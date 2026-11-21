import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

const APPLE_LIGHT_META = "#f5f5f7";
const APPLE_DARK_META = "#161618";
const CLASSIC_LIGHT_META = "#f7f9fb";
const CLASSIC_DARK_META = "#0d1117";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function syncThemeColorMeta(theme: "light" | "dark") {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const isApple = document.documentElement.dataset.design === "apple";
    const hex = isApple
      ? theme === "dark"
        ? APPLE_DARK_META
        : APPLE_LIGHT_META
      : theme === "dark"
        ? CLASSIC_DARK_META
        : CLASSIC_LIGHT_META;
    meta.setAttribute("content", hex);
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
    syncThemeColorMeta(theme);
  }, [theme]);

  const toggle = () => {
    const newTheme = theme === "dark" ? "light" : "dark";

    // @ts-ignore - View Transitions API
    if (!document.startViewTransition) {
      setTheme(newTheme);
      return;
    }

    const className = newTheme === "dark" ? "transition-to-dark" : "transition-to-light";
    document.documentElement.classList.add(className);

    try {
      // @ts-ignore
      const transition = document.startViewTransition(() => {
        flushSync(() => {
          setTheme(newTheme);
        });
      });

      transition.finished
        .catch(() => undefined)
        .finally(() => {
          document.documentElement.classList.remove(className);
        });
    } catch {
      document.documentElement.classList.remove(className);
      setTheme(newTheme);
    }
  };

  return {
    theme,
    toggle,
    setTheme,
  };
}
