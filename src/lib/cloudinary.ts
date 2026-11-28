import { getWorkerApiBase } from "@/lib/r2";

/**
 * Unified Video & Media Streaming utilities (YouTube, Cloudinary, Cloudflare R2, Direct MP4/Audio, SharePoint/Teams).
 * Supports:
 * - YouTube videos, shorts, live, embeds, timestamps, and playlists (plays inline inside VideoViewerModal)
 * - Regular uploaded videos/audios (Cloudflare R2, Supabase, direct MP4/WebM/MOV/MP3/M4A/WAV)
 * - Cloudinary CDN delivery URLs, Adaptive HLS (.m3u8), and Player embed URLs
 * - Microsoft SharePoint / OneDrive / Teams recordings (explicitly detected so they open in Teams/SharePoint instead of breaking <video>)
 * - Safe extraction of `src` from pasted <iframe> snippets
 */

export interface ParsedCloudinaryVideo {
  isValid: boolean;
  isCloudinary: boolean;
  isYouTube: boolean;
  isSharePoint: boolean;
  isHls: boolean;
  isPlayerEmbed: boolean;
  isAudio: boolean;
  isSigned: boolean;
  normalizedUrl: string;
  streamUrl: string;
  mp4FallbackUrl: string | null;
  posterUrl: string | null;
  cloudName: string | null;
  publicId: string | null;
  youtubeId: string | null;
  youtubePlaylistId: string | null;
  streamTypeLabel: { ar: string; en: string };
  error?: string;
}

const CLOUDINARY_HOST_RE = /^(?:res|player|video-res|media)\.cloudinary\.com$/i;
const CLOUDINARY_SUBDOMAIN_RE = /^[a-z0-9-]+\.cloudinary\.com$/i;
const YOUTUBE_HOST_RE = /^(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;
const SHAREPOINT_HOST_RE = /(?:^|\.)(?:sharepoint\.com|sharepoint-df\.com|1drv\.ms|onedrive\.live\.com|stream\.microsoft\.com)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|mkv|avi|m4v|m3u8)(\?.*)?$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|oga|flac)(\?.*)?$/i;
const HLS_EXT_RE = /\.m3u8(\?.*)?$/i;
const SIGNED_SEGMENT_RE = /\/s--[A-Za-z0-9_-]+--\//;

/**
 * If an admin pastes a full <iframe src="..."> snippet, safely extract
 * the `src` URL without ever rendering raw HTML.
 */
export function extractUrlFromInput(rawInput: string): string {
  const trimmed = (rawInput || "").trim();
  if (!trimmed) return "";

  if (/^<iframe\b/i.test(trimmed)) {
    const srcMatch = trimmed.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    if (srcMatch) {
      return (srcMatch[1] || srcMatch[2] || srcMatch[3] || "").trim();
    }
  }

  return trimmed;
}

/** Check whether a hostname belongs to Cloudinary CDN. */
export function isCloudinaryHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return CLOUDINARY_HOST_RE.test(host) || CLOUDINARY_SUBDOMAIN_RE.test(host);
}

/** Strict HTTPS check rejecting credentials, localhost, and private/loopback hosts. */
function isSafeHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      !host ||
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** Check whether a URL is a Microsoft SharePoint / OneDrive / Teams recording page (NOT a raw streamable MP4). */
export function isSharePointOrOneDriveUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) return false;
  try {
    const u = new URL(rawUrl.trim());
    return SHAREPOINT_HOST_RE.test(u.hostname.toLowerCase().replace(/\.$/, ""));
  } catch {
    return false;
  }
}

function parseYouTubeTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n > 0 ? n : null;
  }
  const m = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i);
  if (!m) return null;
  const total = (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  return total > 0 ? total : null;
}

export interface ParsedYouTubeInfo {
  videoId: string | null;
  playlistId: string | null;
  startSeconds: number | null;
  embedUrl: string;
  watchUrl: string;
  posterUrl: string | null;
}

/** Parse any YouTube URL (watch, youtu.be, shorts, live, embed, or playlist) into a safe embed URL. */
export function parseYouTubeUrl(rawUrl?: string | null): ParsedYouTubeInfo | null {
  if (!rawUrl) return null;
  const cleaned = extractUrlFromInput(rawUrl);
  const parsed = isSafeHttpsUrl(cleaned);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!YOUTUBE_HOST_RE.test(host)) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  const playlistIdRaw = parsed.searchParams.get("list");
  const playlistId = playlistIdRaw && /^[A-Za-z0-9_-]{8,128}$/.test(playlistIdRaw) ? playlistIdRaw : null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = segments[0] || null;
  } else if (parsed.pathname === "/watch") {
    videoId = parsed.searchParams.get("v");
  } else if (
    segments.length >= 2 &&
    ["embed", "shorts", "live", "v"].includes(segments[0].toLowerCase())
  ) {
    if (segments[1] !== "videoseries") {
      videoId = segments[1];
    }
  }

  if (videoId && !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    videoId = null;
  }

  if (!videoId && !playlistId) return null;

  const startSeconds =
    parseYouTubeTimestamp(parsed.searchParams.get("t")) ||
    parseYouTubeTimestamp(parsed.searchParams.get("start"));

  const embed = videoId
    ? new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`)
    : new URL("https://www.youtube-nocookie.com/embed/videoseries");

  embed.searchParams.set("autoplay", "1");
  embed.searchParams.set("rel", "0");
  embed.searchParams.set("modestbranding", "1");
  if (playlistId) embed.searchParams.set("list", playlistId);
  if (startSeconds) embed.searchParams.set("start", String(startSeconds));

  const watchUrl = videoId
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${playlistId ? `&list=${encodeURIComponent(playlistId)}` : ""}`
    : `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId!)}`;

  return {
    videoId,
    playlistId,
    startSeconds,
    embedUrl: embed.toString(),
    watchUrl,
    posterUrl: videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : null,
  };
}

/** Quick check: is this URL a playable YouTube video or playlist? */
export function isYouTubeUrl(url?: string | null): boolean {
  return Boolean(parseYouTubeUrl(url));
}

/**
 * Parse a Cloudinary video delivery URL into cloudName, transformation prefix, version, and publicId.
 */
function parseCloudinaryDeliveryPath(url: URL): {
  cloudName: string;
  resourceType: string;
  deliveryType: string;
  afterUpload: string;
  publicId: string | null;
  extension: string | null;
} | null {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) return null;
  const [cloudName, resourceType, deliveryType, ...rest] = parts;
  if (resourceType !== "video") return null;
  if (!["upload", "fetch", "authenticated", "private"].includes(deliveryType)) return null;

  const afterUpload = rest.join("/");
  const remaining = [...rest];
  while (remaining.length > 1) {
    const seg = remaining[0];
    if (
      /^s--[A-Za-z0-9_-]+--$/.test(seg) ||
      seg.includes(",") ||
      /^(?:[a-z]{1,3}_[^/]+)$/.test(seg)
    ) {
      remaining.shift();
      continue;
    }
    if (/^v\d+$/.test(seg)) {
      remaining.shift();
      break;
    }
    break;
  }

  const lastJoined = remaining.join("/");
  const extMatch = lastJoined.match(/\.([a-z0-9]{2,5})$/i);
  const extension = extMatch ? extMatch[1].toLowerCase() : null;
  const publicId = extension ? lastJoined.slice(0, -(extension.length + 1)) : lastJoined;

  return {
    cloudName,
    resourceType,
    deliveryType,
    afterUpload,
    publicId: publicId || null,
    extension,
  };
}

function buildCloudinaryPosterUrl(_url: URL, cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/video/upload/so_auto,f_jpg,q_auto,w_960/${publicId}.jpg`;
}

function buildCloudinaryMp4Url(cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/video/upload/f_mp4,q_auto/${publicId}.mp4`;
}

/**
 * Validate and parse a video/media URL (YouTube, Cloudinary, R2/Direct MP4/Audio, or SharePoint).
 */
export function parseCloudinaryVideo(
  rawInput: string | null | undefined,
  options: { requireCloudinary?: boolean; allowYouTube?: boolean; allowSharePoint?: boolean } = {}
): ParsedCloudinaryVideo {
  const { requireCloudinary = false, allowYouTube = true, allowSharePoint = false } = options;
  const cleaned = extractUrlFromInput(rawInput || "");

  const invalid = (error: string): ParsedCloudinaryVideo => ({
    isValid: false,
    isCloudinary: false,
    isYouTube: false,
    isSharePoint: false,
    isHls: false,
    isPlayerEmbed: false,
    isAudio: false,
    isSigned: false,
    normalizedUrl: "",
    streamUrl: "",
    mp4FallbackUrl: null,
    posterUrl: null,
    cloudName: null,
    publicId: null,
    youtubeId: null,
    youtubePlaylistId: null,
    streamTypeLabel: { ar: "رابط غير صالح", en: "Invalid URL" },
    error,
  });

  if (!cleaned) {
    return invalid("الرابط فارغ");
  }

  const parsed = isSafeHttpsUrl(cleaned);
  if (!parsed) {
    return invalid("يجب أن يكون الرابط HTTPS صالحاً وآمناً (https://...)");
  }

  const host = parsed.hostname.toLowerCase();

  // 0) YouTube video or playlist (plays inline via youtube-nocookie iframe!)
  const yt = parseYouTubeUrl(cleaned);
  if (yt && (allowYouTube || !requireCloudinary)) {
    const isPlaylistOnly = !yt.videoId && Boolean(yt.playlistId);
    const hasPlaylist = Boolean(yt.playlistId);
    return {
      isValid: true,
      isCloudinary: false,
      isYouTube: true,
      isSharePoint: false,
      isHls: false,
      isPlayerEmbed: true,
      isAudio: false,
      isSigned: false,
      normalizedUrl: parsed.toString(),
      streamUrl: yt.embedUrl,
      mp4FallbackUrl: null,
      posterUrl: yt.posterUrl,
      cloudName: null,
      publicId: yt.videoId || yt.playlistId,
      youtubeId: yt.videoId,
      youtubePlaylistId: yt.playlistId,
      streamTypeLabel: isPlaylistOnly
        ? { ar: "قائمة تشغيل يوتيوب", en: "YouTube Playlist" }
        : hasPlaylist
          ? { ar: "يوتيوب (قائمة تشغيل)", en: "YouTube Playlist Video" }
          : { ar: "فيديو يوتيوب", en: "YouTube Video" },
    };
  }

  // 0.5) Microsoft SharePoint / OneDrive / Teams recording links
  if (isSharePointOrOneDriveUrl(cleaned)) {
    if (allowSharePoint) {
      return {
        isValid: true,
        isCloudinary: false,
        isYouTube: false,
        isSharePoint: true,
        isHls: false,
        isPlayerEmbed: false,
        isAudio: false,
        isSigned: false,
        normalizedUrl: parsed.toString(),
        streamUrl: parsed.toString(),
        mp4FallbackUrl: null,
        posterUrl: null,
        cloudName: null,
        publicId: null,
        youtubeId: null,
        youtubePlaylistId: null,
        streamTypeLabel: { ar: "تسجيل Microsoft Teams / SharePoint", en: "Teams / SharePoint Recording" },
      };
    }
    return invalid("روابط SharePoint/Teams تفتح في نافذة مستقلة بسبب حماية مايكروسوفت");
  }

  const isCldHost = isCloudinaryHost(host);

  // 1) Cloudinary Video Player embed
  if (host === "player.cloudinary.com") {
    const cloudName = parsed.searchParams.get("cloud_name");
    const publicId = parsed.searchParams.get("public_id");
    if (!parsed.pathname.startsWith("/embed") || !cloudName || !publicId) {
      return invalid("رابط مشغّل Cloudinary غير مكتمل (تأكد من وجود cloud_name و public_id)");
    }
    const safeEmbed = new URL("https://player.cloudinary.com/embed/");
    parsed.searchParams.forEach((v, k) => {
      if (/^[a-z0-9_[\].-]+$/i.test(k)) {
        safeEmbed.searchParams.set(k, v);
      }
    });
    const cleanPublicId = publicId.replace(/\.(mp4|webm|mov|m3u8|mkv)$/i, "");
    return {
      isValid: true,
      isCloudinary: true,
      isYouTube: false,
      isSharePoint: false,
      isHls: false,
      isPlayerEmbed: true,
      isAudio: false,
      isSigned: false,
      normalizedUrl: safeEmbed.toString(),
      streamUrl: safeEmbed.toString(),
      mp4FallbackUrl: buildCloudinaryMp4Url(cloudName, cleanPublicId),
      posterUrl: buildCloudinaryPosterUrl(parsed, cloudName, cleanPublicId),
      cloudName,
      publicId: cleanPublicId,
      youtubeId: null,
      youtubePlaylistId: null,
      streamTypeLabel: { ar: "مشغل Cloudinary", en: "Cloudinary Player" },
    };
  }

  // 2) Standard Cloudinary CDN video delivery URL
  if (isCldHost) {
    const info = parseCloudinaryDeliveryPath(parsed);
    const isSigned = SIGNED_SEGMENT_RE.test(parsed.pathname);
    const isHls = HLS_EXT_RE.test(parsed.pathname);
    const isAudio = AUDIO_EXT_RE.test(parsed.pathname);

    if (!info && !VIDEO_EXT_RE.test(parsed.pathname) && !isAudio) {
      return invalid("رابط Cloudinary يجب أن يشير إلى فيديو (/video/upload/...) أو مشغّل player.cloudinary.com");
    }

    const cloudName = info?.cloudName || null;
    const publicId = info?.publicId || null;

    const posterUrl =
      !isAudio && !isSigned && cloudName && publicId
        ? buildCloudinaryPosterUrl(parsed, cloudName, publicId)
        : null;

    const mp4FallbackUrl =
      !isAudio && !isSigned && cloudName && publicId
        ? isHls
          ? buildCloudinaryMp4Url(cloudName, publicId)
          : parsed.toString()
        : isAudio || isHls
          ? null
          : parsed.toString();

    return {
      isValid: true,
      isCloudinary: true,
      isYouTube: false,
      isSharePoint: false,
      isHls,
      isPlayerEmbed: false,
      isAudio,
      isSigned,
      normalizedUrl: parsed.toString(),
      streamUrl: parsed.toString(),
      mp4FallbackUrl,
      posterUrl,
      cloudName,
      publicId,
      youtubeId: null,
      youtubePlaylistId: null,
      streamTypeLabel: isHls
        ? { ar: "فيديو تكيفي Cloudinary HLS", en: "Cloudinary Adaptive HLS" }
        : isAudio
          ? { ar: "تسجيل صوتي Cloudinary", en: "Cloudinary Audio" }
          : { ar: "فيديو مسجل Cloudinary CDN", en: "Cloudinary CDN Video" },
    };
  }

  if (requireCloudinary) {
    return invalid("يُسمح بروابط YouTube أو Cloudinary CDN أو Teams/SharePoint أو ملفات الفيديو المباشرة");
  }

  // 3) Non-Cloudinary direct video/audio (Cloudflare R2, Supabase Storage, direct HTTPS media)
  const isHls = HLS_EXT_RE.test(parsed.pathname);
  const isAudio = AUDIO_EXT_RE.test(parsed.pathname);
  const isVideo = VIDEO_EXT_RE.test(parsed.pathname);
  if (!isVideo && !isAudio) {
    return invalid("الرابط ليس ملف فيديو أو وسائط مدعومة");
  }

  return {
    isValid: true,
    isCloudinary: false,
    isYouTube: false,
    isSharePoint: false,
    isHls,
    isPlayerEmbed: false,
    isAudio,
    isSigned: false,
    normalizedUrl: parsed.toString(),
    streamUrl: parsed.toString(),
    mp4FallbackUrl: isHls ? null : parsed.toString(),
    posterUrl: null,
    cloudName: null,
    publicId: null,
    youtubeId: null,
    youtubePlaylistId: null,
    streamTypeLabel: isAudio
      ? { ar: "تسجيل صوتي", en: "Audio Stream" }
      : isHls
        ? { ar: "فيديو تكيفي HLS", en: "Adaptive HLS Video" }
        : { ar: "فيديو مباشر", en: "Direct Video" },
  };
}

/** Quick check: is this URL a Cloudinary video/stream URL? */
export function isCloudinaryVideoUrl(url?: string | null): boolean {
  if (!url) return false;
  const parsed = parseCloudinaryVideo(url, { requireCloudinary: true, allowYouTube: false });
  return parsed.isValid && parsed.isCloudinary;
}

/** Quick check: is this URL an inline-playable stream card (YouTube or Cloudinary)? */
export function isInlineStreamUrl(url?: string | null): boolean {
  if (!url) return false;
  return isYouTubeUrl(url) || isCloudinaryVideoUrl(url);
}

/**
 * Quick check: is this URL any inline-playable media (YouTube, Cloudinary, direct R2/HTTPS MP4/WebM/audio)?
 * Explicitly excludes SharePoint/OneDrive/Teams web links even if their path contains `.mp4`.
 */
export function isPlayableMediaUrl(url?: string | null, displayName?: string | null): boolean {
  if (!url) return false;
  if (isSharePointOrOneDriveUrl(url)) return false;
  if (isYouTubeUrl(url)) return true;
  if (isCloudinaryVideoUrl(url)) return true;
  try {
    const pathname = new URL(url).pathname;
    if (VIDEO_EXT_RE.test(pathname) || AUDIO_EXT_RE.test(pathname)) return true;
  } catch {
    if (VIDEO_EXT_RE.test(url) || AUDIO_EXT_RE.test(url)) return true;
  }
  return Boolean(
    displayName &&
      (url.includes("r2.dev") || url.includes("supabase.co") || url.includes("/api/r2/")) &&
      (VIDEO_EXT_RE.test(displayName) || AUDIO_EXT_RE.test(displayName))
  );
}

/** Whether a URL can be cached as a single static blob offline (excludes YouTube, SharePoint, Drive, HLS, embeds). */
export function isOfflineCacheableUrl(url?: string | null): boolean {
  if (!url) return false;
  if (isYouTubeUrl(url) || isSharePointOrOneDriveUrl(url)) return false;
  if (/drive\.google\.com/i.test(url)) return false;
  const parsed = parseCloudinaryVideo(url);
  if (parsed.isHls || parsed.isPlayerEmbed || parsed.isYouTube || parsed.isSharePoint) return false;
  return true;
}

/**
 * Build a direct CDN download URL with Cloudinary's `fl_attachment` flag so browsers stream-download
 * the video directly from Cloudinary without buffering large files into RAM.
 */
export function buildCloudinaryDownloadUrl(rawUrl?: string | null): string | null {
  if (!rawUrl) return null;
  const parsed = parseCloudinaryVideo(rawUrl, { requireCloudinary: true, allowYouTube: false });
  if (!parsed.isValid || !parsed.isCloudinary || parsed.isSigned) return null;

  // For HLS or Player embeds, download via the MP4 rendition with fl_attachment
  if ((parsed.isHls || parsed.isPlayerEmbed) && parsed.cloudName && parsed.publicId) {
    return `https://res.cloudinary.com/${encodeURIComponent(parsed.cloudName)}/video/upload/fl_attachment,f_mp4,q_auto/${parsed.publicId}.mp4`;
  }

  try {
    const u = new URL(parsed.normalizedUrl);
    if (!/\/video\/upload\//.test(u.pathname)) return null;
    if (/\/fl_attachment\b/.test(u.pathname)) return u.toString();
    u.pathname = u.pathname.replace("/video/upload/", "/video/upload/fl_attachment/");
    return u.toString();
  } catch {
    return null;
  }
}

/** Check whether a File object is a video or audio file suitable for Cloudinary CDN video hosting. */
export function isVideoOrAudioFile(file: File): boolean {
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) return true;
  return VIDEO_EXT_RE.test(file.name) || AUDIO_EXT_RE.test(file.name);
}

/** Parse a pasted CLOUDINARY_URL (cloudinary://api_key:api_secret@cloud_name) if the user copies it from Cloudinary Dashboard. */
export function parseCloudinaryConnectionUrl(raw: string): {
  cloud_name: string;
  api_key: string;
  api_secret: string;
} | null {
  const cleaned = raw.trim().replace(/^CLOUDINARY_URL\s*=\s*/i, "").replace(/^["']|["']$/g, "");
  const m = cleaned.match(/^cloudinary:\/\/([^:@\s]+):([^@\s]+)@([a-z0-9_-]{2,64})$/i);
  if (!m) return null;
  return {
    api_key: decodeURIComponent(m[1]),
    api_secret: decodeURIComponent(m[2]),
    cloud_name: m[3],
  };
}

// ============ CLOUDINARY CDN DIRECT UPLOAD CLIENT (SIGNED + UNSIGNED + CHUNKED) ============

export interface CloudinaryConfigStatus {
  configured: boolean;
  enabled: boolean;
  auto_route_videos: boolean;
  upload_mode: "signed" | "unsigned";
  effective_mode: "signed" | "unsigned" | "unconfigured";
  cloud_name: string;
  upload_preset: string;
  api_key: string;
  has_api_secret: boolean;
  masked_api_secret: string;
  folder: string;
  updated_at: string | null;
}

export interface CloudinaryUsageStats {
  plan: string;
  last_updated: string | null;
  credits: { usage: number; limit: number; used_percent: number } | null;
  storage: { usage: number; credits_usage: number } | null;
  bandwidth: { usage: number; credits_usage: number } | null;
  resources: number;
  derived_resources: number;
}

export interface CloudinaryUploadResult {
  secureUrl: string;
  publicId: string;
  bytes: number;
  duration?: number;
  format?: string;
  width?: number;
  height?: number;
  posterUrl: string | null;
}

interface CloudinarySignResponse {
  mode: "signed" | "unsigned";
  cloud_name: string;
  upload_url: string;
  folder: string;
  api_key?: string;
  timestamp?: number;
  signature?: string;
  upload_preset?: string;
}

function getAdminAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("lms_token") : null;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export async function getCloudinaryConfig(): Promise<CloudinaryConfigStatus> {
  const res = await fetch(`${getWorkerApiBase()}/api/cloudinary/config`, {
    method: "GET",
    headers: getAdminAuthHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `فشل تحميل إعدادات Cloudinary (${res.status})`);
  return data as CloudinaryConfigStatus;
}

export async function saveCloudinaryConfig(payload: {
  cloud_name?: string;
  upload_mode?: "signed" | "unsigned";
  upload_preset?: string;
  api_key?: string;
  api_secret?: string;
  clear_api_secret?: boolean;
  folder?: string;
  enabled?: boolean;
  auto_route_videos?: boolean;
}): Promise<CloudinaryConfigStatus> {
  const res = await fetch(`${getWorkerApiBase()}/api/cloudinary/config`, {
    method: "POST",
    headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `فشل حفظ إعدادات Cloudinary (${res.status})`);
  return data.config as CloudinaryConfigStatus;
}

export async function testCloudinaryConnection(payload?: {
  cloud_name?: string;
  upload_mode?: "signed" | "unsigned";
  upload_preset?: string;
  api_key?: string;
  api_secret?: string;
}): Promise<{ ok: boolean; mode?: string; message?: string; error?: string; usage?: CloudinaryUsageStats }> {
  const res = await fetch(`${getWorkerApiBase()}/api/cloudinary/test`, {
    method: "POST",
    headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `فشل فحص الاتصال (${res.status})`);
  return data;
}

export async function getCloudinaryUsage(): Promise<{
  ok: boolean;
  usage?: CloudinaryUsageStats;
  error?: string;
}> {
  const res = await fetch(`${getWorkerApiBase()}/api/cloudinary/usage`, {
    method: "GET",
    headers: getAdminAuthHeaders(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `فشل جلب استهلاك Cloudinary (${res.status})`);
  return data;
}

const CLOUDINARY_CHUNK_SIZE = 20 * 1024 * 1024; // 20 MB chunks (Cloudinary requires >= 5 MB per chunk)

function formatCloudinaryError(rawMsg: string, fileSizeBytes: number): string {
  const lower = rawMsg.toLowerCase();
  if (lower.includes("file size too large") || lower.includes("maximum is")) {
    const mb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
    return `حجم الفيديو (${mb} MB) أكبر من الحد المسموح في خطة Cloudinary الحالية (الخطة المجانية حدها الأقصى 100 MB للفيديو الواحد — يمكنك ضغطه أو تقسيمه أو الترقية).`;
  }
  if (lower.includes("invalid signature")) {
    return "التوقيع غير صالح — تأكد من صحة API Secret في «إعدادات Cloudinary CDN».";
  }
  if (lower.includes("preset") && (lower.includes("not found") || lower.includes("unsigned"))) {
    return "اسم الـ Upload Preset غير موجود أو غير مفعّل كـ Unsigned في لوحة تحكم Cloudinary.";
  }
  if (lower.includes("invalid cloud_name") || lower.includes("unknown api key")) {
    return "تأكد من صحة Cloud Name و API Key في «إعدادات Cloudinary CDN».";
  }
  return rawMsg || "فشل رفع الفيديو على Cloudinary CDN";
}

function sendXhrChunk(
  uploadUrl: string,
  formData: FormData,
  extraHeaders: Record<string, string>,
  onLoaded: (loaded: number) => void,
  signal?: AbortSignal
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl, true);
    for (const [k, v] of Object.entries(extraHeaders)) {
      xhr.setRequestHeader(k, v);
    }

    const onAbort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) {
        reject(new Error("تم إلغاء الرفع"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onLoaded(ev.loaded);
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      let parsed: any = null;
      try {
        parsed = JSON.parse(xhr.responseText || "{}");
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed);
      } else {
        const msg = parsed?.error?.message || `HTTP ${xhr.status}`;
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("فشل الاتصال بسيرفر Cloudinary — تأكد من الإنترنت أو إعدادات الشبكة"));
    };

    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("تم إلغاء رفع الفيديو"));
    };

    xhr.send(formData);
  });
}

function buildUploadFormData(sign: CloudinarySignResponse, chunk: Blob, fileName: string): FormData {
  const fd = new FormData();
  fd.append("file", chunk, fileName);
  if (sign.mode === "signed") {
    if (sign.api_key) fd.append("api_key", sign.api_key);
    if (sign.timestamp !== undefined) fd.append("timestamp", String(sign.timestamp));
    if (sign.signature) fd.append("signature", sign.signature);
  } else if (sign.upload_preset) {
    fd.append("upload_preset", sign.upload_preset);
  }
  if (sign.folder) {
    fd.append("folder", sign.folder);
  }
  return fd;
}

/**
 * Upload a video/audio file directly from browser to Cloudinary CDN (never stored in Cloudflare R2).
 * Automatically uses 20 MB chunked uploads for large lecture videos with live progress tracking.
 * Returns only the CDN delivery link (`secureUrl`) + metadata to save as link-only in D1.
 */
export async function uploadVideoToCloudinary(
  file: File,
  options?: {
    subfolder?: string;
    onProgress?: (pct: number) => void;
    signal?: AbortSignal;
  }
): Promise<CloudinaryUploadResult> {
  const { subfolder, onProgress, signal } = options || {};

  // 1. Obtain signed upload params (or unsigned preset) from Cloudflare Worker
  const signRes = await fetch(`${getWorkerApiBase()}/api/cloudinary/sign`, {
    method: "POST",
    headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(subfolder ? { subfolder } : {}),
    signal,
  });
  const signData = (await signRes.json().catch(() => null)) as (CloudinarySignResponse & { error?: string }) | null;
  if (!signRes.ok || !signData?.upload_url) {
    throw new Error(signData?.error || `فشل تحضير رفع Cloudinary (${signRes.status})`);
  }

  const totalSize = file.size;
  let finalResponse: any = null;

  try {
    if (totalSize <= CLOUDINARY_CHUNK_SIZE) {
      const fd = buildUploadFormData(signData, file, file.name);
      finalResponse = await sendXhrChunk(
        signData.upload_url,
        fd,
        {},
        (loaded) => {
          if (onProgress && totalSize > 0) {
            onProgress(Math.min(99, Math.round((loaded / totalSize) * 100)));
          }
        },
        signal
      );
    } else {
      const uniqueUploadId = `cic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      let offset = 0;

      while (offset < totalSize) {
        const end = Math.min(offset + CLOUDINARY_CHUNK_SIZE, totalSize);
        const chunk = file.slice(offset, end);
        const fd = buildUploadFormData(signData, chunk, file.name);
        const chunkStart = offset;
        const contentRange = `bytes ${chunkStart}-${end - 1}/${totalSize}`;

        finalResponse = await sendXhrChunk(
          signData.upload_url,
          fd,
          {
            "X-Unique-Upload-Id": uniqueUploadId,
            "Content-Range": contentRange,
          },
          (loaded) => {
            if (onProgress && totalSize > 0) {
              const overall = Math.min(totalSize, chunkStart + Math.min(loaded, end - chunkStart));
              onProgress(Math.min(99, Math.round((overall / totalSize) * 100)));
            }
          },
          signal
        );

        offset = end;
      }
    }
  } catch (err: any) {
    throw new Error(formatCloudinaryError(err?.message || "", totalSize));
  }

  const secureUrl = String(finalResponse?.secure_url || finalResponse?.url || "");
  const publicId = String(finalResponse?.public_id || "");
  if (!secureUrl) {
    throw new Error("لم يُرجع Cloudinary رابط الفيديو بعد الرفع");
  }

  onProgress?.(100);
  const parsed = parseCloudinaryVideo(secureUrl, { requireCloudinary: true, allowYouTube: false });

  return {
    secureUrl,
    publicId,
    bytes: Number(finalResponse?.bytes || totalSize),
    duration: typeof finalResponse?.duration === "number" ? finalResponse.duration : undefined,
    format: finalResponse?.format ? String(finalResponse.format) : undefined,
    width: typeof finalResponse?.width === "number" ? finalResponse.width : undefined,
    height: typeof finalResponse?.height === "number" ? finalResponse.height : undefined,
    posterUrl: parsed.posterUrl,
  };
}
