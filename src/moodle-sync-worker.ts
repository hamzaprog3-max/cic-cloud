/**
 * 24/7 Automated Moodle -> CIC Cloud (Cloudflare R2 + D1) Sync Engine
 * Runs on Cloudflare Workers Cron Trigger (every 25 minutes) and via Owner Admin API.
 *
 * Supports all Moodle 4.x Boost activity types observed on learn3.sha.edu.eg:
 * - mod/resource (PDF, PPTX, DOCX, XLSX, ZIP, images, media -> streams directly to R2)
 * - mod/folder   (multi-file folders like Sections / Labs -> uploads every file to R2)
 * - mod/url      (external links, Google Drive PDFs, YouTube videos -> resolves destination URL)
 * - mod/quiz     (READ-ONLY inspection of open/close dates + description -> adds assignment card)
 * - mod/forum    (skipped cleanly)
 */

export interface MoodleSyncEnv {
  R2_BUCKET: {
    put(
      key: string,
      value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | null,
      options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
    ): Promise<unknown>;
  };
  DB: {
    prepare(query: string): {
      bind(...values: unknown[]): any;
      all<T = Record<string, any>>(): Promise<{ results: T[]; success: boolean }>;
      first<T = Record<string, any>>(): Promise<T | null>;
      run(): Promise<{ success: boolean; meta?: Record<string, any> }>;
    };
  };
}

export interface MoodleSyncCallbacks {
  buildPublicUrl: (key: string) => string;
  inferContentType: (key: string) => string;
  refreshPublicCache: () => Promise<void>;
}

const R2_MAX_SYNC_FILE_BYTES = 45 * 1024 * 1024; // 45 MB safe single-put limit in Worker
const MAX_NEW_UPLOADS_PER_RUN = 8; // Stay comfortably within Cloudflare Worker CPU & subrequest limits
const MIN_QUIZ_YEAR = 2026; // Ignore leftover quizzes from prior academic years (e.g., 2024-2025)

const CAT_IDS = {
  LECTURES: "ebc86347-e9de-4cc1-bb1b-5b682bf7a5ae",
  RECORDINGS: "1ff5c1cc-931c-4356-92a3-eb40d4a2828b",
  SECTIONS: "9e309104-b955-45ce-9087-30982fa8bbf4",
  ASSIGNMENTS: "8cdaf762-2eca-4836-8c76-7b9e0b8af80c",
  SOLUTIONS: "2dd09cfb-0438-4d5c-acb9-7e55fa6b0a5f",
  EXTERNAL: "a1e35ac3-25a0-461c-86c3-3eac800842c4",
  EXAMS: "fef4fb8d-55d2-4240-86ce-056f8bed6733",
};

const ALLOWED_EXTS = new Set([
  ".pdf", ".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi",
  ".mp3", ".wav", ".m4a", ".aac",
  ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".zip", ".rar",
]);

const DEFAULT_YEAR2_CS_COURSES = [
  {
    moodle_course_id: "1304",
    moodle_course_name: "C.S._اخلاقيات العمل",
    cic_course_id: "3965c8dc-fda0-4dc7-93c3-f27e7245d559",
    cic_course_name: "Work Ethics (H 201)",
  },
  {
    moodle_course_id: "1299",
    moodle_course_name: "البرمجة الشيئية",
    cic_course_id: "b7afc4d8-2a2e-4f10-ba94-2a51a2930526",
    cic_course_name: "Object-Oriented Programming (CS 210)",
  },
  {
    moodle_course_id: "1300",
    moodle_course_name: "معالجة الملفات",
    cic_course_id: "2ddacbf2-7a39-4077-9a00-5b2c386080eb",
    cic_course_name: "File Processing (CS 221)",
  },
  {
    moodle_course_id: "1301",
    moodle_course_name: "تنظيم الحاسب و لغة التجميع",
    cic_course_id: "9fa35c19-bb3a-420b-934c-5f510d23bba1",
    cic_course_name: "Computer Organization & Assembly Language (CS 220)",
  },
  {
    moodle_course_id: "1302",
    moodle_course_name: "بحوث عمليات",
    cic_course_id: "a8071a66-f6aa-4d08-895a-b8602367fd4e",
    cic_course_name: "Operations Research (CS 211)",
  },
  {
    moodle_course_id: "1303",
    moodle_course_name: "إحصاء و احتمالات",
    cic_course_id: "75227029-4133-4ce9-ac13-ba723ce373d5",
    cic_course_name: "Statistics & Probabilities (BS 210)",
  },
];

// ============ HELPERS ============
function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<span[^>]*class="[^"]*accesshide[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function normalizeForCompare(str: string): string {
  return str
    .toLowerCase()
    .replace(/\.(pdf|pptx?|docx?|xlsx?|zip|rar)$/i, "")
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0621-\u064A]+/g, " ")
    .trim();
}

function sanitizeSyncR2Key(rawName: string, prefix: string): string {
  let decoded = rawName;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {}
  const baseFile = decoded.split("/").pop() || decoded;
  const dot = baseFile.lastIndexOf(".");
  let ext = dot >= 0 ? baseFile.slice(dot).toLowerCase() : ".pdf";
  if (!ALLOWED_EXTS.has(ext)) ext = ".pdf";
  const stem = dot >= 0 ? baseFile.slice(0, dot) : baseFile;
  const cleanStem = stem.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "file";
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12);
  return `${Date.now()}-${cleanPrefix ? cleanPrefix + "_" : ""}${cleanStem}${ext}`;
}

function normalizeCookieHeader(rawCookie: string): string {
  const trimmed = rawCookie.trim();
  if (!trimmed) return "";
  // If the user pasted just the MoodleSession value (no "="), wrap it as MoodleSession=...
  if (!trimmed.includes("=")) {
    return `MoodleSession=${trimmed}`;
  }
  return trimmed;
}

function extractRotatedMoodleSession(setCookieHeader: string | null, currentCookie: string): string | null {
  if (!setCookieHeader) return null;
  const m = setCookieHeader.match(/MoodleSession=([^;\s]+)/i);
  if (!m || !m[1] || m[1] === "deleted") return null;
  const newVal = m[1];
  if (currentCookie.includes(`MoodleSession=${newVal}`)) return null;
  if (/MoodleSession=[^;]+/i.test(currentCookie)) {
    return currentCookie.replace(/MoodleSession=[^;]+/i, `MoodleSession=${newVal}`);
  }
  return `MoodleSession=${newVal}`;
}

function parseMoodleDateToIso(text: string): string | null {
  // Examples: "Wednesday, 4 November 2026, 11:00 PM" or "Saturday, 24 October 2026, 11:59 PM"
  const m = text.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!m) return null;
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  };
  const day = String(Number(m[1])).padStart(2, "0");
  const month = months[m[2].toLowerCase()];
  const year = m[3];
  let hour = Number(m[4]);
  const minute = m[5];
  const ampm = m[6].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${minute}`;
}

function isYouTubeHref(url: string): boolean {
  return /^https?:\/\/(?:(?:www|m)\.)?(?:youtube\.com|youtu\.be)\//i.test(url);
}

function isSharePointHref(url: string): boolean {
  return /^https?:\/\/[^/]*(?:sharepoint\.com|1drv\.ms|onedrive\.live\.com|stream\.microsoft\.com)\//i.test(url);
}

function stripOuterNumbers(norm: string): string {
  return norm.replace(/^\d+\s+/, "").replace(/\s+\d+$/, "").trim();
}

function wordOverlapRatio(a: string, b: string): number {
  const wa = new Set(a.split(/\s+/).filter((w) => w.length >= 2));
  const wb = new Set(b.split(/\s+/).filter((w) => w.length >= 2));
  if (wa.size < 3 || wb.size < 3) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

interface ParsedMoodleActivity {
  cmid: string;
  modType: "resource" | "folder" | "url" | "quiz" | "assign";
  title: string;
  sectionName: string;
  url: string;
  description: string | null;
}

/**
 * Parse Moodle 4.x course page HTML into sections & activities.
 */
function parseCourseActivities(html: string, baseUrl: string): ParsedMoodleActivity[] {
  const results: ParsedMoodleActivity[] = [];
  const seenCmids = new Set<string>();

  // Split by Moodle 4 section blocks (<li ... id="section-N" ...>)
  const sectionStarts: Array<{ index: number; name: string }> = [];
  const sectionRe = /<li\b[^>]*\bid="section-\d+"[^>]*>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = sectionRe.exec(html)) !== null) {
    const tag = sm[0];
    const dataNameMatch = tag.match(/data-sectionname="([^"]*)"/i);
    let name = dataNameMatch ? decodeHtmlEntities(dataNameMatch[1]).trim() : "";
    if (!name) {
      const lookahead = html.slice(sm.index, sm.index + 1800);
      const hMatch = lookahead.match(/<h3[^>]*class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
      if (hMatch) name = stripTags(hMatch[1]);
    }
    sectionStarts.push({ index: sm.index, name: name || "General" });
  }

  const slices: Array<{ name: string; chunk: string }> =
    sectionStarts.length > 0
      ? sectionStarts.map((s, i) => ({
          name: s.name,
          chunk: html.slice(s.index, i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : html.length),
        }))
      : [{ name: "General", chunk: html }];

  for (const slice of slices) {
    // Match each Moodle activity <li> (e.g. id="module-10472" class="activity activity-wrapper resource modtype_resource ...")
    const actRe = /<li\b[^>]*\bid="module-(\d+)"[^>]*class="([^"]*)"[^>]*>([\s\S]*?)(?=<li\b[^>]*\bid="module-\d+"|<\/ul>\s*<\/div>\s*<\/li>|$)/gi;
    let am: RegExpExecArray | null;
    while ((am = actRe.exec(slice.chunk)) !== null) {
      const cmid = am[1];
      if (seenCmids.has(cmid)) continue;
      const cls = am[2];
      const body = am[3];
      const modMatch = cls.match(/\bmodtype_(resource|folder|url|quiz|assign)\b/i);
      if (!modMatch) continue;
      const modType = modMatch[1].toLowerCase() as ParsedMoodleActivity["modType"];

      const instMatch = body.match(/<span[^>]*class="[^"]*instancename[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      const linkMatch = body.match(
        new RegExp(`href="([^"]*\\/mod\\/${modType}\\/view\\.php\\?id=${cmid}[^"]*)"`, "i")
      );
      let title = instMatch ? stripTags(instMatch[1]) : "";
      if (!title) {
        const aMatch = body.match(/<a[^>]*class="[^"]*aalink[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
        if (aMatch) title = stripTags(aMatch[1]);
      }
      if (!title) continue;

      const altMatch = body.match(/<div[^>]*class="[^"]*(?:activity-altcontent|contentafterlink)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const description = altMatch ? stripTags(altMatch[1]) || null : null;

      const url = linkMatch
        ? decodeHtmlEntities(linkMatch[1])
        : `${baseUrl}/mod/${modType}/view.php?id=${cmid}`;

      seenCmids.add(cmid);
      results.push({
        cmid,
        modType,
        title,
        sectionName: slice.name,
        url,
        description,
      });
    }

    // Fallback scan if theme uses slightly different markup
    const fallbackRe = /href="(https?:\/\/[^"]+\/mod\/(resource|folder|url|quiz|assign)\/view\.php\?id=(\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
    let fm: RegExpExecArray | null;
    while ((fm = fallbackRe.exec(slice.chunk)) !== null) {
      const url = decodeHtmlEntities(fm[1]);
      const modType = fm[2].toLowerCase() as ParsedMoodleActivity["modType"];
      const cmid = fm[3];
      if (seenCmids.has(cmid)) continue;
      const title = stripTags(fm[4]);
      if (!title) continue;
      seenCmids.add(cmid);
      results.push({
        cmid,
        modType,
        title,
        sectionName: slice.name,
        url,
        description: null,
      });
    }
  }

  return results;
}

/**
 * Smart categorization for CIC Cloud categories based on title, section name, filename, and Moodle type.
 */
function classifyMoodleItem(opts: {
  title: string;
  sectionName: string;
  fileName?: string | null;
  modType: string;
  resolvedUrl?: string | null;
}): { categoryId: string; isReference: boolean; isAssignment: boolean } {
  const combined = `${opts.title} ${opts.fileName || ""}`.toLowerCase();
  const fullContext = `${opts.title} ${opts.sectionName} ${opts.fileName || ""}`.toLowerCase();

  if (opts.modType === "quiz" || opts.modType === "assign") {
    return { categoryId: CAT_IDS.ASSIGNMENTS, isReference: false, isAssignment: true };
  }

  // Model Answers / Solutions
  if (/(?:model[\s_-]*answer|answers|نموذج\s*(?:ال)?[إا]جاب|حل\s*(?:شيت|التكليف|الواجب))/i.test(combined)) {
    if (/(?:midterm|final|quiz|exam|امتحان|كويز|ميدترم|فاينل)/i.test(combined)) {
      return { categoryId: CAT_IDS.EXAMS, isReference: false, isAssignment: false };
    }
    return { categoryId: CAT_IDS.SOLUTIONS, isReference: false, isAssignment: false };
  }

  // Exams & Revisions
  if (/(?:midterm|final\s*exam|questions\s*for\s*final|revision|review\s*sheet|question\s*bank|مراجع|امتحان|ميدترم|فاينل)/i.test(fullContext)) {
    return { categoryId: CAT_IDS.EXAMS, isReference: false, isAssignment: false };
  }

  // Course Book / Reference / Syllabus / Specification
  if (/(?:course\s*book|^book$|reference|syllabus|syllebus|specification|objectives|ilos|assessment|instructors|كتاب\s*الماد|مرجع)/i.test(combined) ||
      /^book$/i.test(opts.sectionName.trim())) {
    return { categoryId: CAT_IDS.LECTURES, isReference: true, isAssignment: false };
  }

  // Sections & Labs
  if (/(?:\bsec(?:tion)?\s*\d+|\blab[\s_-]*\d*|\bsections?\b|\blabs?_20|سكشن|سكاشن|معمل|عملي|suggestion\s*project)/i.test(fullContext)) {
    return { categoryId: CAT_IDS.SECTIONS, isReference: false, isAssignment: false };
  }

  // Assignments / Sheets / Offline Quizzes
  if (/(?:\bsheet[\s_-]*\d+|\bassignment|\bquiz\s*\(?\d|\bhomework|تكليف|شيت|اختبار)/i.test(combined)) {
    return { categoryId: CAT_IDS.ASSIGNMENTS, isReference: false, isAssignment: true };
  }

  // External tutorials / online video links
  if (opts.modType === "url") {
    if (opts.resolvedUrl && isSharePointHref(opts.resolvedUrl)) {
      return { categoryId: CAT_IDS.RECORDINGS, isReference: false, isAssignment: false };
    }
    if (opts.resolvedUrl && isYouTubeHref(opts.resolvedUrl)) {
      return { categoryId: CAT_IDS.EXTERNAL, isReference: false, isAssignment: false };
    }
    if (/(?:tutorial|problems|w3schools|geeksforgeeks|on\s*line|online)/i.test(combined)) {
      return { categoryId: CAT_IDS.EXTERNAL, isReference: false, isAssignment: false };
    }
    // Otherwise (e.g., Operations Research UNIT #1..#6 Drive PDFs) -> Lectures
    return { categoryId: CAT_IDS.LECTURES, isReference: false, isAssignment: false };
  }

  return { categoryId: CAT_IDS.LECTURES, isReference: false, isAssignment: false };
}

/**
 * Heuristic check to avoid duplicating files that the Year 2 team already uploaded manually.
 */
function findExistingMaterialMatch(
  existingMaterials: Array<Record<string, any>>,
  candidate: {
    title: string;
    fileName?: string | null;
    cmid: string;
    modType?: string;
    sourceUrl?: string | null;
    resolvedUrl?: string | null;
  }
): Record<string, any> | null {
  const candNormTitle = normalizeForCompare(candidate.title);
  const candNormFile = candidate.fileName ? normalizeForCompare(candidate.fileName) : "";
  const candIsOnline = /\bon\s*line\b/i.test(candidate.title);
  const candIsUpdated = /\bupdated\b/i.test(candidate.title);

  for (const m of existingMaterials) {
    // 1. Exact URL / Moodle CMID match
    const existingUrls = [m.pdf_url, m.external_link, m.submission_link, m.video_url].filter(Boolean) as string[];
    for (const u of existingUrls) {
      if (candidate.resolvedUrl && u.trim() === candidate.resolvedUrl.trim()) return m;
      if (u.includes(`view.php?id=${candidate.cmid}`)) return m;
    }

    // Never match a downloadable resource file against a link-only entry (no pdf_url),
    // nor a non-document URL (Teams/YouTube/tutorial) against an uploaded R2 file unless URL matched above.
    const existingHasR2File = typeof m.pdf_url === "string" && m.pdf_url.includes("r2.dev/");
    const existingIsLinkOnly = !m.pdf_url;
    const candIsDriveOrDocUrl = Boolean(candidate.resolvedUrl && /drive\.google\.com|\.pdf(\?|$)/i.test(candidate.resolvedUrl));
    if ((candidate.modType === "resource" || candidate.modType === "folder") && existingIsLinkOnly) continue;
    if (candidate.modType === "url" && existingHasR2File && !candIsDriveOrDocUrl) continue;

    // Never mix "On line" video/web links with offline PDF slides, or "Updated" with non-updated
    const matIsOnline = /\bon\s*line\b/i.test(String(m.title || ""));
    if (candIsOnline !== matIsOnline) continue;
    const matIsUpdated = /\bupdated\b/i.test(String(m.title || ""));
    if (candIsUpdated && !matIsUpdated) continue;

    // 2. Exact normalized title, stripped-number title, word-overlap (handles 1-letter typos), or filename match
    const mTitle = normalizeForCompare(String(m.title || ""));
    const mDisp = normalizeForCompare(String(m.pdf_display_name || ""));
    let mR2Stem = "";
    if (existingHasR2File) {
      const key = String(m.pdf_url).split("/").pop() || "";
      mR2Stem = normalizeForCompare(key.replace(/^\d+-/, ""));
    }

    if (candNormTitle && (candNormTitle === mTitle || candNormTitle === mDisp)) return m;
    const candStripped = stripOuterNumbers(candNormTitle);
    const matStripped = stripOuterNumbers(mTitle);
    if (candStripped.length >= 8 && matStripped.length >= 8 && candStripped === matStripped) {
      return m;
    }
    if (wordOverlapRatio(candNormTitle, mTitle) >= 0.75) {
      const candTrailNum = candNormTitle.match(/(\d+)$/)?.[1] || "";
      const matTrailNum = mTitle.match(/(\d+)$/)?.[1] || "";
      if (candTrailNum === matTrailNum) return m;
    }
    if (
      candNormFile &&
      candNormFile.length >= 6 &&
      mR2Stem.length >= 6 &&
      (candNormFile === mR2Stem || mR2Stem.includes(candNormFile) || candNormFile.includes(mR2Stem))
    ) {
      // Guard against numbered suffixes like "polymorphism2" matching "polymorphism"
      const candTrailNum = candNormTitle.match(/(\d+)$/)?.[1] || "";
      const matTrailNum = mTitle.match(/(\d+)$/)?.[1] || "";
      if (candTrailNum === matTrailNum) return m;
    }

    // 3. Token overlap check for Arabic/English Lecture/Chapter/Unit/Lab/Section numbering
    const checkNumPair = (re: RegExp, a: string, b: string) => {
      const ma = a.match(re);
      const mb = b.match(re);
      return Boolean(ma && mb && Number(ma[1]) === Number(mb[1]));
    };
    const candAll = `${candidate.title} ${candidate.fileName || ""}`;
    const matAll = `${m.title || ""} ${m.pdf_display_name || ""} ${mR2Stem}`;
    if (
      (checkNumPair(/(?:lecture|lec|unit|ch(?:apter)?)\s*\.?\s*0*(\d+)\b/i, candAll, matAll) &&
        !/(?:section|sec|lab|sheet|quiz|answer|recording|تسجيل)/i.test(candAll) &&
        !/(?:section|sec|lab|sheet|quiz|answer|recording|تسجيل)/i.test(matAll)) ||
      (checkNumPair(/(?:section|sec|lab)\s*\.?\s*0*(\d+)\b/i, candAll, matAll) &&
        !/(?:sheet|quiz|answer|assignment)/i.test(candAll) &&
        !/(?:sheet|quiz|answer|assignment)/i.test(matAll))
    ) {
      const aPart = candAll.match(/part\s*0*(\d+)/i)?.[1];
      const bPart = matAll.match(/part\s*0*(\d+)/i)?.[1];
      if (aPart === bPart) return m;
    }
  }
  return null;
}

// ============ SCHEMA ENSURE & SEED ============
export async function ensureMoodleSyncTables(env: MoodleSyncEnv): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moodle_sync_config (
      id TEXT PRIMARY KEY,
      moodle_base_url TEXT NOT NULL DEFAULT 'https://learn3.sha.edu.eg',
      session_cookie TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_students INTEGER NOT NULL DEFAULT 1,
      session_status TEXT NOT NULL DEFAULT 'unconfigured',
      last_check_at TEXT,
      last_sync_at TEXT,
      last_error TEXT,
      last_summary TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moodle_sync_courses (
      id TEXT PRIMARY KEY,
      moodle_course_id TEXT NOT NULL UNIQUE,
      moodle_course_name TEXT NOT NULL,
      cic_course_id TEXT NOT NULL,
      cic_course_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moodle_sync_items (
      id TEXT PRIMARY KEY,
      moodle_course_id TEXT NOT NULL,
      moodle_key TEXT NOT NULL,
      moodle_cmid TEXT NOT NULL,
      moodle_type TEXT NOT NULL,
      moodle_title TEXT NOT NULL,
      source_url TEXT,
      material_id TEXT,
      status TEXT NOT NULL DEFAULT 'synced',
      synced_at TEXT DEFAULT (datetime('now')),
      UNIQUE(moodle_course_id, moodle_key)
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS moodle_sync_runs (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      status TEXT NOT NULL,
      courses_checked INTEGER NOT NULL DEFAULT 0,
      items_added INTEGER NOT NULL DEFAULT 0,
      items_skipped INTEGER NOT NULL DEFAULT 0,
      errors TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
    )`
  ).run();

  // Seed default config row if missing
  await env.DB.prepare(
    `INSERT OR IGNORE INTO moodle_sync_config (id, moodle_base_url, enabled, notify_students, session_status, updated_at)
     VALUES ('default', 'https://learn3.sha.edu.eg', 1, 1, 'unconfigured', ?)`
  )
    .bind(new Date().toISOString())
    .run();

  // Seed all 6 Year 2 CS course mappings if missing
  const now = new Date().toISOString();
  for (const c of DEFAULT_YEAR2_CS_COURSES) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO moodle_sync_courses (id, moodle_course_id, moodle_course_name, cic_course_id, cic_course_name, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(`ms-course-${c.moodle_course_id}`, c.moodle_course_id, c.moodle_course_name, c.cic_course_id, c.cic_course_name, now)
      .run();
  }
}

// ============ AUTHENTICATED MOODLE FETCH ============
interface MoodleFetcher {
  getCookie: () => string;
  cookieRotated: () => boolean;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

function createMoodleFetcher(initialCookie: string): MoodleFetcher {
  let cookie = normalizeCookieHeader(initialCookie);
  let rotated = false;

  return {
    getCookie: () => cookie,
    cookieRotated: () => rotated,
    fetch: async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      headers.set("Cookie", cookie);
      headers.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      );
      headers.set("Accept-Language", "en-US,en;q=0.9,ar;q=0.8");
      const res = await fetch(url, {
        ...init,
        headers,
      });
      const updated = extractRotatedMoodleSession(res.headers.get("set-cookie"), cookie);
      if (updated) {
        cookie = updated;
        rotated = true;
      }
      return res;
    },
  };
}

function looksLikeLoginPage(res: Response, bodyText?: string): boolean {
  const loc = res.headers.get("location") || "";
  if (/login\/index\.php|auth\/oidc|login\.microsoftonline\.com/i.test(loc)) return true;
  if (res.url && /login\/index\.php|auth\/oidc|login\.microsoftonline\.com/i.test(res.url)) return true;
  if (bodyText) {
    const hasLogout = /login\/logout\.php/i.test(bodyText);
    if (!hasLogout && /login\/index\.php|id="login"|auth\/oidc/i.test(bodyText)) return true;
  }
  return false;
}

// ============ CORE SYNC RUNNER ============
export interface MoodleSyncRunResult {
  ok: boolean;
  status: "success" | "session_expired" | "unconfigured" | "disabled" | "partial" | "error";
  coursesChecked: number;
  itemsAdded: number;
  itemsSkipped: number;
  newItems: Array<{ course: string; title: string; category: string }>;
  errors: string[];
  message: string;
}

export async function runMoodleSync(
  env: MoodleSyncEnv,
  callbacks: MoodleSyncCallbacks,
  options: { triggerType?: "cron" | "manual"; force?: boolean; onlyCourseId?: string } = {}
): Promise<MoodleSyncRunResult> {
  const triggerType = options.triggerType || "cron";
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const newItems: Array<{ course: string; title: string; category: string }> = [];
  let coursesChecked = 0;
  let itemsAdded = 0;
  let itemsSkipped = 0;
  let uploadsThisRun = 0;

  await ensureMoodleSyncTables(env);

  const cfg = await env.DB.prepare("SELECT * FROM moodle_sync_config WHERE id = 'default'").first<Record<string, any>>();
  if (!cfg) {
    return {
      ok: false,
      status: "unconfigured",
      coursesChecked: 0,
      itemsAdded: 0,
      itemsSkipped: 0,
      newItems: [],
      errors: ["Config missing"],
      message: "إعدادات مزامنة مودل غير مهيأة بعد.",
    };
  }

  if (!cfg.enabled && !options.force) {
    return {
      ok: true,
      status: "disabled",
      coursesChecked: 0,
      itemsAdded: 0,
      itemsSkipped: 0,
      newItems: [],
      errors: [],
      message: "المزامنة التلقائية متوقفة مؤقتاً.",
    };
  }

  const rawCookie = String(cfg.session_cookie || "").trim();
  if (!rawCookie) {
    await env.DB.prepare(
      "UPDATE moodle_sync_config SET session_status = 'unconfigured', last_check_at = ?, updated_at = ? WHERE id = 'default'"
    )
      .bind(startedAt, startedAt)
      .run();
    return {
      ok: false,
      status: "unconfigured",
      coursesChecked: 0,
      itemsAdded: 0,
      itemsSkipped: 0,
      newItems: [],
      errors: ["لم يتم إدخال جلسة MoodleSession بعد"],
      message: "يرجى إدخال كوكي جلسة مودل (MoodleSession) لتفعيل المزامنة 24/7.",
    };
  }

  const baseUrl = String(cfg.moodle_base_url || "https://learn3.sha.edu.eg").replace(/\/+$/, "");
  const moodle = createMoodleFetcher(rawCookie);

  // 1. Session health check & keep-alive ping
  try {
    const pingRes = await moodle.fetch(`${baseUrl}/my/`, { redirect: "manual" });
    const pingHtml = pingRes.status === 200 ? await pingRes.text() : "";
    if (pingRes.status >= 300 || looksLikeLoginPage(pingRes, pingHtml)) {
      const finishedAt = new Date().toISOString();
      const errMsg = `انتهت صلاحية جلسة مودل (HTTP ${pingRes.status}) — يلزم تحديث MoodleSession من المتصفح.`;
      await env.DB.prepare(
        "UPDATE moodle_sync_config SET session_status = 'expired', last_check_at = ?, last_error = ?, updated_at = ? WHERE id = 'default'"
      )
        .bind(finishedAt, errMsg, finishedAt)
        .run();
      await env.DB.prepare(
        `INSERT INTO moodle_sync_runs (id, trigger_type, status, courses_checked, items_added, items_skipped, errors, started_at, finished_at)
         VALUES (?, ?, 'session_expired', 0, 0, 0, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), triggerType, JSON.stringify([errMsg]), startedAt, finishedAt)
        .run();
      return {
        ok: false,
        status: "session_expired",
        coursesChecked: 0,
        itemsAdded: 0,
        itemsSkipped: 0,
        newItems: [],
        errors: [errMsg],
        message: errMsg,
      };
    }
  } catch (err: any) {
    const finishedAt = new Date().toISOString();
    const errMsg = `فشل الاتصال بموقع مودل: ${err?.message || String(err)}`;
    await env.DB.prepare(
      "UPDATE moodle_sync_config SET session_status = 'error', last_check_at = ?, last_error = ?, updated_at = ? WHERE id = 'default'"
    )
      .bind(finishedAt, errMsg, finishedAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO moodle_sync_runs (id, trigger_type, status, courses_checked, items_added, items_skipped, errors, started_at, finished_at)
       VALUES (?, ?, 'error', 0, 0, 0, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), triggerType, JSON.stringify([errMsg]), startedAt, finishedAt)
      .run();
    return {
      ok: false,
      status: "error",
      coursesChecked: 0,
      itemsAdded: 0,
      itemsSkipped: 0,
      newItems: [],
      errors: [errMsg],
      message: errMsg,
    };
  }

  // 2. Load enabled courses
  const { results: mappedCourses } = options.onlyCourseId
    ? await env.DB.prepare("SELECT * FROM moodle_sync_courses WHERE moodle_course_id = ?")
        .bind(options.onlyCourseId)
        .all<Record<string, any>>()
    : await env.DB.prepare("SELECT * FROM moodle_sync_courses WHERE enabled = 1 ORDER BY moodle_course_id ASC")
        .all<Record<string, any>>();

  // 3. Helper to upload a pluginfile URL into R2 & insert into D1
  const syncSingleFile = async (params: {
    course: Record<string, any>;
    moodleKey: string;
    cmid: string;
    modType: string;
    title: string;
    sectionName: string;
    pluginFileUrl: string;
    existingMaterials: Array<Record<string, any>>;
    trackedKeys: Set<string>;
  }) => {
    if (params.trackedKeys.has(params.moodleKey)) {
      itemsSkipped++;
      return;
    }

    const rawUrlPath = params.pluginFileUrl.split("?")[0];
    let decodedName = rawUrlPath.split("/").pop() || params.title;
    try {
      decodedName = decodeURIComponent(decodedName);
    } catch {}

    // Deduplicate against manually uploaded materials
    const existing = findExistingMaterialMatch(params.existingMaterials, {
      title: params.title,
      fileName: decodedName,
      cmid: params.cmid,
      modType: params.modType,
      sourceUrl: params.pluginFileUrl,
    });
    if (existing) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'linked_existing', ?)`
      )
        .bind(
          crypto.randomUUID(),
          params.course.moodle_course_id,
          params.moodleKey,
          params.cmid,
          params.modType,
          params.title,
          params.pluginFileUrl,
          existing.id,
          new Date().toISOString()
        )
        .run();
      params.trackedKeys.add(params.moodleKey);
      itemsSkipped++;
      return;
    }

    if (uploadsThisRun >= MAX_NEW_UPLOADS_PER_RUN) {
      return; // Defer remaining new files to the next cron tick cleanly
    }

    const dlUrl = params.pluginFileUrl.includes("forcedownload=")
      ? params.pluginFileUrl
      : `${params.pluginFileUrl}${params.pluginFileUrl.includes("?") ? "&" : "?"}forcedownload=1`;

    const fileRes = await moodle.fetch(dlUrl, { redirect: "follow" });
    if (!fileRes.ok) {
      errors.push(`[${params.course.cic_course_name}] فشل تحميل ${params.title} (HTTP ${fileRes.status})`);
      return;
    }

    const respContentType = (fileRes.headers.get("content-type") || "").toLowerCase();
    if (respContentType.startsWith("text/html")) {
      errors.push(`[${params.course.cic_course_name}] تخطي ${params.title}: استجابة HTML بدلاً من ملف`);
      return;
    }

    const contentLength = Number(fileRes.headers.get("content-length") || "0");
    if (contentLength > R2_MAX_SYNC_FILE_BYTES) {
      errors.push(`[${params.course.cic_course_name}] تخطي ${params.title}: الحجم أكبر من 45MB`);
      return;
    }

    const fileBytes = await fileRes.arrayBuffer();
    if (fileBytes.byteLength === 0 || fileBytes.byteLength > R2_MAX_SYNC_FILE_BYTES) {
      errors.push(`[${params.course.cic_course_name}] تخطي ${params.title}: حجم الملف غير صالح (${fileBytes.byteLength})`);
      return;
    }

    const disp = fileRes.headers.get("content-disposition") || "";
    const dispMatch = disp.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i);
    if (dispMatch) {
      try {
        decodedName = decodeURIComponent(dispMatch[1] || dispMatch[2]);
      } catch {
        decodedName = dispMatch[1] || dispMatch[2];
      }
    }

    const r2Key = sanitizeSyncR2Key(decodedName || params.title, `m${params.course.moodle_course_id}`);
    const contentType = callbacks.inferContentType(r2Key);
    await env.R2_BUCKET.put(r2Key, fileBytes, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const publicUrl = callbacks.buildPublicUrl(r2Key);

    const cls = classifyMoodleItem({
      title: params.title,
      sectionName: params.sectionName,
      fileName: decodedName,
      modType: params.modType,
    });

    const materialId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const displayName = decodedName.replace(/\.(pdf|pptx?|docx?|xlsx?|zip|rar)$/i, "").trim() || params.title;

    await env.DB.prepare(
      `INSERT INTO materials (
        id, title, type, course_id, category_id, pdf_url, pdf_display_name,
        external_link, submission_link, deadline, is_assignment, is_list,
        list_content, is_reference, section_number, notes, archived,
        sort_order, video_url, deleted_at, created_at
      ) VALUES (?, ?, 'lecture', ?, ?, ?, ?, NULL, NULL, NULL, ?, 0, NULL, ?, NULL, NULL, 0, NULL, NULL, NULL, ?)`
    )
      .bind(
        materialId,
        params.title,
        params.course.cic_course_id,
        cls.categoryId,
        publicUrl,
        displayName,
        cls.isAssignment ? 1 : 0,
        cls.isReference ? 1 : 0,
        nowIso
      )
      .run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)`
    )
      .bind(
        crypto.randomUUID(),
        params.course.moodle_course_id,
        params.moodleKey,
        params.cmid,
        params.modType,
        params.title,
        params.pluginFileUrl,
        materialId,
        nowIso
      )
      .run();

    params.trackedKeys.add(params.moodleKey);
    params.existingMaterials.push({
      id: materialId,
      title: params.title,
      pdf_url: publicUrl,
      pdf_display_name: displayName,
    });
    uploadsThisRun++;
    itemsAdded++;
    newItems.push({ course: params.course.cic_course_name, title: params.title, category: cls.categoryId });
  };

  // 4. Iterate mapped courses
  for (const course of mappedCourses) {
    try {
      const courseRes = await moodle.fetch(`${baseUrl}/course/view.php?id=${encodeURIComponent(course.moodle_course_id)}`, {
        redirect: "follow",
      });
      if (!courseRes.ok) {
        errors.push(`[${course.cic_course_name}] HTTP ${courseRes.status}`);
        continue;
      }
      const courseHtml = await courseRes.text();
      if (looksLikeLoginPage(courseRes, courseHtml)) {
        errors.push(`[${course.cic_course_name}] الجلسة انتهت أثناء القراءة`);
        break;
      }

      coursesChecked++;
      const activities = parseCourseActivities(courseHtml, baseUrl);

      const [{ results: trackedRows }, { results: existingMaterials }] = await Promise.all([
        env.DB.prepare("SELECT moodle_key FROM moodle_sync_items WHERE moodle_course_id = ?")
          .bind(course.moodle_course_id)
          .all<{ moodle_key: string }>(),
        env.DB.prepare("SELECT id, title, pdf_url, pdf_display_name, external_link, submission_link, video_url FROM materials WHERE course_id = ? AND deleted_at IS NULL")
          .bind(course.cic_course_id)
          .all<Record<string, any>>(),
      ]);
      const trackedKeys = new Set(trackedRows.map((r) => r.moodle_key));

      for (const act of activities) {
        try {
          if (act.modType === "resource") {
            const mKey = `res:${act.cmid}`;
            if (trackedKeys.has(mKey)) {
              itemsSkipped++;
              continue;
            }
            // Fast pre-check before downloading resource HTML
            const preMatch = findExistingMaterialMatch(existingMaterials, {
              title: act.title,
              cmid: act.cmid,
              modType: "resource",
              sourceUrl: act.url,
            });
            if (preMatch) {
              await env.DB.prepare(
                `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
                 VALUES (?, ?, ?, ?, 'resource', ?, ?, ?, 'linked_existing', ?)`
              )
                .bind(crypto.randomUUID(), course.moodle_course_id, mKey, act.cmid, act.title, act.url, preMatch.id, new Date().toISOString())
                .run();
              trackedKeys.add(mKey);
              itemsSkipped++;
              continue;
            }

            if (uploadsThisRun >= MAX_NEW_UPLOADS_PER_RUN) continue;

            // Resolve pluginfile.php URL
            const resView = await moodle.fetch(`${baseUrl}/mod/resource/view.php?id=${act.cmid}&redirect=1`, {
              redirect: "manual",
            });
            let pluginFileUrl: string | null = null;
            const loc = resView.headers.get("location");
            if (loc && loc.includes("pluginfile.php")) {
              pluginFileUrl = loc.startsWith("http") ? loc : `${baseUrl}${loc}`;
            } else if (resView.status === 200) {
              const ct = (resView.headers.get("content-type") || "").toLowerCase();
              if (ct.startsWith("text/html")) {
                const resHtml = await resView.text();
                const pfMatch = resHtml.match(/https?:\/\/[^"'<>\s]+\/pluginfile\.php\/\d+\/mod_resource\/content\/[^"'<>\s?]+/i);
                if (pfMatch) pluginFileUrl = decodeHtmlEntities(pfMatch[0]);
              } else {
                // Direct file returned from mod/resource/view.php
                pluginFileUrl = `${baseUrl}/mod/resource/view.php?id=${act.cmid}&redirect=1`;
              }
            }

            if (!pluginFileUrl) {
              errors.push(`[${course.cic_course_name}] لم يتم العثور على رابط الملف لـ ${act.title}`);
              continue;
            }

            await syncSingleFile({
              course,
              moodleKey: mKey,
              cmid: act.cmid,
              modType: "resource",
              title: act.title,
              sectionName: act.sectionName,
              pluginFileUrl,
              existingMaterials,
              trackedKeys,
            });
          } else if (act.modType === "folder") {
            const folderRes = await moodle.fetch(`${baseUrl}/mod/folder/view.php?id=${act.cmid}`, { redirect: "follow" });
            if (!folderRes.ok) continue;
            const folderHtml = await folderRes.text();
            const fileUrls = new Set<string>();
            const pfRe = /https?:\/\/[^"'<>\s]+\/pluginfile\.php\/\d+\/mod_folder\/content\/[^"'<>\s?]+/gi;
            let pm: RegExpExecArray | null;
            while ((pm = pfRe.exec(folderHtml)) !== null) {
              fileUrls.add(decodeHtmlEntities(pm[0]));
            }
            for (const fUrl of fileUrls) {
              let fName = fUrl.split("/").pop() || "file";
              try {
                fName = decodeURIComponent(fName);
              } catch {}
              const fKey = `folder:${act.cmid}:${fName}`;
              const cleanTitle = fName.replace(/\.(pdf|pptx?|docx?|xlsx?|zip|rar)$/i, "").replace(/[_]+/g, " ").trim();
              await syncSingleFile({
                course,
                moodleKey: fKey,
                cmid: act.cmid,
                modType: "folder",
                title: cleanTitle || fName,
                sectionName: `${act.sectionName} ${act.title}`,
                pluginFileUrl: fUrl,
                existingMaterials,
                trackedKeys,
              });
            }
          } else if (act.modType === "url") {
            const mKey = `url:${act.cmid}`;
            if (trackedKeys.has(mKey)) {
              itemsSkipped++;
              continue;
            }
            const urlView = await moodle.fetch(`${baseUrl}/mod/url/view.php?id=${act.cmid}&redirect=1`, {
              redirect: "manual",
            });
            let resolvedUrl: string | null = null;
            const loc = urlView.headers.get("location");
            if (loc && /^https?:\/\//i.test(loc) && !loc.includes("learn3.sha.edu.eg/login")) {
              resolvedUrl = loc;
            } else if (urlView.status === 200) {
              const urlHtml = await urlView.text();
              const workMatch = urlHtml.match(/class="urlworkaround"[\s\S]*?<a[^>]*href="(https?:\/\/[^"]+)"/i);
              if (workMatch) resolvedUrl = decodeHtmlEntities(workMatch[1]);
            }
            if (!resolvedUrl) continue;

            const existing = findExistingMaterialMatch(existingMaterials, {
              title: act.title,
              cmid: act.cmid,
              modType: "url",
              sourceUrl: act.url,
              resolvedUrl,
            });
            if (existing) {
              await env.DB.prepare(
                `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
                 VALUES (?, ?, ?, ?, 'url', ?, ?, ?, 'linked_existing', ?)`
              )
                .bind(crypto.randomUUID(), course.moodle_course_id, mKey, act.cmid, act.title, resolvedUrl, existing.id, new Date().toISOString())
                .run();
              trackedKeys.add(mKey);
              itemsSkipped++;
              continue;
            }

            const cls = classifyMoodleItem({
              title: act.title,
              sectionName: act.sectionName,
              modType: "url",
              resolvedUrl,
            });
            const isYtOrSp = isYouTubeHref(resolvedUrl) || isSharePointHref(resolvedUrl);
            const isDriveOrFile = !isYtOrSp && /drive\.google\.com|\.pdf(\?|$)/i.test(resolvedUrl);
            const materialId = crypto.randomUUID();
            const nowIso = new Date().toISOString();

            await env.DB.prepare(
              `INSERT INTO materials (
                id, title, type, course_id, category_id, pdf_url, pdf_display_name,
                external_link, submission_link, deadline, is_assignment, is_list,
                list_content, is_reference, section_number, notes, archived,
                sort_order, video_url, deleted_at, created_at
              ) VALUES (?, ?, 'lecture', ?, ?, ?, ?, ?, NULL, NULL, ?, 0, NULL, ?, NULL, NULL, 0, NULL, ?, NULL, ?)`
            )
              .bind(
                materialId,
                act.title,
                course.cic_course_id,
                cls.categoryId,
                isDriveOrFile ? resolvedUrl : null,
                isDriveOrFile ? act.title : null,
                !isYtOrSp && !isDriveOrFile ? resolvedUrl : null,
                cls.isAssignment ? 1 : 0,
                cls.isReference ? 1 : 0,
                isYtOrSp ? resolvedUrl : null,
                nowIso
              )
              .run();

            await env.DB.prepare(
              `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
               VALUES (?, ?, ?, ?, 'url', ?, ?, ?, 'synced', ?)`
            )
              .bind(crypto.randomUUID(), course.moodle_course_id, mKey, act.cmid, act.title, resolvedUrl, materialId, nowIso)
              .run();

            trackedKeys.add(mKey);
            existingMaterials.push({ id: materialId, title: act.title, external_link: resolvedUrl, pdf_url: resolvedUrl });
            itemsAdded++;
            newItems.push({ course: course.cic_course_name, title: act.title, category: cls.categoryId });
          } else if (act.modType === "quiz") {
            const mKey = `quiz:${act.cmid}`;
            if (trackedKeys.has(mKey)) {
              itemsSkipped++;
              continue;
            }
            const existing = findExistingMaterialMatch(existingMaterials, {
              title: act.title,
              cmid: act.cmid,
              sourceUrl: act.url,
            });
            if (existing) {
              await env.DB.prepare(
                `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
                 VALUES (?, ?, ?, ?, 'quiz', ?, ?, ?, 'linked_existing', ?)`
              )
                .bind(crypto.randomUUID(), course.moodle_course_id, mKey, act.cmid, act.title, act.url, existing.id, new Date().toISOString())
                .run();
              trackedKeys.add(mKey);
              itemsSkipped++;
              continue;
            }

            // Read-only quiz info page fetch
            const quizRes = await moodle.fetch(`${baseUrl}/mod/quiz/view.php?id=${act.cmid}`, { redirect: "follow" });
            let deadline: string | null = null;
            let notesParts: string[] = ["كويز على منصة المودل"];

            if (quizRes.ok) {
              const quizHtml = await quizRes.text();
              const closedMatch = quizHtml.match(/(?:Closed|Closes):?\s*<\/strong>\s*([^<]+)/i) ||
                quizHtml.match(/(?:Closed|Closes):?\s*([A-Za-z]+,?\s+\d{1,2}\s+[A-Za-z]+\s+\d{4},?\s+\d{1,2}:\d{2}\s*[AP]M)/i);
              if (closedMatch) {
                deadline = parseMoodleDateToIso(stripTags(closedMatch[1]));
              }
              const openedMatch = quizHtml.match(/(?:Opened|Opens):?\s*<\/strong>\s*([^<]+)/i);
              if (openedMatch) {
                notesParts.push(`يفتح: ${stripTags(openedMatch[1])}`);
              }
              const introMatch = quizHtml.match(/<div[^>]*id="intro"[^>]*>([\s\S]*?)<\/div>/i);
              if (introMatch) {
                const introText = stripTags(introMatch[1]).slice(0, 260);
                if (introText) notesParts.push(introText);
              }
            }

            // Skip leftover old quizzes from previous academic years (e.g. 2024-2025)
            const yearInDeadline = deadline ? Number(deadline.slice(0, 4)) : null;
            const yearInTitle = act.title.match(/20(2[0-5])/) ? Number(`20${act.title.match(/20(2[0-5])/)![1]}`) : null;
            if ((yearInDeadline && yearInDeadline < MIN_QUIZ_YEAR) || (yearInTitle && yearInTitle < MIN_QUIZ_YEAR)) {
              await env.DB.prepare(
                `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
                 VALUES (?, ?, ?, ?, 'quiz', ?, ?, NULL, 'ignored_old', ?)`
              )
                .bind(crypto.randomUUID(), course.moodle_course_id, mKey, act.cmid, act.title, act.url, new Date().toISOString())
                .run();
              trackedKeys.add(mKey);
              itemsSkipped++;
              continue;
            }

            const materialId = crypto.randomUUID();
            const nowIso = new Date().toISOString();
            const quizUrl = `${baseUrl}/mod/quiz/view.php?id=${act.cmid}`;

            await env.DB.prepare(
              `INSERT INTO materials (
                id, title, type, course_id, category_id, pdf_url, pdf_display_name,
                external_link, submission_link, deadline, is_assignment, is_list,
                list_content, is_reference, section_number, notes, archived,
                sort_order, video_url, deleted_at, created_at
              ) VALUES (?, ?, 'lecture', ?, ?, NULL, NULL, NULL, ?, ?, 1, 0, NULL, 0, NULL, ?, 0, NULL, NULL, NULL, ?)`
            )
              .bind(
                materialId,
                `${act.title} (Quiz)`,
                course.cic_course_id,
                CAT_IDS.ASSIGNMENTS,
                quizUrl,
                deadline,
                notesParts.join(" | "),
                nowIso
              )
              .run();

            await env.DB.prepare(
              `INSERT OR IGNORE INTO moodle_sync_items (id, moodle_course_id, moodle_key, moodle_cmid, moodle_type, moodle_title, source_url, material_id, status, synced_at)
               VALUES (?, ?, ?, ?, 'quiz', ?, ?, ?, 'synced', ?)`
            )
              .bind(crypto.randomUUID(), course.moodle_course_id, mKey, act.cmid, act.title, quizUrl, materialId, nowIso)
              .run();

            trackedKeys.add(mKey);
            itemsAdded++;
            newItems.push({ course: course.cic_course_name, title: `${act.title} (Quiz)`, category: CAT_IDS.ASSIGNMENTS });
          }
        } catch (actErr: any) {
          errors.push(`[${course.cic_course_name}] ${act.title}: ${actErr?.message || String(actErr)}`);
        }
      }

      await env.DB.prepare("UPDATE moodle_sync_courses SET last_synced_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), course.id)
        .run();
    } catch (courseErr: any) {
      errors.push(`[${course.cic_course_name}] ${courseErr?.message || String(courseErr)}`);
    }
  }

  // 5. Refresh public R2 DB cache & notify students if new materials were added
  const finishedAt = new Date().toISOString();
  if (itemsAdded > 0) {
    try {
      if (cfg.notify_students) {
        const previewTitles = newItems.slice(0, 3).map((x) => `${x.title} (${x.course.split(" (")[0]})`).join("، ");
        await env.DB.prepare(
          `INSERT INTO notifications (id, title, message, target_audience, target_year, link, sent_by, created_at)
           VALUES (?, ?, ?, 'cs', '2', '/year/2/courses', 'Moodle Auto-Sync', ?)`
        )
          .bind(
            crypto.randomUUID(),
            `📚 تحديث تلقائي من مودل: تم رفع ${itemsAdded} عنصر جديد لسنة تانية CS`,
            `${previewTitles}${itemsAdded > 3 ? ` وغيرها (+${itemsAdded - 3})` : ""}`,
            finishedAt
          )
          .run();
      }
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, admin_id, admin_name, action, details, action_type, related_material_id, material_snapshot, admin_year, created_at)
         VALUES (?, '00000000-0000-0000-0000-000000000000', 'Moodle Auto-Sync 24/7', ?, ?, 'add', NULL, NULL, '2', ?)`
      )
        .bind(
          crypto.randomUUID(),
          `مزامنة تلقائية من مودل (+${itemsAdded} عنصر)`,
          newItems.map((x) => `${x.course}: ${x.title}`).join(" | ").slice(0, 1000),
          finishedAt
        )
        .run();
    } catch (e) {
      console.warn("Moodle sync notification/audit failed:", e);
    }

    await callbacks.refreshPublicCache();
  }

  // Persist rotated cookie + run status
  const runStatus = errors.length > 0 ? (itemsAdded > 0 ? "partial" : "error") : "success";
  const summaryText = `تم فحص ${coursesChecked} مقرر — أُضيف ${itemsAdded} جديد، وتُخطي ${itemsSkipped} موجود مسبقاً${uploadsThisRun >= MAX_NEW_UPLOADS_PER_RUN ? " (سيُستكمل الباقي تلقائياً في الدورة القادمة)" : ""}.`;

  await env.DB.prepare(
    `UPDATE moodle_sync_config
     SET session_status = 'active',
         session_cookie = COALESCE(?, session_cookie),
         last_check_at = ?,
         last_sync_at = CASE WHEN ? > 0 THEN ? ELSE last_sync_at END,
         last_error = ?,
         last_summary = ?,
         updated_at = ?
     WHERE id = 'default'`
  )
    .bind(
      moodle.cookieRotated() ? moodle.getCookie() : null,
      finishedAt,
      itemsAdded,
      finishedAt,
      errors.length > 0 ? errors.slice(0, 5).join(" | ") : null,
      summaryText,
      finishedAt
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO moodle_sync_runs (id, trigger_type, status, courses_checked, items_added, items_skipped, errors, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      triggerType,
      runStatus,
      coursesChecked,
      itemsAdded,
      itemsSkipped,
      errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : null,
      startedAt,
      finishedAt
    )
    .run();

  return {
    ok: runStatus === "success" || runStatus === "partial",
    status: runStatus,
    coursesChecked,
    itemsAdded,
    itemsSkipped,
    newItems,
    errors,
    message: summaryText,
  };
}
