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
