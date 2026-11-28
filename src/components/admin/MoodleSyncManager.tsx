import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Play,
  ShieldCheck,
  KeyRound,
  Database,
  RotateCcw,
  Sparkles,
  FolderSync,
  Plus,
  Trash2,
} from "lucide-react";
import type { Course } from "@/lib/store";
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

interface DedupDetail {
  course: string;
  removedTitle: string;
  keptTitle: string;
  reason: string;
}

interface GdriveFolderRow {
  id: string;
  drive_folder_id: string;
  folder_name: string;
  cic_course_id: string;
  cic_course_name: string;
  default_category_id: string | null;
  enabled: boolean;
  last_synced_at: string | null;
  last_summary: string | null;
  stats: { synced: number; linked: number };
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
  gdriveFolders?: GdriveFolderRow[];
  runs: SyncRun[];
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("lms_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function MoodleSyncManager({
  courses: allCicCourses = [],
  onSynced,
}: {
  courses?: Course[];
  onSynced?: () => void;
}) {
  const { lang } = useI18n();
  const [data, setData] = useState<SyncStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [gdSyncing, setGdSyncing] = useState(false);
  const [busyCourseKey, setBusyCourseKey] = useState<string | null>(null);
  const [dedupReport, setDedupReport] = useState<{ message: string; details: DedupDetail[] } | null>(null);
  const [cookieInput, setCookieInput] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [newDriveUrl, setNewDriveUrl] = useState("");
  const [newDriveName, setNewDriveName] = useState("");
  const [newDriveCourseId, setNewDriveCourseId] = useState("");
  const [addingDrive, setAddingDrive] = useState(false);

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
      toast.success(lang === "ar" ? "تم حفظ جلسة مودل بنجاح!" : "Session saved!");
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
    if (onlyCourseId) setBusyCourseKey(`sync:${onlyCourseId}`);
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
      setBusyCourseKey(null);
    }
  };

  const handleResyncRepair = async (mode: "repair" | "full_reset", onlyCourseId?: string) => {
    if (mode === "full_reset") {
      const confirmed = window.confirm(
        lang === "ar"
          ? "سيتم مسح سجل تتبع المزامنة وإعادة فحص كل ملفات مودل ومقارنتها بمحتوى أول 5 صفحات (بدون حذف أي ملفات حالية). متابعة؟"
          : "This resets sync tracking and re-checks all Moodle items using 5-page content fingerprinting (existing files are kept). Continue?"
      );
      if (!confirmed) return;
    }

    if (onlyCourseId) setBusyCourseKey(`resync:${onlyCourseId}`);
    else setResyncing(true);

    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/resync`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...(onlyCourseId ? { onlyCourseId } : {}) }),
      });
      const result = await res.json();
      if (result.ok) {
        toast.success(result.message || "تمت إعادة المزامنة والإصلاح بنجاح ✅");
        onSynced?.();
      } else {
        toast.error(result.message || result.error || "فشلت إعادة المزامنة");
      }
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "فشل إعادة المزامنة");
    } finally {
      setResyncing(false);
      setBusyCourseKey(null);
    }
  };

  const handleContentDedup = async (onlyCourseId?: string) => {
    if (onlyCourseId) setBusyCourseKey(`dedup:${onlyCourseId}`);
    else setDeduping(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/dedup`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(onlyCourseId ? { onlyCourseId } : {}),
      });
      const result = await res.json();
      if (result.ok) {
        setDedupReport({ message: result.message, details: result.details || [] });
        toast.success(result.message);
        if (result.duplicatesRemoved > 0) onSynced?.();
      } else {
        toast.error(result.error || "فشل فحص التكرارات");
      }
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "فشل فحص التكرارات بالمحتوى");
    } finally {
      setDeduping(false);
      setBusyCourseKey(null);
    }
  };

  const handleRunGdriveSync = async (onlyFolderId?: string) => {
    if (onlyFolderId) setBusyCourseKey(`gd:${onlyFolderId}`);
    else setGdSyncing(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/gdrive/run`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(onlyFolderId ? { onlyFolderId } : {}),
      });
      const result = await res.json();
      if (result.ok) {
        toast.success(result.message || "اكتملت مزامنة Google Drive ✅");
        if (result.itemsAdded > 0 || result.itemsUpgraded > 0) onSynced?.();
      } else {
        toast.error(result.message || result.error || "فشلت مزامنة Google Drive");
      }
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "فشل تشغيل مزامنة Google Drive");
    } finally {
      setGdSyncing(false);
      setBusyCourseKey(null);
    }
  };

  const handleAddGdriveFolder = async () => {
    if (!newDriveUrl.trim() || !newDriveCourseId) {
      toast.error(lang === "ar" ? "أدخل رابط مجلد Google Drive واختر المقرر" : "Enter Drive folder URL and select a course");
      return;
    }
    const chosenCourse = allCicCourses.find((c) => c.id === newDriveCourseId);
    setAddingDrive(true);
    try {
      const res = await fetch(`${apiBase}/api/moodle-sync/gdrive/folders`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_url: newDriveUrl.trim(),
          folder_name: newDriveName.trim() || chosenCourse?.name || "Google Drive Folder",
          cic_course_id: newDriveCourseId,
          cic_course_name: chosenCourse ? `${chosenCourse.name}${chosenCourse.code ? ` (${chosenCourse.code})` : ""}` : newDriveCourseId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "فشل إضافة المجلد");
      setNewDriveUrl("");
      setNewDriveName("");
      setNewDriveCourseId("");
      toast.success(lang === "ar" ? "تمت إضافة مجلد Google Drive للمزامنة 24/7 ✅" : "Drive folder added ✅");
      await loadStatus();
    } catch (err: any) {
      toast.error(err?.message || "فشل الإضافة");
    } finally {
      setAddingDrive(false);
    }
  };

  const handleToggleGdriveFolder = async (rowId: string, enabled: boolean) => {
    try {
      await fetch(`${apiBase}/api/moodle-sync/gdrive/folders/${encodeURIComponent(rowId)}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await loadStatus();
    } catch {
      toast.error("فشل تحديث حالة المجلد");
    }
  };

  const handleDeleteGdriveFolder = async (rowId: string) => {
    if (!window.confirm(lang === "ar" ? "حذف ربط مجلد Google Drive هذا من المزامنة؟ (الملفات المرفوعة بالفعل ستبقى)" : "Remove this Drive folder from sync?")) return;
    try {
      await fetch(`${apiBase}/api/moodle-sync/gdrive/folders/${encodeURIComponent(rowId)}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      await loadStatus();
      toast.success(lang === "ar" ? "تم حذف الربط" : "Removed");
    } catch {
      toast.error("فشل الحذف");
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
  const anyGlobalBusy = syncing || resyncing || deduping || gdSyncing;

  return (
    <div className="space-y-6">
      {/* Header Status Card */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-display font-bold flex items-center gap-2">
              <RefreshCw className={`w-5 h-5 text-primary ${anyGlobalBusy ? "animate-spin" : ""}`} />
              {lang === "ar" ? "مزامنة مودل التلقائية 24/7 + مقارنة أول 5 صفحات" : "24/7 Moodle Sync + 5-Page Dedup"}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {cfg?.cron_schedule || "تعمل تلقائياً كل 25 دقيقة على Cloudflare Workers مع مقارنة SHA-256 ونص أول 5 صفحات/شرائح لمنع التكرار."}
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
              variant="outline"
              size="sm"
              onClick={() => handleContentDedup()}
              disabled={anyGlobalBusy}
              className="gap-1.5"
            >
              <Sparkles className="w-4 h-4 text-amber-500" />
              {deduping
                ? (lang === "ar" ? "جاري فحص أول 5 صفحات..." : "Scanning 5 pages...")
                : (lang === "ar" ? "فحص وتنظيف التكرارات (أول 5 صفحات)" : "5-Page Content Dedup")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleResyncRepair("repair")}
              disabled={anyGlobalBusy || !cfg?.has_cookie}
              className="gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              {resyncing
                ? (lang === "ar" ? "جاري إعادة المزامنة والإصلاح..." : "Repairing...")
                : (lang === "ar" ? "إعادة المزامنة والإصلاح" : "Re-sync & Repair")}
            </Button>
            <Button
              size="sm"
              onClick={() => handleRunSync()}
              disabled={anyGlobalBusy || !cfg?.has_cookie}
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

        {dedupReport && (
          <div className="text-xs px-3 py-2.5 rounded-lg bg-amber-500/10 text-foreground border border-amber-500/25 space-y-1.5">
            <div className="font-semibold text-amber-700 dark:text-amber-400">
              🔍 {dedupReport.message}
            </div>
            {dedupReport.details.length > 0 && (
              <ul className="list-disc ps-5 space-y-0.5 text-[11px] text-muted-foreground">
                {dedupReport.details.map((d, idx) => (
                  <li key={idx}>
                    <strong>{d.course}:</strong> حُذف «{d.removedTitle}» (مطابق لـ «{d.keptTitle}» — {d.reason})
                  </li>
                ))}
              </ul>
            )}
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
            ? "الـ Worker يجدّد الجلسة تلقائياً كل 25 دقيقة لبقائها شغالة 24 ساعة. في حال انتهاء الجلسة يوماً ما: افتح learn3.sha.edu.eg بعد تسجيل الدخول ← اضغط F12 ← Application ← Cookies ← انسخ قيمة MoodleSession والصقها هنا."
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
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold">
            {lang === "ar" ? "المواد المربوطة بالمزامنة (سنة تانية CS)" : "Mapped Moodle Courses"}
          </h3>
          <Button
            size="sm"
            variant="ghost"
            disabled={anyGlobalBusy || !cfg?.has_cookie}
            onClick={() => handleResyncRepair("full_reset")}
            className="text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {lang === "ar" ? "إعادة ضبط سجل المزامنة للكل" : "Full Reset Tracking"}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(data?.courses || []).map((c) => {
            const isSyncingThis = busyCourseKey === `sync:${c.moodle_course_id}`;
            const isResyncingThis = busyCourseKey === `resync:${c.moodle_course_id}`;
            const isDedupingThis = busyCourseKey === `dedup:${c.moodle_course_id}`;
            const disableCourseBtns = anyGlobalBusy || Boolean(busyCourseKey);
            return (
              <div
                key={c.id}
                className="rounded-xl border border-border/60 bg-secondary/30 p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
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
                  <Switch
                    checked={c.enabled}
                    onCheckedChange={(v) => handleToggleCourse(c.id, v)}
                  />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/40">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disableCourseBtns || !cfg?.has_cookie}
                    onClick={() => handleRunSync(c.moodle_course_id)}
                    className="h-7 text-[11px] px-2.5"
                  >
                    {isSyncingThis ? "..." : (lang === "ar" ? "مزامنة" : "Sync")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disableCourseBtns || !cfg?.has_cookie}
                    onClick={() => handleResyncRepair("full_reset", c.moodle_course_id)}
                    className="h-7 text-[11px] px-2.5 gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {isResyncingThis ? "..." : (lang === "ar" ? "إعادة وإصلاح" : "Re-sync")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disableCourseBtns}
                    onClick={() => handleContentDedup(c.moodle_course_id)}
                    className="h-7 text-[11px] px-2.5 gap-1"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    {isDedupingThis ? "..." : (lang === "ar" ? "فحص مكرر (5 صفحات)" : "5-Page Dedup")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Google Drive 24/7 Synced Folders */}
      <div className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              <FolderSync className={`w-4 h-4 text-emerald-500 ${gdSyncing ? "animate-spin" : ""}`} />
              {lang === "ar" ? "مجلدات Google Drive المتزامنة 24/7 (تلقائياً كل 25 دقيقة)" : "24/7 Synced Google Drive Folders"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lang === "ar"
                ? "تسحب الملفات والمجلدات الفرعية مباشرة إلى R2 وتعمل بدون أي Session أو تسجيل دخول 24 ساعة في اليوم."
                : "Recursively pulls public Drive folder files directly to R2 24/7 without requiring any session."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={anyGlobalBusy}
            onClick={() => handleRunGdriveSync()}
            className="gap-1.5"
          >
            <Play className="w-3.5 h-3.5 text-emerald-500" />
            {gdSyncing
              ? (lang === "ar" ? "جاري مزامنة Drive..." : "Syncing Drive...")
              : (lang === "ar" ? "مزامنة Google Drive الآن" : "Sync Drive Now")}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(data?.gdriveFolders || []).map((f) => {
            const isBusyThis = busyCourseKey === `gd:${f.drive_folder_id}`;
            return (
              <div key={f.id} className="rounded-xl border border-border/60 bg-secondary/30 p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{f.folder_name}</div>
                    <div className="text-xs text-primary truncate">{f.cic_course_name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      <span>✅ متزامن: {f.stats.synced}</span>
                      <span>🔗 موجود: {f.stats.linked}</span>
                    </div>
                    {f.last_summary && (
                      <div className="text-[11px] text-muted-foreground/90 mt-1">{f.last_summary}</div>
                    )}
                  </div>
                  <Switch
                    checked={f.enabled}
                    onCheckedChange={(v) => handleToggleGdriveFolder(f.id, v)}
                  />
                </div>
                <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={anyGlobalBusy || Boolean(busyCourseKey)}
                    onClick={() => handleRunGdriveSync(f.drive_folder_id)}
                    className="h-7 text-[11px] px-2.5"
                  >
                    {isBusyThis ? "..." : (lang === "ar" ? "مزامنة الآن" : "Sync Now")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteGdriveFolder(f.id)}
                    className="h-7 text-[11px] px-2 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add New Public Drive Folder Form */}
        <div className="rounded-xl border border-dashed border-border/70 bg-secondary/20 p-3.5 space-y-2.5">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-primary" />
            {lang === "ar" ? "إضافة مجلد Google Drive جديد للمزامنة 24/7" : "Add Public Google Drive Folder"}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              dir="ltr"
              placeholder="https://drive.google.com/drive/folders/..."
              value={newDriveUrl}
              onChange={(e) => setNewDriveUrl(e.target.value)}
              className="bg-background/70 text-xs"
            />
            <Input
              placeholder={lang === "ar" ? "اسم المجلد (اختياري)" : "Folder label (optional)"}
              value={newDriveName}
              onChange={(e) => setNewDriveName(e.target.value)}
              className="bg-background/70 text-xs"
            />
            <select
              value={newDriveCourseId}
              onChange={(e) => setNewDriveCourseId(e.target.value)}
              className="rounded-lg bg-background/70 border border-input px-2.5 py-1.5 text-xs"
            >
              <option value="">{lang === "ar" ? "اختر المقرر..." : "Select course..."}</option>
              {allCicCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.code ? `(${c.code})` : ""} — س{c.academic_year}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" onClick={handleAddGdriveFolder} disabled={addingDrive} className="h-8 text-xs gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            {addingDrive ? "..." : (lang === "ar" ? "إضافة المجلد للمزامنة" : "Add Folder")}
          </Button>
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
