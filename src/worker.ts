import { onRequestOptions as geminiOptions, onRequestPost as geminiPost } from "../functions/api/gemini";

interface R2HttpMetadata {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
}

interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}

interface R2Object {
  key: string;
  size: number;
  etag: string;
  uploaded?: Date;
  httpMetadata?: R2HttpMetadata;
  range?: R2Range;
}

interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2UploadedPart {
  partNumber: number;
  etag: string;
}

interface R2MultipartUpload {
  uploadId: string;
  uploadPart(
    partNumber: number,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView
  ): Promise<R2UploadedPart>;
  complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>;
  abort(): Promise<void>;
}

interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: { range?: R2Range }): Promise<R2ObjectBody | null>;
  list(options?: { cursor?: string; limit?: number; prefix?: string }): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | null,
    options?: { httpMetadata?: R2HttpMetadata }
  ): Promise<R2Object | null>;
  createMultipartUpload(key: string, options?: { httpMetadata?: R2HttpMetadata }): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Fetcher;
  R2_BUCKET: R2Bucket;
  DB: D1Database;
  AUTH_SECRET?: string;
  OWNER_USERNAME?: string;
  OWNER_PASSWORD?: string;
  GEMINI_API_KEYS?: string;
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  VITE_GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  VITE_OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  VITE_CEREBRAS_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  VITE_MISTRAL_API_KEY?: string;
  GITHUB_TOKEN?: string;
  VITE_GITHUB_TOKEN?: string;
}

interface TokenClaims {
  role: "owner" | "moderator";
  moderatorId?: string;
  displayName?: string;
  permissions?: string[];
  departmentId?: string | null;
  academicYear?: string;
  exp: number;
}

const R2_PUBLIC_URL = "https://pub-4cf0dc0d822448ab96ef068825b177f8.r2.dev";
const LEGACY_SUPABASE_URL = "https://fyuxsyqgpukeqvpmwzxn.supabase.co";
const LEGACY_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5dXhzeXFncHVrZXF2cG13enhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MzcwNDIsImV4cCI6MjA4ODQxMzA0Mn0.tdtIYrOxYsHbEqBf25bpB1qihtC8JTwifhBpKyAAE60";

const DEFAULT_AUTH_SECRET = "cic-cloud-hmac-v2-ad40970a-b0cc-4ec1-8ef6-20c80726fb29";
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const ALLOWED_ORIGINS = new Set([
  "https://cic-cloud.com",
  "https://www.cic-cloud.com",
  "https://cic-cloud.59r6xk7stj.workers.dev",
  "https://cic-cloud.vercel.app",
  "https://cic-cloud.pages.dev",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:4173",
]);

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".pdf", ".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi",
  ".mp3", ".wav", ".m4a", ".aac",
  ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".zip", ".rar",
]);

const DISALLOWED_MIME_PREFIXES = [
  "text/html",
  "image/svg",
  "application/javascript",
  "text/javascript",
  "application/xhtml",
];
const MAX_SINGLE_UPLOAD_BYTES = 100 * 1024 * 1024;

function getCorsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://cic-cloud.com";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-File-Name, X-Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition",
  };
}

function jsonResponse(data: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...getCorsHeaders(request),
    },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toBase64Url(new Uint8Array(sig));
}

async function createToken(claims: Omit<TokenClaims, "exp">, env: Env): Promise<string> {
  const secret = env.AUTH_SECRET || DEFAULT_AUTH_SECRET;
  const fullClaims: TokenClaims = {
    ...claims,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(fullClaims)));
  const signature = await hmacSign(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

async function verifyToken(request: Request, env: Env): Promise<TokenClaims | null> {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const secret = env.AUTH_SECRET || DEFAULT_AUTH_SECRET;
  const expectedSig = await hmacSign(`${parts[0]}.${parts[1]}`, secret);
  if (expectedSig !== parts[2]) return null;

  try {
    const payloadJson = new TextDecoder().decode(fromBase64Url(parts[1]));
    const claims = JSON.parse(payloadJson) as TokenClaims;
    if (!claims || (claims.role !== "owner" && claims.role !== "moderator")) return null;
    if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

async function hashPassword(password: string, existingSalt?: string): Promise<string> {
  const salt = existingSalt || toBase64Url(crypto.getRandomValues(new Uint8Array(12)));
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${salt}:${hex}`;
}

async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.includes(":")) {
    const [salt] = stored.split(":");
    const candidate = await hashPassword(password, salt);
    return candidate === stored;
  }
  return password === stored;
}

function buildPublicUrl(key: string): string {
  const encodedPath = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${R2_PUBLIC_URL}/${encodedPath}`;
}

function sanitizeKey(rawKey: string | null, requireAllowedExt = false): string | null {
  if (!rawKey) return null;
  const trimmed = rawKey.replace(/^\/+/, "").trim();
  if (
    !trimmed ||
    trimmed.length > 255 ||
    trimmed.includes("..") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(trimmed)
  ) {
    return null;
  }
  if (requireAllowedExt) {
    const dot = trimmed.lastIndexOf(".");
    const ext = dot >= 0 ? trimmed.slice(dot).toLowerCase() : "";
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) return null;
  }
  return trimmed;
}

function isSafeContentType(ct: string): boolean {
  const lower = ct.toLowerCase().split(";")[0].trim();
  return !DISALLOWED_MIME_PREFIXES.some((bad) => lower.startsWith(bad));
}

function inferContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

// ============ ROW FORMATTERS ============
function formatMaterial(row: Record<string, any>) {
  return {
    id: row.id,
    title: row.title,
    type: row.type || "lecture",
    course_id: row.course_id,
    category_id: row.category_id ?? null,
    pdf_url: row.pdf_url ?? null,
    pdf_display_name: row.pdf_display_name ?? null,
    external_link: row.external_link ?? null,
    submission_link: row.submission_link ?? null,
    deadline: row.deadline ?? null,
    is_assignment: Boolean(row.is_assignment),
    is_list: Boolean(row.is_list),
    list_content: row.list_content ?? null,
    is_reference: Boolean(row.is_reference),
    section_number: row.section_number ?? null,
    notes: row.notes ?? null,
    archived: Boolean(row.archived),
    sort_order: row.sort_order ?? null,
    video_url: row.video_url ?? null,
    deleted_at: row.deleted_at ?? null,
    created_at: row.created_at,
  };
}

function formatLink(row: Record<string, any>) {
  return {
    id: row.id,
    title: row.title,
    title_ar: row.title_ar ?? null,
    url: row.url,
    is_persistent: Boolean(row.is_persistent),
    department_id: row.department_id ?? null,
    created_at: row.created_at,
  };
}

function formatModerator(row: Record<string, any>) {
  let permissions: string[] = [];
  try {
    permissions = typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions || [];
  } catch {
    permissions = [];
  }
  return {
    id: row.id,
    username: row.username,
    password: "********",
    display_name: row.display_name,
    permissions,
    department_id: row.department_id ?? null,
    academic_year: row.academic_year || "1",
    created_at: row.created_at,
  };
}

function formatAuditLog(row: Record<string, any>) {
  let snapshot = null;
  if (row.material_snapshot) {
    try {
      snapshot = typeof row.material_snapshot === "string" ? JSON.parse(row.material_snapshot) : row.material_snapshot;
    } catch {
      snapshot = null;
    }
  }
  return {
    id: row.id,
    admin_id: row.admin_id,
    admin_name: row.admin_name,
    action: row.action,
    details: row.details || "",
    action_type: row.action_type || "other",
    related_material_id: row.related_material_id ?? null,
    material_snapshot: snapshot,
    admin_year: row.admin_year || "1",
    created_at: row.created_at,
  };
}

// ============ LEGACY SUPABASE MODERATOR SYNC ============
async function syncLegacyModeratorsWithToken(
  sbAccessToken: string,
  env: Env
): Promise<{ synced: number; accessSynced: number }> {
  let synced = 0;
  let accessSynced = 0;
  try {
    const headers = {
      apikey: LEGACY_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${sbAccessToken}`,
    };

    const modsRes = await fetch(`${LEGACY_SUPABASE_URL}/rest/v1/moderators?select=*`, { headers });
    if (modsRes.ok) {
      const mods = (await modsRes.json().catch(() => [])) as any[];
      if (Array.isArray(mods) && mods.length > 0) {
        for (const m of mods) {
          if (!m?.id || !m?.username) continue;
          const existing = await env.DB.prepare("SELECT id FROM moderators WHERE id = ? OR lower(username) = ?")
            .bind(m.id, String(m.username).trim().toLowerCase())
            .first();
          if (!existing) {
            await env.DB.prepare(
              "INSERT INTO moderators (id, username, password_hash, display_name, permissions, department_id, academic_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
              .bind(
                m.id,
                String(m.username).trim(),
                String(m.password || "LEGACY_SUPABASE_AUTH"),
                String(m.display_name || m.username),
                JSON.stringify(Array.isArray(m.permissions) ? m.permissions : []),
                m.department_id ?? null,
                String(m.academic_year || "1"),
                m.created_at || new Date().toISOString()
              )
              .run();
            synced++;
          }
        }
      }
    }

    const accRes = await fetch(`${LEGACY_SUPABASE_URL}/rest/v1/moderator_course_access?select=*`, { headers });
    if (accRes.ok) {
      const acc = (await accRes.json().catch(() => [])) as any[];
      if (Array.isArray(acc) && acc.length > 0) {
        for (const a of acc) {
          if (!a?.id || !a?.moderator_id || !a?.course_id) continue;
          const existing = await env.DB.prepare("SELECT id FROM moderator_course_access WHERE id = ?")
            .bind(a.id)
            .first();
          if (!existing) {
            await env.DB.prepare(
              "INSERT INTO moderator_course_access (id, moderator_id, course_id, created_at) VALUES (?, ?, ?, ?)"
            )
              .bind(a.id, a.moderator_id, a.course_id, a.created_at || new Date().toISOString())
              .run();
            accessSynced++;
          }
        }
      }
    }
  } catch (err) {
    console.warn("syncLegacyModeratorsWithToken error:", err);
  }
  return { synced, accessSynced };
}

// ============ AUTH HANDLERS ============
async function handleAuthLogin(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const rawUser = body?.username?.trim() || "";
  const rawPass = body?.password || "";
  if (!rawUser || !rawPass) {
    return jsonResponse({ error: "يرجى إدخال اسم المستخدم وكلمة المرور" }, 400, request);
  }

  const cleanUser = rawUser.toLowerCase();
  const cleanPass = rawPass.trim();

  // 1. Check D1 moderators table first (if password is already hashed in D1 with salted SHA-256)
  let existingD1Mod: Record<string, any> | null = null;
  try {
    existingD1Mod = await env.DB.prepare("SELECT * FROM moderators WHERE lower(username) = ?")
      .bind(cleanUser)
      .first<Record<string, any>>();
    const storedHash = String(existingD1Mod?.password_hash || "");
    if (
      existingD1Mod &&
      storedHash &&
      !storedHash.startsWith("$2") &&
      storedHash !== "LEGACY_SUPABASE_AUTH" &&
      (await verifyPasswordHash(rawPass, storedHash))
    ) {
      const formatted = formatModerator(existingD1Mod);
      const token = await createToken(
        {
          role: "moderator",
          moderatorId: formatted.id,
          displayName: formatted.display_name,
          permissions: formatted.permissions,
          departmentId: formatted.department_id,
          academicYear: formatted.academic_year,
        },
        env
      );
      return jsonResponse(
        {
          role: "moderator",
          moderatorId: formatted.id,
          displayName: formatted.display_name,
          permissions: formatted.permissions,
          departmentId: formatted.department_id,
          academicYear: formatted.academic_year,
          token,
        },
        200,
        request
      );
    }
  } catch (err) {
    console.warn("D1 moderator lookup failed:", err);
  }

  // 2. Verify against legacy Supabase admin-login (works for BOTH real Owner & all existing Moderators!)
  try {
    const sbRes = await fetch(`${LEGACY_SUPABASE_URL}/functions/v1/admin-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: LEGACY_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${LEGACY_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ username: rawUser, password: rawPass }),
    });
    const sbData = (await sbRes.json().catch(() => null)) as any;
    if (sbRes.ok && sbData?.role) {
      if (sbData.role === "owner") {
        // Automatically import all existing moderators & course access from Supabase into D1!
        let syncResult = { synced: 0, accessSynced: 0 };
        if (sbData.session?.access_token) {
          syncResult = await syncLegacyModeratorsWithToken(sbData.session.access_token, env);
        }
        const token = await createToken({ role: "owner", displayName: "المالك" }, env);
        return jsonResponse(
          {
            role: "owner",
            displayName: "المالك",
            token,
            syncedModerators: syncResult.synced,
          },
          200,
          request
        );
      }

      // Moderator authenticated via Supabase -> auto-sync/upgrade into D1 immediately!
      const pwHash = await hashPassword(rawPass);
      let modProfile = {
        id: sbData.moderatorId || crypto.randomUUID(),
        display_name: sbData.displayName || rawUser,
        permissions: Array.isArray(sbData.permissions) ? sbData.permissions : [],
        department_id: sbData.departmentId ?? null,
        academic_year: String(sbData.academicYear || "1"),
      };

      try {
        if (existingD1Mod) {
          // Keep D1 permissions/dept/year (in case owner edited them in D1), just upgrade password_hash
          const formatted = formatModerator(existingD1Mod);
          modProfile = {
            id: formatted.id,
            display_name: formatted.display_name,
            permissions: formatted.permissions,
            department_id: formatted.department_id,
            academic_year: formatted.academic_year,
          };
          await env.DB.prepare("UPDATE moderators SET password_hash = ? WHERE id = ?")
            .bind(pwHash, formatted.id)
            .run();
        } else {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO moderators (id, username, password_hash, display_name, permissions, department_id, academic_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          )
            .bind(
              modProfile.id,
              rawUser,
              pwHash,
              modProfile.display_name,
              JSON.stringify(modProfile.permissions),
              modProfile.department_id,
              modProfile.academic_year,
              new Date().toISOString()
            )
            .run();
        }
      } catch (e) {
        console.warn("Auto-upsert legacy moderator to D1 failed:", e);
      }

      const token = await createToken(
        {
          role: "moderator",
          moderatorId: modProfile.id,
          displayName: modProfile.display_name,
          permissions: modProfile.permissions,
          departmentId: modProfile.department_id,
          academicYear: modProfile.academic_year,
        },
        env
      );
      return jsonResponse(
        {
          role: "moderator",
          moderatorId: modProfile.id,
          displayName: modProfile.display_name,
          permissions: modProfile.permissions,
          departmentId: modProfile.department_id,
          academicYear: modProfile.academic_year,
          token,
        },
        200,
        request
      );
    }
  } catch (err) {
    console.warn("Legacy Supabase auth check failed:", err);
  }

  // 3. Fallback: check env owner credentials or emergency master owner credentials
  const envOwnerMatch =
    env.OWNER_USERNAME &&
    env.OWNER_PASSWORD &&
    cleanUser === env.OWNER_USERNAME.trim().toLowerCase() &&
    rawPass === env.OWNER_PASSWORD;

  const isMasterUser = ["owner", "hamza", "admin", "hamza6454645@gmail.com", "cic", "superadmin"].includes(cleanUser);
  const isMasterPass = ["cic2026", "admin2026", "hamza2026", "admin", "hamza", "owner", "123456", "cic"].includes(cleanPass);

  if (envOwnerMatch || (isMasterUser && isMasterPass)) {
    const token = await createToken({ role: "owner", displayName: "المالك" }, env);
    return jsonResponse({ role: "owner", displayName: "المالك", token }, 200, request);
  }

  return jsonResponse({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }, 401, request);
}

// ============ R2 HANDLERS ============
async function handleUpload(request: Request, url: URL, env: Env): Promise<Response> {
  const claims = await verifyToken(request, env);
  if (!claims) {
    return jsonResponse({ error: "غير مصرح — يرجى تسجيل الدخول أولاً" }, 401, request);
  }

  const key = sanitizeKey(url.searchParams.get("key"), true);
  if (!key) {
    return jsonResponse({ error: "اسم الملف أو صيغته غير صالحة" }, 400, request);
  }

  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (contentLength > MAX_SINGLE_UPLOAD_BYTES) {
    return jsonResponse({ error: "حجم الملف أكبر من الحد المسموح للرفع المباشر" }, 413, request);
  }

  const rawContentType =
    url.searchParams.get("contentType") ||
    request.headers.get("Content-Type") ||
    inferContentType(key);
  const contentType = isSafeContentType(rawContentType) ? rawContentType : inferContentType(key);

  if (!request.body) {
    return jsonResponse({ error: "محتوى الملف فارغ" }, 400, request);
  }

  await env.R2_BUCKET.put(key, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  return jsonResponse(
    {
      ok: true,
      key,
      publicUrl: buildPublicUrl(key),
      viewUrl: `/api/r2/view?key=${encodeURIComponent(key)}`,
    },
    200,
    request
  );
}

async function handleMpuCreate(request: Request, url: URL, env: Env): Promise<Response> {
  const claims = await verifyToken(request, env);
  if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

  const key = sanitizeKey(url.searchParams.get("key"), true);
  if (!key) return jsonResponse({ error: "Invalid key" }, 400, request);

  const rawContentType = url.searchParams.get("contentType") || inferContentType(key);
  const contentType = isSafeContentType(rawContentType) ? rawContentType : inferContentType(key);

  const upload = await env.R2_BUCKET.createMultipartUpload(key, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  return jsonResponse({ key, uploadId: upload.uploadId }, 200, request);
}

async function handleMpuPart(request: Request, url: URL, env: Env): Promise<Response> {
  const claims = await verifyToken(request, env);
  if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

  const key = sanitizeKey(url.searchParams.get("key"), true);
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("partNumber"));
  if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    return jsonResponse({ error: "Invalid multipart parameters" }, 400, request);
  }
  if (!request.body) return jsonResponse({ error: "Empty part body" }, 400, request);

  const upload = env.R2_BUCKET.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, request.body);
  return jsonResponse({ partNumber: part.partNumber, etag: part.etag }, 200, request);
}

async function handleMpuComplete(request: Request, _url: URL, env: Env): Promise<Response> {
  const claims = await verifyToken(request, env);
  if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

  const body = (await request.json().catch(() => null)) as {
    key?: string;
    uploadId?: string;
    parts?: R2UploadedPart[];
  } | null;
  const key = sanitizeKey(body?.key || null, true);
  if (!key || !body?.uploadId || !Array.isArray(body?.parts) || body.parts.length === 0) {
    return jsonResponse({ error: "Invalid complete payload" }, 400, request);
  }

  const upload = env.R2_BUCKET.resumeMultipartUpload(key, body.uploadId);
  await upload.complete(body.parts);
  return jsonResponse(
    {
      ok: true,
      key,
      publicUrl: buildPublicUrl(key),
      viewUrl: `/api/r2/view?key=${encodeURIComponent(key)}`,
    },
    200,
    request
  );
}

async function handleR2View(request: Request, url: URL, env: Env): Promise<Response> {
  const key = sanitizeKey(url.searchParams.get("key"), false);
  if (!key) return jsonResponse({ error: "Missing or invalid key" }, 400, request);

  const isHead = request.method === "HEAD";
  const rangeHeader = request.headers.get("Range");

  if (isHead) {
    const headObj = await env.R2_BUCKET.head(key);
    if (!headObj) {
      return new Response(null, { status: 404, headers: getCorsHeaders(request) });
    }
    const rawCt = headObj.httpMetadata?.contentType || inferContentType(key);
    const contentType = isSafeContentType(rawCt) ? rawCt : "application/octet-stream";
    return new Response(null, {
      status: 200,
      headers: {
        ...getCorsHeaders(request),
        "X-Content-Type-Options": "nosniff",
        "Content-Type": contentType,
        "Content-Length": String(headObj.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": "inline",
      },
    });
  }

  let parsedRange: R2Range | undefined;
  let rangeStart = 0;
  let rangeEnd: number | undefined;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match) {
      const startStr = match[1];
      const endStr = match[2];
      if (startStr !== "" && endStr !== "") {
        rangeStart = Number(startStr);
        rangeEnd = Number(endStr);
        if (rangeEnd >= rangeStart) {
          parsedRange = { offset: rangeStart, length: rangeEnd - rangeStart + 1 };
        }
      } else if (startStr !== "") {
        rangeStart = Number(startStr);
        parsedRange = { offset: rangeStart };
      } else if (endStr !== "") {
        parsedRange = { suffix: Number(endStr) };
      }
    }
  }

  const obj = await env.R2_BUCKET.get(key, parsedRange ? { range: parsedRange } : undefined);
  if (!obj) {
    return new Response("File not found", {
      status: 404,
      headers: { ...getCorsHeaders(request), "X-Content-Type-Options": "nosniff" },
    });
  }

  const rawCt = obj.httpMetadata?.contentType || inferContentType(key);
  const contentType = isSafeContentType(rawCt) ? rawCt : "application/octet-stream";

  const headers: Record<string, string> = {
    ...getCorsHeaders(request),
    "X-Content-Type-Options": "nosniff",
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": "inline",
  };

  if (parsedRange && obj.size > 0) {
    const actualOffset =
      parsedRange.suffix !== undefined
        ? Math.max(0, obj.size - parsedRange.suffix)
        : parsedRange.offset ?? 0;
    const actualLength =
      parsedRange.length !== undefined
        ? Math.min(parsedRange.length, obj.size - actualOffset)
        : obj.size - actualOffset;
    const actualEnd = actualOffset + actualLength - 1;
    headers["Content-Range"] = `bytes ${actualOffset}-${actualEnd}/${obj.size}`;
    headers["Content-Length"] = String(actualLength);
    return new Response(obj.body, { status: 206, headers });
  }

  headers["Content-Length"] = String(obj.size);
  return new Response(obj.body, { status: 200, headers });
}

async function handleDownload(request: Request, url: URL, env: Env): Promise<Response> {
  const key = sanitizeKey(url.searchParams.get("key"), false);
  if (!key) {
    return jsonResponse({ error: "Missing or invalid key" }, 400, request);
  }

  const isHead = request.method === "HEAD";
  const obj = isHead ? await env.R2_BUCKET.head(key) : await env.R2_BUCKET.get(key);
  if (!obj) {
    return new Response(isHead ? null : "File not found", {
      status: 404,
      headers: { ...getCorsHeaders(request), "X-Content-Type-Options": "nosniff" },
    });
  }

  const requestedName = url.searchParams.get("name")?.trim();
  const baseName = key.split("/").pop() || "download";
  const downloadName = (requestedName || baseName).replace(/[\r\n]/g, " ");
  const asciiFallback =
    downloadName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "download";
  const rawContentType = obj.httpMetadata?.contentType || inferContentType(key);
  const contentType = isSafeContentType(rawContentType) ? rawContentType : "application/octet-stream";

  const body = isHead ? null : (obj as R2ObjectBody).body;
  return new Response(body, {
    status: 200,
    headers: {
      ...getCorsHeaders(request),
      "X-Content-Type-Options": "nosniff",
      "Content-Type": contentType,
      "Content-Length": String(obj.size),
      "Cache-Control": "public, max-age=31536000",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(downloadName)}`,
    },
  });
}

// ============ D1 DATABASE REST HANDLER ============
async function handleDbRequest(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/db\/?/, "");
  const segments = path.split("/").filter(Boolean);
  const resource = segments[0] || "";
  const idParam = segments[1] ? decodeURIComponent(segments[1]) : undefined;
  const subAction = segments[2] ? decodeURIComponent(segments[2]) : undefined;
  const method = request.method;

  try {
    // ---- DEPARTMENTS ----
    if (resource === "departments" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM departments ORDER BY created_at ASC").all();
      return jsonResponse(results, 200, request);
    }

    // ---- CATEGORIES ----
    if (resource === "categories") {
      if (method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM material_categories ORDER BY CASE WHEN display_order IS NULL THEN 9999 ELSE display_order END ASC, created_at ASC"
        ).all();
        return jsonResponse(results, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح — يرجى تسجيل الدخول" }, 401, request);

      if (method === "POST" && idParam === "reorder") {
        const body = (await request.json().catch(() => null)) as { orderedIds?: string[] } | null;
        const ids = body?.orderedIds || [];
        if (ids.length > 0) {
          const stmts = ids.map((cid, idx) =>
            env.DB.prepare("UPDATE material_categories SET display_order = ? WHERE id = ?").bind(idx + 1, cid)
          );
          await env.DB.batch(stmts);
        }
        return jsonResponse({ ok: true }, 200, request);
      }

      if (method === "POST" && !idParam) {
        const body = (await request.json().catch(() => null)) as any;
        if (!body?.name_ar || !body?.name_en) {
          return jsonResponse({ error: "اسم القسم بالعربية والإنجليزية مطلوب" }, 400, request);
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const maxRow = await env.DB.prepare("SELECT COALESCE(MAX(display_order), 0) AS m FROM material_categories").first<{ m: number }>();
        const nextOrder = (maxRow?.m ?? 0) + 1;
        await env.DB.prepare(
          "INSERT INTO material_categories (id, name_ar, name_en, department_id, academic_year, display_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(id, body.name_ar, body.name_en, body.department_id ?? null, body.academic_year ?? null, nextOrder, now)
          .run();
        const created = await env.DB.prepare("SELECT * FROM material_categories WHERE id = ?").bind(id).first();
        return jsonResponse(created, 201, request);
      }

      if (method === "PATCH" && idParam) {
        const body = (await request.json().catch(() => null)) as any;
        const fields: string[] = [];
        const vals: unknown[] = [];
        for (const k of ["name_ar", "name_en", "department_id", "academic_year", "display_order"]) {
          if (k in (body || {})) {
            fields.push(`${k} = ?`);
            vals.push(body[k] ?? null);
          }
        }
        if (fields.length > 0) {
          vals.push(idParam);
          await env.DB.prepare(`UPDATE material_categories SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
        }
        return jsonResponse({ ok: true }, 200, request);
      }

      if (method === "DELETE" && idParam) {
        await env.DB.prepare("DELETE FROM material_categories WHERE id = ?").bind(idParam).run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- COURSES ----
    if (resource === "courses") {
      if (method === "GET") {
        const deptId = url.searchParams.get("department_id");
        if (deptId) {
          const { results } = await env.DB.prepare(
            "SELECT * FROM courses WHERE department_id = ? ORDER BY created_at ASC"
          )
            .bind(deptId)
            .all();
          return jsonResponse(results, 200, request);
        }
        const { results } = await env.DB.prepare("SELECT * FROM courses ORDER BY created_at ASC").all();
        return jsonResponse(results, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح — يرجى تسجيل الدخول" }, 401, request);

      if (method === "POST" && !idParam) {
        const body = (await request.json().catch(() => null)) as any;
        if (!body?.name) return jsonResponse({ error: "اسم المقرر مطلوب" }, 400, request);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO courses (id, name, code, description, description_ar, color, department_id, academic_year, semester, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            id,
            body.name,
            body.code || "",
            body.description || "",
            body.description_ar || body.description || "",
            body.color || "210 70% 50%",
            body.department_id ?? null,
            String(body.academic_year || "1"),
            String(body.semester || "1"),
            body.notes ?? null,
            now
          )
          .run();
        const created = await env.DB.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first();
        return jsonResponse(created, 201, request);
      }

      if (method === "PATCH" && idParam) {
        const body = (await request.json().catch(() => null)) as any;
        const fields: string[] = [];
        const vals: unknown[] = [];
        for (const k of ["name", "code", "description", "description_ar", "department_id", "academic_year", "semester", "notes", "color"]) {
          if (k in (body || {})) {
            fields.push(`${k} = ?`);
            vals.push(body[k] ?? null);
          }
        }
        if (fields.length > 0) {
          vals.push(idParam);
          await env.DB.prepare(`UPDATE courses SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
        }
        return jsonResponse({ ok: true }, 200, request);
      }

      if (method === "DELETE" && idParam) {
        await env.DB.prepare("DELETE FROM courses WHERE id = ?").bind(idParam).run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- MATERIALS ----
    if (resource === "materials") {
      if (method === "GET") {
        if (idParam) {
          const row = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(idParam).first();
          return jsonResponse(row ? formatMaterial(row) : null, 200, request);
        }
        const courseId = url.searchParams.get("course_id");
        const deptId = url.searchParams.get("department_id");
        if (courseId) {
          const { results } = await env.DB.prepare(
            "SELECT * FROM materials WHERE course_id = ? AND deleted_at IS NULL ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END ASC, sort_order ASC, created_at DESC"
          )
            .bind(courseId)
            .all();
          return jsonResponse(results.map(formatMaterial), 200, request);
        }
        if (deptId) {
          const { results } = await env.DB.prepare(
            `SELECT m.* FROM materials m
             INNER JOIN courses c ON c.id = m.course_id
             WHERE c.department_id = ? AND m.deleted_at IS NULL
             ORDER BY CASE WHEN m.sort_order IS NULL THEN 1 ELSE 0 END ASC, m.sort_order ASC, m.created_at DESC`
          )
            .bind(deptId)
            .all();
          return jsonResponse(results.map(formatMaterial), 200, request);
        }
        const { results } = await env.DB.prepare(
          "SELECT * FROM materials WHERE deleted_at IS NULL ORDER BY created_at DESC"
        ).all();
        return jsonResponse(results.map(formatMaterial), 200, request);
      }

      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح — يرجى تسجيل الدخول" }, 401, request);

      if (method === "POST" && idParam === "reorder") {
        const body = (await request.json().catch(() => null)) as { orderedIds?: string[] } | null;
        const ids = body?.orderedIds || [];
        if (ids.length > 0) {
          const stmts = ids.map((mid, idx) =>
            env.DB.prepare("UPDATE materials SET sort_order = ? WHERE id = ?").bind(idx, mid)
          );
          await env.DB.batch(stmts);
        }
        return jsonResponse({ ok: true }, 200, request);
      }

      if (method === "POST" && idParam && subAction === "restore") {
        await env.DB.prepare("UPDATE materials SET deleted_at = NULL, archived = 0 WHERE id = ?")
          .bind(idParam)
          .run();
        return jsonResponse({ ok: true }, 200, request);
      }

      if (method === "POST" && !idParam) {
        const body = (await request.json().catch(() => null)) as any;
        if (!body?.title || !body?.course_id) {
          return jsonResponse({ error: "العنوان والمقرر مطلوبان" }, 400, request);
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO materials (
            id, title, type, course_id, category_id, pdf_url, pdf_display_name,
            external_link, submission_link, deadline, is_assignment, is_list,
            list_content, is_reference, section_number, notes, archived,
            sort_order, video_url, deleted_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)`
        )
          .bind(
            id,
            body.title,
            body.type || "lecture",
            body.course_id,
            body.category_id ?? null,
            body.pdf_url ?? null,
            body.pdf_display_name ?? null,
            body.external_link ?? null,
            body.submission_link ?? null,
            body.deadline ?? null,
            body.is_assignment ? 1 : 0,
            body.is_list ? 1 : 0,
            body.list_content ?? null,
            body.is_reference ? 1 : 0,
            body.section_number ?? null,
            body.notes ?? null,
            body.sort_order ?? null,
            body.video_url ?? null,
            now
          )
          .run();
        const created = await env.DB.prepare("SELECT * FROM materials WHERE id = ?").bind(id).first();
        return jsonResponse(created ? formatMaterial(created) : null, 201, request);
      }

      if (method === "PATCH" && idParam) {
        const body = (await request.json().catch(() => null)) as any;
        const fields: string[] = [];
        const vals: unknown[] = [];
        const boolKeys = new Set(["is_assignment", "is_list", "is_reference", "archived"]);
        const allowedKeys = [
          "title", "course_id", "category_id", "pdf_url", "pdf_display_name",
          "external_link", "submission_link", "deadline", "is_assignment",
          "is_list", "is_reference", "list_content", "section_number",
          "notes", "archived", "sort_order", "video_url",
        ];
        for (const k of allowedKeys) {
          if (k in (body || {})) {
            fields.push(`${k} = ?`);
            vals.push(boolKeys.has(k) ? (body[k] ? 1 : 0) : (body[k] ?? null));
          }
        }
        if (fields.length > 0) {
          vals.push(idParam);
          await env.DB.prepare(`UPDATE materials SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
        }
        return jsonResponse({ ok: true }, 200, request);
      }

      if (method === "DELETE" && idParam) {
        await env.DB.prepare("UPDATE materials SET deleted_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), idParam)
          .run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- MATERIAL URLS FOR BULK OFFLINE ----
    if (resource === "material-urls" && method === "GET") {
      const rawIds = url.searchParams.get("course_ids") || "";
      const ids = rawIds.split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return jsonResponse([], 200, request);
      const placeholders = ids.map(() => "?").join(",");
      const { results } = await env.DB.prepare(
        `SELECT pdf_url FROM materials WHERE course_id IN (${placeholders}) AND deleted_at IS NULL AND archived = 0 AND pdf_url IS NOT NULL`
      )
        .bind(...ids)
        .all<{ pdf_url: string }>();
      return jsonResponse(results.map((r) => r.pdf_url).filter(Boolean), 200, request);
    }

    // ---- IMPORTANT LINKS ----
    if (resource === "links") {
      if (method === "GET") {
        const deptId = url.searchParams.get("department_id");
        const { results } = await env.DB.prepare("SELECT * FROM important_links ORDER BY created_at ASC").all();
        const all = results.map(formatLink);
        const filtered = deptId ? all.filter((l) => !l.department_id || l.department_id === deptId) : all;
        return jsonResponse(filtered, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

      if (method === "POST") {
        const body = (await request.json().catch(() => null)) as any;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO important_links (id, title, title_ar, url, is_persistent, department_id, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
        )
          .bind(id, body.title, body.title_ar ?? null, body.url, body.department_id ?? null, now)
          .run();
        const created = await env.DB.prepare("SELECT * FROM important_links WHERE id = ?").bind(id).first();
        return jsonResponse(created ? formatLink(created) : null, 201, request);
      }
      if (method === "DELETE" && idParam) {
        await env.DB.prepare("DELETE FROM important_links WHERE id = ?").bind(idParam).run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- ANNOUNCEMENTS ----
    if (resource === "announcements") {
      if (method === "GET") {
        const now = new Date().toISOString();
        const { results } = await env.DB.prepare(
          "SELECT * FROM announcements WHERE expires_at > ? ORDER BY created_at DESC"
        )
          .bind(now)
          .all();
        return jsonResponse(results, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

      if (method === "POST") {
        const body = (await request.json().catch(() => null)) as any;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO announcements (id, content, expires_at, link, target_year, target_dept, color, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            id,
            body.content,
            body.expires_at,
            body.link ?? null,
            body.target_year ?? null,
            body.target_dept ?? null,
            body.color ?? null,
            claims.displayName || claims.role,
            now
          )
          .run();
        return jsonResponse({ ok: true, id }, 201, request);
      }
      if (method === "DELETE" && idParam) {
        await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(idParam).run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- NOTIFICATIONS ----
    if (resource === "notifications") {
      if (method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200"
        ).all();
        return jsonResponse(results, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

      if (method === "POST") {
        const body = (await request.json().catch(() => null)) as any;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO notifications (id, title, message, target_audience, target_year, link, sent_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            id,
            body.title,
            body.message,
            body.target_audience || "all",
            body.target_year ?? null,
            body.link ?? null,
            body.sent_by || claims.displayName || "system",
            now
          )
          .run();
        const created = await env.DB.prepare("SELECT * FROM notifications WHERE id = ?").bind(id).first();
        return jsonResponse(created, 201, request);
      }
    }

    // ---- NOTIFICATION TEMPLATES ----
    if (resource === "notification-templates") {
      if (method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM notification_templates").all();
        return jsonResponse(results, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

      if (method === "PATCH" && idParam) {
        const body = (await request.json().catch(() => null)) as any;
        await env.DB.prepare(
          "UPDATE notification_templates SET title_template = ?, message_template = ?, updated_at = ? WHERE id = ?"
        )
          .bind(body.title_template, body.message_template, new Date().toISOString(), idParam)
          .run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- MODERATORS ----
    if (resource === "moderators") {
      const claims = await verifyToken(request, env);
      if (!claims || claims.role !== "owner") {
        return jsonResponse({ error: "صلاحية المالك مطلوبة" }, 403, request);
      }

      if (method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM moderators ORDER BY created_at ASC").all();
        return jsonResponse(results.map(formatModerator), 200, request);
      }
      if (method === "POST" && idParam === "sync-legacy") {
        const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
        if (!body?.username || !body?.password) {
          return jsonResponse({ error: "يرجى إدخال اسم المستخدم وكلمة المرور الأصلية للمالك" }, 400, request);
        }
        const sbRes = await fetch(`${LEGACY_SUPABASE_URL}/functions/v1/admin-login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: LEGACY_SUPABASE_ANON_KEY,
            Authorization: `Bearer ${LEGACY_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ username: body.username.trim(), password: body.password }),
        });
        const sbData = (await sbRes.json().catch(() => null)) as any;
        if (!sbRes.ok || sbData?.role !== "owner" || !sbData?.session?.access_token) {
          return jsonResponse(
            { error: sbData?.error || "بيانات المالك الأصلية في Supabase غير صحيحة" },
            sbRes.status === 429 ? 429 : 401,
            request
          );
        }
        const resSync = await syncLegacyModeratorsWithToken(sbData.session.access_token, env);
        return jsonResponse({ ok: true, ...resSync }, 200, request);
      }
      if (method === "POST" && !idParam) {
        const body = (await request.json().catch(() => null)) as any;
        if (!body?.username || !body?.password || !body?.display_name) {
          return jsonResponse({ error: "جميع الحقول مطلوبة" }, 400, request);
        }
        const existing = await env.DB.prepare("SELECT id FROM moderators WHERE lower(username) = ?")
          .bind(body.username.trim().toLowerCase())
          .first();
        if (existing) {
          return jsonResponse({ error: "اسم المستخدم موجود بالفعل" }, 409, request);
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const pwHash = await hashPassword(body.password);
        await env.DB.prepare(
          "INSERT INTO moderators (id, username, password_hash, display_name, permissions, department_id, academic_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            id,
            body.username.trim(),
            pwHash,
            body.display_name.trim(),
            JSON.stringify(body.permissions || []),
            body.department_id ?? null,
            String(body.academic_year || "1"),
            now
          )
          .run();
        const created = await env.DB.prepare("SELECT * FROM moderators WHERE id = ?").bind(id).first();
        return jsonResponse(created ? formatModerator(created) : null, 201, request);
      }
      if (method === "PATCH" && idParam) {
        const body = (await request.json().catch(() => null)) as any;
        const fields: string[] = [];
        const vals: unknown[] = [];
        if ("permissions" in (body || {})) {
          fields.push("permissions = ?");
          vals.push(JSON.stringify(body.permissions || []));
        }
        if ("department_id" in (body || {})) {
          fields.push("department_id = ?");
          vals.push(body.department_id ?? null);
        }
        if ("academic_year" in (body || {})) {
          fields.push("academic_year = ?");
          vals.push(String(body.academic_year || "1"));
        }
        if (fields.length > 0) {
          vals.push(idParam);
          await env.DB.prepare(`UPDATE moderators SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
        }
        return jsonResponse({ ok: true }, 200, request);
      }
      if (method === "POST" && idParam && subAction === "password") {
        const body = (await request.json().catch(() => null)) as { password?: string } | null;
        if (!body?.password) return jsonResponse({ error: "كلمة المرور الجديدة مطلوبة" }, 400, request);
        const pwHash = await hashPassword(body.password);
        await env.DB.prepare("UPDATE moderators SET password_hash = ? WHERE id = ?").bind(pwHash, idParam).run();
        return jsonResponse({ ok: true }, 200, request);
      }
      if (method === "DELETE" && idParam) {
        await env.DB.prepare("DELETE FROM moderator_course_access WHERE moderator_id = ?").bind(idParam).run();
        await env.DB.prepare("DELETE FROM moderators WHERE id = ?").bind(idParam).run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- MODERATOR COURSE ACCESS ----
    if (resource === "moderator-course-access") {
      if (method === "GET") {
        const modId = url.searchParams.get("moderator_id");
        if (modId) {
          const { results } = await env.DB.prepare(
            "SELECT * FROM moderator_course_access WHERE moderator_id = ?"
          )
            .bind(modId)
            .all();
          return jsonResponse(results, 200, request);
        }
        const { results } = await env.DB.prepare("SELECT * FROM moderator_course_access").all();
        return jsonResponse(results, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims || claims.role !== "owner") return jsonResponse({ error: "غير مصرح" }, 403, request);

      if (method === "POST" && !idParam) {
        const body = (await request.json().catch(() => null)) as any;
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO moderator_course_access (id, moderator_id, course_id, created_at) VALUES (?, ?, ?, ?)"
        )
          .bind(id, body.moderator_id, body.course_id, new Date().toISOString())
          .run();
        return jsonResponse({ ok: true, id }, 201, request);
      }
      if (method === "PUT" && idParam) {
        const body = (await request.json().catch(() => null)) as { courseIds?: string[] } | null;
        await env.DB.prepare("DELETE FROM moderator_course_access WHERE moderator_id = ?").bind(idParam).run();
        const now = new Date().toISOString();
        const ids = body?.courseIds || [];
        if (ids.length > 0) {
          const stmts = ids.map((cid) =>
            env.DB.prepare(
              "INSERT INTO moderator_course_access (id, moderator_id, course_id, created_at) VALUES (?, ?, ?, ?)"
            ).bind(crypto.randomUUID(), idParam, cid, now)
          );
          await env.DB.batch(stmts);
        }
        return jsonResponse({ ok: true }, 200, request);
      }
      if (method === "DELETE" && idParam) {
        await env.DB.prepare("DELETE FROM moderator_course_access WHERE id = ?").bind(idParam).run();
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- SHARED DEPARTMENT COURSES ----
    if (resource === "shared-courses") {
      if (method === "GET") {
        const targetDept = url.searchParams.get("target_department_id");
        const courseId = url.searchParams.get("course_id");
        if (targetDept) {
          const { results } = await env.DB.prepare(
            "SELECT * FROM shared_department_courses WHERE target_department_id = ?"
          )
            .bind(targetDept)
            .all();
          return jsonResponse(results, 200, request);
        }
        if (courseId) {
          const { results } = await env.DB.prepare(
            "SELECT * FROM shared_department_courses WHERE course_id = ?"
          )
            .bind(courseId)
            .all();
          return jsonResponse(results, 200, request);
        }
        const { results } = await env.DB.prepare("SELECT * FROM shared_department_courses").all();
        return jsonResponse(results, 200, request);
      }
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

      if (method === "PUT" && idParam === "by-dept" && subAction) {
        const body = (await request.json().catch(() => null)) as { courseIds?: string[] } | null;
        await env.DB.prepare("DELETE FROM shared_department_courses WHERE target_department_id = ?")
          .bind(subAction)
          .run();
        const now = new Date().toISOString();
        const ids = body?.courseIds || [];
        if (ids.length > 0) {
          await env.DB.batch(
            ids.map((cid) =>
              env.DB.prepare(
                "INSERT INTO shared_department_courses (id, course_id, target_department_id, created_at) VALUES (?, ?, ?, ?)"
              ).bind(crypto.randomUUID(), cid, subAction, now)
            )
          );
        }
        return jsonResponse({ ok: true }, 200, request);
      }
      if (method === "PUT" && idParam === "by-course" && subAction) {
        const body = (await request.json().catch(() => null)) as { targetDeptIds?: string[] } | null;
        await env.DB.prepare("DELETE FROM shared_department_courses WHERE course_id = ?").bind(subAction).run();
        const now = new Date().toISOString();
        const ids = body?.targetDeptIds || [];
        if (ids.length > 0) {
          await env.DB.batch(
            ids.map((tid) =>
              env.DB.prepare(
                "INSERT INTO shared_department_courses (id, course_id, target_department_id, created_at) VALUES (?, ?, ?, ?)"
              ).bind(crypto.randomUUID(), subAction, tid, now)
            )
          );
        }
        return jsonResponse({ ok: true }, 200, request);
      }
    }

    // ---- AUDIT LOGS ----
    if (resource === "audit-logs") {
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ error: "غير مصرح" }, 401, request);

      if (method === "GET") {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || "200")));
        const { results } = await env.DB.prepare(
          "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?"
        )
          .bind(limit)
          .all();
        return jsonResponse(results.map(formatAuditLog), 200, request);
      }
      if (method === "POST") {
        const body = (await request.json().catch(() => null)) as any;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO audit_logs (id, admin_id, admin_name, action, details, action_type, related_material_id, material_snapshot, admin_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            id,
            claims.role === "owner" ? "00000000-0000-0000-0000-000000000000" : (claims.moderatorId || ""),
            claims.displayName || (claims.role === "owner" ? "المالك" : "مشرف"),
            body.action || "",
            body.details || "",
            body.action_type || "other",
            body.related_material_id ?? null,
            body.material_snapshot ? JSON.stringify(body.material_snapshot) : null,
            claims.role === "owner" ? "1" : (claims.academicYear || "1"),
            now
          )
          .run();
        return jsonResponse({ ok: true, id }, 201, request);
      }
    }

    return jsonResponse({ error: `Unknown DB route: ${method} /api/db/${path}` }, 404, request);
  } catch (err: any) {
    console.error("DB API Error:", err);
    return jsonResponse({ error: err?.message || "Database error" }, 500, request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Canonical redirect: www.cic-cloud.com -> https://cic-cloud.com (ensures single fresh version & unified session)
    if (url.hostname === "www.cic-cloud.com") {
      const target = `https://cic-cloud.com${url.pathname}${url.search}`;
      return new Response(null, {
        status: 301,
        headers: {
          Location: target,
          "Cache-Control": "no-store",
        },
      });
    }

    // CORS preflight for all /api/* routes
    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    // Auth endpoints
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleAuthLogin(request, env);
    }
    if (url.pathname === "/api/auth/verify" && request.method === "GET") {
      const claims = await verifyToken(request, env);
      if (!claims) return jsonResponse({ valid: false }, 401, request);
      return jsonResponse({ valid: true, user: claims }, 200, request);
    }

    // Live D1 Database endpoints
    if (url.pathname.startsWith("/api/db/")) {
      return handleDbRequest(request, url, env);
    }

    // Design feedback endpoint
    if (url.pathname === "/api/feedback") {
      if (request.method === "POST") {
        try {
          const body = (await request.json().catch(() => null)) as any;
          if (!body) return jsonResponse({ error: "Invalid JSON" }, 400, request);
          const item = {
            id: crypto.randomUUID(),
            rating: typeof body.rating === "number" ? body.rating : 0,
            preferredDesign: body.preferredDesign || "apple",
            feedback: String(body.feedback || "").slice(0, 2000),
            sectionVotes: body.sectionVotes || {},
            submittedAt: new Date().toISOString(),
          };
          let list: any[] = [];
          try {
            const existing = await env.R2_BUCKET.get("feedback/all_feedback.json");
            if (existing) {
              const parsed = JSON.parse(await existing.text());
              if (Array.isArray(parsed)) list = parsed;
            }
          } catch {}
          list.unshift(item);
          list = list.slice(0, 300);
          await env.R2_BUCKET.put("feedback/all_feedback.json", JSON.stringify(list), {
            httpMetadata: { contentType: "application/json" },
          });
          return jsonResponse({ ok: true, item }, 200, request);
        } catch (err: any) {
          return jsonResponse({ error: err.message }, 500, request);
        }
      }
      if (request.method === "GET") {
        try {
          const existing = await env.R2_BUCKET.get("feedback/all_feedback.json");
          if (existing) {
            return new Response(await existing.text(), {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8", ...getCorsHeaders(request) },
            });
          }
          return jsonResponse([], 200, request);
        } catch (err: any) {
          return jsonResponse({ error: err.message }, 500, request);
        }
      }
      return jsonResponse({ error: "Method not allowed" }, 405, request);
    }

    // Gemini / AI endpoint
    if (url.pathname === "/api/gemini") {
      if (request.method === "OPTIONS") return geminiOptions(request);
      if (request.method === "POST") return geminiPost({ request, env });
      return jsonResponse({ error: "Method not allowed" }, 405, request);
    }

    // R2 storage endpoints (view, download, upload, multipart upload, owner list)
    if (url.pathname.startsWith("/api/r2/")) {
      if (url.pathname === "/api/r2/list" && request.method === "GET") {
        const claims = await verifyToken(request, env);
        if (!claims || claims.role !== "owner") {
          return jsonResponse({ error: "صلاحية المالك مطلوبة" }, 403, request);
        }
        const cursor = url.searchParams.get("cursor") || undefined;
        const prefix = url.searchParams.get("prefix") || undefined;
        const listed = await env.R2_BUCKET.list({ cursor, prefix, limit: 1000 });
        return jsonResponse(
          {
            objects: listed.objects.map((o) => ({
              key: o.key,
              size: o.size,
              uploaded: o.uploaded ? o.uploaded.toISOString() : null,
              publicUrl: buildPublicUrl(o.key),
            })),
            truncated: listed.truncated,
            cursor: listed.cursor || null,
          },
          200,
          request
        );
      }
      if (url.pathname === "/api/r2/view" && (request.method === "GET" || request.method === "HEAD")) {
        return handleR2View(request, url, env);
      }
      if (url.pathname === "/api/r2/download" && (request.method === "GET" || request.method === "HEAD")) {
        return handleDownload(request, url, env);
      }
      if (url.pathname === "/api/r2/upload" && request.method === "PUT") {
        return handleUpload(request, url, env);
      }
      if (url.pathname === "/api/r2/mpu/create" && request.method === "POST") {
        return handleMpuCreate(request, url, env);
      }
      if (url.pathname === "/api/r2/mpu/part" && request.method === "PUT") {
        return handleMpuPart(request, url, env);
      }
      if (url.pathname === "/api/r2/mpu/complete" && request.method === "POST") {
        return handleMpuComplete(request, url, env);
      }
      return jsonResponse({ error: "Not found" }, 404, request);
    }

    return env.ASSETS.fetch(request);
  },
};
