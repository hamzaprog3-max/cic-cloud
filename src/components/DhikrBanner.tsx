import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

const DHIKR = [
  "سبحان الله",
  "الحمد لله",
  "الله أكبر",
  "لا إله إلا الله",
  "سبحان الله وبحمده",
  "سبحان الله وبحمده، سبحان الله العظيم",
  "لا حول ولا قوة إلا بالله",
  "اللهم صلِّ على نبينا محمد وعلى آله وصحبه وسلم",
];

const pickIndex = () => {
  const hourStamp = Math.floor(Date.now() / (1000 * 60 * 60));
  return hourStamp % DHIKR.length;
};

/** Compact Dhikr pill designed to sit cleanly at top-left next to the course name / header */
export const DhikrTopPill = ({ className = "" }: { className?: string }) => {
  const [index, setIndex] = useState(pickIndex);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const tick = () => setIndex(pickIndex());
    const interval = setInterval(tick, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-card/95 border border-emerald-500/25 text-foreground/90 shadow-sm text-xs font-semibold select-none backdrop-blur-md ${className}`}
      dir="rtl"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
      <span className="truncate max-w-[230px] sm:max-w-[300px]">{DHIKR[index]}</span>
      <button
        type="button"
        onClick={() => setIsVisible(false)}
        className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        title="إخفاء"
        aria-label="Hide reminder"
      >
        <X className="w-3 h-3" />
      </button>
    </motion.div>
  );
};

const DhikrBanner = () => {
  const location = useLocation();
  const [index, setIndex] = useState(pickIndex);
  const [isVisible, setIsVisible] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Course pages already render <DhikrTopPill /> right next to the course name — avoid duplicating
  const isCoursePage =
    location.pathname.startsWith("/course/") ||
    /^\/\d+b?\/\d+\/[^/]+/.test(location.pathname);

  useEffect(() => {
    const tick = () => setIndex(pickIndex());
    const now = new Date();
    const msToNextHour = Math.max(
      1000,
      (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000
    );
    const timeout = setTimeout(() => {
      tick();
      intervalRef.current = setInterval(tick, 60 * 60 * 1000);
    }, msToNextHour);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const timeout = setTimeout(
      () => setIsVisible((v) => !v),
      isVisible ? 30 * 1000 : 60 * 1000
    );
    return () => clearTimeout(timeout);
  }, [isVisible]);

  if (isCoursePage) return null;

  // Compact bottom-end pill on desktop/tablet (never a giant overlapping circle)
  return (
    <div className="hidden sm:flex fixed z-30 pointer-events-none bottom-5 end-5 px-4 justify-end">
      <AnimatePresence>
        {isVisible && (
          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="pointer-events-auto"
          >
            <div
              className="glass-card rounded-full px-4 py-2 flex items-center gap-2.5 max-w-[85vw] shadow-md border border-emerald-500/25"
              dir="rtl"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <p className="text-xs font-semibold text-foreground/90 select-none">
                {DHIKR[index]}
              </p>
              <button
                type="button"
                onClick={() => setIsVisible(false)}
                className="p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="إخفاء"
                aria-label="Hide reminder"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DhikrBanner;
