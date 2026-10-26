import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  Sparkles,
  Zap,
  Globe,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Layers,
  Activity,
  Key,
} from "lucide-react";
import {
  getAiProvidersConfig,
  saveAiProvidersConfig,
  testAiProvider,
  type AiProvidersConfig,
} from "@/lib/gemini";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export const AiProvidersManagerModal: React.FC<Props> = ({
  open,
  onOpenChange,
  onSaved,
}) => {
  const { lang } = useI18n();

  const [geminiKeysText, setGeminiKeysText] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [cerebrasKey, setCerebrasKey] = useState("");
  const [mistralKey, setMistralKey] = useState("");
  const [githubToken, setGithubToken] = useState("");

  // Testing states
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string; durationMs: number }>
  >({});

  // Active sub-tab
  const [activeTab, setActiveTab] = useState<"gemini" | "groq" | "openrouter" | "more">("gemini");

  useEffect(() => {
    if (open) {
      const config = getAiProvidersConfig();
      setGeminiKeysText(config.geminiKeys.join("\n"));
      setGroqKey(config.groqKey || "");
      setOpenRouterKey(config.openRouterKey || "");
      setCerebrasKey(config.cerebrasKey || "");
      setMistralKey(config.mistralKey || "");
      setGithubToken(config.githubToken || "");
      setTestResults({});
    }
  }, [open]);

  const geminiKeyCount = geminiKeysText
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 10).length;

  const handleRunTest = async (
    provider: "gemini" | "groq" | "openrouter" | "cerebras" | "mistral",
    key: string
  ) => {
    if (!key.trim()) {
      toast.error(lang === "ar" ? "يرجى إدخال المفتاح أولاً قبل الفحص" : "Please enter a key first");
      return;
    }

    setTestingProvider(provider);
    try {
      const result = await testAiProvider(provider, key);
      setTestResults((prev) => ({ ...prev, [provider]: result }));
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err: any) {
      toast.error(err?.message || "فشل الفحص");
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSave = () => {
    const cleanGeminiKeys = geminiKeysText
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 10);

    const newConfig: AiProvidersConfig = {
      geminiKeys: cleanGeminiKeys,
      groqKey: groqKey.trim(),
      openRouterKey: openRouterKey.trim(),
      cerebrasKey: cerebrasKey.trim(),
      mistralKey: mistralKey.trim(),
      githubToken: githubToken.trim(),
      preferredProvider: "auto",
    };

    saveAiProvidersConfig(newConfig);
    toast.success(
      lang === "ar"
        ? "تم حفظ إعدادات مزودي الذكاء الاصطناعي وباقة الطوارئ بنجاح ✅"
        : "AI Providers & Fallback config saved ✅"
    );
    if (onSaved) onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-background/95 backdrop-blur-2xl border border-border/80 shadow-2xl p-0 overflow-hidden rounded-2xl">
        <DialogHeader className="p-6 pb-4 bg-gradient-to-r from-primary/10 via-background to-secondary/30 border-b border-border/50">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2.5 font-display text-lg text-foreground">
              <div className="p-2 rounded-xl bg-primary/20 text-primary">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <span>{lang === "ar" ? "إدارة مزودي الذكاء الاصطناعي وباقة الطوارئ" : "AI Multi-Provider & Fallback System"}</span>
                <p className="text-xs font-normal text-muted-foreground mt-0.5">
                  {lang === "ar"
                    ? "نظام مقاوم لانتهاء الكوتا (429) عبر تدوير المفاتيح والتبديل التلقائي"
                    : "Zero-downtime key rotation & multi-provider fallback engine"}
                </p>
              </div>
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Resilience Architecture Banner */}
        <div className="px-6 py-2.5 bg-secondary/40 border-b border-border/40 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span className="font-semibold text-foreground">
              {lang === "ar" ? "مسار التبديل التلقائي الذكي:" : "Auto-Fallback Chain:"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] overflow-x-auto py-0.5">
            <span className={`px-2 py-0.5 rounded-md font-semibold border ${groqKey ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-muted text-muted-foreground/60 border-transparent"}`}>
              Groq 120B ({lang === "ar" ? "أقوى نموذج 120B" : "Flagship 120B"})
            </span>
            <span>&rarr;</span>
            <span className={`px-2 py-0.5 rounded-md font-semibold border ${cerebrasKey ? "bg-purple-500/10 text-purple-400 border-purple-500/20" : "bg-muted text-muted-foreground/60 border-transparent"}`}>
              Cerebras 120B ({lang === "ar" ? "1M توكن" : "1M tokens"})
            </span>
            <span>&rarr;</span>
            <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 font-semibold border border-blue-500/20">
              Gemini ({geminiKeyCount} {lang === "ar" ? "مشاريع تدوير" : "projects"})
            </span>
            <span>&rarr;</span>
            <span className={`px-2 py-0.5 rounded-md font-semibold border ${openRouterKey ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground/60 border-transparent"}`}>
              OpenRouter :free
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border/60 bg-secondary/20 px-6 pt-2 gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab("gemini")}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "gemini"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "ar" ? "تدوير مفاتيح Gemini" : "Gemini Key Rotation"}
            {geminiKeyCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/20 text-primary">
                {geminiKeyCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("groq")}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "groq"
                ? "border-amber-500 text-amber-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            {lang === "ar" ? "Groq Cloud (سريع جداً)" : "Groq Cloud"}
            {groqKey && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("openrouter")}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "openrouter"
                ? "border-emerald-500 text-emerald-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            {lang === "ar" ? "OpenRouter (نماذج مجانية)" : "OpenRouter :free"}
            {openRouterKey && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("more")}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "more"
                ? "border-purple-500 text-purple-500"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            {lang === "ar" ? "Cerebras & المزيد" : "Cerebras & More"}
            {(cerebrasKey || mistralKey || githubToken) && (
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            )}
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 space-y-4 max-h-[55vh] overflow-y-auto">
          {/* TAB 1: GEMINI */}
          {activeTab === "gemini" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 space-y-1.5">
                <div className="flex items-center justify-between font-semibold text-blue-300">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    {lang === "ar" ? "تدوير مفاتيح Google Gemini الذكي" : "Smart Gemini Key Rotation"}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                    {lang === "ar" ? `السعة: ${geminiKeyCount * 1500} طلب/يوم مجاناً` : `Capacity: ${geminiKeyCount * 1500} req/day free`}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {lang === "ar"
                    ? "المنصة تعتمد على gemini-2.0-flash و gemini-1.5-flash (1,500 طلب يومياً لكل مفتاح مجاناً). يمكنك وضع 4 أو 5 مفاتيح من حسابات جوجل مختلفة (سطر لكل مفتاح)، وسيقوم النظام تلقائياً بالتبديل للمفتاح التالي فور استلام خطأ 429."
                    : "Paste multiple Gemini API keys (one per line). Each key grants 1,500 free requests/day on Gemini 2.0 Flash."}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-primary" />
                    {lang === "ar" ? "مفاتيح Google Gemini (مفتاح في كل سطر):" : "Gemini API Keys (one per line):"}
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {geminiKeyCount} {lang === "ar" ? "مفتاح مدخل" : "keys detected"}
                  </span>
                </div>
                <Textarea
                  rows={4}
                  placeholder={`AIzaSy... (المفتاح الأول)\nAIzaSy... (المفتاح الثاني من حساب آخر)\nAIzaSy... (المفتاح الثالث)`}
                  value={geminiKeysText}
                  onChange={(e) => setGeminiKeysText(e.target.value)}
                  className="font-mono text-xs bg-secondary/50 border-border/80 focus:border-primary resize-y"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {lang === "ar" ? "الحصول على مفاتيح مجانية من Google AI Studio" : "Get free keys from Google AI Studio"}
                </a>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testingProvider === "gemini" || geminiKeyCount === 0}
                  onClick={() => {
                    const firstKey = geminiKeysText.split(/[\n,]+/)[0]?.trim();
                    handleRunTest("gemini", firstKey);
                  }}
                  className="text-xs gap-1.5"
                >
                  <Activity className={`w-3.5 h-3.5 ${testingProvider === "gemini" ? "animate-spin text-primary" : ""}`} />
                  {testingProvider === "gemini"
                    ? (lang === "ar" ? "جاري الفحص..." : "Testing...")
                    : (lang === "ar" ? "فحص أول مفتاح" : "Test Key")}
                </Button>
              </div>

              {testResults.gemini && (
                <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${testResults.gemini.success ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-destructive/10 text-destructive border border-destructive/20"}`}>
                  {testResults.gemini.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                  <span>{testResults.gemini.message}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: GROQ */}
          {activeTab === "groq" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-4 h-4" />
                    {lang === "ar" ? "Groq Cloud — سرعة فورية وباقة 14,400 طلب يومياً" : "Groq Cloud — Ultra-Fast & High Free Limit"}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                    14,400 req/day FREE
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {lang === "ar"
                    ? "يوفر نموذج Llama-3.3-70b-versatile و Mixtral-8x7b مجاناً بسرعة استجابة خارقة. يُعد أفضل شبكة أمان واحتياطي فوري إذا نفدت باقة جيمناي."
                    : "Groq provides high-performance Llama 3.3 70B inference with up to 14,400 free requests per day."}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-500" />
                  {lang === "ar" ? "مفتاح Groq API Key:" : "Groq API Key:"}
                </label>
                <Input
                  type="password"
                  placeholder="gsk_..."
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  className="font-mono text-xs bg-secondary/50 border-border/80"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-amber-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {lang === "ar" ? "إنشاء مفتاح مجاني من console.groq.com" : "Get free key from console.groq.com"}
                </a>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testingProvider === "groq" || !groqKey.trim()}
                  onClick={() => handleRunTest("groq", groqKey)}
                  className="text-xs gap-1.5"
                >
                  <Activity className={`w-3.5 h-3.5 ${testingProvider === "groq" ? "animate-spin text-amber-500" : ""}`} />
                  {testingProvider === "groq" ? "جاري الفحص..." : "اختبار Groq"}
                </Button>
              </div>

              {testResults.groq && (
                <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${testResults.groq.success ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-destructive/10 text-destructive border border-destructive/20"}`}>
                  {testResults.groq.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                  <span>{testResults.groq.message}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: OPENROUTER */}
          {activeTab === "openrouter" && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold text-emerald-300">
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-4 h-4" />
                    {lang === "ar" ? "OpenRouter — بوابة عشرات النماذج المجانية" : "OpenRouter :free Gateway"}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                    Unlimited :free Models
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {lang === "ar"
                    ? "يتيح مفتاح OpenRouter تشغيل عشرات النماذج المجانية بالكامل الملحقة بـ (:free) مثل google/gemini-2.0-flash-exp:free و deepseek/deepseek-chat:free و Llama 3.3 مجاناً."
                    : "Access free models like DeepSeek, Gemini Flash, and Llama 3.3 under a single API key."}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-emerald-500" />
                  {lang === "ar" ? "مفتاح OpenRouter API Key:" : "OpenRouter API Key:"}
                </label>
                <Input
                  type="password"
                  placeholder="sk-or-v1-..."
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  className="font-mono text-xs bg-secondary/50 border-border/80"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {lang === "ar" ? "إنشاء مفتاح من openrouter.ai/keys" : "Get key from openrouter.ai/keys"}
                </a>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testingProvider === "openrouter" || !openRouterKey.trim()}
                  onClick={() => handleRunTest("openrouter", openRouterKey)}
                  className="text-xs gap-1.5"
                >
                  <Activity className={`w-3.5 h-3.5 ${testingProvider === "openrouter" ? "animate-spin text-emerald-500" : ""}`} />
                  {testingProvider === "openrouter" ? "جاري الفحص..." : "اختبار OpenRouter"}
                </Button>
              </div>

              {testResults.openRouter && (
                <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${testResults.openRouter.success ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-destructive/10 text-destructive border border-destructive/20"}`}>
                  {testResults.openRouter.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                  <span>{testResults.openRouter.message}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CEREBRAS & OTHERS */}
          {activeTab === "more" && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs space-y-1">
                <span className="font-semibold text-purple-300 flex items-center gap-1.5">
                  <Cpu className="w-4 h-4" />
                  {lang === "ar" ? "Cerebras Cloud و Mistral و GitHub Models" : "Cerebras, Mistral & GitHub Models"}
                </span>
                <p className="text-[11px] text-muted-foreground">
                  {lang === "ar"
                    ? "Cerebras يوفر مليون توكن يومياً مجاناً بسرعة 2,000 توكن في الثانية، وميسترال يقدم خطة Experiment المجانية."
                    : "Additional fast and free AI fallback channels for extreme resilience."}
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      {lang === "ar" ? "Cerebras API Key (مليون توكن/يوم مجاناً):" : "Cerebras API Key:"}
                    </label>
                    <a href="https://cloud.cerebras.ai" target="_blank" rel="noreferrer" className="text-[11px] text-purple-400 hover:underline">
                      cloud.cerebras.ai ↗
                    </a>
                  </div>
                  <Input
                    type="password"
                    placeholder="csk-..."
                    value={cerebrasKey}
                    onChange={(e) => setCerebrasKey(e.target.value)}
                    className="font-mono text-xs bg-secondary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      {lang === "ar" ? "Mistral API Key (خطة Experiment المجانية):" : "Mistral API Key:"}
                    </label>
                    <a href="https://console.mistral.ai" target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">
                      console.mistral.ai ↗
                    </a>
                  </div>
                  <Input
                    type="password"
                    placeholder="mistral_..."
                    value={mistralKey}
                    onChange={(e) => setMistralKey(e.target.value)}
                    className="font-mono text-xs bg-secondary/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      {lang === "ar" ? "GitHub Token (نماذج GPT-4o-mini مجاناً):" : "GitHub Personal Access Token:"}
                    </label>
                    <a href="https://github.com/marketplace/models" target="_blank" rel="noreferrer" className="text-[11px] text-sky-400 hover:underline">
                      github.com/marketplace/models ↗
                    </a>
                  </div>
                  <Input
                    type="password"
                    placeholder="ghp_..."
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    className="font-mono text-xs bg-secondary/50"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-secondary/30 border-t border-border/60 flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span>{lang === "ar" ? "النظام نشط ومعد للتبديل التلقائي" : "Auto-fallback engine active"}</span>
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
              {lang === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md gap-1.5 px-5"
            >
              <CheckCircle2 className="w-4 h-4" />
              {lang === "ar" ? "حفظ كافة الإعدادات والمفاتيح" : "Save All Providers"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
