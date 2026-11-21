import React, { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Star, Columns2, X } from "lucide-react";
import { useDesign } from "@/hooks/use-design";
import { useI18n } from "@/lib/i18n";

const DesignComparisonModal = lazy(() =>
  import("@/components/DesignComparisonModal").then((m) => ({
    default: m.DesignComparisonModal,
  }))
);

export const DesignMagicOverlay: React.FC = () => {
  const {
    isTransitioning,
    transitionTarget,
    transitionId,
    compareOpen,
    setCompareOpen,
    compareInitialTab,
    openCompare,
    showPostTryPrompt,
    dismissPostTryPrompt,
  } = useDesign();
  const { lang } = useI18n();
  const location = useLocation();

  const isAuthOrAdmin =
    location.pathname.startsWith("/login") || location.pathname.startsWith("/admin");
  const isRtl = lang === "ar";
  const toApple = transitionTarget === "apple";

  return (
    <>
      {/* 1. Slanted Diagonal Magic Sweep Ribbon */}
      {isTransitioning && (
        <div
          key={`sweep-${transitionId}`}
          className="fixed inset-0 z-[9999] pointer-events-none overflow-hidden"
          aria-hidden="true"
        >
          {/* Slanted diagonal beam */}
          <div
            className={`absolute -top-[10vh] h-[120vh] w-[30vw] min-w-[200px] max-w-[380px] ${
              isRtl ? "design-ribbon-sweep-rtl" : "design-ribbon-sweep-ltr"
            }`}
            style={{
              left: 0,
              background: toApple
                ? "linear-gradient(90deg, transparent 0%, rgba(0, 113, 227, 0.08) 30%, rgba(0, 113, 227, 0.28) 52%, rgba(255, 255, 255, 0.55) 56%, rgba(0, 113, 227, 0.16) 72%, transparent 100%)"
                : "linear-gradient(90deg, transparent 0%, rgba(23, 184, 212, 0.08) 30%, rgba(23, 184, 212, 0.30) 52%, rgba(255, 255, 255, 0.52) 56%, rgba(23, 184, 212, 0.16) 72%, transparent 100%)",
              backdropFilter: "blur(3px)",
              boxShadow: toApple
                ? "0 0 42px 6px rgba(0, 113, 227, 0.22)"
                : "0 0 42px 6px rgba(23, 184, 212, 0.22)",
            }}
          />

          {/* Compact Floating Transformation Status Pill */}
          <div className="absolute top-[4.6rem] inset-x-0 flex justify-center px-4">
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              className="px-4 py-1.5 rounded-full bg-background/90 backdrop-blur-md border border-primary/35 shadow-lg text-xs font-bold text-foreground flex items-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
              <span>
                {toApple
                  ? lang === "ar"
                    ? "✨ جاري التحويل إلى تصميم Apple macOS..."
                    : "✨ Transforming to Apple macOS Design..."
                  : lang === "ar"
                    ? "🏛️ جاري العودة للتصميم الكلاسيكي..."
                    : "🏛️ Switching back to Classic Design..."}
              </span>
            </motion.div>
          </div>
        </div>
      )}

      {/* 2. Post-Try Floating Rating Bar (appears on first Apple trial) */}
      <AnimatePresence>
        {showPostTryPrompt && !isAuthOrAdmin && !isTransitioning && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="fixed bottom-4 sm:bottom-6 inset-x-0 z-40 flex justify-center px-3 pointer-events-none"
          >
            <div className="pointer-events-auto glass-card rounded-2xl sm:rounded-full px-3.5 py-2 shadow-xl border border-primary/30 flex items-center flex-wrap justify-center gap-2 max-w-[95vw]">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>
                  {lang === "ar" ? "عجبك التصميم الجديد؟" : "Liked the new design?"}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openCompare("compare")}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary hover:bg-secondary/80 text-foreground text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <Columns2 className="w-3 h-3 text-primary" />
                  <span>{lang === "ar" ? "مقارنة كل سكشن" : "Compare Sections"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => openCompare("feedback")}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full icloud-btn-primary text-[11px] font-semibold shadow-sm cursor-pointer"
                >
                  <Star className="w-3 h-3 fill-current" />
                  <span>{lang === "ar" ? "قيّم واقترح" : "Rate & Suggest"}</span>
                </button>

                <button
                  type="button"
                  onClick={dismissPostTryPrompt}
                  className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                  aria-label={lang === "ar" ? "إغلاق" : "Close"}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Shared Comparison & Feedback Modal */}
      {compareOpen && (
        <Suspense fallback={null}>
          <DesignComparisonModal
            open={compareOpen}
            onOpenChange={setCompareOpen}
            initialTab={compareInitialTab}
          />
        </Suspense>
      )}
    </>
  );
};
