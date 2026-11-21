import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  Star,
  Send,
  X,
  Check,
  Layers,
  MessageSquare,
  ThumbsUp,
  Play,
  FileText,
  Clock,
  Download,
  Share2,
  HardDriveDownload,
  GraduationCap,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { playClickSfx } from "@/hooks/use-sfx";
import { useDesign, type DesignMode } from "@/hooks/use-design";
import { supabase } from "@/integrations/supabase/client";

type SectionId = "navbar" | "years" | "course" | "material" | "tabs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "compare" | "feedback";
}

const SECTION_META: {
  id: SectionId;
  ar: string;
  en: string;
  desc_ar: string;
  desc_en: string;
}[] = [
  {
    id: "material",
    ar: "بطاقة المحاضرة",
    en: "Material Card",
    desc_ar: "شريط علوي موحّد بالعنوان والتاريخ + أزرار متوازنة يمين ويسار",
    desc_en: "Unified header row + edge-to-edge balanced action footer",
  },
  {
    id: "years",
    ar: "بطاقات الفرق",
    en: "Year Cards",
    desc_ar: "تدرج سماوي متوهج قديماً مقابل بطاقات Apple مسطحة بحفظ كامل العرض",
    desc_en: "Cyan glow & pill vs crisp Apple flat surface & full-width footer",
  },
  {
    id: "navbar",
    ar: "شريط التنقل",
    en: "Navigation Bar",
    desc_ar: "شريط كلاسيكي بقائمة الموبايل مقابل شريط macOS Segmented أنيق",
    desc_en: "Classic navbar + drawer vs macOS iCloud segmented toolbar",
  },
  {
    id: "course",
    ar: "بطاقة المقرر",
    en: "Course Card",
    desc_ar: "أكواد دائرية ملونة وإطار أنيق مقابل التوهج الكلاسيكي",
    desc_en: "Apple reading-pane styling vs classic bordered cyan highlight",
  },
  {
    id: "tabs",
    ar: "تبويبات الأقسام",
    en: "Category Tabs",
    desc_ar: "أزرار Apple الزرقاء القابلة للسحب بالماوس مقابل التبويب المدمج",
    desc_en: "Apple blue scrollable pills vs compact segmented tray",
  },
];

/* --------------------------------------------------------------------------
 * Real Self-Contained Visual Mini-Renders (Left/Top = Apple, Bottom = Classic)
 * -------------------------------------------------------------------------- */
const PreviewStageLayer: React.FC<{
  section: SectionId;
  variant: "classic" | "apple";
  lang: string;
}> = ({ section, variant, lang }) => {
  const isAr = lang === "ar";
  const isApp = variant === "apple";

  const surfaceStyle: React.CSSProperties = isApp
    ? {
        fontFamily: '"SF Pro Arabic", -apple-system, BlinkMacSystemFont, sans-serif',
        background: "#f5f5f7",
        color: "#1d1d1f",
      }
    : {
        fontFamily: "'Cairo', 'Noto Naskh Arabic', sans-serif",
        background:
          "radial-gradient(circle at 20% 25%, rgba(23,184,212,0.14), transparent 55%), #0f172a",
        color: "#f1f5f9",
      };

  const cardStyle: React.CSSProperties = isApp
    ? {
        background: "#ffffff",
        border: "1px solid rgba(0, 0, 0, 0.09)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      }
    : {
        background: "rgba(22, 31, 51, 0.92)",
        border: "1px solid rgba(56, 189, 248, 0.22)",
        boxShadow: "0 8px 24px -8px rgba(23, 184, 212, 0.28)",
      };

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="w-full h-full flex items-center justify-center p-4 sm:p-6 select-none overflow-hidden"
      style={surfaceStyle}
    >
      {section === "material" && (
        <div
          className={`w-full max-w-md relative overflow-hidden ${
            isApp ? "rounded-[18px] p-4" : "rounded-xl p-4"
          }`}
          style={cardStyle}
        >
          {!isApp && (
            <div
              className="absolute top-0 start-0 w-1 h-full"
              style={{ background: "#17b8d4" }}
            />
          )}

          {isApp ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0"
                    style={{ background: "rgba(0,113,227,0.12)", color: "#0071e3" }}
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-bold text-sm truncate">Lec2 — Algorithms</span>
                  <span
                    className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                    style={{ background: "rgba(0,113,227,0.12)", color: "#0071e3" }}
                  >
                    {isAr ? "جديد" : "New"}
                  </span>
                </div>
                <span className="text-[10px] opacity-65 flex items-center gap-1 shrink-0">
                  <Clock className="w-2.5 h-2.5" />
                  12 أكتوبر 2026
                </span>
              </div>

              <div
                className="mt-3 pt-2.5 flex items-center justify-between gap-1.5 text-[10px]"
                style={{ borderTop: "1px solid rgba(0,0,0,0.07)" }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold"
                    style={{ background: "rgba(0,113,227,0.1)", color: "#0071e3" }}
                  >
                    <FileText className="w-2.5 h-2.5" />
                    Lec2.pdf
                  </span>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full font-medium"
                    style={{ background: "#ededf0", color: "#1d1d1f" }}
                  >
                    <Download className="w-2.5 h-2.5" />
                    {isAr ? "تنزيل" : "Save"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold"
                    style={{ background: "rgba(0,113,227,0.12)", color: "#0071e3" }}
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    AI
                  </span>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full"
                    style={{ background: "#f2f2f5", color: "#6e6e73" }}
                  >
                    <Share2 className="w-2.5 h-2.5" />
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="ps-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 shrink-0" style={{ color: "#22d3ee" }} />
                <span className="font-bold text-sm">Lec2 — Algorithms</span>
              </div>
              <p className="text-[10px] opacity-65 mt-1 mb-2.5 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {isAr ? "تاريخ الرفع: 12 أكتوبر 2026" : "Uploaded: 12 Oct 2026"}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="font-semibold underline" style={{ color: "#22d3ee" }}>
                  {isAr ? "عرض PDF" : "View PDF"}
                </span>
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(148,163,184,0.18)" }}
                >
                  <Download className="w-2.5 h-2.5" />
                  {isAr ? "تنزيل (للجهاز)" : "Download"}
                </span>
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold"
                  style={{
                    background: "rgba(34,211,238,0.14)",
                    color: "#22d3ee",
                    border: "1px solid rgba(34,211,238,0.35)",
                  }}
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  {isAr ? "شرح وتلخيص AI" : "AI Explain"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {section === "years" && (
        <div
          className={`w-56 overflow-hidden relative flex flex-col justify-between ${
            isApp ? "rounded-[20px]" : "rounded-2xl pb-10 pt-5 px-4"
          }`}
          style={cardStyle}
        >
          {!isApp && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle at 50% 35%, rgba(23,184,212,0.32), transparent 65%)",
              }}
            />
          )}
          <div className={`text-center relative z-10 ${isApp ? "pt-5 pb-3 px-4" : ""}`}>
            <div
              className="text-4xl font-black leading-none mb-1"
              style={{ color: isApp ? "#0071e3" : "#22d3ee" }}
            >
              1
            </div>
            <div className="font-bold text-sm">
              {isAr ? "الفرقة الأولى" : "First Year"}
            </div>
            <div className="text-[10px] opacity-65 mt-0.5">
              {isAr ? "المواد التأسيسية والأساسية" : "General & Core Courses"}
            </div>
          </div>

          {isApp ? (
            <div
              className="px-3 py-2.5"
              style={{ borderTop: "1px solid rgba(0,0,0,0.07)", background: "#f7f7f9" }}
            >
              <div
                className="w-full py-1.5 rounded-full text-[10px] font-bold flex items-center justify-center gap-1"
                style={{
                  background: "#ffffff",
                  border: "1px solid rgba(0,0,0,0.1)",
                  color: "#1d1d1f",
                }}
              >
                <HardDriveDownload className="w-3 h-3" />
                {isAr ? "حفظ الصف أوفلاين" : "Save Offline"}
              </div>
            </div>
          ) : (
            <div className="absolute bottom-2.5 inset-x-0 flex justify-center">
              <div
                className="px-3 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1"
                style={{
                  background: "rgba(15,23,42,0.92)",
                  border: "1px solid rgba(56,189,248,0.35)",
                  color: "#f1f5f9",
                }}
              >
                <HardDriveDownload className="w-2.5 h-2.5" />
                {isAr ? "حفظ الصف أوفلاين" : "Save Year"}
              </div>
            </div>
          )}
        </div>
      )}

      {section === "navbar" && (
        <div className="w-full max-w-md rounded-2xl overflow-hidden" style={cardStyle}>
          <div className="px-4 h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 flex items-center justify-center font-black text-xs ${
                  isApp ? "rounded-[8px]" : "rounded-lg"
                }`}
                style={{
                  background: isApp ? "#f5f5f7" : "rgba(34,211,238,0.15)",
                  color: isApp ? "#0071e3" : "#22d3ee",
                  border: isApp ? "1px solid rgba(0,0,0,0.08)" : "none",
                }}
              >
                C
              </div>
              <span className="font-bold text-sm">CIC</span>
              {isApp && (
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1"
                  style={{ background: "#ededf0", color: "#1d1d1f" }}
                >
                  <GraduationCap className="w-3 h-3" style={{ color: "#0071e3" }} />
                  {isAr ? "الفرقة ٢" : "Year 2"}
                </span>
              )}
            </div>

            {isApp ? (
              <div
                className="flex items-center gap-1 p-0.5 rounded-[10px]"
                style={{ background: "#ededf0" }}
              >
                <span
                  className="px-2.5 py-1 rounded-[8px] text-[10px] font-bold shadow-sm"
                  style={{ background: "#ffffff", color: "#1d1d1f" }}
                >
                  {isAr ? "المقررات" : "Courses"}
                </span>
                <span className="px-2 py-1 text-[10px] opacity-70">
                  {isAr ? "الجدول" : "Schedule"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px]">
                <span
                  className="px-2.5 py-1.5 rounded-lg font-bold"
                  style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee" }}
                >
                  {isAr ? "المقررات" : "Courses"}
                </span>
                <span className="px-2 py-1 opacity-75">{isAr ? "الجدول" : "Schedule"}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {section === "course" && (
        <div
          className={`w-full max-w-md p-4 ${isApp ? "rounded-[20px]" : "rounded-2xl"}`}
          style={cardStyle}
        >
          <span
            className={`inline-block px-2.5 py-0.5 text-[10px] font-bold mb-2 ${
              isApp ? "rounded-full" : "rounded-lg"
            }`}
            style={{
              background: isApp ? "rgba(0,113,227,0.12)" : "rgba(34,211,238,0.16)",
              color: isApp ? "#0071e3" : "#22d3ee",
            }}
          >
            CS201
          </span>
          <h4 className="font-bold text-base mb-1">
            {isAr ? "هياكل البيانات والخوارزميات" : "Data Structures & Algorithms"}
          </h4>
          <p className="text-[11px] opacity-70 mb-3">
            {isAr
              ? "تحليل الخوارزميات، القوائم المرتبطة، والأشجار والرسوم البيانية."
              : "Algorithm complexity, linked structures, trees and graphs."}
          </p>
          <div
            className="pt-2.5 flex items-center justify-between text-[11px] font-bold"
            style={{
              borderTop: isApp ? "1px solid rgba(0,0,0,0.07)" : "1px solid rgba(255,255,255,0.08)",
              color: isApp ? "#0071e3" : "#22d3ee",
            }}
          >
            <span>{isAr ? "فتح المقرر" : "Open Course"}</span>
            <span>←</span>
          </div>
        </div>
      )}

      {section === "tabs" && (
        <div className="w-full max-w-md p-4 rounded-2xl" style={cardStyle}>
          {isApp ? (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span
                className="px-3.5 py-1.5 rounded-xl text-[11px] font-bold text-white shrink-0"
                style={{ background: "#0071e3" }}
              >
                {isAr ? "المحاضرات" : "Lectures"}
              </span>
              <span
                className="px-3 py-1.5 rounded-xl text-[11px] font-semibold shrink-0"
                style={{ background: "#ededf0", color: "#1d1d1f" }}
              >
                {isAr ? "السكاشن" : "Sections"}
              </span>
              <span
                className="px-3 py-1.5 rounded-xl text-[11px] font-semibold shrink-0"
                style={{ background: "#ededf0", color: "#1d1d1f" }}
              >
                {isAr ? "التكليفات" : "Tasks"}
              </span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1 p-1 rounded-xl"
              style={{ background: "rgba(15,23,42,0.7)" }}
            >
              <span
                className="flex-1 text-center py-1.5 rounded-lg text-[11px] font-bold shadow"
                style={{ background: "#1e293b", color: "#f8fafc" }}
              >
                {isAr ? "المحاضرات" : "Lectures"}
              </span>
              <span className="flex-1 text-center py-1.5 text-[11px] opacity-70">
                {isAr ? "السكاشن" : "Sections"}
              </span>
              <span className="flex-1 text-center py-1.5 text-[11px] opacity-70">
                {isAr ? "التكليفات" : "Tasks"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const DesignComparisonModal: React.FC<Props> = ({
  open,
  onOpenChange,
  initialTab = "compare",
}) => {
  const { lang } = useI18n();
  const { design, switchDesign } = useDesign();
  const isAr = lang === "ar";

  const [activeTab, setActiveTab] = useState<"compare" | "feedback">(initialTab);
  const [selectedSection, setSelectedSection] = useState<SectionId>("material");
  const [sliderPos, setSliderPos] = useState<number>(50);
  const [isAutoSweeping, setIsAutoSweeping] = useState(false);

  const [sectionVotes, setSectionVotes] = useState<Record<string, DesignMode>>(() => {
    try {
      const saved = localStorage.getItem("cic_design_section_votes");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [rating, setRating] = useState<number>(() =>
    parseInt(localStorage.getItem("cic_design_rating") || "5", 10)
  );
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [preferredDesign, setPreferredDesign] = useState<"apple" | "classic" | "both">("apple");
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(
    () => localStorage.getItem("cic_design_feedback_submitted") === "true"
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const stopAutoSweep = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsAutoSweeping(false);
  }, []);

  const runAutoSweep = useCallback(() => {
    stopAutoSweep();
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    setIsAutoSweeping(true);
    const start = performance.now();
    const duration = 2600;

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // Smooth sine wave: 50 -> 84 -> 16 -> 50
      const pos = 50 + Math.sin(t * Math.PI * 2) * 34;
      setSliderPos(Math.round(pos * 10) / 10);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setSliderPos(50);
        setIsAutoSweeping(false);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [stopAutoSweep]);

  // Sync initialTab when modal opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      if (initialTab === "compare") {
        runAutoSweep();
      }
    } else {
      stopAutoSweep();
    }
  }, [open, initialTab, runAutoSweep, stopAutoSweep]);

  useEffect(() => stopAutoSweep, [stopAutoSweep]);

  const updateSliderFromClientX = useCallback(
    (clientX: number) => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSliderPos(Math.max(4, Math.min(96, pct)));
    },
    []
  );

  const handleVoteSection = (mode: DesignMode) => {
    playClickSfx();
    const updated = { ...sectionVotes, [selectedSection]: mode };
    setSectionVotes(updated);
    try {
      localStorage.setItem("cic_design_section_votes", JSON.stringify(updated));
    } catch {
      // ignore
    }
    toast.success(
      isAr
        ? `تم تسجيل اختيارك لهذا القسم (${mode === "apple" ? "الجديد" : "القديم"}) ✓`
        : `Preference saved for this section ✓`
    );
  };

  const handleTryOtherDesign = () => {
    const next: DesignMode = design === "classic" ? "apple" : "classic";
    onOpenChange(false);
    window.setTimeout(() => {
      switchDesign(next);
    }, 140);
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim() && rating === 0) return;

    setIsSubmitting(true);
    playClickSfx();

    try {
      const payload = {
        rating,
        preferredDesign,
        feedback: feedbackText.trim(),
        sectionVotes,
        submittedAt: new Date().toISOString(),
      };

      localStorage.setItem("cic_design_rating", String(rating));
      localStorage.setItem("cic_design_feedback_submitted", "true");
      try {
        const prev = JSON.parse(localStorage.getItem("cic_design_feedback_history") || "[]");
        prev.unshift(payload);
        localStorage.setItem("cic_design_feedback_history", JSON.stringify(prev.slice(0, 10)));
      } catch {
        // ignore
      }

      try {
        await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        // ignore
      }

      try {
        await (supabase as any).rpc("submit_design_feedback", {
          p_rating: rating,
          p_preferred_design: preferredDesign,
          p_suggestion: feedbackText.trim() || null,
          p_section_votes: sectionVotes,
        });
      } catch {
        // Silently ignore if remote DB doesn't have migration applied yet
      }

      setHasSubmitted(true);
      setFeedbackText("");
      toast.success(
        isAr
          ? "شكراً لمشاركتك! تم حفظ تقييمك واقتراحك بنجاح ❤️"
          : "Thank you! Your feedback has been submitted ❤️"
      );
    } catch {
      toast.error(isAr ? "حدث خطأ أثناء الإرسال" : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  const activeMeta = SECTION_META.find((s) => s.id === selectedSection)!;
  const currentVote = sectionVotes[selectedSection];
  const votesCount = Object.keys(sectionVotes).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={() => onOpenChange(false)}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl icloud-pane overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-foreground">
                {isAr ? "مقارنة التصميم التفاعلية والتقييم" : "Interactive Design Comparison"}
              </h2>
              <p className="text-[11px] sm:text-xs text-muted-foreground">
                {isAr
                  ? "اسحب الشريط المائل لتقارن كل سكشن بين القديم والجديد وتشاركنا اقتراحك"
                  : "Drag the diagonal wipe bar to compare every section & share feedback"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-8 h-8 rounded-full bg-secondary hover:bg-secondary/80 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label={isAr ? "إغلاق" : "Close"}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-border/60 px-5 gap-5 text-xs sm:text-sm font-semibold">
          <button
            type="button"
            onClick={() => {
              playClickSfx();
              setActiveTab("compare");
            }}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "compare"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>{isAr ? "مقارنة كل سكشن (قديم vs جديد)" : "Compare Sections"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playClickSfx();
              stopAutoSweep();
              setActiveTab("feedback");
            }}
            className={`py-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "feedback"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>{isAr ? "تقييم واقتراحات الطلاب ⭐" : "Rating & Suggestions ⭐"}</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === "compare" ? (
            <>
              {/* Section Switcher Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {SECTION_META.map((sec) => {
                  const active = selectedSection === sec.id;
                  const vote = sectionVotes[sec.id];
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => {
                        playClickSfx();
                        setSelectedSection(sec.id);
                      }}
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-secondary/80 hover:bg-secondary text-foreground/80"
                      }`}
                    >
                      <span>{isAr ? sec.ar : sec.en}</span>
                      {vote && (
                        <span className="text-[10px]">
                          {vote === "apple" ? "🍏" : "🏛️"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Live Diagonal Slanted Split-Screen Preview Stage */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                  <span>{isAr ? activeMeta.desc_ar : activeMeta.desc_en}</span>
                  <button
                    type="button"
                    onClick={() => {
                      playClickSfx();
                      runAutoSweep();
                    }}
                    disabled={isAutoSweeping}
                    className="inline-flex items-center gap-1 text-primary font-semibold hover:underline shrink-0 ms-2 cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>{isAr ? "قلب تلقائي" : "Auto-Sweep"}</span>
                  </button>
                </div>

                <div
                  ref={stageRef}
                  dir="ltr"
                  onPointerDown={(e) => {
                    stopAutoSweep();
                    isDraggingRef.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updateSliderFromClientX(e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (!isDraggingRef.current) return;
                    updateSliderFromClientX(e.clientX);
                  }}
                  onPointerUp={() => {
                    isDraggingRef.current = false;
                  }}
                  onPointerCancel={() => {
                    isDraggingRef.current = false;
                  }}
                  className="relative w-full h-[240px] sm:h-[260px] rounded-2xl overflow-hidden border border-border shadow-inner cursor-ew-resize touch-none select-none"
                >
                  {/* Bottom Layer: Classic Design */}
                  <div className="absolute inset-0">
                    <PreviewStageLayer section={selectedSection} variant="classic" lang={lang} />
                    <span
                      dir={isAr ? "rtl" : "ltr"}
                      className="absolute top-2.5 right-2.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-900/85 text-cyan-300 border border-cyan-400/30 shadow-sm pointer-events-none"
                    >
                      {isAr ? "🏛️ التصميم القديم" : "🏛️ Classic"}
                    </span>
                  </div>

                  {/* Top Layer: Apple Design clipped by slanted diagonal polygon */}
                  <div
                    className="absolute inset-0 will-change-[clip-path]"
                    style={{
                      clipPath: `polygon(0 0, calc(${sliderPos}% + 26px) 0, calc(${sliderPos}% - 26px) 100%, 0 100%)`,
                    }}
                  >
                    <PreviewStageLayer section={selectedSection} variant="apple" lang={lang} />
                    <span
                      dir={isAr ? "rtl" : "ltr"}
                      className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-white/95 text-[#0071e3] border border-black/10 shadow-sm pointer-events-none"
                    >
                      {isAr ? "🍏 تصميم Apple macOS" : "🍏 Apple macOS"}
                    </span>
                  </div>

                  {/* Visual Slanted Diagonal Divider Bar + Grip */}
                  <div
                    className="absolute -top-3 -bottom-3 w-1 pointer-events-none"
                    style={{
                      left: `${sliderPos}%`,
                      transform: "translateX(-50%) skewX(-11deg)",
                      background:
                        "linear-gradient(180deg, #0071e3 0%, #ffffff 50%, #17b8d4 100%)",
                      boxShadow: "0 0 14px rgba(0, 113, 227, 0.55)",
                    }}
                  >
                    <div
                      className="absolute top-1/2 left-1/2 w-8 h-8 rounded-full bg-white text-[#1d1d1f] border-2 border-primary shadow-lg flex items-center justify-center text-xs font-black"
                      style={{
                        transform: "translate(-50%, -50%) skewX(11deg)",
                      }}
                    >
                      ↔
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-section vote + Try on full site CTA */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground me-1">
                    {isAr ? "الأفضل هنا:" : "Better here:"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleVoteSection("classic")}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
                      currentVote === "classic"
                        ? "bg-primary/15 border-primary text-primary"
                        : "bg-secondary/60 border-border/60 text-foreground/80 hover:bg-secondary"
                    }`}
                  >
                    {isAr ? "أفضل القديم 🏛️" : "Classic 🏛️"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVoteSection("apple")}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
                      currentVote === "apple"
                        ? "bg-primary/15 border-primary text-primary"
                        : "bg-secondary/60 border-border/60 text-foreground/80 hover:bg-secondary"
                    }`}
                  >
                    {isAr ? "أفضل الجديد 🍏" : "Apple 🍏"}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleTryOtherDesign}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full icloud-btn-primary text-xs shadow-sm cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>
                    {design === "classic"
                      ? isAr
                        ? "🪄 جرّب التصميم الجديد على الموقع كله"
                        : "🪄 Try Apple Design Across Whole Site"
                      : isAr
                        ? "🏛️ رجّع التصميم القديم مؤقتاً"
                        : "🏛️ Switch to Classic Design"}
                  </span>
                </button>
              </div>
            </>
          ) : (
            /* Tab 2: Student Rating & Suggestions */
            <form onSubmit={handleSubmitFeedback} className="space-y-4">
              <div className="text-center space-y-2 pb-1">
                <p className="text-sm font-bold text-foreground">
                  {isAr
                    ? "تقييمك للتصميم الجديد وتجربة التبديل:"
                    : "Rate the new design & transition:"}
                </p>

                <div className="flex items-center justify-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const filled = (hoverRating || rating) >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        onMouseEnter={() => setHoverRating(star)}
                        onMouseLeave={() => setHoverRating(0)}
                        onClick={() => {
                          playClickSfx();
                          setRating(star);
                        }}
                        className="p-1 transition-transform hover:scale-110 cursor-pointer"
                      >
                        <Star
                          className={`w-7 h-7 transition-colors ${
                            filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground/35"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Overall preference pill */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground block">
                  {isAr ? "أي تصميم تفضل استخدامه غالباً؟" : "Which design do you prefer overall?"}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "apple", ar: "الجديد (Apple) 🍏", en: "New (Apple) 🍏" },
                    { id: "classic", ar: "القديم (كلاسيك) 🏛️", en: "Classic 🏛️" },
                    { id: "both", ar: "كلاهما ممتاز ✨", en: "Both Great ✨" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        playClickSfx();
                        setPreferredDesign(opt.id as "apple" | "classic" | "both");
                      }}
                      className={`py-2 px-2 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                        preferredDesign === opt.id
                          ? "bg-primary/12 border-primary text-primary"
                          : "bg-secondary/60 border-border/60 text-foreground/80 hover:bg-secondary"
                      }`}
                    >
                      {isAr ? opt.ar : opt.en}
                    </button>
                  ))}
                </div>
              </div>

              {votesCount > 0 && (
                <div className="px-3 py-2 rounded-xl bg-primary/8 border border-primary/20 text-[11px] text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Check className="w-3.5 h-3.5 text-primary" />
                    {isAr
                      ? `مرفق تقييمك لـ ${votesCount} أقسام من شاشة المقارنة`
                      : `Includes your ${votesCount} section preferences`}
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground block">
                  {isAr
                    ? "اقتراحاتك لتطوير التصميم والموقع:"
                    : "Your suggestions & ideas:"}
                </label>
                <textarea
                  rows={3}
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  maxLength={1000}
                  placeholder={
                    isAr
                      ? "اكتب أي تعديل أو ميزة تحب نضيفها أو نغيرها..."
                      : "Write any suggestions or features you'd like to see..."
                  }
                  className="w-full rounded-xl bg-secondary/50 border border-border p-3 text-xs sm:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full icloud-btn-primary text-xs shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmitting
                      ? isAr
                        ? "جاري الإرسال..."
                        : "Submitting..."
                      : isAr
                        ? "إرسال التقييم والاقتراح"
                        : "Submit Feedback"}
                  </span>
                </button>
              </div>

              {hasSubmitted && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs">
                  <ThumbsUp className="w-4 h-4 shrink-0" />
                  <span>
                    {isAr
                      ? "تم حفظ رأيك بنجاح! شكراً لمساعدتنا في تطوير المنصة."
                      : "Your feedback has been saved! Thank you."}
                  </span>
                </div>
              )}
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
};
