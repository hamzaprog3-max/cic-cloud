import { motion } from "framer-motion";
import { Link, useSearchParams, Navigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import { ExternalLink, ArrowLeft, ArrowRight, GraduationCap, Layers, Monitor, Cpu } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { db } from "@/lib/store";
import { BulkOfflineDownloadButton } from "@/components/BulkOfflineDownloadButton";
import { playClickSfx } from "@/hooks/use-sfx";
import { useDesign } from "@/hooks/use-design";
import {
  setStoredYear,
  getStoredYear,
  getStudentHomeRoute,
  setStoredClassRoute,
} from "@/lib/year-context";

const SHOROUK_QUICK_LINKS = [
  {
    label_ar: "الخطة الزمنية والتعليمية",
    label_en: "Academic Calendar",
    href: "https://sha.edu.eg/Home/EducationalMap",
  },
  {
    label_ar: "جداول ونتائج شروق نت",
    label_en: "Schedules & Results",
    href: "https://shorouknet.sha.edu.eg",
  },
  {
    label_ar: "قسم علوم الحاسب HICIT",
    label_en: "CS Department HICIT",
    href: "https://hicit.sha.edu.eg/",
  },
  {
    label_ar: "بوابة أكاديمية الشروق",
    label_en: "Shorouk Academy Portal",
    href: "https://sha.edu.eg",
  },
];

const YEARS = [
  {
    id: "1",
    name_ar: "الفرقة الأولى",
    name_en: "First Year",
    icon: GraduationCap,
    appleAccent: "211 100% 45%", // Apple System Blue
    classicAccent: "190 80% 45%",
    route: "departments",
    desc_ar: "المواد العامة والأساسية",
    desc_en: "General & Core Courses",
  },
  {
    id: "2",
    name_ar: "الفرقة الثانية",
    name_en: "Second Year",
    icon: Layers,
    appleAccent: "241 62% 58%", // Apple Indigo
    classicAccent: "260 70% 55%",
    route: "departments",
    desc_ar: "التخصصات التقنية الأساسية",
    desc_en: "Core Technical Departments",
  },
  {
    id: "3",
    name_ar: "الفرقة الثالثة",
    name_en: "Third Year",
    icon: Monitor,
    appleAccent: "142 69% 42%", // Apple Green
    classicAccent: "340 70% 55%",
    route: "departments",
    desc_ar: "دراسات متقدمة في التخصص",
    desc_en: "Advanced Studies",
  },
  {
    id: "4",
    name_ar: "الفرقة الرابعة",
    name_en: "Fourth Year",
    icon: Cpu,
    appleAccent: "32 95% 48%", // Apple Orange
    classicAccent: "30 80% 50%",
    route: "departments",
    desc_ar: "مشاريع التخرج والتطبيقات",
    desc_en: "Graduation Projects",
  },
];

const YearCard = ({ year, idx }: { year: (typeof YEARS)[0]; idx: number }) => {
  const { lang } = useI18n();
  const { isApple } = useDesign();
  const targetRoute = `/year/${year.id}/${year.route}`;
  const accent = isApple ? year.appleAccent : year.classicAccent;

  const { data: allCourses = [] } = useQuery({
    queryKey: ["courses"],
    queryFn: db.getCourses,
  });

  const yearCourses = allCourses.filter((c) => (c.academic_year || "1") === year.id);

  const { data: yearUrls = [] } = useQuery({
    queryKey: ["year-urls", yearCourses.map((c) => c.id)],
    queryFn: () => db.getMaterialUrlsForCourses(yearCourses.map((c) => c.id)),
    enabled: yearCourses.length > 0,
  });

  const handleNavigate = () => {
    playClickSfx();
    sessionStorage.removeItem("cic_view_all_years");
    setStoredYear(year.id);
    setStoredClassRoute(targetRoute);
  };

  if (!isApple) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 + idx * 0.05, duration: 0.28, ease: "easeOut" }}
        className="relative group h-full"
      >
        <Link
          to={targetRoute}
          onClick={handleNavigate}
          className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
          style={{ "--year-color": `hsl(${accent})` } as React.CSSProperties}
        >
          <div
            data-design-morph
            className="glass-card rounded-2xl pt-8 pb-16 px-6 h-full relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 flex flex-col items-center justify-center text-center min-h-[200px]"
          >
            {/* Classic ambient glow */}
            <div
              className="absolute inset-0 pointer-events-none transition-opacity duration-500 opacity-25 group-hover:opacity-50"
              style={{
                background: `radial-gradient(circle at 50% 38%, hsl(${accent} / 0.35) 0%, transparent 65%)`,
              }}
            />

            <div className="relative z-10 flex flex-col items-center justify-center">
              <h2
                className="text-6xl md:text-7xl font-display font-black mb-1 transition-transform group-hover:scale-105 duration-300 select-none"
                style={{ color: `hsl(${accent})` }}
              >
                {year.id}
              </h2>
              <h3 className="font-display font-bold text-xl text-foreground group-hover:text-[var(--year-color)] transition-colors duration-300">
                {lang === "ar" ? year.name_ar : year.name_en}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {lang === "ar" ? year.desc_ar : year.desc_en}
              </p>
            </div>
          </div>
        </Link>

        {/* Quick Download Button layered on top */}
        <div className="absolute bottom-3.5 left-0 w-full flex justify-center z-20 pointer-events-none px-4">
          <div
            className="pointer-events-auto"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <BulkOfflineDownloadButton
              urls={yearUrls}
              label={{ ar: "حفظ الصف أوفلاين", en: "Save Year Offline" }}
              className="rounded-full shadow-md border-border/50 bg-background/90 hover:bg-background text-xs font-semibold px-4 py-1.5"
            />
          </div>
        </div>
      </motion.div>
    );
  }

  // Apple macOS Card Mode
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 + idx * 0.04, duration: 0.24, ease: "easeOut" }}
      className="group h-full select-none"
    >
      <Link
        to={targetRoute}
        onClick={handleNavigate}
        data-design-morph
        className="glass-card rounded-[20px] h-full flex flex-col justify-between overflow-hidden hover:-translate-y-0.5 hover:shadow-md transition-all mac-cursor block outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 pt-8 pb-6">
          <span
            className="text-6xl md:text-7xl font-black tracking-tighter mb-2 select-none transition-transform duration-200 group-hover:scale-105"
            style={{ color: `hsl(${accent})` }}
          >
            {year.id}
          </span>
          <h3 className="font-bold text-xl text-foreground group-hover:text-primary transition-colors">
            {lang === "ar" ? year.name_ar : year.name_en}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {lang === "ar" ? year.desc_ar : year.desc_en}
          </p>
        </div>

        {/* Clean macOS Hairline Footer with Full-Width Button */}
        <div className="px-4 py-3 border-t border-border/60 bg-muted/40 flex items-center justify-center">
          <div
            className="w-full"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <BulkOfflineDownloadButton
              urls={yearUrls}
              label={{ ar: "حفظ الصف أوفلاين", en: "Save Offline" }}
              className="rounded-full text-xs h-8 px-4 w-full sm:w-full"
            />
          </div>
        </div>
      </Link>
    </motion.div>
  );
};

const Index = () => {
  const { lang } = useI18n();
  const { isApple } = useDesign();
  const [searchParams] = useSearchParams();

  const allowAllYears =
    searchParams.get("change") === "true" ||
    sessionStorage.getItem("cic_view_all_years") === "true";
  const storedYear = getStoredYear();

  if (storedYear && !allowAllYears) {
    const destination = getStudentHomeRoute();
    return <Navigate to={destination} replace />;
  }

  return (
    <div className="min-h-screen pt-20 md:pt-24 pb-24 px-4 relative z-10">
      <div className="container mx-auto max-w-4xl">
        {/* Hero Title — Classic cyan gradient vs Apple clean solid typography */}
        <motion.div
          data-design-morph
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="text-center mb-10 md:mb-14"
        >
          <h1
            className={
              isApple
                ? "text-4xl md:text-5xl font-black mb-2 tracking-tight text-foreground"
                : "text-4xl md:text-6xl font-display font-bold mb-3 tracking-tight"
            }
          >
            {isApple ? "CIC" : <span className="text-gradient">CIC</span>}
          </h1>
          <p className="text-sm md:text-base text-muted-foreground max-w-md mx-auto font-medium">
            CA Interactive Cloud
          </p>
        </motion.div>

        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg md:text-xl font-bold text-foreground">
            {lang === "ar" ? "اختر السنة الدراسية" : "Select Academic Year"}
          </h2>
          <div className="h-px flex-1 bg-border/70 ms-4 hidden sm:block" />
        </div>

        {/* Shorouk Academy Quick Links */}
        <motion.div
          data-design-morph
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.22 }}
          className="mb-5 flex flex-wrap gap-2"
        >
          {SHOROUK_QUICK_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-secondary/80 hover:bg-secondary text-foreground/80 hover:text-primary border border-border/50 transition-colors mac-cursor"
            >
              {lang === "ar" ? item.label_ar : item.label_en}
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          ))}
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
          {YEARS.map((year, idx) => (
            <YearCard key={year.id} year={year} idx={idx} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
