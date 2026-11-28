import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Play, ShieldCheck, KeyRound, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getWorkerApiBase } from "@/lib/r2";

interface SyncCourse {
  id: string;
  moodle_course_id: string;
  moodle_course_name: string;
  cic_course_id: string;
  cic_course_name: string;
  enabled: boolean;
  last_synced_at: string | null;
  stats: { synced: number; linked: number };
}

interface SyncRun {
  id: string;
  trigger_type: string;
  status: string;
  courses_checked: number;
  items_added: number;
  items_skipped: number;
  errors: string[];
  started_at: string;
  finished_at: string;
}

interface SyncStatusResponse {
  config: {
    moodle_base_url: string;
    has_cookie: boolean;
    masked_cookie: string;
    enabled: boolean;
    notify_students: boolean;
    session_status: string;
    last_check_at: string | null;
    last_sync_at: string | null;
    last_error: string | null;
    last_summary: string | null;
    cron_schedule: string;
  } | null;
  courses: SyncCourse[];
  runs: SyncRun[];
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("lms_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function MoodleSyncManager({ onSynced }: { onSynced?: () => void }) {
  const { lang } = useI18n();
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingCourseId, setSyncingCourseId] = useState<string | null>(null);
  const [cookieInput, setCookieInput] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [refreshingCache, setRefreshingCache] = useState(false);

  const apiBase = getWorkerApiBase();

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/status`, {
        headers: getAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SyncStatusResponse;
      setData(json);
    } catch (err: any) {
      toast.error(err?.message || "فشل تحميل حالة المزامنة");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSaveCookie = async () => {
    if (!cookieInput.trim()) {
      toast.error(lang === "ar" ? "الصق قيمة MoodleSession أولاً" : "Paste MoodleSession first");
      return;
    }
    setSavingConfig(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/config`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ session_cookie: cookieInput.trim() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "فشل الحفظ");
      setCookieInput("");
      toast.success(lang === "ar" ? "تم حفظ جلسة مودل بنجاح — جاري الاختبار..." : "Session saved!");
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "فشل حفظ الجلسة");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleConfig = async (patch: { enabled?: boolean; notify_students?: boolean }) => {
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/config`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("فشل التحديث");
      await loadStatus();
      toast.success(lang === "ar" ? "تم تحديث الإعدادات ✅" : "Updated ✅");
    } catch (err: any) {
      toast.error(err?.message || "فشل التحديث");
    }
  };

  const handleToggleCourse = async (courseRowId: string, enabled: boolean) => {
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/courses/${encodeURIComponent(courseRowId)}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("فشل التحديث");
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "فشل تحديث المقرر");
    }
  };

  const handleRunSync = async (onlyCourseId?: string) => {
    if (onlyCourseId) setSyncingCourseId(onlyCourseId);
    else setSyncing(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/run`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(onlyCourseId ? { onlyCourseId } : {}),
      });
      const result = await res.json();
      if (result.ok) {
        toast.success(result.message || "اكتملت المزامنة بنجاح ✅");
        if (result.itemsAdded > 0) onSynced?.();
      } else {
        toast.error(result.message || result.error || "فشلت المزامنة");
      }
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "فشل تشغيل المزامنة");
    } finally {
      setSyncing(false);
      setSyncingCourseId(null);
    }
  };

  const handleRefreshDbCache = async () => {
    setRefreshingCache(true);
    try {
      const res = await fetch(`${apiBase}/api/db/cache/refresh`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "فشل تحديث الكاش");
      toast.success(
        lang === "ar"
          ? `تم تحديث كاش قاعدة البيانات في R2 (${json.materials} ملف / ${json.courses} مقرر) ✅`
          : `R2 DB cache refreshed (${json.materials} materials) ✅`
      );
    } catch (err: any) {
      toast.error(err?.message || "فشل تحديث الكاش");
    } finally {
      setRefreshingCache(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-8 text-center text-sm text-muted-foreground">
        {lang === "ar" ? "جاري تحميل لوحة مزامنة مودل..." : "Loading Moodle Sync panel..."}
      </div>
    );
  }

  const cfg = data?.config;
  const isActive = cfg?.session_status === "active";

  return (
    <div className="space-y-6">
      {/* Header Status Card */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-display font-bold flex items-center gap-2">
              <RefreshCw className={`w-5 h-5 text-primary ${syncing ? "animate-spin" : ""}`} />
              {lang === "ar" ? "مزامنة مودل التلقائية 24/7 (Cloudflare Worker)" : "24/7 Automated Moodle Sync"}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {cfg?.cron_schedule || "تعمل تلقائياً كل 25 دقيقة على سيرفرات Cloudflare Workers لسحب المحاضرات والسكاشن والكويزات الجديدة ورفعها على R2 + D1."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshDbCache}
              disabled={refreshingCache}
              className="gap-1.5"
            >
              <Database className="w-4 h-4" />
              {refreshingCache
                ? (lang === "ar" ? "جاري التحديث..." : "Refreshing...")
                : (lang === "ar" ? "تحديث كاش D1/R2" : "Refresh DB Cache")}
            </Button>
            <Button
              size="sm"
              onClick={() => handleRunSync()}
              disabled={syncing || !cfg?.has_cookie}
              className="gap-1.5"
            >
              <Play className="w-4 h-4" />
              {syncing
                ? (lang === "ar" ? "جاري المزامنة..." : "Syncing...")
                : (lang === "ar" ? "مزامنة كل المواد الآن" : "Sync All Now")}
            </Button>
          </div>
        </div>

        {/* Status Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
            <div className="text-[11px] text-muted-foreground mb-1">
              {lang === "ar" ? "حالة جلسة مودل" : "Session Status"}
            </div>
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {isActive ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {lang === "ar" ? "متصل ويعمل 24/7" : "Active 24/7"}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">
                    {cfg?.session_status === "expired"
                      ? (lang === "ar" ? "الجلسة انتهت — يلزم التحديث" : "Expired — Update Cookie")
                      : (lang === "ar" ? "بانتظار إدخال MoodleSession" : "Not Configured")}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3">
            <div className="text-[11px] text-muted-foreground mb-1">
              {lang === "ar" ? "آخر فحص تلقائي" : "Last Check"}
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span>{cfg?.last_check_at ? new Date(cfg.last_check_at).toLocaleString("ar-EG") : "—"}</span>
            </div>
          </div>

          <div className="rounded-xl bg-secondary/40 border border-border/50 p-3 flex items-center justify-between gap-3">
            <div className="space-y-1.5 w-full">
              <div className="flex items-center justify-between text-xs">
                <span>{lang === "ar" ? "تشغيل المزامنة 24/7" : "Auto-Sync 24/7"}</span>
                <Switch
                  checked={Boolean(cfg?.enabled)}
                  onCheckedChange={(v) => handleToggleConfig({ enabled: v })}
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span>{lang === "ar" ? "إشعار الطلاب تلقائياً" : "Auto-Notify Students"}</span>
                <Switch
                  checked={Boolean(cfg?.notify_students)}
                  onCheckedChange={(v) => handleToggleConfig({ notify_students: v })}
                />
              </div>
            </div>
          </div>
        </div>

        {cfg?.last_summary && (
          <div className="text-xs px-3 py-2 rounded-lg bg-primary/10 text-foreground border border-primary/20">
            <strong>{lang === "ar" ? "آخر نتيجة:" : "Last Summary:"}</strong> {cfg.last_summary}
          </div>
        )}

        {cfg?.last_error && (
          <div className="text-xs px-3 py-2 rounded-lg bg-destructive/10 text-destructive border border-destructive/20">
            <strong>{lang === "ar" ? "تنبيه:" : "Alert:"}</strong> {cfg.last_error}
          </div>
        )}
      </div>

      {/* Session Cookie Update Box */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            {lang === "ar" ? "تحديث كوكي جلسة مودل (MoodleSession)" : "Update MoodleSession Cookie"}
          </h3>
          {cfg?.has_cookie && (
            <span className="text-[11px] font-mono text-muted-foreground bg-secondary/70 px-2 py-0.5 rounded" dir="ltr">
              {cfg.masked_cookie}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {lang === "ar"
            ? "الـ Worker يقوم بتجديد الجلسة تلقائياً كل 25 دقيقة لبقائها شغالة 24 ساعة. في حال انتهاء الجلسة يوماً ما: افتح learn3.sha.edu.eg بعد تسجيل الدخول ← اضغط F12 ← Application ← Cookies ← انسخ قيمة MoodleSession والصقها هنا."
            : "The worker pings Moodle every 25 minutes to keep the session alive 24/7. If it ever expires, copy MoodleSession from DevTools → Application → Cookies on learn3.sha.edu.eg and paste it here."}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="password"
            dir="ltr"
            placeholder="MoodleSession=... أو القيمة مباشرة"
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            className="bg-secondary/50 font-mono text-xs flex-1"
          />
          <Button onClick={handleSaveCookie} disabled={savingConfig} className="gap-1.5 shrink-0">
            <ShieldCheck className="w-4 h-4" />
            {savingConfig
              ? (lang === "ar" ? "جاري الحفظ..." : "Saving...")
              : (lang === "ar" ? "حفظ وتفعيل الجلسة" : "Save Session")}
          </Button>
        </div>
      </div>

      {/* Mapped Year 2 CS Courses */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-sm font-bold">
          {lang === "ar" ? "المواد المربوطة بالمزامنة (سنة تانية CS)" : "Mapped Moodle Courses"}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(data?.courses || []).map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-border/60 bg-secondary/30 p-3.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{c.cic_course_name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  Moodle #{c.moodle_course_id} — {c.moodle_course_name}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span>✅ متزامن: {c.stats.synced}</span>
                  <span>🔗 مربوط قديم: {c.stats.linked}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={syncing || syncingCourseId === c.moodle_course_id || !cfg?.has_cookie}
                  onClick={() => handleRunSync(c.moodle_course_id)}
                  className="h-8 text-xs"
                >
                  {syncingCourseId === c.moodle_course_id ? "..." : (lang === "ar" ? "مزامنة" : "Sync")}
                </Button>
                <Switch
                  checked={c.enabled}
                  onCheckedChange={(v) => handleToggleCourse(c.id, v)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Runs History */}
      <div className="glass-card p-5 space-y-3">
        <h3 className="text-sm font-bold">
          {lang === "ar" ? "سجل دورات المزامنة الأخيرة" : "Recent Sync Runs"}
        </h3>
        {(data?.runs || []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {lang === "ar" ? "لم يتم تشغيل أي دورة مزامنة بعد." : "No sync runs yet."}
          </p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {data!.runs.map((r) => (
              <div
                key={r.id}
                className="text-xs rounded-lg border border-border/50 bg-secondary/25 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      r.status === "success"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : r.status === "partial"
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="text-muted-foreground">({r.trigger_type})</span>
                  <span>
                    {r.courses_checked} مواد | +{r.items_added} جديد | {r.items_skipped} متخطى
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(r.started_at).toLocaleString("ar-EG")}
                </span>
                {r.errors.length > 0 && (
                  <div className="w-full text-[11px] text-destructive/90 mt-1">
                    {r.errors.slice(0, 2).join(" — ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
