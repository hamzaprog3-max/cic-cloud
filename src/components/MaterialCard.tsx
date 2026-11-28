import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  ExternalLink,
  Clock,
  Archive,
  ArchiveRestore,
  Trash2,
  Download,
  Pencil,
  X,
  Save,
  Link,
  Share2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Copy,
  BookOpen,
  Sparkles,
  PlayCircle,
  Play,
  Radio,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type { Material, MaterialCategory, Course } from "@/lib/store";
import { db } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { isPast } from "date-fns";
import { safeFormatDate, slugify, coursePath, normalizeLink, parseDeadlineDate } from "@/lib/utils";
import { ar, enUS } from "date-fns/locale";
import { playClickSfx } from "@/hooks/use-sfx";
import { useState, useMemo, lazy, Suspense } from "react";
import { OfflineMaterialButton } from "./OfflineMaterialButton";
import { downloadFileDirectly } from "@/lib/download";
import { toR2DownloadUrl, isR2Url } from "@/lib/r2";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useDesign } from "@/hooks/use-design";
import {
  isCloudinaryVideoUrl,
  isInlineStreamUrl,
  isOfflineCacheableUrl,
  isPlayableMediaUrl,
  isSharePointOrOneDriveUrl,
  isYouTubeUrl,
  parseCloudinaryVideo,
  parseYouTubeUrl,
} from "@/lib/cloudinary";

const PdfViewerModal = lazy(() => import("@/components/PdfViewerModal"));
const VideoViewerModal = lazy(() => import("@/components/VideoViewerModal"));
const AiLectureExplainerModal = lazy(() => import("@/components/AiLectureExplainerModal"));

interface Props {
  material: Material;
  index: number;
  isAdmin?: boolean;
  showDelete?: boolean;
  showEdit?: boolean;
  highlightedId?: string | null;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onUpdate?: () => void;
  categories?: MaterialCategory[];
  courses?: Course[];
  dragHandleListeners?: Record<string, Function>;
  dragHandleAttributes?: Record<string, any>;
  style?: React.CSSProperties;
}

const MaterialCard = ({
  material,
  index,
  isAdmin,
  showDelete = true,
  showEdit = true,
  highlightedId,
  onArchive,
  onUnarchive,
  onDelete,
  onUpdate,
  categories = [],
  courses = [],
  dragHandleListeners,
  dragHandleAttributes,
  style,
}: Props) => {
  const { t, lang } = useI18n();
  const { isApple } = useDesign();
  const locale = lang === "ar" ? ar : enUS;
  const parsedDeadline = parseDeadlineDate(material.deadline);
  const deadlinePast = Boolean(parsedDeadline && isPast(parsedDeadline));
  const isHighlighted = highlightedId === material.id;
  const isRecent = Boolean(
    material.created_at &&
      Date.now() - new Date(material.created_at).getTime() < 3 * 24 * 60 * 60 * 1000
  );

  const safePdfUrl = useMemo(() => normalizeLink(material.pdf_url), [material.pdf_url]);
  const safeExternalLink = useMemo(() => normalizeLink(material.external_link), [material.external_link]);
  const safeSubmissionLink = useMemo(() => normalizeLink(material.submission_link), [material.submission_link]);

  // Resolve inline stream URL: YouTube OR Cloudinary OR explicit video_url (excluding SharePoint web pages)
  const cloudinaryStreamUrl = useMemo(() => {
    const candidates = [material.video_url, safePdfUrl, safeExternalLink];
    for (const u of candidates) {
      if (u && isInlineStreamUrl(u)) return u;
    }
    if (material.video_url && !isSharePointOrOneDriveUrl(material.video_url)) {
      return material.video_url;
    }
    return null;
  }, [material.video_url, safePdfUrl, safeExternalLink]);

  const parsedStream = useMemo(
    () => (cloudinaryStreamUrl ? parseCloudinaryVideo(cloudinaryStreamUrl, { allowYouTube: true, allowSharePoint: false }) : null),
    [cloudinaryStreamUrl]
  );

  // Detect SharePoint / Microsoft Teams recording URL (stored in video_url, pdf_url, or external_link)
  const sharePointVideoUrl = useMemo(() => {
    if (material.video_url && isSharePointOrOneDriveUrl(material.video_url)) return material.video_url;
    if (safePdfUrl && isSharePointOrOneDriveUrl(safePdfUrl)) return safePdfUrl;
    return null;
  }, [material.video_url, safePdfUrl]);

  // Don't duplicate pdf_url / external_link row if it IS the inline stream (YouTube/Cloudinary) or SharePoint recording
  const showPdfSection = Boolean(
    safePdfUrl &&
      safePdfUrl !== cloudinaryStreamUrl &&
      safePdfUrl !== sharePointVideoUrl
  );
  const showExternalSection = Boolean(
    safeExternalLink &&
      safeExternalLink !== cloudinaryStreamUrl &&
      safeExternalLink !== sharePointVideoUrl
  );

  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [videoViewerUrl, setVideoViewerUrl] = useState<string | null>(null);
  const [aiExplainerOpen, setAiExplainerOpen] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  // Admin Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState(material.title);
  const [editCourseId, setEditCourseId] = useState(material.course_id);
  const [editCategoryId, setEditCategoryId] = useState(material.category_id || "");
  const [editVideoUrl, setEditVideoUrl] = useState(cloudinaryStreamUrl || "");
  const [editExternalLink, setEditExternalLink] = useState(material.external_link || "");
  const [editSubmissionLink, setEditSubmissionLink] = useState(material.submission_link || "");
  const [editDeadline, setEditDeadline] = useState(
    material.deadline ? material.deadline.slice(0, 16) : ""
  );
  const [editPdfDisplayName, setEditPdfDisplayName] = useState(material.pdf_display_name || "");
  const [editIsList, setEditIsList] = useState(material.is_list || false);
  const [editIsReference, setEditIsReference] = useState(material.is_reference || false);
  const [editListContent, setEditListContent] = useState(material.list_content || "");
  const [editSectionNumber, setEditSectionNumber] = useState(material.section_number || "all");
  const [editNotes, setEditNotes] = useState(material.notes || "");
  const [isExpanded, setIsExpanded] = useState(false);

  const editVideoValidation = useMemo(() => {
    if (!editVideoUrl.trim()) return null;
    return parseCloudinaryVideo(editVideoUrl, {
      requireCloudinary: false,
      allowYouTube: true,
      allowSharePoint: true,
    });
  }, [editVideoUrl]);

  const copyListContent = (e: React.MouseEvent) => {
    e.stopPropagation();
    playClickSfx();
    if (material.list_content) {
      navigator.clipboard.writeText(material.list_content);
      toast.success(lang === "ar" ? "تم نسخ المحتوى" : "Content copied");
    }
  };

  const renderListContent = (content: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return content.split("\n").map((line, i) => {
      const parts = line.split(urlRegex);
      return (
        <div key={i} className="mb-2 last:mb-0 min-h-[1.5rem]">
          {parts.map((part, j) => {
            if (/^https?:\/\//i.test(part)) {
              const safeHref = normalizeLink(part);
              if (safeHref) {
                if (isYouTubeUrl(safeHref) || isPlayableMediaUrl(safeHref)) {
                  return (
                    <span key={j} className="inline-flex items-center gap-1.5 flex-wrap align-middle">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playClickSfx();
                          setVideoViewerUrl(safeHref);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/12 hover:bg-primary/20 text-primary font-semibold text-xs transition-colors cursor-pointer"
                      >
                        <PlayCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{isYouTubeUrl(safeHref) ? (lang === "ar" ? "تشغيل يوتيوب" : "Play YouTube") : (lang === "ar" ? "تشغيل الفيديو" : "Play Video")}</span>
                      </button>
                      <a
                        href={safeHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary hover:underline break-all text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {part}
                      </a>
                    </span>
                  );
                }
                return (
                  <a
                    key={j}
                    href={safeHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline break-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {part}
                  </a>
                );
              }
            }
            return <span key={j}>{part}</span>;
          })}
        </div>
      );
    });
  };

  const openEdit = () => {
    playClickSfx();
    setEditTitle(material.title);
    setEditCourseId(material.course_id);
    setEditCategoryId(material.category_id || "");
    setEditVideoUrl(material.video_url || cloudinaryStreamUrl || sharePointVideoUrl || "");
    setEditExternalLink(material.external_link || "");
    setEditSubmissionLink(material.submission_link || "");
    setEditDeadline(material.deadline ? material.deadline.slice(0, 16) : "");
    setEditPdfDisplayName(material.pdf_display_name || "");
    setEditIsList(material.is_list || false);
    setEditIsReference(material.is_reference || false);
    setEditListContent(material.list_content || "");
    setEditSectionNumber(material.section_number || "all");
    setEditNotes(material.notes || "");
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!editTitle.trim()) {
      toast.error(lang === "ar" ? "العنوان مطلوب" : "Title is required");
      return;
    }

    let finalVideoUrl: string | null = null;
    if (editVideoUrl.trim()) {
      const parsedVal = parseCloudinaryVideo(editVideoUrl, {
        requireCloudinary: false,
        allowYouTube: true,
        allowSharePoint: true,
      });
      if (!parsedVal.isValid) {
        toast.error(parsedVal.error || (lang === "ar" ? "رابط الفيديو غير صالح" : "Invalid video URL"));
        return;
      }
      finalVideoUrl = parsedVal.normalizedUrl;
    }

    setSaving(true);
    try {
      await db.updateMaterial(material.id, {
        title: editTitle.trim(),
        course_id: editCourseId,
        category_id: editCategoryId || null,
        video_url: finalVideoUrl,
        external_link: editExternalLink.trim() ? normalizeLink(editExternalLink) : null,
        submission_link: material.is_assignment && editSubmissionLink.trim()
          ? normalizeLink(editSubmissionLink)
          : null,
        deadline: editDeadline || null,
        pdf_display_name: editPdfDisplayName.trim() || null,
        is_list: editIsList,
        is_reference: editIsReference,
        list_content: editIsList ? editListContent : null,
        section_number: editSectionNumber === "all" ? null : editSectionNumber,
        notes: editNotes.trim() || null,
      });
      toast.success(lang === "ar" ? "تم التعديل بنجاح ✅" : "Updated successfully ✅");
      setEditOpen(false);
      onUpdate?.();
      db.addAuditLog(`تعديل مادة: ${editTitle.trim()}`, `ID: ${material.id}`, {
        action_type: "edit",
        related_material_id: material.id,
      }).catch(() => {});
    } catch {
      toast.error(lang === "ar" ? "فشل التعديل" : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  // Precompute shared PDF/media action info cleanly once for both designs
  const pdfAction = useMemo(() => {
    if (!showPdfSection || !safePdfUrl) return null;
    const isVideo = isPlayableMediaUrl(safePdfUrl, material.pdf_display_name);
    const isSupabaseDoc =
      (safePdfUrl.includes("supabase.co") ||
        safePdfUrl.includes("r2.dev") ||
        safePdfUrl.includes("r2.cloudflarestorage.com")) &&
      !isVideo;

    const buildDownloadName = (rawFilename: string) => {
      const extMatch = rawFilename.match(/\.[0-9a-z]+$/i);
      let ext = extMatch ? extMatch[0] : "";
      if (!ext) {
        if (isVideo) ext = ".mp4";
        else if (isSupabaseDoc) ext = ".pdf";
      }
      let name = material.pdf_display_name || material.title || "download";
      if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) {
        name = `${name}${ext}`;
      }
      return name;
    };

    const getDownloadUrl = (url: string) => {
      try {
        const urlObj = new URL(url);
        if (isR2Url(url)) {
          const key = decodeURIComponent(urlObj.pathname.replace(/^\/+/, ""));
          const filename = key.split("/").pop() || key;
          const name = buildDownloadName(filename);
          return toR2DownloadUrl(url, name);
        }
        if (urlObj.hostname.includes("supabase.co")) {
          const pathParts = urlObj.pathname.split("/");
          const filename = pathParts[pathParts.length - 1];
          urlObj.searchParams.set("download", buildDownloadName(filename));
          return urlObj.toString();
        }
        return url;
      } catch {
        return url;
      }
    };

    return {
      isVideo,
      isSupabaseDoc,
      downloadUrl: getDownloadUrl(safePdfUrl),
      filenameToSave: buildDownloadName(material.pdf_display_name || material.title),
    };
  }, [showPdfSection, safePdfUrl, material.pdf_display_name, material.title]);

  const handleShareMaterial = (e: React.MouseEvent) => {
    e.stopPropagation();
    playClickSfx();
    const courseObj = courses.find((c) => c.id === material.course_id);
    let url: URL;
    if (courseObj) {
      url = new URL(window.location.origin + coursePath(courseObj, courses));
    } else {
      url = new URL(window.location.origin + `/course/${material.course_id}`);
    }

    if (material.category_id) {
      const cat = categories?.find((c) => c.id === material.category_id);
      if (courseObj && cat) {
        const catSlug = slugify(cat.name_en) || slugify(cat.name_ar) || cat.id;
        url = new URL(window.location.origin + `${coursePath(courseObj, courses)}/${catSlug}`);
      } else {
        url.searchParams.set("category", material.category_id);
      }
    }
    url.searchParams.set("material", material.id);

    const shareTitle = material.title;
    const shareText =
      lang === "ar"
        ? `شاهد "${material.title}" على منصة CIC Cloud`
        : `Check out "${material.title}" on CIC Cloud`;
    const shareUrl = url.toString();

    if (navigator.share) {
      navigator
        .share({ title: shareTitle, text: shareText, url: shareUrl })
        .catch(() => {
          navigator.clipboard
            .writeText(`${shareTitle}\n${shareUrl}`)
            .then(() => toast.success(t("material.linkCopied")))
            .catch(() => undefined);
        });
    } else {
      navigator.clipboard
        .writeText(`${shareTitle}\n${shareUrl}`)
        .then(() => toast.success(t("material.linkCopied")))
        .catch(() => toast.error(t("material.shareFail")));
    }
  };

  const hasBadges = Boolean(
    isRecent ||
      material.is_reference ||
      cloudinaryStreamUrl ||
      sharePointVideoUrl ||
      material.is_assignment ||
      (material.section_number && material.section_number !== "all")
  );

  const adminControls = isAdmin ? (
    <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
      {showEdit && (
        <button
          type="button"
          onClick={openEdit}
          title={lang === "ar" ? "تعديل" : "Edit"}
          className="icloud-icon-btn hover:text-primary"
        >
          <Pencil className="w-4 h-4" />
        </button>
      )}
      {showEdit && onArchive && !material.archived && (
        <button
          type="button"
          onClick={() => onArchive(material.id)}
          title={lang === "ar" ? "أرشفة" : "Archive"}
          className="icloud-icon-btn"
        >
          <Archive className="w-4 h-4" />
        </button>
      )}
      {showEdit && onUnarchive && material.archived && (
        <button
          type="button"
          onClick={() => onUnarchive(material.id)}
          title={t("admin.unarchive")}
          className="icloud-icon-btn hover:text-emerald-600"
        >
          <ArchiveRestore className="w-4 h-4" />
        </button>
      )}
      {showDelete && onDelete && (
        <button
          type="button"
          onClick={() => onDelete(material.id)}
          title={lang === "ar" ? "حذف" : "Delete"}
          className="icloud-icon-btn hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  ) : null;

  const badgePills = hasBadges ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {isRecent && isApple && (
        <span className="icloud-unread-dot" title={lang === "ar" ? "جديد" : "New"} />
      )}
      {isRecent && (
        <span
          className={
            isApple
              ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/12 text-primary"
              : "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
          }
        >
          <Sparkles className="w-2.5 h-2.5" />
          {lang === "ar" ? (isApple ? "جديد" : "جديد مُحدّث") : "New"}
        </span>
      )}
      {material.is_reference && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <BookOpen className="w-3 h-3" />
          {lang === "ar" ? "مرجع المادة" : "Reference"}
        </span>
      )}
      {cloudinaryStreamUrl && (
        <span
          className={
            parsedStream?.isYouTube
              ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/12 text-red-600 dark:text-red-400"
              : "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
          }
        >
          <PlayCircle className="w-2.5 h-2.5" />
          {parsedStream?.isYouTube
            ? parsedStream.streamTypeLabel[lang === "ar" ? "ar" : "en"]
            : t("admin.streamBadge")}
        </span>
      )}
      {sharePointVideoUrl && !cloudinaryStreamUrl && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/12 text-sky-600 dark:text-sky-400">
          <PlayCircle className="w-2.5 h-2.5" />
          {lang === "ar" ? "تسجيل Teams" : "Teams Recording"}
        </span>
      )}
      {material.is_assignment && (
        <span
          className={
            isApple
              ? "inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-400"
              : "inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/12 text-primary"
          }
        >
          {t("material.assignment")}
        </span>
      )}
      {material.section_number && material.section_number !== "all" && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-foreground/80">
          {material.section_number.startsWith("سكشن")
            ? material.section_number
            : lang === "ar"
              ? `سكشن ${material.section_number}`
              : `Sec ${material.section_number}`}
        </span>
      )}
    </div>
  ) : null;

  const streamPreviewBlock =
    cloudinaryStreamUrl && parsedStream?.isValid ? (
      <div className="mt-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            playClickSfx();
            setVideoViewerUrl(cloudinaryStreamUrl);
          }}
          className="icloud-video-thumb w-full max-w-md group/vid text-start block cursor-pointer"
        >
          <div className="relative aspect-[16/9] w-full flex items-center justify-center overflow-hidden">
            {parsedStream.posterUrl && !posterFailed ? (
              <img
                src={parsedStream.posterUrl}
                alt={material.title}
                loading="lazy"
                onError={() => setPosterFailed(true)}
                className="w-full h-full object-cover group-hover/vid:scale-[1.03] transition-transform duration-300"
              />
            ) : (
              <div className="w-full h-full bg-[#1c1c1e] flex items-center justify-center">
                <Radio className="w-12 h-12 text-white/20" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/35" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl group-hover/vid:scale-110 transition-transform ${
                  parsedStream.isYouTube
                    ? "bg-red-600 text-white"
                    : "bg-white/90 text-[#1d1d1f]"
                }`}
              >
                <Play className="w-6 h-6 fill-current ms-0.5" />
              </span>
            </div>
            <div className="absolute bottom-2.5 inset-x-3 flex items-center justify-between gap-2 text-white">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                <PlayCircle className="w-4 h-4 text-[#64d2ff]" />
                {parsedStream.isYouTube
                  ? (lang === "ar" ? "تشغيل داخل المنصة" : "Play Video")
                  : t("admin.watchStream")}
              </span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md border border-white/15">
                {parsedStream.streamTypeLabel[lang === "ar" ? "ar" : "en"]}
              </span>
            </div>
          </div>
        </button>
      </div>
    ) : null;

  const extraDetailsBlock = (
    <>
      {material.is_assignment && safeSubmissionLink && (
        <a
          href={safeSubmissionLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation();
            playClickSfx();
          }}
          className={`mt-3 inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 ${
            isApple
              ? "icloud-btn-primary"
              : "rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          }`}
        >
          <Link className="w-3.5 h-3.5" />
          {lang === "ar" ? "رابط تسليم التكليف" : "Submit Assignment"}
        </a>
      )}

      {material.notes && (
        <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-foreground/90 leading-relaxed flex items-start gap-2">
          <span className="text-sm shrink-0">📝</span>
          <div className="flex-1 whitespace-pre-wrap">
            <span className="font-semibold text-amber-700 dark:text-amber-400 block mb-0.5">
              {lang === "ar" ? "ملحوظات:" : "Notes:"}
            </span>
            {material.notes}
          </div>
        </div>
      )}

      {material.is_list && (
        <div className="mt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playClickSfx();
              setIsExpanded(!isExpanded);
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {lang === "ar" ? "عرض القائمة" : "View List"}
          </button>
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mt-2.5"
              >
                <div className="bg-secondary/50 border border-border/60 rounded-xl p-4 text-sm text-foreground relative whitespace-pre-wrap">
                  <button
                    type="button"
                    onClick={copyListContent}
                    className="absolute top-2.5 end-2.5 p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={lang === "ar" ? "نسخ" : "Copy"}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <div className="pt-1 pe-7">{renderListContent(material.list_content || "")}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );

  const openViewerButton = pdfAction && safePdfUrl ? (
    pdfAction.isSupabaseDoc ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          playClickSfx();
          setPdfViewerOpen(true);
        }}
        className={
          isApple
            ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary font-semibold transition-colors mac-cursor"
            : "inline-flex items-center gap-1.5 text-primary hover:underline font-medium cursor-pointer"
        }
        id={`view-pdf-${material.id}`}
      >
        <FileText className="w-3.5 h-3.5" />
        <span>{material.pdf_display_name || t("pdfViewer.viewPdf")}</span>
      </button>
    ) : pdfAction.isVideo ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          playClickSfx();
          setVideoViewerUrl(safePdfUrl);
        }}
        className={
          isApple
            ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary font-semibold transition-colors mac-cursor"
            : "inline-flex items-center gap-1.5 text-primary hover:underline font-medium cursor-pointer"
        }
      >
        <PlayCircle className="w-3.5 h-3.5" />
        <span>{material.pdf_display_name || (lang === "ar" ? "تشغيل" : "Play")}</span>
      </button>
    ) : (
      <a
        href={safePdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation();
          playClickSfx();
        }}
        className={
          isApple
            ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary font-semibold transition-colors mac-cursor"
            : "inline-flex items-center gap-1.5 text-primary hover:underline font-medium cursor-pointer"
        }
      >
        <FileText className="w-3.5 h-3.5" />
        <span>{material.pdf_display_name || t("pdfViewer.viewPdf")}</span>
      </a>
    )
  ) : null;

  return (
    <>
      <motion.div
        id={`material-${material.id}`}
        data-design-morph
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.025, 0.25), duration: 0.22, ease: "easeOut" }}
        className={`glass-card group relative overflow-hidden ${
          isApple ? "rounded-[18px] px-4 py-3.5 sm:px-5 sm:py-4" : "rounded-xl p-4 sm:p-5"
        } ${material.archived ? "opacity-65" : ""} ${
          isHighlighted ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
        } ${material.is_reference ? "ring-1 ring-amber-500/35 bg-amber-500/[0.04]" : ""}`}
        style={{ ...style }}
      >
        {/* Drag handle when sortable */}
        {dragHandleListeners && (
          <button
            type="button"
            {...dragHandleListeners}
            {...dragHandleAttributes}
            className="absolute top-0 start-0 h-full w-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors z-10"
            tabIndex={-1}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        )}

        {/* Classic start vertical accent strip */}
        {!isApple && (
          <div
            className={`absolute top-0 start-0 w-1 h-full ${
              material.is_reference ? "bg-amber-500" : "bg-primary"
            } rounded-s-xl opacity-70 group-hover:opacity-100 transition-opacity ${
              dragHandleListeners ? "ms-6" : ""
            }`}
          />
        )}

        {isApple ? (
          /* ================= APPLE macOS UNIFIED MATERIAL CARD ================= */
          <div className={dragHandleListeners ? "ps-5" : ""}>
            {/* Row 1: Single unified header row (Title + inline badges + Upload date on SAME row) */}
            <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2.5 min-w-0 flex-1 flex-wrap">
                <div
                  className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
                    cloudinaryStreamUrl
                      ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                      : material.is_reference
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-primary/12 text-primary"
                  }`}
                >
                  {cloudinaryStreamUrl ? (
                    <Play className="w-4 h-4 fill-current" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>
                <h3 className="font-semibold text-[15px] text-foreground truncate leading-snug max-w-full">
                  {material.title}
                </h3>
                {badgePills}
              </div>

              <div className="flex items-center gap-2 shrink-0 ms-auto">
                {material.created_at && (
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                    <Clock className="w-2.5 h-2.5" />
                    {safeFormatDate(material.created_at, "dd MMM yyyy", { locale })}
                  </span>
                )}
                {adminControls}
              </div>
            </div>

            {streamPreviewBlock}

            {/* Row 2: Unified, harmonious action pills row (No split boxes, no gaps!) */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {material.is_assignment && !material.deadline && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
                  <Clock className="w-3 h-3" />
                  {lang === "ar" ? "مفتوح (بدون موعد نهائي)" : "Open-ended"}
                </span>
              )}
              {material.deadline && (
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium ${
                    deadlinePast
                      ? "bg-destructive/12 text-destructive"
                      : "bg-secondary text-foreground/80"
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  {safeFormatDate(material.deadline, "dd MMM yyyy - hh:mm a", { locale })}
                  {deadlinePast && ` (${t("material.expired")})`}
                </span>
              )}

              {openViewerButton}

              {cloudinaryStreamUrl && parsedStream?.isValid && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playClickSfx();
                      setVideoViewerUrl(cloudinaryStreamUrl);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/12 hover:bg-primary/20 text-primary font-semibold transition-colors mac-cursor"
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    <span>
                      {parsedStream.isYouTube
                        ? (lang === "ar" ? "تشغيل يوتيوب" : "Watch YouTube")
                        : (lang === "ar" ? "تشغيل الفيديو" : "Play Video")}
                    </span>
                  </button>
                  {parsedStream.isYouTube && (
                    <a
                      href={parseYouTubeUrl(cloudinaryStreamUrl)?.watchUrl || cloudinaryStreamUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.stopPropagation();
                        playClickSfx();
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-secondary/80 hover:bg-secondary text-foreground/80 font-medium transition-colors mac-cursor"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{lang === "ar" ? "فتح في يوتيوب" : "YouTube"}</span>
                    </a>
                  )}
                </>
              )}

              {sharePointVideoUrl && (
                <a
                  href={sharePointVideoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    playClickSfx();
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-primary/12 hover:bg-primary/20 text-primary font-semibold transition-colors mac-cursor"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span>{lang === "ar" ? "تشغيل تسجيل Teams / SharePoint" : "Watch Teams Recording"}</span>
                  <ExternalLink className="w-3 h-3 opacity-75" />
                </a>
              )}

              {pdfAction && safePdfUrl && (pdfAction.isSupabaseDoc || pdfAction.isVideo || isOfflineCacheableUrl(safePdfUrl)) && (
                <>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      playClickSfx();
                      await downloadFileDirectly(pdfAction.downloadUrl, pdfAction.filenameToSave);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/80 hover:bg-secondary text-foreground/80 hover:text-foreground border border-border/70 transition-colors mac-cursor font-medium"
                    title={lang === "ar" ? "تحميل مباشر على جهازك" : "Direct Download"}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{lang === "ar" ? "تنزيل" : "Download"}</span>
                  </button>

                  {isOfflineCacheableUrl(safePdfUrl) && (
                    <OfflineMaterialButton url={safePdfUrl} />
                  )}
                </>
              )}

              {showExternalSection && safeExternalLink && (
                <a
                  href={safeExternalLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    playClickSfx();
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-secondary/80 hover:bg-secondary text-foreground/80 font-medium transition-colors mac-cursor"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {t("material.externalLink")}
                </a>
              )}

              {(showPdfSection || material.list_content) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playClickSfx();
                    setAiExplainerOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/12 hover:bg-primary/20 text-primary font-semibold transition-colors mac-cursor"
                  title={
                    lang === "ar"
                      ? "شرح وتلخيص المحاضرة بالذكاء الاصطناعي"
                      : "AI Study & Explainer"
                  }
                >
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span>{lang === "ar" ? "شرح وتلخيص AI" : "AI Explain"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleShareMaterial}
                title={t("material.share")}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors mac-cursor"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>{t("material.share")}</span>
              </button>
            </div>

            {extraDetailsBlock}
          </div>
        ) : (
          /* ================= CLASSIC ORIGINAL CIC CLOUD CARD ================= */
          <div className={`flex items-start justify-between gap-3 ${dragHandleListeners ? "ps-6" : "ps-1.5"}`}>
            <div className="flex-1 min-w-0">
              {badgePills && <div className="mb-2">{badgePills}</div>}

              <div className="flex items-center gap-2">
                {cloudinaryStreamUrl ? (
                  <PlayCircle className="w-4 h-4 text-primary shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-primary shrink-0" />
                )}
                <h3 className="font-display font-semibold text-sm sm:text-[15px] text-foreground truncate">
                  {material.title}
                </h3>
              </div>

              {material.created_at && (
                <p className="text-[11px] text-muted-foreground/75 mt-1 mb-2.5 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{lang === "ar" ? "تاريخ الرفع: " : "Uploaded: "}</span>
                  <span>{safeFormatDate(material.created_at, "dd MMM yyyy", { locale })}</span>
                </p>
              )}

              {streamPreviewBlock}

              <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground mt-1">
                {material.is_assignment && !material.deadline && (
                  <span className="flex items-center gap-1 text-primary font-medium">
                    <Clock className="w-3 h-3" />
                    {lang === "ar" ? "مفتوح (بدون موعد نهائي)" : "Open-ended"}
                  </span>
                )}
                {material.deadline && (
                  <span className={`flex items-center gap-1 ${deadlinePast ? "text-destructive" : ""}`}>
                    <Clock className="w-3 h-3" />
                    {safeFormatDate(material.deadline, "dd MMM yyyy - hh:mm a", { locale })}
                    {deadlinePast && ` (${t("material.expired")})`}
                  </span>
                )}

                {openViewerButton}

                {cloudinaryStreamUrl && parsedStream?.isValid && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playClickSfx();
                        setVideoViewerUrl(cloudinaryStreamUrl);
                      }}
                      className="flex items-center gap-1.5 text-xs text-primary hover:bg-primary/15 px-2.5 py-1 bg-primary/10 rounded-full font-semibold transition-all cursor-pointer"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>
                        {parsedStream.isYouTube
                          ? (lang === "ar" ? "تشغيل يوتيوب" : "Watch YouTube")
                          : (lang === "ar" ? "تشغيل الفيديو" : "Play Video")}
                      </span>
                    </button>
                    {parsedStream.isYouTube && (
                      <a
                        href={parseYouTubeUrl(cloudinaryStreamUrl)?.watchUrl || cloudinaryStreamUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.stopPropagation();
                          playClickSfx();
                        }}
                        className="flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>{lang === "ar" ? "فتح في يوتيوب" : "YouTube"}</span>
                      </a>
                    )}
                  </>
                )}

                {sharePointVideoUrl && (
                  <a
                    href={sharePointVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      playClickSfx();
                    }}
                    className="flex items-center gap-1.5 text-xs text-primary hover:bg-primary/15 px-2.5 py-1 bg-primary/10 rounded-full font-semibold transition-all cursor-pointer"
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    <span>{lang === "ar" ? "تشغيل تسجيل Teams / SharePoint" : "Watch Teams Recording"}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}

                {pdfAction && safePdfUrl && (pdfAction.isSupabaseDoc || pdfAction.isVideo || isOfflineCacheableUrl(safePdfUrl)) && (
                  <>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        playClickSfx();
                        await downloadFileDirectly(pdfAction.downloadUrl, pdfAction.filenameToSave);
                      }}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 px-2.5 py-1 bg-secondary/70 rounded-full transition-all cursor-pointer"
                      title={lang === "ar" ? "تحميل على الجهاز" : "Download to Device"}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{lang === "ar" ? "تنزيل (للجهاز)" : "Download (Device)"}</span>
                    </button>

                    {isOfflineCacheableUrl(safePdfUrl) && (
                      <OfflineMaterialButton url={safePdfUrl} />
                    )}
                  </>
                )}

                {showExternalSection && safeExternalLink && (
                  <a
                    href={safeExternalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      playClickSfx();
                    }}
                    className="flex items-center gap-1 text-primary hover:underline cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" /> {t("material.externalLink")}
                  </a>
                )}

                <button
                  type="button"
                  onClick={handleShareMaterial}
                  title={t("material.share")}
                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                >
                  <Share2 className="w-3 h-3" />
                  <span>{t("material.share")}</span>
                </button>

                {(showPdfSection || material.list_content) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playClickSfx();
                      setAiExplainerOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 font-semibold transition-colors cursor-pointer"
                    title={
                      lang === "ar"
                        ? "شرح وتلخيص المحاضرة بالذكاء الاصطناعي"
                        : "AI Study & Explainer"
                    }
                  >
                    <Sparkles className="w-3 h-3 text-primary" />
                    <span>{lang === "ar" ? "شرح وتلخيص AI" : "AI Explain"}</span>
                  </button>
                )}
              </div>

              {extraDetailsBlock}
            </div>

            {adminControls}
          </div>
        )}
      </motion.div>

      {/* Admin Edit Modal */}
      <AnimatePresence>
        {editOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setEditOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.94, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 16 }}
              className="relative icloud-pane p-6 w-full max-w-lg max-h-[88vh] overflow-y-auto z-10"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-primary" />
                  {lang === "ar" ? "تعديل المادة" : "Edit Material"}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="icloud-icon-btn"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {lang === "ar" ? "العنوان" : "Title"}
                  </label>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="bg-secondary/50"
                  />
                </div>

                {courses.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      {lang === "ar" ? "المقرر" : "Course"}
                    </label>
                    <select
                      value={editCourseId}
                      onChange={(e) => setEditCourseId(e.target.value)}
                      className="w-full rounded-lg bg-secondary/50 border border-input px-3 py-2 text-sm"
                    >
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {categories.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      {lang === "ar" ? "النوع / القسم" : "Category"}
                    </label>
                    <select
                      value={editCategoryId}
                      onChange={(e) => setEditCategoryId(e.target.value)}
                      className="w-full rounded-lg bg-secondary/50 border border-input px-3 py-2 text-sm"
                    >
                      <option value="">{lang === "ar" ? "بدون" : "None"}</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {lang === "ar" ? cat.name_ar : cat.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Cloudinary CDN Stream URL field */}
                <div className="p-3 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/20 space-y-1.5">
                  <label className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5" />
                    {t("admin.cloudinaryUrl")}
                  </label>
                  <Input
                    value={editVideoUrl}
                    onChange={(e) => setEditVideoUrl(e.target.value)}
                    placeholder={t("admin.cloudinaryPlaceholder")}
                    className="bg-background/80 text-xs font-mono"
                    dir="ltr"
                  />
                  {editVideoValidation && (
                    <div
                      className={`flex items-center gap-1.5 text-[11px] font-medium ${
                        editVideoValidation.isValid ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                      }`}
                    >
                      {editVideoValidation.isValid ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {editVideoValidation.streamTypeLabel[lang === "ar" ? "ar" : "en"]}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{editVideoValidation.error}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id={`editIsList-${material.id}`}
                    checked={editIsList}
                    onChange={(e) => setEditIsList(e.target.checked)}
                    className="accent-primary"
                  />
                  <label htmlFor={`editIsList-${material.id}`} className="text-sm font-medium cursor-pointer">
                    {lang === "ar" ? "هذه المادة عبارة عن قائمة منسدلة (Playlist)" : "Dropdown list (Playlist)"}
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`editIsReference-${material.id}`}
                    checked={editIsReference}
                    onChange={(e) => setEditIsReference(e.target.checked)}
                    className="accent-amber-500"
                  />
                  <label htmlFor={`editIsReference-${material.id}`} className="text-sm font-medium cursor-pointer">
                    {lang === "ar" ? "هذه المادة تعتبر مرجع (Course Reference)" : "Course Reference"}
                  </label>
                </div>

                {editIsList ? (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground mb-1 block">
                      {lang === "ar" ? "محتوى القائمة" : "List Content"}
                    </label>
                    <textarea
                      value={editListContent}
                      onChange={(e) => setEditListContent(e.target.value)}
                      className="w-full bg-secondary/50 rounded-lg border border-input px-3 py-2 text-sm min-h-[140px]"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {lang === "ar" ? "اسم عرض الملف" : "Display Name"}
                      </label>
                      <Input
                        value={editPdfDisplayName}
                        onChange={(e) => setEditPdfDisplayName(e.target.value)}
                        className="bg-secondary/50"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {lang === "ar" ? "رابط خارجي" : "External Link"}
                      </label>
                      <Input
                        value={editExternalLink}
                        onChange={(e) => setEditExternalLink(e.target.value)}
                        className="bg-secondary/50"
                        placeholder="https://..."
                        dir="ltr"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {lang === "ar" ? "تحديد السكشن (اختياري)" : "Assign to Section (optional)"}
                      </label>
                      <select
                        value={editSectionNumber}
                        onChange={(e) => setEditSectionNumber(e.target.value)}
                        className="w-full rounded-lg bg-secondary/50 border border-input px-3 py-2 text-xs"
                      >
                        <option value="all">{lang === "ar" ? "عام (جميع السكاشن)" : "All Sections"}</option>
                        {Array.from({ length: 18 }, (_, idx) => String(idx + 1)).map((num) => (
                          <option key={num} value={num}>
                            {lang === "ar" ? `سكشن ${num}` : `Section ${num}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {lang === "ar" ? "ملحوظات على المادة / التكليف" : "Material Notes"}
                      </label>
                      <textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        className="w-full bg-secondary/50 rounded-lg border border-input px-3 py-2 text-xs min-h-[60px]"
                        placeholder={lang === "ar" ? "اكتب أي ملحوظات أو تنبيهات هنا..." : "Write any notes..."}
                      />
                    </div>

                    {material.is_assignment && (
                      <>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            {lang === "ar" ? "رابط التسليم" : "Submission Link"}
                          </label>
                          <Input
                            value={editSubmissionLink}
                            onChange={(e) => setEditSubmissionLink(e.target.value)}
                            className="bg-secondary/50"
                            placeholder="https://forms.google.com/..."
                            dir="ltr"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            {lang === "ar" ? "الموعد النهائي" : "Deadline"}
                          </label>
                          <Input
                            type="datetime-local"
                            value={editDeadline}
                            onChange={(e) => setEditDeadline(e.target.value)}
                            className="bg-secondary/50"
                          />
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-2 mt-5">
                <Button onClick={handleSave} disabled={saving} className="flex-1 gap-2 rounded-full icloud-btn-primary border-0">
                  <Save className="w-4 h-4" />
                  {saving
                    ? lang === "ar"
                      ? "جاري الحفظ..."
                      : "Saving..."
                    : lang === "ar"
                      ? "حفظ التعديلات"
                      : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={() => setEditOpen(false)} className="w-24 rounded-full">
                  {lang === "ar" ? "إلغاء" : "Cancel"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Lazy Modals — Mounted ONLY when actually open */}
      {pdfViewerOpen && safePdfUrl && (
        <Suspense fallback={null}>
          <PdfViewerModal
            open={pdfViewerOpen}
            onOpenChange={setPdfViewerOpen}
            pdfUrl={safePdfUrl}
            title={material.title}
            displayName={material.pdf_display_name || undefined}
            materialId={material.id}
            course={courses.find((c) => c.id === material.course_id)}
          />
        </Suspense>
      )}

      {videoViewerUrl && (
        <Suspense fallback={null}>
          <VideoViewerModal
            open={Boolean(videoViewerUrl)}
            onOpenChange={(open) => {
              if (!open) setVideoViewerUrl(null);
            }}
            videoUrl={videoViewerUrl}
            title={material.title}
            displayName={material.pdf_display_name || undefined}
          />
        </Suspense>
      )}

      {aiExplainerOpen && (
        <Suspense fallback={null}>
          <AiLectureExplainerModal
            open={aiExplainerOpen}
            onOpenChange={setAiExplainerOpen}
            material={material}
            course={courses.find((c) => c.id === material.course_id)}
          />
        </Suspense>
      )}
    </>
  );
};

export default MaterialCard;
