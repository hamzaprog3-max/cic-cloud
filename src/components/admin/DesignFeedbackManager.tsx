import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Star, MessageSquare, ThumbsUp, RefreshCw, Smartphone, Laptop } from "lucide-react";
import { toast } from "sonner";
import { playClickSfx } from "@/hooks/use-sfx";

interface FeedbackItem {
  id: string;
  rating: number;
  preferredDesign: string;
  feedback: string;
  sectionVotes?: Record<string, string>;
  submittedAt: string;
}

export const DesignFeedbackManager = () => {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFeedback = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/feedback");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setItems(data);
        }
      }
    } catch {
      toast.error(isAr ? "تعذر جلب التقييمات" : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeedback();
  }, []);

  const totalReviews = items.length;
  const avgRating =
    totalReviews > 0
      ? (items.reduce((acc, curr) => acc + (curr.rating || 0), 0) / totalReviews).toFixed(1)
      : "0.0";
  const applePrefCount = items.filter((i) => i.preferredDesign === "apple").length;
  const classicPrefCount = items.filter((i) => i.preferredDesign === "classic").length;
  const applePct = totalReviews > 0 ? Math.round((applePrefCount / totalReviews) * 100) : 50;

  return (
    <div className="space-y-6">
      {/* Header & Stats Cards */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">
            {isAr ? "تقييمات وآراء الطلاب في التصميم الجديد" : "Design Comparison & Student Feedback"}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {isAr
              ? "آراء وملاحظات واقتراحات الطلاب التي سجلوها عبر نافذة مقارنة التصميمين"
              : "Feedback and ratings submitted by students comparing the new vs old design"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            playClickSfx();
            fetchFeedback();
          }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-secondary/80 hover:bg-secondary text-foreground text-xs font-semibold transition-colors mac-cursor"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>{isAr ? "تحديث" : "Refresh"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Stat 1: Total reviews */}
        <div className="glass-card rounded-2xl p-4 sm:p-5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground">{totalReviews}</div>
            <div className="text-xs text-muted-foreground">
              {isAr ? "إجمالي التقييمات والمقترحات" : "Total Submissions"}
            </div>
          </div>
        </div>

        {/* Stat 2: Average Rating */}
        <div className="glass-card rounded-2xl p-4 sm:p-5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
            <Star className="w-5 h-5 fill-current" />
          </div>
          <div>
            <div className="text-2xl font-bold text-foreground flex items-center gap-1">
              <span>{avgRating}</span>
              <span className="text-xs text-muted-foreground">/ 5.0</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {isAr ? "متوسط التقييم العام" : "Average Rating"}
            </div>
          </div>
        </div>

        {/* Stat 3: Design Preference */}
        <div className="glass-card rounded-2xl p-4 sm:p-5 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
            <ThumbsUp className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-foreground flex items-center gap-2">
              <span>{isAr ? "الجديد" : "New"}: {applePct}%</span>
              <span className="text-muted-foreground">|</span>
              <span className="text-muted-foreground">{isAr ? "القديم" : "Old"}: {100 - applePct}%</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {isAr ? "التصميم المفضل للطلاب" : "Preferred Design"}
            </div>
          </div>
        </div>
      </div>

      {/* List of submissions */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="font-semibold text-base mb-4 text-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span>{isAr ? "المقترحات والملاحظات المكتوبة" : "Written Suggestions"}</span>
        </h3>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {isAr ? "جاري تحميل الآراء..." : "Loading feedback..."}
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {isAr
              ? "لم يتم إرسال أي تقييمات حتى الآن. سيظهر هنا أي رأي أو تقييم يرسله الطلاب."
              : "No feedback submitted yet. Student ratings and suggestions will appear here."}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const dateStr = item.submittedAt
                ? new Date(item.submittedAt).toLocaleString(isAr ? "ar-EG" : "en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "";

              return (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-secondary/35 hover:bg-secondary/50 border border-border/50 transition-all space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5 text-amber-500">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`w-3.5 h-3.5 ${
                              i < item.rating ? "fill-amber-500 text-amber-500" : "text-muted-foreground/30"
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary">
                        {item.preferredDesign === "apple"
                          ? isAr
                            ? "يفضل الحديث (macOS)"
                            : "Prefers Modern"
                          : isAr
                            ? "يفضل الكلاسيكي"
                            : "Prefers Classic"}
                      </span>
                    </div>

                    <span className="text-[11px] text-muted-foreground">{dateStr}</span>
                  </div>

                  {item.feedback ? (
                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap bg-background/50 p-2.5 rounded-lg border border-border/40">
                      {item.feedback}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      {isAr ? "(تقييم نجوم وتصويت فقط بدون نص)" : "(Star rating only)"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
