import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Maximize, Minimize, ExternalLink, Loader2, AlertTriangle, PlayCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { playClickSfx } from "@/hooks/use-sfx";
import { toast } from "sonner";
import { useState, useCallback, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useOfflineStorage } from "@/hooks/use-offline-storage";
import { toR2ViewUrl, toR2DownloadUrl } from "@/lib/r2";
import {
  parseCloudinaryVideo,
  parseYouTubeUrl,
  isSharePointOrOneDriveUrl,
  buildCloudinaryDownloadUrl,
} from "@/lib/cloudinary";

interface VideoViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string;
  title: string;
  displayName?: string;
}

const VideoViewerModal = ({
  open,
  onOpenChange,
  videoUrl,
  title,
  displayName,
}: VideoViewerModalProps) => {
  const { t, lang } = useI18n();
  const isMobile = useIsMobile();

  const [isMaximized, setIsMaximized] = useState(false);
  const [actualVideoUrl, setActualVideoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [triedMp4Fallback, setTriedMp4Fallback] = useState(false);

  const { getCachedUrl } = useOfflineStorage();

  const youtubeInfo = useMemo(() => parseYouTubeUrl(videoUrl), [videoUrl]);
  const isSharePoint = useMemo(() => isSharePointOrOneDriveUrl(videoUrl), [videoUrl]);
  const parsedStream = useMemo(
    () => parseCloudinaryVideo(videoUrl, { allowYouTube: true, allowSharePoint: true }),
    [videoUrl]
  );

  const isYouTube = Boolean(youtubeInfo);
  const isIframeEmbed = isYouTube || (parsedStream.isValid && parsedStream.isPlayerEmbed);
  const isAudio = Boolean(
    !isYouTube &&
      !isSharePoint &&
      !isIframeEmbed &&
      (videoUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?.*)?$/i) ||
        displayName?.match(/\.(mp3|wav|m4a|aac|ogg)$/i))
  );

  useEffect(() => {
    if (!open || !videoUrl) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    setMediaError(false);
    setTriedMp4Fallback(false);

    if (isIframeEmbed || isSharePoint) {
      setIsLoading(false);
      setActualVideoUrl(isYouTube ? youtubeInfo!.embedUrl : parsedStream.streamUrl);
      return;
    }

    setIsLoading(true);

    const resolvePlaybackUrl = (): string => {
      if (parsedStream.isCloudinary && parsedStream.isHls && parsedStream.mp4FallbackUrl) {
        const supportsNativeHls =
          typeof document !== "undefined" &&
          Boolean(document.createElement("video").canPlayType("application/vnd.apple.mpegurl"));
        if (!supportsNativeHls) {
          return parsedStream.mp4FallbackUrl;
        }
      }
      return toR2ViewUrl(videoUrl);
    };

    const initViewer = async () => {
      try {
        const cachedUrl = await getCachedUrl(videoUrl);
        if (cancelled) return;

        if (cachedUrl) {
          objectUrl = cachedUrl;
          setActualVideoUrl(cachedUrl);
        } else {
          setActualVideoUrl(resolvePlaybackUrl());
        }

        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: title || displayName || "تسجيل المحاضرة",
            artist: "CIC Cloud",
            album: "محاضرات",
            artwork: [
              { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
            ],
          });
        }
      } catch {
        if (!cancelled) {
          setActualVideoUrl(resolvePlaybackUrl());
        }
      }
    };

    initViewer();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = null;
      }
    };
  }, [open, videoUrl, getCachedUrl, title, displayName, isIframeEmbed, isSharePoint, isYouTube, youtubeInfo, parsedStream.streamUrl, parsedStream.isCloudinary, parsedStream.isHls, parsedStream.mp4FallbackUrl]);

  const rawBaseName = title || displayName || "video";
  const fileName = isAudio
    ? (/\.(mp3|wav|m4a|aac|ogg)$/i.test(rawBaseName) ? rawBaseName : `${rawBaseName}.mp3`)
    : (/\.(mp4|webm|mov|mkv|avi)$/i.test(rawBaseName) ? rawBaseName : `${rawBaseName}.mp4`);

  const subtitle = isYouTube
    ? (youtubeInfo?.playlistId
        ? (lang === "ar" ? "YouTube — قائمة تشغيل مدمجة داخل المنصة" : "YouTube — Embedded Playlist")
        : (lang === "ar" ? "YouTube — تشغيل مباشر داخل المنصة" : "YouTube — Inline Player"))
    : isSharePoint
      ? (lang === "ar" ? "تسجيل Microsoft Teams / SharePoint" : "Microsoft Teams / SharePoint Recording")
      : parsedStream.isPlayerEmbed
        ? parsedStream.streamTypeLabel[lang === "ar" ? "ar" : "en"]
        : fileName;

  const handleDownload = useCallback(async () => {
    playClickSfx();
    try {
      // Stream-download directly from Cloudinary CDN using fl_attachment (zero browser RAM buffering!)
      const cldDownloadUrl = buildCloudinaryDownloadUrl(videoUrl);
      if (cldDownloadUrl) {
        const a = document.createElement("a");
        a.href = cldDownloadUrl;
        a.download = fileName;
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.success(t("material.downloadSuccess"), { id: "dl-viewer" });
        return;
      }

      toast.loading(t("material.downloading"), { id: "dl-viewer" });
      const dlTarget = toR2DownloadUrl(videoUrl, fileName);
      const res = await fetch(dlTarget);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success(t("material.downloadSuccess"), { id: "dl-viewer" });
    } catch {
      toast.error(t("material.downloadFail"), { id: "dl-viewer" });
    }
  }, [videoUrl, fileName, t]);

  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) {
        setActualVideoUrl(null);
        setMediaError(false);
        setIsLoading(false);
      }
      onOpenChange(value);
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 p-0 overflow-hidden transition-all duration-300 ease-in-out bg-black border-border/50",
          isMaximized
            ? "max-w-none w-[100vw] h-[100vh] sm:rounded-none border-0 m-0"
            : "max-w-5xl w-[95vw] h-[85vh] sm:h-[90vh]"
        )}
      >
        {/* Header */}
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/50 shrink-0 bg-background text-foreground">
          <div className="flex items-start justify-between gap-3 pe-8 mb-1">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base font-display">
                {title}
              </DialogTitle>
              <DialogDescription className="truncate text-xs mt-0.5 text-left" dir="ltr">
                {subtitle}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!isMobile && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsMaximized(!isMaximized)}
                  className="gap-1.5 text-xs h-9"
                >
                  {isMaximized ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </Button>
              )}
              {isYouTube ? (
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className="gap-1.5 text-xs h-9"
                >
                  <a
                    href={youtubeInfo?.watchUrl || videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => playClickSfx()}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {lang === "ar" ? "فتح في يوتيوب" : "Open on YouTube"}
                    </span>
                  </a>
                </Button>
              ) : isSharePoint ? (
                <Button
                  size="sm"
                  asChild
                  className="gap-1.5 text-xs h-9"
                >
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => playClickSfx()}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{lang === "ar" ? "فتح في Teams" : "Open in Teams"}</span>
                  </a>
                </Button>
              ) : !parsedStream.isPlayerEmbed ? (
                <Button
                  size="sm"
                  onClick={handleDownload}
                  className="gap-1.5 text-xs h-9"
                  id="video-viewer-download"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {t("pdfViewer.download")}
                  </span>
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 relative min-h-0 flex items-center justify-center bg-black">
          {isSharePoint ? (
            <div className="max-w-md mx-auto p-6 text-center space-y-4 text-white">
              <div className="w-16 h-16 rounded-2xl bg-primary/20 text-primary mx-auto flex items-center justify-center">
                <PlayCircle className="w-9 h-9" />
              </div>
              <h3 className="text-base font-bold">
                {lang === "ar"
                  ? "تسجيل محاضرة على Microsoft Teams / SharePoint"
                  : "Microsoft Teams / SharePoint Recording"}
              </h3>
              <p className="text-xs text-white/70 leading-relaxed">
                {lang === "ar"
                  ? "تسجيلات مايكروسوفت تيمز تتطلب تسجيل الدخول بحساب الأكاديمية (@sha.edu.eg) ولا يسمح SharePoint بتشغيلها داخل مشغل خارجي. اضغط الزر بالأسفل لفتح التسجيل مباشرة."
                  : "Microsoft Teams recordings require your academy Microsoft account and cannot be embedded externally. Click below to watch directly."}
              </p>
              <Button asChild className="gap-2 rounded-full">
                <a href={videoUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                  {lang === "ar" ? "تشغيل التسجيل على SharePoint" : "Watch on SharePoint"}
                </a>
              </Button>
            </div>
          ) : isIframeEmbed && actualVideoUrl ? (
            <iframe
              key={actualVideoUrl}
              src={actualVideoUrl}
              title={title}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : mediaError ? (
            <div className="max-w-md mx-auto p-6 text-center space-y-4 text-white">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <h3 className="text-base font-bold">
                {lang === "ar" ? "تعذّر تشغيل الفيديو داخل المتصفح" : "Unable to play video in browser"}
              </h3>
              <p className="text-xs text-white/70 leading-relaxed">
                {lang === "ar"
                  ? "قد يكون نوع ترميز الفيديو غير مدعوم في هذا المتصفح أو الرابط يحتاج فتح مباشر. يمكنك تحميله أو فتحه في نافذة جديدة."
                  : "The video codec may not be supported by this browser or the link requires direct access. You can download or open it directly."}
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Button size="sm" onClick={handleDownload} className="gap-1.5">
                  <Download className="w-4 h-4" />
                  {t("pdfViewer.download")}
                </Button>
                <Button size="sm" variant="secondary" asChild className="gap-1.5">
                  <a href={actualVideoUrl || videoUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4" />
                    {lang === "ar" ? "فتح في نافذة جديدة" : "Open in new tab"}
                  </a>
                </Button>
              </div>
            </div>
          ) : actualVideoUrl ? (
            <>
              {isLoading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/60 pointer-events-none">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <span className="text-xs text-white/80">
                    {lang === "ar" ? "جاري تحميل الفيديو..." : "Loading media..."}
                  </span>
                </div>
              )}
              {isAudio ? (
                <audio
                  key={actualVideoUrl}
                  src={actualVideoUrl}
                  controls
                  autoPlay
                  preload="metadata"
                  className="w-full max-w-md px-4"
                  controlsList="nodownload"
                  onLoadedMetadata={() => setIsLoading(false)}
                  onCanPlay={() => setIsLoading(false)}
                  onError={() => {
                    setIsLoading(false);
                    setMediaError(true);
                  }}
                >
                  {lang === "ar" ? "متصفحك لا يدعم تشغيل الصوت." : "Your browser does not support the audio tag."}
                </audio>
              ) : (
                <video
                  key={actualVideoUrl}
                  src={actualVideoUrl}
                  poster={parsedStream.posterUrl || undefined}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-contain"
                  controlsList="nodownload"
                  onLoadedMetadata={() => setIsLoading(false)}
                  onCanPlay={() => setIsLoading(false)}
                  onWaiting={() => setIsLoading(true)}
                  onPlaying={() => setIsLoading(false)}
                  onError={() => {
                    // For Cloudinary non-native containers (e.g. .mkv / .mov / .avi), auto-retry with Cloudinary MP4 transcode once
                    if (
                      !triedMp4Fallback &&
                      parsedStream.isCloudinary &&
                      parsedStream.cloudName &&
                      parsedStream.publicId
                    ) {
                      const mp4Url = `https://res.cloudinary.com/${encodeURIComponent(parsedStream.cloudName)}/video/upload/f_mp4,q_auto/${parsedStream.publicId}.mp4`;
                      if (mp4Url !== actualVideoUrl) {
                        setTriedMp4Fallback(true);
                        setIsLoading(true);
                        setActualVideoUrl(mp4Url);
                        return;
                      }
                    }
                    setIsLoading(false);
                    setMediaError(true);
                  }}
                >
                  {lang === "ar" ? "متصفحك لا يدعم تشغيل الفيديو." : "Your browser does not support the video tag."}
                </video>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VideoViewerModal;
