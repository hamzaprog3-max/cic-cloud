import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  Cloud,
  Upload,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Loader2,
  ShieldCheck,
  Zap,
  ExternalLink,
  HardDrive,
  Activity,
  Film,
  Sparkles,
  ArrowUpRight,
  X,
} from "lucide-react";
import {
  getCloudinaryConfig,
  saveCloudinaryConfig,
  testCloudinaryConnection,
  getCloudinaryUsage,
  uploadVideoToCloudinary,
  parseCloudinaryConnectionUrl,
  type CloudinaryConfigStatus,
  type CloudinaryUsageStats,
  type CloudinaryUploadResult,
} from "@/lib/cloudinary";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (config: CloudinaryConfigStatus) => void;
  onUseVideoUrl?: (url: string, suggestedTitle?: string) => void;
  initialTab?: "settings" | "upload";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx >= 2 ? 2 : 1)} ${units[idx]}`;
}

function formatDuration(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const CloudinaryManagerModal: React.FC<Props> = ({
  open,
  onOpenChange,
  onSaved,
  onUseVideoUrl,
  initialTab = "settings",
}) => {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const [activeTab, setActiveTab] = useState<"settings" | "upload">(initialTab);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Settings state
  const [cloudName, setCloudName] = useState("");
  const [uploadMode, setUploadMode] = useState<"signed" | "unsigned">("signed");
  const [uploadPreset, setUploadPreset] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [hasExistingSecret, setHasExistingSecret] = useState(false);
  const [maskedSecret, setMaskedSecret] = useState("");
  const [folder, setFolder] = useState("cic-cloud/lectures");
  const [enabled, setEnabled] = useState(true);
  const [autoRouteVideos, setAutoRouteVideos] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [connectionUrlPaste, setConnectionUrlPaste] = useState("");

  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [usage, setUsage] = useState<CloudinaryUsageStats | null>(null);

  // Quick upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadSubfolder, setUploadSubfolder] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadedItems, setUploadedItems] = useState<Array<CloudinaryUploadResult & { fileName: string }>>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    setTestResult(null);
    setConnectionUrlPaste("");
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const cfg = await getCloudinaryConfig();
        if (cancelled) return;
        setCloudName(cfg.cloud_name || "");
        setUploadMode(cfg.upload_mode || "signed");
        setUploadPreset(cfg.upload_preset || "");
        setApiKey(cfg.api_key || "");
        setApiSecret("");
        setHasExistingSecret(cfg.has_api_secret);
        setMaskedSecret(cfg.masked_api_secret || "");
        setFolder(cfg.folder || "cic-cloud/lectures");
        setEnabled(cfg.enabled);
        setAutoRouteVideos(cfg.auto_route_videos);
        setIsConfigured(cfg.configured);

        if (cfg.configured && cfg.effective_mode === "signed") {
          const u = await getCloudinaryUsage().catch(() => null);
          if (!cancelled && u?.ok && u.usage) {
            setUsage(u.usage);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          toast.error(err?.message || (isAr ? "فشل تحميل إعدادات Cloudinary" : "Failed to load Cloudinary config"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialTab, isAr]);

  const handlePasteConnectionUrl = (val: string) => {
    setConnectionUrlPaste(val);
    const parsed = parseCloudinaryConnectionUrl(val);
    if (parsed) {
      setCloudName(parsed.cloud_name);
      setApiKey(parsed.api_key);
      setApiSecret(parsed.api_secret);
      setUploadMode("signed");
      setConnectionUrlPaste("");
      toast.success(
        isAr
          ? `تم استخراج بيانات الحساب (${parsed.cloud_name}) تلقائياً ✅ اضغط «حفظ الإعدادات»`
          : `Parsed Cloudinary URL (${parsed.cloud_name}) ✅ Click Save`
      );
    }
  };

  const handleTest = async () => {
    if (!cloudName.trim()) {
      toast.error(isAr ? "أدخل Cloud Name أولاً" : "Enter Cloud Name first");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testCloudinaryConnection({
        cloud_name: cloudName.trim(),
        upload_mode: uploadMode,
        upload_preset: uploadPreset.trim(),
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim() || undefined,
      });
      setTestResult({
        ok: Boolean(res.ok),
        message: res.ok ? (res.message || "Connected ✅") : (res.error || "Connection failed"),
      });
      if (res.ok) {
        toast.success(res.message || "تم الاتصال بنجاح ✅");
        if (res.usage) setUsage(res.usage);
      } else {
        toast.error(res.error || "فشل الاتصال");
      }
    } catch (err: any) {
      const msg = err?.message || "فشل فحص الاتصال";
      setTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloudName.trim()) {
      toast.error(isAr ? "اسم السحابة (Cloud Name) مطلوب" : "Cloud Name is required");
      return;
    }
    if (uploadMode === "signed" && (!apiKey.trim() || (!apiSecret.trim() && !hasExistingSecret))) {
      toast.error(
        isAr
          ? "في وضع الرفع الموقّع (Signed) يلزم إدخال API Key و API Secret"
          : "Signed mode requires API Key and API Secret"
      );
      return;
    }
    if (uploadMode === "unsigned" && !uploadPreset.trim()) {
      toast.error(
        isAr
          ? "في وضع الرفع السريع (Unsigned) يلزم إدخال اسم الـ Upload Preset"
          : "Unsigned mode requires an Upload Preset"
      );
      return;
    }

    setSaving(true);
    try {
      const updated = await saveCloudinaryConfig({
        cloud_name: cloudName.trim(),
        upload_mode: uploadMode,
        upload_preset: uploadPreset.trim(),
        api_key: apiKey.trim(),
        api_secret: apiSecret.trim() || undefined,
        folder: folder.trim() || "cic-cloud/lectures",
        enabled,
        auto_route_videos: autoRouteVideos,
      });
      setHasExistingSecret(updated.has_api_secret);
      setMaskedSecret(updated.masked_api_secret || "");
      setApiSecret("");
      setIsConfigured(updated.configured);
      toast.success(isAr ? "تم حفظ إعدادات Cloudinary CDN بنجاح ✅" : "Cloudinary CDN settings saved ✅");
      onSaved?.(updated);

      if (updated.configured && updated.effective_mode === "signed") {
        const u = await getCloudinaryUsage().catch(() => null);
        if (u?.ok && u.usage) setUsage(u.usage);
      }
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل حفظ الإعدادات" : "Failed to save settings"));
    } finally {
      setSaving(false);
    }
  };

  const handleQuickUpload = async () => {
    if (!selectedFile) {
      toast.error(isAr ? "اختر ملف فيديو أولاً" : "Select a video file first");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await uploadVideoToCloudinary(selectedFile, {
        subfolder: uploadSubfolder.trim() || undefined,
        onProgress: (pct) => setUploadPct(pct),
        signal: controller.signal,
      });
      setUploadedItems((prev) => [{ ...result, fileName: selectedFile.name }, ...prev]);
      setSelectedFile(null);
      setUploadPct(0);
      toast.success(
        isAr
          ? "تم رفع الفيديو على Cloudinary CDN بنجاح! يمكنك نسخ الرابط الآن 🎬"
          : "Video uploaded to Cloudinary CDN! Copy the link below 🎬"
      );
    } catch (err: any) {
      toast.error(err?.message || (isAr ? "فشل رفع الفيديو" : "Upload failed"));
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  };

  const handleCopy = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopiedUrl(url);
        toast.success(isAr ? "تم نسخ رابط Cloudinary CDN ✅" : "Cloudinary CDN URL copied ✅");
        setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 2000);
      })
      .catch(() => toast.error(isAr ? "تعذّر النسخ" : "Copy failed"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-background/95 backdrop-blur-2xl border border-border/80 shadow-2xl p-0 overflow-hidden rounded-2xl">
        <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-indigo-500/12 via-background to-sky-500/10 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2.5 font-display text-lg text-foreground">
            <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-500">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span>{isAr ? "استضافة الفيديوهات — Cloudinary CDN" : "Cloudinary CDN Video Hosting"}</span>
                {isConfigured ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {isAr ? "متصل وجاهز" : "Connected"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    {isAr ? "غير مُعدّ بعد" : "Not configured"}
                  </span>
                )}
              </div>
              <p className="text-xs font-normal text-muted-foreground mt-0.5">
                {isAr
                  ? "ترفع الفيديوهات مباشرة على Cloudinary CDN ويُحفظ الرابط فقط في المنصة (0 بايت على R2)"
                  : "Upload videos directly to Cloudinary CDN and store only the CDN link in CIC Cloud (0 bytes in R2)"}
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Tab Bar */}
        <div className="flex border-b border-border/60 bg-secondary/20 px-6 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "settings"
                ? "border-indigo-500 text-indigo-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {isAr ? "إعدادات الحساب والربط" : "Account & Settings"}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "upload"
                ? "border-indigo-500 text-indigo-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            {isAr ? "رفع فيديو وأخذ الرابط فقط" : "Upload & Get CDN Link"}
          </button>
        </div>

        <div className="p-6 max-h-[65vh] overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              <span>{isAr ? "جاري تحميل إعدادات Cloudinary..." : "Loading Cloudinary settings..."}</span>
            </div>
          ) : activeTab === "settings" ? (
            <form onSubmit={handleSave} className="space-y-4">
              {/* Live Usage Card (when available) */}
              {usage && (
                <div className="p-3.5 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/20 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      {isAr ? `استهلاك حساب Cloudinary (خطة ${usage.plan})` : `Cloudinary Usage (${usage.plan})`}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {usage.resources} {isAr ? "ملف" : "assets"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded-lg bg-background/70 border border-border/50">
                      <p className="text-[10px] text-muted-foreground">{isAr ? "الكريدت" : "Credits"}</p>
                      <p className="text-xs font-bold font-mono mt-0.5">
                        {usage.credits ? `${usage.credits.usage.toFixed(2)} / ${usage.credits.limit}` : "—"}
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-background/70 border border-border/50">
                      <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
                        <HardDrive className="w-3 h-3" /> {isAr ? "التخزين" : "Storage"}
                      </p>
                      <p className="text-xs font-bold font-mono mt-0.5">
                        {usage.storage ? formatBytes(usage.storage.usage) : "—"}
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-background/70 border border-border/50">
                      <p className="text-[10px] text-muted-foreground">{isAr ? "الباندويث" : "Bandwidth"}</p>
                      <p className="text-xs font-bold font-mono mt-0.5">
                        {usage.bandwidth ? formatBytes(usage.bandwidth.usage) : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Paste CLOUDINARY_URL */}
              <div className="p-3 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/20 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    {isAr ? "ربط سريع بضغطة واحدة (اختياري)" : "One-Paste Quick Setup (Optional)"}
                  </span>
                  <a
                    href="https://console.cloudinary.com/pm/developer-dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                  >
                    {isAr ? "افتح لوحة Cloudinary" : "Open Cloudinary Console"}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <Input
                  value={connectionUrlPaste}
                  onChange={(e) => handlePasteConnectionUrl(e.target.value)}
                  placeholder="الصق هنا: cloudinary://API_KEY:API_SECRET@CLOUD_NAME"
                  className="bg-background/80 text-xs font-mono"
                  dir="ltr"
                />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isAr
                    ? "من لوحة تحكم Cloudinary → Programmable Media → API Keys، انسخ API Environment variable والصقه هنا ليمتلئ Cloud Name و API Key و API Secret تلقائياً."
                    : "Copy the API Environment Variable from Cloudinary Console → API Keys and paste it here to auto-fill all fields."}
                </p>
              </div>

              {/* Upload Mode Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  {isAr ? "طريقة المصادقة والرفع:" : "Upload Authentication Mode:"}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUploadMode("signed")}
                    className={`p-3 rounded-xl border text-start transition-all ${
                      uploadMode === "signed"
                        ? "border-indigo-500 bg-indigo-500/10 text-foreground"
                        : "border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <ShieldCheck className="w-4 h-4 text-indigo-500" />
                      {isAr ? "Signed (آمن — موصى به)" : "Signed (Secure — Recommended)"}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {isAr
                        ? "بـ API Key + Secret (توقيع من السيرفر بدون Preset + إحصائيات الاستهلاك)"
                        : "Uses server-signed uploads via Worker + shows live storage/bandwidth usage"}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setUploadMode("unsigned")}
                    className={`p-3 rounded-xl border text-start transition-all ${
                      uploadMode === "unsigned"
                        ? "border-indigo-500 bg-indigo-500/10 text-foreground"
                        : "border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary/50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <Zap className="w-4 h-4 text-amber-500" />
                      {isAr ? "Unsigned (Upload Preset)" : "Unsigned (Upload Preset)"}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {isAr
                        ? "تحتاج فقط Cloud Name + اسم Upload Preset غير موقّع من إعدادات Cloudinary"
                        : "Only requires Cloud Name + an Unsigned Upload Preset name"}
                    </p>
                  </button>
                </div>
              </div>

              {/* Cloud Name + Folder */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Cloud Name *
                  </label>
                  <Input
                    value={cloudName}
                    onChange={(e) => setCloudName(e.target.value)}
                    placeholder="e.g. dxyz123abc"
                    className="bg-secondary/50 font-mono text-xs"
                    dir="ltr"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground block">
                    {isAr ? "مجلد الحفظ الافتراضي في Cloudinary" : "Default Cloudinary Folder"}
                  </label>
                  <Input
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                    placeholder="cic-cloud/lectures"
                    className="bg-secondary/50 font-mono text-xs"
                    dir="ltr"
                  />
                </div>
              </div>

              {/* Conditional Credential Inputs */}
              {uploadMode === "signed" ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground block">
                      API Key *
                    </label>
                    <Input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="123456789012345"
                      className="bg-secondary/50 font-mono text-xs"
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                      <span>API Secret *</span>
                      {hasExistingSecret && (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                          {isAr ? `محفوظ (${maskedSecret})` : `Saved (${maskedSecret})`}
                        </span>
                      )}
                    </label>
                    <Input
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      placeholder={
                        hasExistingSecret
                          ? isAr
                            ? "اتركه فارغاً للإبقاء على المفتاح المحفوظ"
                            : "Leave blank to keep existing secret"
                          : "xxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      }
                      className="bg-secondary/50 font-mono text-xs"
                      dir="ltr"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Unsigned Upload Preset *
                  </label>
                  <Input
                    value={uploadPreset}
                    onChange={(e) => setUploadPreset(e.target.value)}
                    placeholder="e.g. cic_cloud_videos"
                    className="bg-secondary/50 font-mono text-xs"
                    dir="ltr"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {isAr
                      ? "من Cloudinary → Settings → Upload → Upload presets → Add upload preset → اختر Signing Mode: Unsigned."
                      : "In Cloudinary → Settings → Upload → Upload presets → Add upload preset → Signing Mode: Unsigned."}
                  </p>
                </div>
              )}

              {/* Toggles */}
              <div className="p-3 rounded-xl bg-secondary/35 border border-border/60 space-y-2.5">
                <label className="flex items-center gap-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="accent-indigo-500 w-4 h-4"
                  />
                  <span className="font-medium text-foreground">
                    {isAr ? "تفعيل الرفع على Cloudinary CDN للمالك والمشرفين" : "Enable Cloudinary CDN uploads for owner & moderators"}
                  </span>
                </label>

                <label className="flex items-center gap-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoRouteVideos}
                    onChange={(e) => setAutoRouteVideos(e.target.checked)}
                    className="accent-indigo-500 w-4 h-4"
                  />
                  <span className="font-medium text-foreground">
                    {isAr
                      ? "توجيه ملفات الفيديو تلقائياً إلى Cloudinary CDN وحفظ الرابط فقط (بدلاً من R2)"
                      : "Automatically route video uploads to Cloudinary CDN & save link only (instead of R2)"}
                  </span>
                </label>
              </div>

              {/* Test Result Banner */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                    testResult.ok
                      ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
                      : "bg-destructive/10 border-destructive/25 text-destructive"
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed">{testResult.message}</span>
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing || saving}
                  className="gap-1.5"
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                  {isAr ? "فحص الاتصال" : "Test Connection"}
                </Button>
                <Button type="submit" disabled={saving || testing} className="flex-1 gap-1.5">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
                  {saving
                    ? isAr
                      ? "جاري الحفظ..."
                      : "Saving..."
                    : isAr
                      ? "حفظ إعدادات Cloudinary"
                      : "Save Cloudinary Settings"}
                </Button>
              </div>
            </form>
          ) : (
            /* TAB 2: QUICK UPLOAD & COPY CDN LINK */
            <div className="space-y-4">
              {!isConfigured ? (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300 space-y-2">
                  <p className="font-bold">
                    {isAr ? "⚠️ يلزم ربط حساب Cloudinary أولاً" : "⚠️ Configure Cloudinary first"}
                  </p>
                  <p>
                    {isAr
                      ? "انتقل لتبويب «إعدادات الحساب والربط» وأضف بيانات حساب Cloudinary الخاصة بك، ثم ارجع هنا لرفع الفيديوهات والحصول على روابط CDN فوراً."
                      : "Switch to Account & Settings tab to connect your Cloudinary account first."}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setActiveTab("settings")}>
                    {isAr ? "الذهاب للإعدادات" : "Go to Settings"}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="p-4 rounded-2xl border-2 border-dashed border-indigo-500/35 bg-indigo-500/[0.04] space-y-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
                        <Film className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">
                          {isAr ? "ارفع فيديو على Cloudinary CDN وانسخ الرابط" : "Upload video to Cloudinary CDN"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {isAr
                            ? "يدعم الرفع المجزأ (Chunked) للفيديوهات الكبيرة MP4 / WebM / MOV / MKV / MP3 — يُحفظ كرابط CDN فقط"
                            : "Supports chunked upload for large MP4/WebM/MOV/MKV/MP3 files — stores link only"}
                        </p>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-2">
                      <div className="sm:col-span-2">
                        <Input
                          type="file"
                          accept="video/*,audio/*,.mp4,.webm,.mov,.mkv,.avi,.mp3,.m4a,.wav"
                          disabled={uploading}
                          onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                          className="bg-background/80 text-xs cursor-pointer"
                        />
                      </div>
                      <Input
                        value={uploadSubfolder}
                        onChange={(e) => setUploadSubfolder(e.target.value)}
                        placeholder={isAr ? "مجلد فرعي (اختياري: CS210)" : "Subfolder (e.g. CS210)"}
                        disabled={uploading}
                        className="bg-background/80 text-xs font-mono"
                        dir="ltr"
                      />
                    </div>

                    {selectedFile && (
                      <div className="flex items-center justify-between text-xs bg-background/70 px-3 py-2 rounded-lg border border-border/60">
                        <span className="truncate font-medium">{selectedFile.name}</span>
                        <span className="text-muted-foreground font-mono shrink-0 ms-2">
                          {formatBytes(selectedFile.size)}
                        </span>
                      </div>
                    )}

                    {uploading && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-indigo-500 font-semibold flex items-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {isAr ? "جاري الرفع مباشرة على Cloudinary CDN..." : "Uploading directly to Cloudinary CDN..."}
                          </span>
                          <span className="font-mono font-bold text-indigo-500">{uploadPct}%</span>
                        </div>
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 transition-all duration-200 rounded-full"
                            style={{ width: `${uploadPct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        onClick={handleQuickUpload}
                        disabled={!selectedFile || uploading}
                        className="flex-1 gap-2"
                      >
                        <Upload className="w-4 h-4" />
                        {uploading
                          ? `${isAr ? "جاري الرفع" : "Uploading"} (${uploadPct}%)`
                          : isAr
                            ? "رفع على Cloudinary CDN الآن"
                            : "Upload to Cloudinary CDN"}
                      </Button>
                      {uploading && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => abortRef.current?.abort()}
                          className="gap-1"
                        >
                          <X className="w-4 h-4" />
                          {isAr ? "إلغاء" : "Cancel"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Uploaded Links History */}
                  {uploadedItems.length > 0 && (
                    <div className="space-y-2.5">
                      <h4 className="text-xs font-bold text-foreground">
                        {isAr ? "روابط الفيديوهات المرفوعة:" : "Uploaded CDN Video Links:"}
                      </h4>
                      {uploadedItems.map((item, idx) => (
                        <div
                          key={`${item.publicId}-${idx}`}
                          className="p-3 rounded-xl bg-secondary/40 border border-border/70 space-y-2"
                        >
                          <div className="flex items-center gap-3">
                            {item.posterUrl && (
                              <img
                                src={item.posterUrl}
                                alt={item.fileName}
                                className="w-16 h-10 object-cover rounded-lg border border-border/50 shrink-0 bg-black"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold truncate">{item.fileName}</p>
                              <p className="text-[11px] text-muted-foreground font-mono">
                                {formatBytes(item.bytes)}
                                {item.duration ? ` • ${formatDuration(item.duration)}` : ""}
                                {item.format ? ` • ${item.format.toUpperCase()}` : ""}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Input
                              readOnly
                              value={item.secureUrl}
                              className="h-8 text-[11px] font-mono bg-background/80"
                              dir="ltr"
                              onFocus={(e) => e.target.select()}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopy(item.secureUrl)}
                              className="h-8 gap-1 text-xs shrink-0"
                            >
                              {copiedUrl === item.secureUrl ? (
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              {isAr ? "نسخ" : "Copy"}
                            </Button>
                            {onUseVideoUrl && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => {
                                  const cleanName = item.fileName.replace(/\.[^.]+$/, "");
                                  onUseVideoUrl(item.secureUrl, cleanName);
                                  onOpenChange(false);
                                }}
                                className="h-8 gap-1 text-xs shrink-0"
                              >
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                {isAr ? "إدراج بالمادة" : "Use Link"}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CloudinaryManagerModal;
