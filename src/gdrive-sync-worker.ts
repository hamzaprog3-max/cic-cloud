/**
 * 24/7 Automated Public Google Drive Folder -> CIC Cloud (Cloudflare R2 + D1) Sync Engine
 * Runs inside the same Cloudflare Workers Cron Trigger (every 25 minutes) alongside Moodle Sync!
 *
 * Features:
 * - Zero API keys & zero cookies required for "Anyone with the link" public Google Drive folders
 * - Recursive subfolder scanning (up to depth 3: e.g. Exercise/, Project/, lectures/)
 * - Downloads files directly from drive.usercontent.google.com into Cloudflare R2 (so students get fast in-app PDF viewer, offline caching, and AI Explainer!)
 * - Upgrades existing Google Drive link-only materials (e.g. from Moodle mod/url) into direct R2 PDFs automatically without duplicating!
 * - Uses 5-page PDF/PPTX/DOCX content fingerprinting + SHA-256 + smart title matching so files NEVER duplicate
 */

import { computeContentFingerprint, compareFingerprints } from "./content-fingerprint";
import type { MoodleSyncEnv, MoodleSyncCallbacks } from "./moodle-sync-worker";

const GDRIVE_MAX_FILE_BYTES = 45 * 1024 * 1024;
const GDRIVE_MAX_UPLOADS_PER_RUN = 10;

const CAT_IDS = {
  LECTURES: "ebc86347-e9de-4cc1-bb1b-5b682bf7a5ae",
  SECTIONS: "9e309104-b955-45ce-9087-30982fa8bbf4",
  ASSIGNMENTS: "8cdaf762-2eca-4836-8c76-7b9e0b8af80c",
  SOLUTIONS: "2dd09cfb-0438-4d5c-acb9-7e55fa6b0a5f",
  EXAMS: "fef4fb8d-55d2-4240-86ce-056f8bed6733",
};

const ALLOWED_EXTS = new Set([
  ".pdf", ".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi",
  ".mp3", ".wav", ".m4a", ".aac",
  ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".zip", ".rar",
]);

const DEFAULT_GDRIVE_FOLDERS = [
  {
    id: "gd-folder-oop-cs",
    drive_folder_id: "12vOTwuW6eAVlwkox-PEQIgbBBmfKAQnI",
    folder_name: "Computer Science OOP 2026-2027 (Sections & Sheets)",
    cic_course_id: "b7afc4d8-2a2e-4f10-ba94-2a51a2930526",
    cic_course_name: "Object-Oriented Programming (CS 210)",
    default_category_id: CAT_IDS.SECTIONS,
  },
  {
    id: "gd-folder-or-cs",
    drive_folder_id: "1ulzlkN2MrUGL6uXZOiOKkN8GMpq2HkzI",
    folder_name: "Operation Research (Lectures, Book & Final Revision)",
    cic_course_id: "a8071a66-f6aa-4d08-895a-b8602367fd4e",
    cic_course_name: "Operations Research (CS 211)",
    default_category_id: CAT_IDS.LECTURES,
  },
];

function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .trim();
}

function normalizeStr(str: string): string {
  return str
    .toLowerCase()
    .replace(/\.(pdf|pptx?|docx?|xlsx?|zip|rar)$/i, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0621-\u064A]+/g, " ")
    .trim();
}

function stripOuterNumbers(norm: string): string {
  return norm.replace(/^\d+\s+/, "").replace(/\s+\d+$/, "").trim();
}

function sanitizeDriveR2Key(fileName: string, folderTag: string): string {
  const dot = fileName.lastIndexOf(".");
  let ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : ".pdf";
  if (!ALLOWED_EXTS.has(ext)) ext = ".pdf";
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName;
  const cleanStem = stem.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "file";
  const cleanTag = folderTag.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12);
  return `${Date.now()}-gd${cleanTag ? "_" + cleanTag : ""}_${cleanStem}${ext}`;
}

export function extractDriveFolderId(raw: string): string | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9_-]{15,64}$/.test(trimmed)) return trimmed;
  const m =
    trimmed.match(/\/folders\/([A-Za-z0-9_-]{15,64})/) ||
    trimmed.match(/[?&]id=([A-Za-z0-9_-]{15,64})/);
  return m ? m[1] : null;
}

export async function ensureGdriveSyncTables(env: MoodleSyncEnv): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS gdrive_sync_folders (
      id TEXT PRIMARY KEY,
      drive_folder_id TEXT NOT NULL UNIQUE,
      folder_name TEXT NOT NULL,
      cic_course_id TEXT NOT NULL,
      cic_course_name TEXT NOT NULL,
      default_category_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      last_summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS gdrive_sync_items (
      id TEXT PRIMARY KEY,
      drive_folder_id TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      subfolder_path TEXT DEFAULT '',
      material_id TEXT,
      status TEXT NOT NULL DEFAULT 'synced',
      synced_at TEXT DEFAULT (datetime('now')),
      UNIQUE(drive_folder_id, drive_file_id)
    )`
  ).run();

  const now = new Date().toISOString();
  for (const f of DEFAULT_GDRIVE_FOLDERS) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO gdrive_sync_folders (id, drive_folder_id, folder_name, cic_course_id, cic_course_name, default_category_id, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(f.id, f.drive_folder_id, f.folder_name, f.cic_course_id, f.cic_course_name, f.default_category_id, now)
      .run();
  }
}

interface DriveEntry {
  fileId: string;
  name: string;
  subfolderPath: string;
  viewUrl: string;
}

/**
 * Recursively list all files inside a public Google Drive folder via embeddedfolderview (zero API key!).
 */
async function listPublicDriveFolderFiles(
  folderId: string,
  depth = 0,
  subfolderPath = "",
  visitedFolders = new Set<string>()
): Promise<{ folderTitle: string; files: DriveEntry[] }> {
  if (depth > 3 || visitedFolders.has(folderId)) {
    return { folderTitle: "", files: [] };
  }
  visitedFolders.add(folderId);

  const res = await fetch(
    `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Google Drive folder ${folderId} returned HTTP ${res.status}`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const folderTitle = titleMatch ? decodeHtml(titleMatch[1]) : folderId;

  const files: DriveEntry[] = [];
  const entryRe =
    /id="entry-([A-Za-z0-9_-]+)"[\s\S]*?<a\s+href="([^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">([^<]+)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(html)) !== null) {
    const id = m[1];
    const href = decodeHtml(m[2]);
    const name = decodeHtml(m[3]);
    const isFolder = href.includes("/drive/folders/") || href.includes("/folderview");
    if (isFolder) {
      const nextPath = subfolderPath ? `${subfolderPath}/${name}` : name;
      const sub = await listPublicDriveFolderFiles(id, depth + 1, nextPath, visitedFolders);
      files.push(...sub.files);
    } else {
      files.push({
        fileId: id,
        name,
        subfolderPath,
        viewUrl: `https://drive.google.com/file/d/${id}/view?usp=sharing`,
      });
    }
  }

  return { folderTitle, files };
}

function classifyDriveFile(opts: {
  fileName: string;
  subfolderPath: string;
  defaultCategoryId?: string | null;
}): { categoryId: string; isReference: boolean; isAssignment: boolean } {
  const nameLower = opts.fileName.toLowerCase();
  const ctxLower = `${opts.subfolderPath} ${opts.fileName}`.toLowerCase();

  if (/(?:model[\s_-]*answer|answers|حل|إجاب|اجاب)/i.test(nameLower)) {
    if (/(?:midterm|final|quiz|exam)/i.test(nameLower)) {
      return { categoryId: CAT_IDS.EXAMS, isReference: false, isAssignment: false };
    }
    return { categoryId: CAT_IDS.SOLUTIONS, isReference: false, isAssignment: false };
  }

  if (/(?:questions\s*for\s*final|midterm|final\s*exam|revision|review\s*sheet|question\s*bank|مراجع|امتحان)/i.test(ctxLower)) {
    return { categoryId: CAT_IDS.EXAMS, isReference: false, isAssignment: false };
  }

  if (/(?:edition|course\s*book|an\s*introduction.*8th|reference|كتاب|مرجع)/i.test(nameLower)) {
    return { categoryId: CAT_IDS.LECTURES, isReference: true, isAssignment: false };
  }

  if (/(?:exercise|sheet[\s_-]*\d+|assignment|project|تكليف|شيت|مشروع)/i.test(ctxLower)) {
    return { categoryId: CAT_IDS.ASSIGNMENTS, isReference: false, isAssignment: true };
  }

  if (/(?:^|\b)(?:lectures?|lec\s*\d+)/i.test(opts.subfolderPath.toLowerCase())) {
    return { categoryId: CAT_IDS.LECTURES, isReference: false, isAssignment: false };
  }

  if (/(?:sec(?:tion)?|lab|week\s*\d+|سكشن|معمل)/i.test(ctxLower)) {
    return { categoryId: CAT_IDS.SECTIONS, isReference: false, isAssignment: false };
  }

  return {
    categoryId: opts.defaultCategoryId || CAT_IDS.LECTURES,
    isReference: false,
    isAssignment: false,
  };
}

function findMatchingExistingDriveOrR2Material(
  existingMaterials: Array<Record<string, any>>,
  entry: DriveEntry
): { material: Record<string, any>; isDriveLinkUpgradeable: boolean } | null {
  const cleanTitle = entry.name.replace(/\.(pdf|pptx?|docx?|xlsx?|zip|rar)$/i, "").replace(/\s+/g, " ").trim();
  const normName = normalizeStr(cleanTitle);
  const normStripped = stripOuterNumbers(normName);

  // 1. Exact Google Drive file ID match (upgradeable to R2 if currently pointing to drive.google.com!)
  for (const m of existingMaterials) {
    const urls = [m.pdf_url, m.external_link].filter(Boolean) as string[];
    for (const u of urls) {
      if (u.includes(entry.fileId)) {
        const isDriveOnly = typeof m.pdf_url === "string" && m.pdf_url.includes("drive.google.com");
        return { material: m, isDriveLinkUpgradeable: isDriveOnly };
      }
    }
  }

  // 2. Normalized title / R2 filename match
  for (const m of existingMaterials) {
    const mTitle = normalizeStr(String(m.title || ""));
    const mDisp = normalizeStr(String(m.pdf_display_name || ""));
    const mStripped = stripOuterNumbers(mTitle);
    let mR2Stem = "";
    if (typeof m.pdf_url === "string" && m.pdf_url.includes("r2.dev/")) {
      const key = m.pdf_url.split("/").pop() || "";
      mR2Stem = normalizeStr(key.replace(/^\d+-(?:gd_[a-z0-9]+_|m\d+_)?/i, ""));
    }

    if (normName && (normName === mTitle || normName === mDisp || (mR2Stem.length >= 6 && normName === mR2Stem))) {
      return { material: m, isDriveLinkUpgradeable: false };
    }
    if (normStripped.length >= 8 && mStripped.length >= 8 && normStripped === mStripped) {
      return { material: m, isDriveLinkUpgradeable: false };
    }

    // Match OOP Week N <-> OOP Section N / Sec N (e.g. "OOP-week 3" <-> "OOP-week3.pdf" or "OOP Week 5" <-> "OOPWeek5.pdf")
    const entryCompact = normName.replace(/\s+/g, "");
    const r2Compact = mR2Stem.replace(/\s+/g, "");
    if (entryCompact.length >= 8 && r2Compact.length >= 8 && (entryCompact === r2Compact || r2Compact.includes(entryCompact) || entryCompact.includes(r2Compact))) {
      const aNum = entryCompact.match(/(\d+)$/)?.[1] || "";
      const bNum = r2Compact.match(/(\d+)$/)?.[1] || "";
      if (aNum === bNum) return { material: m, isDriveLinkUpgradeable: false };
    }

    // Match Sheet N (e.g. "cs - oop - sheet 2" <-> "sheet 2 oop")
    const aSheet = normName.match(/\bsheet\s*0*(\d+)\b/);
    const bSheet = `${mTitle} ${mR2Stem}`.match(/\bsheet\s*0*(\d+)\b/);
    if (aSheet && bSheet && Number(aSheet[1]) === Number(bSheet[1]) && !/answer|solution|حل/i.test(normName) && !/answer|solution|حل/i.test(mTitle)) {
      return { material: m, isDriveLinkUpgradeable: false };
    }

    // Match Week N / Section N (for OOP TA folder)
    const aWeek = normName.match(/\b(?:week|sec(?:tion)?)\s*0*(\d+)\b/);
    const bWeek = `${mTitle} ${mR2Stem}`.match(/\b(?:week|sec(?:tion)?)\s*0*(\d+)\b/);
    if (aWeek && bWeek && Number(aWeek[1]) === Number(bWeek[1]) && !/sheet|project|lecture|lec/i.test(normName) && !/sheet|project|lecture|lec/i.test(mTitle)) {
      return { material: m, isDriveLinkUpgradeable: false };
    }
  }

  return null;
}

async function downloadPublicDriveFile(fileId: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const downloadUrls = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&confirm=t&id=${encodeURIComponent(fileId)}`,
  ];

  for (const url of downloadUrls) {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) continue;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("text/html")) continue; // Virus-scan/login interstitial
    const cl = Number(res.headers.get("content-length") || "0");
    if (cl > GDRIVE_MAX_FILE_BYTES) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > GDRIVE_MAX_FILE_BYTES) continue;
    return { bytes, contentType: ct || "application/pdf" };
  }
  return null;
}

export interface GdriveSyncRunResult {
  ok: boolean;
  foldersChecked: number;
  itemsAdded: number;
  itemsUpgraded: number;
  itemsSkipped: number;
  newItems: Array<{ course: string; title: string; action: "added" | "upgraded_to_r2" }>;
  errors: string[];
  message: string;
}

export async function runGdriveSync(
  env: MoodleSyncEnv,
  callbacks: MoodleSyncCallbacks,
  options: { onlyFolderId?: string } = {}
): Promise<GdriveSyncRunResult> {
  await ensureGdriveSyncTables(env);

  const { results: folders } = options.onlyFolderId
    ? await env.DB.prepare("SELECT * FROM gdrive_sync_folders WHERE drive_folder_id = ?")
        .bind(options.onlyFolderId)
        .all<Record<string, any>>()
    : await env.DB.prepare("SELECT * FROM gdrive_sync_folders WHERE enabled = 1 ORDER BY created_at ASC")
        .all<Record<string, any>>();

  let foldersChecked = 0;
  let itemsAdded = 0;
  let itemsUpgraded = 0;
  let itemsSkipped = 0;
  let uploadsThisRun = 0;
  const newItems: GdriveSyncRunResult["newItems"] = [];
  const errors: string[] = [];

  for (const folder of folders) {
    try {
      const { files } = await listPublicDriveFolderFiles(String(folder.drive_folder_id));
      foldersChecked++;

      const [{ results: trackedRows }, { results: existingMaterials }, { results: existingFpsRaw }] = await Promise.all([
        env.DB.prepare("SELECT drive_file_id, status, material_id FROM gdrive_sync_items WHERE drive_folder_id = ?")
          .bind(folder.drive_folder_id)
          .all<Record<string, any>>(),
        env.DB.prepare("SELECT id, title, pdf_url, pdf_display_name, external_link FROM materials WHERE course_id = ? AND deleted_at IS NULL")
          .bind(folder.cic_course_id)
          .all<Record<string, any>>(),
        env.DB.prepare("SELECT material_id, sha256, tokens_json, stream_hashes_json FROM material_fingerprints WHERE course_id = ?")
          .bind(folder.cic_course_id)
          .all<Record<string, any>>(),
      ]);

      const trackedIds = new Set(trackedRows.map((r) => String(r.drive_file_id)));
      const existingFps = existingFpsRaw.map((r) => {
        let tokens: string[] = [];
        let streamHashes: string[] = [];
        try { tokens = JSON.parse(String(r.tokens_json || "[]")); } catch {}
        try { streamHashes = JSON.parse(String(r.stream_hashes_json || "[]")); } catch {}
        return {
          materialId: String(r.material_id),
          sha256: r.sha256 ? String(r.sha256) : null,
          tokens,
          streamHashes,
        };
      });

      let folderAdded = 0;
      let folderUpgraded = 0;
      let folderSkipped = 0;

      for (const entry of files) {
        if (trackedIds.has(entry.fileId)) {
          itemsSkipped++;
          folderSkipped++;
          continue;
        }

        const cleanTitle = entry.name.replace(/\.(pdf|pptx?|docx?|xlsx?|zip|rar)$/i, "").replace(/\s+/g, " ").trim() || entry.name;
        const match = findMatchingExistingDriveOrR2Material(existingMaterials, entry);

        if (match && !match.isDriveLinkUpgradeable) {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO gdrive_sync_items (id, drive_folder_id, drive_file_id, file_name, subfolder_path, material_id, status, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, 'linked_existing', ?)`
          )
            .bind(
              crypto.randomUUID(),
              folder.drive_folder_id,
              entry.fileId,
              entry.name,
              entry.subfolderPath,
              match.material.id,
              new Date().toISOString()
            )
            .run();
          trackedIds.add(entry.fileId);
          itemsSkipped++;
          folderSkipped++;
          continue;
        }

        if (uploadsThisRun >= GDRIVE_MAX_UPLOADS_PER_RUN) continue;

        // Download file directly from Google Drive
        const dl = await downloadPublicDriveFile(entry.fileId);
        if (!dl) {
          // If file is > 45MB (e.g., huge textbook) and already exists as Drive link, keep link cleanly
          if (match && match.isDriveLinkUpgradeable) {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO gdrive_sync_items (id, drive_folder_id, drive_file_id, file_name, subfolder_path, material_id, status, synced_at)
               VALUES (?, ?, ?, ?, ?, ?, 'linked_existing', ?)`
            )
              .bind(crypto.randomUUID(), folder.drive_folder_id, entry.fileId, entry.name, entry.subfolderPath, match.material.id, new Date().toISOString())
              .run();
            trackedIds.add(entry.fileId);
            itemsSkipped++;
            folderSkipped++;
          } else {
            errors.push(`[${folder.cic_course_name}] تعذّر تحميل ${entry.name} من Google Drive`);
          }
          continue;
        }

        // 5-page content fingerprint check before uploading to R2 (skip if upgrading an existing Drive link!)
        const fp = await computeContentFingerprint(dl.bytes, entry.name);
        if (!match) {
          let contentDupId: string | null = null;
          for (const exFp of existingFps) {
            if (compareFingerprints(fp, exFp).isMatch) {
              contentDupId = exFp.materialId;
              break;
            }
          }
          if (contentDupId) {
            await env.DB.prepare(
              `INSERT OR IGNORE INTO gdrive_sync_items (id, drive_folder_id, drive_file_id, file_name, subfolder_path, material_id, status, synced_at)
               VALUES (?, ?, ?, ?, ?, ?, 'linked_existing', ?)`
            )
              .bind(crypto.randomUUID(), folder.drive_folder_id, entry.fileId, entry.name, entry.subfolderPath, contentDupId, new Date().toISOString())
              .run();
            trackedIds.add(entry.fileId);
            itemsSkipped++;
            folderSkipped++;
            continue;
          }
        }

        // Upload straight to Cloudflare R2
        const r2Key = sanitizeDriveR2Key(entry.name, String(folder.drive_folder_id).slice(0, 6));
        const contentType = callbacks.inferContentType(r2Key);
        await env.R2_BUCKET.put(r2Key, dl.bytes, {
          httpMetadata: {
            contentType,
            cacheControl: "public, max-age=31536000, immutable",
          },
        });
        const publicUrl = callbacks.buildPublicUrl(r2Key);
        const nowIso = new Date().toISOString();

        if (match && match.isDriveLinkUpgradeable) {
          // Upgrade existing Drive-link material in place to fast R2 PDF!
          await env.DB.prepare("UPDATE materials SET pdf_url = ? WHERE id = ?")
            .bind(publicUrl, match.material.id)
            .run();
          await env.DB.prepare(
            `INSERT OR REPLACE INTO material_fingerprints (material_id, course_id, r2_key, byte_size, sha256, kind, tokens_json, stream_hashes_json, sample_text, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(match.material.id, folder.cic_course_id, r2Key, fp.byteSize, fp.sha256, fp.kind, JSON.stringify(fp.tokens), JSON.stringify(fp.streamHashes), fp.sampleText, nowIso)
            .run()
            .catch(() => {});
          await env.DB.prepare(
            `INSERT OR IGNORE INTO gdrive_sync_items (id, drive_folder_id, drive_file_id, file_name, subfolder_path, material_id, status, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, 'synced', ?)`
          )
            .bind(crypto.randomUUID(), folder.drive_folder_id, entry.fileId, entry.name, entry.subfolderPath, match.material.id, nowIso)
            .run();
          trackedIds.add(entry.fileId);
          uploadsThisRun++;
          itemsUpgraded++;
          folderUpgraded++;
          newItems.push({ course: String(folder.cic_course_name), title: cleanTitle, action: "upgraded_to_r2" });
        } else {
          const cls = classifyDriveFile({
            fileName: entry.name,
            subfolderPath: entry.subfolderPath,
            defaultCategoryId: folder.default_category_id,
          });
          const materialId = crypto.randomUUID();
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
              cleanTitle,
              folder.cic_course_id,
              cls.categoryId,
              publicUrl,
              cleanTitle,
              cls.isAssignment ? 1 : 0,
              cls.isReference ? 1 : 0,
              nowIso
            )
            .run();

          await env.DB.prepare(
            `INSERT OR REPLACE INTO material_fingerprints (material_id, course_id, r2_key, byte_size, sha256, kind, tokens_json, stream_hashes_json, sample_text, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(materialId, folder.cic_course_id, r2Key, fp.byteSize, fp.sha256, fp.kind, JSON.stringify(fp.tokens), JSON.stringify(fp.streamHashes), fp.sampleText, nowIso)
            .run()
            .catch(() => {});

          await env.DB.prepare(
            `INSERT OR IGNORE INTO gdrive_sync_items (id, drive_folder_id, drive_file_id, file_name, subfolder_path, material_id, status, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, 'synced', ?)`
          )
            .bind(crypto.randomUUID(), folder.drive_folder_id, entry.fileId, entry.name, entry.subfolderPath, materialId, nowIso)
            .run();

          trackedIds.add(entry.fileId);
          existingFps.push({ materialId, sha256: fp.sha256, tokens: fp.tokens, streamHashes: fp.streamHashes });
          existingMaterials.push({ id: materialId, title: cleanTitle, pdf_url: publicUrl, pdf_display_name: cleanTitle });
          uploadsThisRun++;
          itemsAdded++;
          folderAdded++;
          newItems.push({ course: String(folder.cic_course_name), title: cleanTitle, action: "added" });
        }
      }

      const folderSummary = `فُحص ${files.length} ملف — +${folderAdded} جديد${folderUpgraded > 0 ? `، ${folderUpgraded} ترقية لـ R2` : ""}، ${folderSkipped} موجود مسبقاً`;
      await env.DB.prepare("UPDATE gdrive_sync_folders SET last_synced_at = ?, last_summary = ? WHERE id = ?")
        .bind(new Date().toISOString(), folderSummary, folder.id)
        .run();
    } catch (err: any) {
      errors.push(`[${folder.folder_name}] ${err?.message || String(err)}`);
    }
  }

  if (itemsAdded > 0 || itemsUpgraded > 0) {
    const nowIso = new Date().toISOString();
    try {
      if (itemsAdded > 0) {
        const preview = newItems
          .filter((x) => x.action === "added")
          .slice(0, 3)
          .map((x) => `${x.title} (${x.course.split(" (")[0]})`)
          .join("، ");
        await env.DB.prepare(
          `INSERT INTO notifications (id, title, message, target_audience, target_year, link, sent_by, created_at)
           VALUES (?, ?, ?, 'cs', '2', '/year/2/courses', 'Google Drive Auto-Sync', ?)`
        )
          .bind(
            crypto.randomUUID(),
            `📁 تحديث تلقائي من Google Drive: تم رفع ${itemsAdded} ملف جديد لسنة تانية CS`,
            preview,
            nowIso
          )
          .run();
      }
      await env.DB.prepare(
        `INSERT INTO audit_logs (id, admin_id, admin_name, action, details, action_type, related_material_id, material_snapshot, admin_year, created_at)
         VALUES (?, '00000000-0000-0000-0000-000000000000', 'Google Drive Sync 24/7', ?, ?, 'add', NULL, NULL, '2', ?)`
      )
        .bind(
          crypto.randomUUID(),
          `مزامنة Google Drive (+${itemsAdded} جديد، ${itemsUpgraded} ترقية R2)`,
          newItems.map((x) => `${x.course}: ${x.title} (${x.action})`).join(" | ").slice(0, 1000),
          nowIso
        )
        .run();
    } catch {}
    await callbacks.refreshPublicCache();
  }

  const msg = `تم فحص ${foldersChecked} مجلد Google Drive — أُضيف ${itemsAdded} ملف جديد${itemsUpgraded > 0 ? `، وتم نقل ${itemsUpgraded} ملف من روابط Drive إلى R2 مباشرة` : ""}، وتُخطي ${itemsSkipped} موجود مسبقاً.`;
  return {
    ok: errors.length === 0 || itemsAdded > 0 || itemsUpgraded > 0,
    foldersChecked,
    itemsAdded,
    itemsUpgraded,
    itemsSkipped,
    newItems,
    errors,
    message: msg,
  };
}
