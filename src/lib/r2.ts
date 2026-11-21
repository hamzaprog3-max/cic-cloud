/**
 * Cloudflare R2 upload, inline viewing, and direct download helper.
 * Routes all R2 reads/writes through our same-origin Cloudflare Worker (/api/r2/*)
 * so files open and download reliably on every ISP and browser with zero CORS/CSP issues.
 */

export const R2_PUBLIC_URL = "https://pub-4cf0dc0d822448ab96ef068825b177f8.r2.dev";

const SINGLE_UPLOAD_LIMIT = 45 * 1024 * 1024;
const MULTIPART_CHUNK_SIZE = 20 * 1024 * 1024;

export function getWorkerApiBase(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("cic-cloud.com") || host.includes("workers.dev")) {
      return "";
    }
  }
  return "https://cic-cloud.com";
}

export function extractR2Key(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl, typeof window !== "undefined" ? window.location.origin : "https://cic-cloud.com");
    if (u.pathname === "/api/r2/view" || u.pathname === "/api/r2/download") {
      return u.searchParams.get("key");
    }
    if (u.hostname.includes("r2.dev") || u.hostname.includes("r2.cloudflarestorage.com")) {
      return decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    }
    return null;
  } catch {
    return null;
  }
}

export function isR2Url(rawUrl?: string | null): boolean {
  return Boolean(extractR2Key(rawUrl));
}

/**
 * Converts an R2 public URL into a same-origin inline streaming URL (/api/r2/view?key=...)
 * so PDFs, videos, audio, and images open cleanly even if *.r2.dev is blocked or throttled.
 */
export function toR2ViewUrl(rawUrl: string): string {
  const key = extractR2Key(rawUrl);
  if (!key) return rawUrl;
  const apiBase = getWorkerApiBase();
  return `${apiBase}/api/r2/view?key=${encodeURIComponent(key)}`;
}

/**
 * Converts an R2 public URL into a forced-download URL (/api/r2/download?key=...&name=...).
 */
export function toR2DownloadUrl(rawUrl: string, filename?: string): string {
  const key = extractR2Key(rawUrl);
  if (!key) return rawUrl;
  const apiBase = getWorkerApiBase();
  const name = filename || key.split("/").pop() || "download";
  return `${apiBase}/api/r2/download?key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`;
}

function sanitizeR2Key(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
  const base = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
  const cleanBase = base.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || "file";
  return `${Date.now()}-${cleanBase}${ext}`;
}

function inferContentType(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
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
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function getAuthToken(): string {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("lms_token") : null;
  if (!token) {
    throw new Error("انتهت جلسة تسجيل الدخول — يرجى تسجيل الخروج وإعادة تسجيل الدخول أولاً لرفع الملفات.");
  }
  return token;
}

export function isVideoFile(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(file.name)
  );
}

/** Upload any material file (PDF, video, audio, document, image) directly to Cloudflare R2. */
export async function uploadFileToR2(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const token = getAuthToken();
  const apiBase = getWorkerApiBase();
  const key = sanitizeR2Key(file.name);
  const contentType = inferContentType(file);

  if (file.size <= SINGLE_UPLOAD_LIMIT) {
    onProgress?.(10);
    const res = await fetch(
      `${apiBase}/api/r2/upload?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": contentType,
        },
        body: file,
      }
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const errMsg = errData?.error || (await res.text().catch(() => res.statusText));
      throw new Error(`فشل رفع الملف (${res.status}): ${errMsg}`);
    }
    const data = (await res.json()) as { publicUrl: string };
    onProgress?.(100);
    return data.publicUrl;
  }

  const createRes = await fetch(
    `${apiBase}/api/r2/mpu/create?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => createRes.statusText);
    throw new Error(`فشل بدء الرفع متعدد الأجزاء (${createRes.status}): ${errText}`);
  }
  const { uploadId } = (await createRes.json()) as { uploadId: string };

  const parts: Array<{ partNumber: number; etag: string }> = [];
  let partNumber = 1;
  let uploadedBytes = 0;

  for (let start = 0; start < file.size; start += MULTIPART_CHUNK_SIZE) {
    const end = Math.min(start + MULTIPART_CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const partRes = await fetch(
      `${apiBase}/api/r2/mpu/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: chunk,
      }
    );
    if (!partRes.ok) {
      const errText = await partRes.text().catch(() => partRes.statusText);
      throw new Error(`فشل رفع الجزء ${partNumber} (${partRes.status}): ${errText}`);
    }
    const partData = (await partRes.json()) as { partNumber: number; etag: string };
    parts.push({ partNumber: partData.partNumber, etag: partData.etag });
    uploadedBytes = end;
    onProgress?.(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
    partNumber += 1;
  }

  const completeRes = await fetch(`${apiBase}/api/r2/mpu/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, uploadId, parts }),
  });
  if (!completeRes.ok) {
    const errText = await completeRes.text().catch(() => completeRes.statusText);
    throw new Error(`فشل إتمام رفع الملف (${completeRes.status}): ${errText}`);
  }
  const completeData = (await completeRes.json()) as { publicUrl: string };
  onProgress?.(100);
  return completeData.publicUrl;
}

export const uploadVideoToR2 = uploadFileToR2;
