import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Link2,
  BookOpen,
  CalendarDays,
  Globe,
  Volume2,
  VolumeX,
  Home,
  HardDrive,
  GraduationCap,
  Sparkles,
  Columns2,
  Menu,
  X,
} from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell";
import { useState, useMemo, lazy, Suspense } from "react";
import { useSfx, playClickSfx } from "@/hooks/use-sfx";
import { useYear } from "@/hooks/use-year";
import { useI18n } from "@/lib/i18n";
import { useOfflineStorage } from "@/hooks/use-offline-storage";
import { getStudentHomeRoute, yearLabel } from "@/lib/year-context";
import { useDesign } from "@/hooks/use-design";

const OfflineFilesModal = lazy(() =>
  import("./OfflineFilesModal").then((m) => ({ default: m.OfflineFilesModal }))
);

const Navbar = () => {
  const location = useLocation();
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t, lang, setLang } = useI18n();
  const { muted, toggleMute } = useSfx();
  const { year } = useYear();
  const { totalSize, formatSize, isSupported } = useOfflineStorage();
  const {
    design,
    isApple,
    isClassic,
    switchDesign,
    openCompare,
    showSpotlight,
    dismissSpotlight,
  } = useDesign();

  const isLoginPage = location.pathname === "/login";
  const isAdminPage = location.pathname.startsWith("/admin");
  const showDesignControls = !isLoginPage && !isAdminPage;

  const homeRoute = useMemo(() => {
    return year ? getStudentHomeRoute() : "/";
  }, [year, location.pathname]);

  const coursesRoute = useMemo(() => {
    if (!year) return "/";
    return ["1", "2"].includes(year) ? `/year/${year}/departments` : `/year/${year}/semesters`;
  }, [year]);

  const navItems = useMemo(
    () => [
      {
        to: homeRoute,
        label: t("nav.home") || (lang === "ar" ? "الرئيسية" : "Home"),
        icon: Home,
        exact: homeRoute === "/",
        isHome: true,
      },
      {
        to: coursesRoute,
        label: t("nav.courses"),
        icon: BookOpen,
        exact: false,
        isHome: false,
      },
      {
        to: "/calendar",
        label: t("nav.calendar"),
        icon: Calendar,
        exact: false,
        isHome: false,
      },
      {
        to: "/schedule",
        label: t("nav.schedule"),
        icon: CalendarDays,
        exact: false,
        isHome: false,
      },
      {
        to: "/links",
        label: t("nav.links"),
        icon: Link2,
        exact: false,
        isHome: false,
      },
    ],
    [homeRoute, coursesRoute, t, lang]
  );

  const isRouteActive = (item: (typeof navItems)[number]) => {
    if (item.exact || item.isHome) return location.pathname === item.to;
    if (item.to === "/") return location.pathname === "/";
    return location.pathname.startsWith(item.to);
  };

  const openYearSwitcher = () => {
    playClickSfx();
    window.dispatchEvent(new CustomEvent("cic-open-year-picker"));
  };

  return (
    <header
      className={
        isApple
          ? "fixed top-0 inset-x-0 z-50 icloud-topbar"
          : "fixed top-0 inset-x-0 z-50 glass-card border-b"
      }
    >
      <div
        className={`container mx-auto max-w-6xl px-2 sm:px-4 flex items-center justify-between gap-1 sm:gap-2 ${
          isApple ? "h-14" : "h-16"
        }`}
      >
        {/* Start: Brand Lockup + Year Switcher (Apple mode) */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
          <Link to={homeRoute} className="flex items-center gap-1.5 sm:gap-2 group shrink-0">
            <img
              src="/logo.png"
              alt="CIC"
              className={
                isApple
                  ? "w-7 h-7 sm:w-8 sm:h-8 rounded-[8px] sm:rounded-[9px] object-contain bg-card border border-border/70 p-0.5"
                  : "w-7 h-7 sm:w-9 sm:h-9 rounded-lg object-contain"
              }
            />
            <span
              className={
                isApple
                  ? "font-bold text-[15px] sm:text-[16px] tracking-tight text-foreground"
                  : "font-display font-bold text-[15px] sm:text-lg text-foreground"
              }
            >
              CIC
            </span>
          </Link>

          {!isLoginPage && year && isApple && (
            <button
              type="button"
              onClick={openYearSwitcher}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-secondary/90 hover:bg-secondary text-foreground/85 border border-border/60 transition-colors mac-cursor"
              title={lang === "ar" ? "تغيير الفرقة أو القسم" : "Switch year or department"}
            >
              <GraduationCap className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="truncate max-w-[110px]">{yearLabel(year, lang)}</span>
            </button>
          )}
        </div>

        {/* Center: Navigation Links (Apple = iCloud segmented pill; Classic = classic flat pills) */}
        {!isLoginPage && (
          <nav
            className={
              isApple
                ? "hidden lg:flex items-center icloud-segmented gap-0.5"
                : "hidden lg:flex items-center gap-1"
            }
            aria-label="Main navigation"
          >
            {navItems.map((item) => {
              const active = isRouteActive(item);
              const Icon = item.icon;
              if (isApple) {
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    onClick={() => playClickSfx()}
                    data-active={active ? "true" : "false"}
                    className="icloud-segmented-item flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? "text-primary" : ""}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              }
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  onClick={() => playClickSfx()}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        )}

        {/* End: Top [قديم | جديد] Design Switcher + Compare Button + Toolbar Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {showDesignControls && (
            <div className="relative flex items-center gap-1 shrink-0">
              {/* [ قديم | ✨ جديد ] Switcher Pill */}
              <div
                className={`inline-flex items-center p-0.5 border transition-colors ${
                  isApple
                    ? "rounded-full bg-secondary/90 border-border/70"
                    : "rounded-full bg-secondary/80 border-primary/25 shadow-sm"
                }`}
                role="group"
                aria-label={lang === "ar" ? "تبديل تصميم الموقع" : "Switch site design"}
              >
                <button
                  type="button"
                  onClick={() => switchDesign("classic")}
                  data-design-btn="classic"
                  className={`px-1.5 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                    design === "classic"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang === "ar" ? "قديم" : "Classic"}
                </button>
                <button
                  type="button"
                  onClick={() => switchDesign("apple")}
                  data-design-btn="apple"
                  className={`inline-flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                    design === "apple"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-primary bg-primary/10 hover:bg-primary/20 animate-pulse"
                  }`}
                >
                  <Sparkles className="w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0" />
                  <span>{lang === "ar" ? "جديد" : "New"}</span>
                </button>
              </div>

              {/* Quick Compare & Rate Icon Button */}
              <button
                type="button"
                onClick={() => openCompare("compare")}
                className={
                  isApple
                    ? "icloud-icon-btn mac-cursor !h-7 !min-w-7 !px-1 sm:!h-8 sm:!min-w-8 sm:!px-1.5"
                    : "inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-secondary/90 hover:bg-secondary text-foreground/80 hover:text-primary transition-colors cursor-pointer"
                }
                title={
                  lang === "ar"
                    ? "مقارنة التصميم القديم والجديد وتقييمك"
                    : "Compare old vs new design & rate"
                }
                aria-label={
                  lang === "ar" ? "مقارنة التصميم والتقييم" : "Compare design & rate"
                }
              >
                <Columns2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
              </button>

              {/* First-Visit Spotlight Callout Pointer pointing directly to "✨ جديد" */}
              <AnimatePresence>
                {showSpotlight && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="absolute top-full mt-3 end-0 z-50 w-[min(17.5rem,calc(100vw-24px))]"
                  >
                    {/* Upward Pointer Arrow aligned toward "✨ جديد" */}
                    <div
                      className="w-3.5 h-3.5 bg-card border-t border-s border-primary/35 rotate-45 absolute -top-[7px] end-11 sm:end-12"
                      aria-hidden="true"
                    />
                    <div className="relative rounded-2xl bg-card border border-primary/35 shadow-xl p-3.5 text-start">
                      <button
                        type="button"
                        onClick={dismissSpotlight}
                        className="absolute top-2.5 end-2.5 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                        aria-label={lang === "ar" ? "إغلاق" : "Dismiss"}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>

                      <p className="text-xs font-bold text-foreground pe-6 mb-1">
                        {lang === "ar"
                          ? "✨ جرّب التصميم الجديد (Apple macOS)!"
                          : "✨ Try the New Apple macOS Design!"}
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                        {lang === "ar"
                          ? "اضغط لتتحول الصفحة قدامك عنصر عنصر زي السحر، أو قارن التصميمين مباشرة."
                          : "Click to watch the whole page morph element-by-element, or compare side-by-side."}
                      </p>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => switchDesign("apple")}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>{lang === "ar" ? "جرّب الآن 🪄" : "Try Now 🪄"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            dismissSpotlight();
                            openCompare("compare");
                          }}
                          className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-full bg-secondary hover:bg-secondary/80 text-foreground text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          <span>{lang === "ar" ? "مقارنة" : "Compare"}</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {!isLoginPage && isSupported && totalSize > 0 && (
            <button
              type="button"
              onClick={() => {
                playClickSfx();
                setOfflineModalOpen(true);
              }}
              className="hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-emerald-500/12 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-semibold transition-colors mac-cursor"
              title={lang === "ar" ? "الملفات المحفوظة بدون إنترنت" : "Offline downloaded files"}
            >
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono text-[11px]">{formatSize(totalSize)}</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleMute}
            className={
              isApple
                ? "hidden sm:inline-flex icloud-icon-btn mac-cursor"
                : "hidden sm:inline-flex p-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
            }
            aria-label={
              lang === "ar" ? (muted ? "تشغيل الصوت" : "كتم الصوت") : muted ? "Unmute" : "Mute"
            }
            title={
              lang === "ar" ? (muted ? "تشغيل الصوت" : "كتم الصوت") : muted ? "Unmute" : "Mute"
            }
          >
            {muted ? (
              <VolumeX className="w-[17px] h-[17px]" />
            ) : (
              <Volume2 className="w-[17px] h-[17px]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              playClickSfx();
              setLang(lang === "ar" ? "en" : "ar");
            }}
            className={
              isApple
                ? "icloud-icon-btn mac-cursor !h-7 !min-w-7 !px-1 sm:!h-8 sm:!min-w-8 sm:!px-2 gap-1 text-xs font-semibold"
                : "hidden sm:inline-flex items-center gap-1 p-1.5 sm:p-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-bold transition-colors cursor-pointer"
            }
            aria-label="Toggle language"
          >
            <Globe className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{lang === "ar" ? "EN" : "AR"}</span>
          </button>

          {!isLoginPage && <NotificationBell />}
          <ThemeToggle />

          {/* Mobile menu button for BOTH Classic and Apple themes (< lg) */}
          {!isLoginPage && (
            <button
              type="button"
              onClick={() => {
                playClickSfx();
                setMobileMenuOpen((v) => !v);
              }}
              className={
                isApple
                  ? "lg:hidden icloud-icon-btn mac-cursor !h-7 !min-w-7 !px-1 sm:!h-8 sm:!min-w-8 shrink-0"
                  : "lg:hidden inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-secondary text-foreground hover:bg-secondary/80 transition-colors cursor-pointer shrink-0"
              }
              aria-label={lang === "ar" ? "القائمة" : "Menu"}
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Nav Drawer (works in BOTH Classic and Apple themes) */}
      <AnimatePresence>
        {mobileMenuOpen && !isLoginPage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={`lg:hidden border-t border-border px-4 py-3 space-y-1 overflow-hidden ${
              isApple ? "bg-card/95 backdrop-blur-xl shadow-lg" : "bg-card"
            }`}
          >
            {navItems.map((item) => {
              const active = isRouteActive(item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  onClick={() => {
                    playClickSfx();
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    isApple ? "rounded-xl" : "rounded-lg"
                  } ${
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            {year && isApple && (
              <button
                type="button"
                onClick={() => {
                  playClickSfx();
                  setMobileMenuOpen(false);
                  openYearSwitcher();
                }}
                className="sm:hidden w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium text-foreground bg-secondary/70 hover:bg-secondary transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2.5">
                  <GraduationCap className="w-4 h-4 text-primary" />
                  <span>{lang === "ar" ? "تغيير الفرقة / القسم" : "Switch Year / Dept"}</span>
                </span>
                <span className="font-bold text-xs text-primary">{yearLabel(year, lang)}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                playClickSfx();
                setLang(lang === "ar" ? "en" : "ar");
                setMobileMenuOpen(false);
              }}
              className="sm:hidden w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium text-foreground bg-secondary/70 hover:bg-secondary transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-primary" />
                <span>{lang === "ar" ? "تغيير اللغة" : "Language"}</span>
              </span>
              <span className="font-bold text-xs text-primary">
                {lang === "ar" ? "English" : "العربية"}
              </span>
            </button>
            {isSupported && totalSize > 0 && (
              <button
                type="button"
                onClick={() => {
                  playClickSfx();
                  setMobileMenuOpen(false);
                  setOfflineModalOpen(true);
                }}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
              >
                <span className="flex items-center gap-2.5">
                  <HardDrive className="w-4 h-4" />
                  {lang === "ar" ? "الملفات المحفوظة أوفلاين" : "Offline Files"}
                </span>
                <span className="font-mono text-xs font-bold">{formatSize(totalSize)}</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {offlineModalOpen && (
        <Suspense fallback={null}>
          <OfflineFilesModal open={offlineModalOpen} onOpenChange={setOfflineModalOpen} />
        </Suspense>
      )}
    </header>
  );
};

export default Navbar;
