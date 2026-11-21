/**
 * Cloudinary CDN Video Streaming utilities & strict URL validation.
 * Supports:
 * - Standard Cloudinary delivery URLs (MP4, WebM, MOV, MKV, extensionless)
 * - Cloudinary Adaptive HLS (.m3u8) streaming URLs
 * - Cloudinary Video Player embed URLs (player.cloudinary.com/embed/...)
 * - Automatically extracts & validates `src` if an admin pastes a Cloudinary <iframe> snippet
 * - Preserves signed Cloudinary URLs (s--...--) without mutating transformations
 */

export interface ParsedCloudinaryVideo {
  isValid: boolean;
  isCloudinary: boolean;
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
  streamTypeLabel: { ar: string; en: string };
  error?: string;
}

const CLOUDINARY_HOST_RE = /^(?:res|player|video-res|media)\.cloudinary\.com$/i;
const CLOUDINARY_SUBDOMAIN_RE = /^[a-z0-9-]+\.cloudinary\.com$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov|mkv|avi|m4v|m3u8)(\?.*)?$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|oga|flac)(\?.*)?$/i;
const HLS_EXT_RE = /\.m3u8(\?.*)?$/i;
const SIGNED_SEGMENT_RE = /\/s--[A-Za-z0-9_-]+--\//;

/**
 * If an admin pastes a full Cloudinary <iframe src="..."> snippet, safely extract
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

/**
 * Parse a Cloudinary video delivery URL into cloudName, transformation prefix, version, and publicId.
 * Example: https://res.cloudinary.com/demo/video/upload/q_auto/v1234/folder/lec1.mp4
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
  // Expect at least: [cloudName, "video", "upload"|"authenticated"|"private", ...rest]
  if (parts.length < 4) return null;
  const [cloudName, resourceType, deliveryType, ...rest] = parts;
  if (resourceType !== "video") return null;
  if (!["upload", "fetch", "authenticated", "private"].includes(deliveryType)) return null;

  const afterUpload = rest.join("/");
  // Locate the public ID by stripping leading transformation segments and optional v12345 version
  const remaining = [...rest];
  while (remaining.length > 1) {
    const seg = remaining[0];
    // Signed segment s--...-- or transformation segment (contains comma or key_value like f_auto, q_auto, sp_hd, w_720)
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

/**
 * Build a Cloudinary poster thumbnail URL from a res.cloudinary.com video URL.
 */
function buildCloudinaryPosterUrl(url: URL, cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/video/upload/so_auto,f_jpg,q_auto,w_960/${publicId}.jpg`;
}

/**
 * Build an MP4 fallback URL from an unsigned Cloudinary HLS (.m3u8) or extensionless URL.
 */
function buildCloudinaryMp4Url(cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/video/upload/f_mp4,q_auto/${publicId}.mp4`;
}

/**
 * Validate and parse a video stream URL (strict Cloudinary validation when `requireCloudinary` is true).
 */
export function parseCloudinaryVideo(
  rawInput: string | null | undefined,
  options: { requireCloudinary?: boolean } = {}
): ParsedCloudinaryVideo {
  const { requireCloudinary = false } = options;
  const cleaned = extractUrlFromInput(rawInput || "");

  const invalid = (error: string): ParsedCloudinaryVideo => ({
    isValid: false,
    isCloudinary: false,
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
  const isCldHost = isCloudinaryHost(host);

  // 1) Cloudinary Video Player embed: https://player.cloudinary.com/embed/?cloud_name=...&public_id=...
  if (host === "player.cloudinary.com") {
    const cloudName = parsed.searchParams.get("cloud_name");
    const publicId = parsed.searchParams.get("public_id");
    if (!parsed.pathname.startsWith("/embed") || !cloudName || !publicId) {
      return invalid("رابط مشغّل Cloudinary غير مكتمل (تأكد من وجود cloud_name و public_id)");
    }
    // Enforce clean embed parameters
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
      streamTypeLabel: { ar: "مشغل Cloudinary", en: "Cloudinary Player" },
    };
  }

  // 2) Standard Cloudinary CDN video delivery URL (res.cloudinary.com/<cloud>/video/...)
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

    // Preserve exact URL for signed/HLS/direct video URLs; derive poster + MP4 fallback when unsigned
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
      streamTypeLabel: isHls
        ? { ar: "فيديو تكيفي Cloudinary HLS", en: "Cloudinary Adaptive HLS" }
        : isAudio
          ? { ar: "تسجيل صوتي Cloudinary", en: "Cloudinary Audio" }
          : { ar: "فيديو مسجل Cloudinary CDN", en: "Cloudinary CDN Video" },
    };
  }

  if (requireCloudinary) {
    return invalid("يُسمح فقط بروابط Cloudinary CDN (res.cloudinary.com أو player.cloudinary.com)");
  }

  // 3) Non-Cloudinary direct video/audio (e.g., existing Cloudflare R2 or Supabase Storage media)
  const isHls = HLS_EXT_RE.test(parsed.pathname);
  const isAudio = AUDIO_EXT_RE.test(parsed.pathname);
  const isVideo = VIDEO_EXT_RE.test(parsed.pathname);
  if (!isVideo && !isAudio) {
    return invalid("الرابط ليس ملف فيديو أو وسائط مدعومة");
  }

  return {
    isValid: true,
    isCloudinary: false,
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
  const parsed = parseCloudinaryVideo(url, { requireCloudinary: true });
  return parsed.isValid && parsed.isCloudinary;
}

/** Quick check: is this URL any playable media (Cloudinary stream, HLS, MP4, WebM, audio)? */
export function isPlayableMediaUrl(url?: string | null, displayName?: string | null): boolean {
  if (!url) return false;
  if (isCloudinaryVideoUrl(url)) return true;
  return Boolean(
    VIDEO_EXT_RE.test(url) ||
    AUDIO_EXT_RE.test(url) ||
    (displayName && (VIDEO_EXT_RE.test(displayName) || AUDIO_EXT_RE.test(displayName)))
  );
}

/** Whether a URL can be cached as a single static blob offline (excludes HLS/embed streams). */
export function isOfflineCacheableUrl(url?: string | null): boolean {
  if (!url) return false;
  const parsed = parseCloudinaryVideo(url);
  if (parsed.isHls || parsed.isPlayerEmbed) return false;
  return true;
}
