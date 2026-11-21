import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { playClickSfx } from "@/hooks/use-sfx";
import { syncThemeColorMeta } from "@/hooks/use-theme";

export type DesignMode = "classic" | "apple";

const DESIGN_KEY = "cic_design_mode";
const SPOTLIGHT_DISMISSED_KEY = "cic_design_spotlight_dismissed";
const TRIED_APPLE_KEY = "cic_design_tried_apple";

interface SwitchOptions {
  instant?: boolean;
}

interface DesignContextValue {
  design: DesignMode;
  isApple: boolean;
  isClassic: boolean;
  isTransitioning: boolean;
  transitionTarget: DesignMode | null;
  transitionId: number;
  switchDesign: (next: DesignMode, opts?: SwitchOptions) => void;
  compareOpen: boolean;
  setCompareOpen: (open: boolean) => void;
  compareInitialTab: "compare" | "feedback";
  openCompare: (tab?: "compare" | "feedback") => void;
  showSpotlight: boolean;
  dismissSpotlight: () => void;
  showPostTryPrompt: boolean;
  dismissPostTryPrompt: () => void;
}

const DesignContext = createContext<DesignContextValue | null>(null);

function readStoredDesign(): DesignMode {
  if (typeof window === "undefined") return "classic";
  try {
    const raw = localStorage.getItem(DESIGN_KEY);
    if (raw === "apple") return "apple";
    if (raw === "new") {
      localStorage.setItem(DESIGN_KEY, "apple");
      return "apple";
    }
    return "classic";
  } catch {
    return "classic";
  }
}

function clearMorphDomArtifacts() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-morph-lock]").forEach((el) => {
    el.removeAttribute("data-morph-lock");
  });
  document.querySelectorAll(".design-morph-flip").forEach((el) => {
    el.classList.remove("design-morph-flip");
  });
}

function getCurrentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export const DesignProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [design, setDesign] = useState<DesignMode>(readStoredDesign);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<DesignMode | null>(null);
  const [transitionId, setTransitionId] = useState(0);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareInitialTab, setCompareInitialTab] = useState<"compare" | "feedback">("compare");

  const [showSpotlight, setShowSpotlight] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const initial = readStoredDesign();
      if (initial === "apple") return false;
      return localStorage.getItem(SPOTLIGHT_DISMISSED_KEY) !== "true";
    } catch {
      return false;
    }
  });

  const [showPostTryPrompt, setShowPostTryPrompt] = useState(false);

  const timersRef = useRef<number[]>([]);
  const runIdRef = useRef(0);

  const clearScheduledTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  // Keep <html> dataset.design and meta theme-color in sync
  useEffect(() => {
    document.documentElement.dataset.design = design;
    syncThemeColorMeta(getCurrentTheme());
  }, [design]);

  useEffect(() => {
    return () => {
      clearScheduledTimers();
      clearMorphDomArtifacts();
    };
  }, [clearScheduledTimers]);

  const dismissSpotlight = useCallback(() => {
    setShowSpotlight(false);
    try {
      localStorage.setItem(SPOTLIGHT_DISMISSED_KEY, "true");
    } catch {
      // ignore storage failure
    }
  }, []);

  const dismissPostTryPrompt = useCallback(() => {
    setShowPostTryPrompt(false);
  }, []);

  const openCompare = useCallback((tab: "compare" | "feedback" = "compare") => {
    playClickSfx();
    setCompareInitialTab(tab);
    setCompareOpen(true);
    setShowPostTryPrompt(false);
  }, []);

  const switchDesign = useCallback(
    (next: DesignMode, opts?: SwitchOptions) => {
      if (next === design) return;

      playClickSfx();
      clearScheduledTimers();
      clearMorphDomArtifacts();
      const currentRun = ++runIdRef.current;

      const prevDesign = design;

      try {
        localStorage.setItem(DESIGN_KEY, next);
      } catch {
        // ignore storage failure
      }

      let firstTimeApple = false;
      if (next === "apple") {
        setShowSpotlight(false);
        try {
          localStorage.setItem(SPOTLIGHT_DISMISSED_KEY, "true");
          firstTimeApple = localStorage.getItem(TRIED_APPLE_KEY) !== "true";
        } catch {
          // ignore
        }
      } else {
        setShowPostTryPrompt(false);
      }

      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

      if (opts?.instant || prefersReducedMotion) {
        document.documentElement.dataset.design = next;
        setDesign(next);
        setIsTransitioning(false);
        setTransitionTarget(null);
        if (firstTimeApple) {
          try {
            localStorage.setItem(TRIED_APPLE_KEY, "true");
          } catch {
            // ignore
          }
          setShowPostTryPrompt(true);
        }
        return;
      }

      // Collect visible morph targets, excluding nested descendants whose ancestor is already targeted
      const rawCandidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          "header, .glass-card, .icloud-list-group, [data-design-morph]"
        )
      );

      const viewportH = window.innerHeight || 800;
      const viewportW = window.innerWidth || 1200;
      const isRtl =
        document.documentElement.dir === "rtl" ||
        getComputedStyle(document.documentElement).direction === "rtl";

      const visibleSet = new Set<HTMLElement>();
      const candidatesWithRect: { el: HTMLElement; rect: DOMRect }[] = [];

      for (const el of rawCandidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.bottom > -100 && rect.top < viewportH + 100) {
          visibleSet.add(el);
          candidatesWithRect.push({ el, rect });
        }
      }

      const topLevelTargets = candidatesWithRect.filter(({ el }) => {
        let parent = el.parentElement;
        while (parent) {
          if (visibleSet.has(parent)) return false;
          parent = parent.parentElement;
        }
        return true;
      });

      // Sort along a diagonal wave (top-to-bottom + leading-to-trailing)
      topLevelTargets.sort((a, b) => {
        const scoreA =
          a.rect.top * 0.65 + (isRtl ? viewportW - a.rect.right : a.rect.left) * 0.35;
        const scoreB =
          b.rect.top * 0.65 + (isRtl ? viewportW - b.rect.right : b.rect.left) * 0.35;
        return scoreA - scoreB;
      });

      const cappedTargets = topLevelTargets.slice(0, 22).map((entry) => entry.el);

      // Lock every element to previous design until its own turn in the diagonal cascade
      cappedTargets.forEach((el) => {
        el.setAttribute("data-morph-lock", prevDesign);
      });

      setTransitionTarget(next);
      setIsTransitioning(true);
      setTransitionId((n) => n + 1);

      // Switch root theme slightly after wave begins while elements remain locked
      const rootSwitchTimer = window.setTimeout(() => {
        if (runIdRef.current !== currentRun) return;
        document.documentElement.dataset.design = next;
        setDesign(next);
      }, 150);
      timersRef.current.push(rootSwitchTimer);

      let lastDelay = 130;
      cappedTargets.forEach((el, idx) => {
        const delay = Math.min(130 + idx * 60, 860);
        lastDelay = delay;

        const startFlipTimer = window.setTimeout(() => {
          if (runIdRef.current !== currentRun) return;
          el.classList.add("design-morph-flip");
        }, delay);

        const unlockTimer = window.setTimeout(() => {
          if (runIdRef.current !== currentRun) return;
          el.removeAttribute("data-morph-lock");
        }, delay + 170);

        const endFlipTimer = window.setTimeout(() => {
          if (runIdRef.current !== currentRun) return;
          el.classList.remove("design-morph-flip");
        }, delay + 520);

        timersRef.current.push(startFlipTimer, unlockTimer, endFlipTimer);
      });

      const finishTimer = window.setTimeout(() => {
        if (runIdRef.current !== currentRun) return;
        clearMorphDomArtifacts();
        setIsTransitioning(false);
        setTransitionTarget(null);
        if (firstTimeApple) {
          try {
            localStorage.setItem(TRIED_APPLE_KEY, "true");
          } catch {
            // ignore
          }
          setShowPostTryPrompt(true);
        }
      }, lastDelay + 560);

      timersRef.current.push(finishTimer);
    },
    [design, clearScheduledTimers]
  );

  return (
    <DesignContext.Provider
      value={{
        design,
        isApple: design === "apple",
        isClassic: design === "classic",
        isTransitioning,
        transitionTarget,
        transitionId,
        switchDesign,
        compareOpen,
        setCompareOpen,
        compareInitialTab,
        openCompare,
        showSpotlight,
        dismissSpotlight,
        showPostTryPrompt,
        dismissPostTryPrompt,
      }}
    >
      {children}
    </DesignContext.Provider>
  );
};

export function useDesign() {
  const ctx = useContext(DesignContext);
  if (!ctx) {
    throw new Error("useDesign must be used within DesignProvider");
  }
  return ctx;
}
