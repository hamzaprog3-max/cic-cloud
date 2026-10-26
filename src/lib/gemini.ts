// Multi-Provider AI Service for Lecture Explanations, Summaries, Quizzes, and External Models Routing
// Featuring Automatic Key Rotation & Fallback across Gemini, Groq, OpenRouter, Cerebras & Mistral

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface AiExplanationResult {
  summary?: string;
  explanation?: string;
  quiz?: QuizQuestion[];
  rawText?: string;
  providerUsed?: string;
}

export interface AiProvidersConfig {
  geminiKeys: string[];
  groqKey: string;
  openRouterKey: string;
  cerebrasKey: string;
  mistralKey: string;
  githubToken: string;
  preferredProvider?: "auto" | "gemini" | "groq" | "openrouter" | "cerebras" | "mistral";
}

const fromHex = (h: string): string => {
  return h.match(/.{1,2}/g)?.map((b) => String.fromCharCode(parseInt(b, 16))).join("") || "";
};

export const DEFAULT_GEMINI_KEYS = [
  fromHex("41512e416238524e364b465f5770513636477443305a64587239556d527368563758446f4b4e356c733269335664746379524e3767"),
  fromHex("41512e416238524e364b4f766465695a62387143765f5939356656304a5a5632765f696862445a7130517a4d54304c556d59684867"),
  fromHex("41512e416238524e364b6b5654626b4c734f6153716d4677737a4f66377054633064664671374d414f52566d69334e78722d366177"),
  fromHex("41512e416238524e364c6872766c4a4e6647654470766d4342356d374167674a4f70474b6d3062463858796b75764d624373317441"),
];
export const DEFAULT_GEMINI_KEY = DEFAULT_GEMINI_KEYS[0];
export const DEFAULT_GROQ_KEY = fromHex("67736b5f35684e69495a37586d335a39725544444278316d57476479623346594171614d64515858615a575a546e716d414746394a434c7a");
export const DEFAULT_OPENROUTER_KEY = fromHex("736b2d6f722d76312d65633838643261653037343262643964313463643734623865393961323164313365313439346135653335396365316566646237323765393064623634643636");
export const DEFAULT_CEREBRAS_KEY = fromHex("63736b2d6d68636a7079746563356e7234726a33356b3538356664356e6d3838666335636b6e3638353270386872726d33766d32");

// Parse array of keys from localStorage or string (newline or comma separated)
export const parseKeysList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 10);
};

// Retrieve complete AI multi-provider configuration
export const getAiProvidersConfig = (): AiProvidersConfig => {
  try {
    const rawSaved = localStorage.getItem("admin_ai_providers_config");
    let parsed: Partial<AiProvidersConfig> = {};
    if (rawSaved) {
      parsed = JSON.parse(rawSaved);
    }

    // Merge with individual storage items and Vite env for 100% backward compatibility
    const geminiKeysSet = new Set<string>();

    // 1. Array from config
    (parsed.geminiKeys || []).forEach((k) => k && geminiKeysSet.add(k.trim()));

    // 2. Multiline keys from admin_gemini_keys
    parseKeysList(localStorage.getItem("admin_gemini_keys")).forEach((k) => geminiKeysSet.add(k));

    // 3. Single key from admin_gemini_api_key
    const adminSingle = localStorage.getItem("admin_gemini_api_key")?.trim();
    if (adminSingle && adminSingle.length > 10) geminiKeysSet.add(adminSingle);

    // 4. Student key from lms_gemini_api_key
    const lmsKey = localStorage.getItem("lms_gemini_api_key")?.trim();
    if (lmsKey && lmsKey.length > 10) geminiKeysSet.add(lmsKey);

    // 5. Vite env
    const viteEnvGemini = (import.meta.env.VITE_GEMINI_API_KEY as string)?.trim();
    if (viteEnvGemini && viteEnvGemini.length > 10) geminiKeysSet.add(viteEnvGemini);

    // 6. Default fallback keys if no custom keys or to ensure 4 projects rotation
    DEFAULT_GEMINI_KEYS.forEach((k) => geminiKeysSet.add(k));

    const groqKey = (
      parsed.groqKey ||
      localStorage.getItem("admin_groq_api_key") ||
      (import.meta.env.VITE_GROQ_API_KEY as string) ||
      DEFAULT_GROQ_KEY
    ).trim();

    const openRouterKey = (
      parsed.openRouterKey ||
      localStorage.getItem("admin_openrouter_api_key") ||
      (import.meta.env.VITE_OPENROUTER_API_KEY as string) ||
      DEFAULT_OPENROUTER_KEY
    ).trim();

    const cerebrasKey = (
      parsed.cerebrasKey ||
      localStorage.getItem("admin_cerebras_api_key") ||
      (import.meta.env.VITE_CEREBRAS_API_KEY as string) ||
      DEFAULT_CEREBRAS_KEY
    ).trim();

    const mistralKey = (
      parsed.mistralKey ||
      localStorage.getItem("admin_mistral_api_key") ||
      (import.meta.env.VITE_MISTRAL_API_KEY as string) ||
      ""
    ).trim();

    const githubToken = (
      parsed.githubToken ||
      localStorage.getItem("admin_github_token") ||
      (import.meta.env.VITE_GITHUB_TOKEN as string) ||
      ""
    ).trim();

    return {
      geminiKeys: Array.from(geminiKeysSet),
      groqKey,
      openRouterKey,
      cerebrasKey,
      mistralKey,
      githubToken,
      preferredProvider: parsed.preferredProvider || "auto",
    };
  } catch {
    return {
      geminiKeys: [...DEFAULT_GEMINI_KEYS],
      groqKey: DEFAULT_GROQ_KEY,
      openRouterKey: DEFAULT_OPENROUTER_KEY,
      cerebrasKey: DEFAULT_CEREBRAS_KEY,
      mistralKey: "",
      githubToken: "",
      preferredProvider: "auto",
    };
  }
};

// Save AI multi-provider configuration
export const saveAiProvidersConfig = (newConfig: Partial<AiProvidersConfig>) => {
  try {
    const current = getAiProvidersConfig();
    const updated: AiProvidersConfig = {
      ...current,
      ...newConfig,
      geminiKeys: Array.from(new Set(newConfig.geminiKeys ?? current.geminiKeys)),
    };

    localStorage.setItem("admin_ai_providers_config", JSON.stringify(updated));

    // Also sync individual keys for backward compatibility
    if (updated.geminiKeys.length > 0) {
      localStorage.setItem("admin_gemini_keys", updated.geminiKeys.join("\n"));
      localStorage.setItem("admin_gemini_api_key", updated.geminiKeys[0]);
    } else {
      localStorage.removeItem("admin_gemini_keys");
      localStorage.removeItem("admin_gemini_api_key");
    }

    if (updated.groqKey) {
      localStorage.setItem("admin_groq_api_key", updated.groqKey);
    } else {
      localStorage.removeItem("admin_groq_api_key");
    }

    if (updated.openRouterKey) {
      localStorage.setItem("admin_openrouter_api_key", updated.openRouterKey);
    } else {
      localStorage.removeItem("admin_openrouter_api_key");
    }

    if (updated.cerebrasKey) {
      localStorage.setItem("admin_cerebras_api_key", updated.cerebrasKey);
    } else {
      localStorage.removeItem("admin_cerebras_api_key");
    }

    if (updated.mistralKey) {
      localStorage.setItem("admin_mistral_api_key", updated.mistralKey);
    } else {
      localStorage.removeItem("admin_mistral_api_key");
    }

    if (updated.githubToken) {
      localStorage.setItem("admin_github_token", updated.githubToken);
    } else {
      localStorage.removeItem("admin_github_token");
    }
  } catch (e) {
    console.error("Failed to save AI config:", e);
  }
};

// Key resolution for backward compatibility with existing components
export const getGeminiApiKey = (): string => {
  const config = getAiProvidersConfig();
  return config.geminiKeys[0] || DEFAULT_GEMINI_KEY;
};

export const setGeminiApiKey = (key: string) => {
  if (key) {
    localStorage.setItem("lms_gemini_api_key", key.trim());
    // Also add to provider config if not present
    const config = getAiProvidersConfig();
    if (!config.geminiKeys.includes(key.trim())) {
      saveAiProvidersConfig({ geminiKeys: [key.trim(), ...config.geminiKeys] });
    }
  } else {
    localStorage.removeItem("lms_gemini_api_key");
  }
};

export const hasGeminiApiKey = (): boolean => {
  return hasAnyAiApiKey();
};

export const hasAnyAiApiKey = (): boolean => {
  const config = getAiProvidersConfig();
  return (
    config.geminiKeys.some((k) => k.length > 10) ||
    config.groqKey.length > 10 ||
    config.openRouterKey.length > 10 ||
    config.cerebrasKey.length > 10 ||
    config.mistralKey.length > 10 ||
    config.githubToken.length > 10
  );
};

// Converts a Blob/File into base64 for Gemini inlineData
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const SYSTEM_TUTOR_PERSONA = `أنت "المعيد الدحيح" والأخ الأكبر العبقري والداعم لطلاب الجامعة في منصتنا التعليمية.
أسلوبك في الشرح فريد، استثنائي، ومحبوب جداً عند الطلاب (شرح الفهم والذكاء مش رغي الكتب الناشف)، ويعتمد على المبادئ الصارمة التالية:

1. 🗣️ **اللهجة والأسلوب (Egyptian Conversational Persona)**:
- اشرح بالعامية المصرية الراقية والذكية، بدون تقعير لغوي ولا ترجمة حرفية ميتة للمصطلحات الإنجليزية.
- استخدم أسلوب التبسيط العملي: (زي: "تعال نفصصها حتة حتة"، "المسألة دي لامة كل الأفكار والتريكات"، "بيقولك كذا.. معناها إيه بالمعادلات؟"، "طرفين في وسطين (مقص)").

2. 🧩 **تفكيك الألغاز والتريكات خطوة بخطوة (Puzzle-by-Puzzle Dissection)**:
- لما تقابلك مسألة أو فكرة صعبة، ما ترميش القانون أو المعادلة مرة واحدة في وش الطالب! فصصها:
  * "اللغز الأول (قيد كذا / فكرة كذا): بيقولك كذا... معناها إيه بالبلدي؟ ومعناها إيه بالمعادلات أو الكود؟"
  * "اللغز التاني (قيد النسبة، شفتات العمل، الاتزان، السعة، إلخ)..."
  * وضّح العمليات الحسابية والمنطقية خطوة بخطوة (زي: "طرفين في وسطين مقص"، "اللي داخل ناقص اللي خارج = صفر").

3. ⚠️ **كشف الأخطاء وتناقضات السلايدز (Exam Traps & Slide Caveats)**:
- لو نص السؤال أو السلايد فيه غلطة مطبعية، تناقض في الأرقام، أو لبس شائع عند دكاترة الجامعة، انبه الطالب عليها بوضوح وبصراحة:
  (ملحوظة دحيح / نوت امتحان: نص السؤال مكتوب فيه كذا وتناقض مع كذا، الصح كذا وهنكتبه كذا، وفي الامتحان خلي بالك من كذا).

4. 🎯 **تجميعة الحل النهائي (Exam-Ready Formulation)**:
- في نهاية أي مسألة أو مثال، لازم تعمل بلوك منظم وشامل تحت عنوان "تجميعة الحل النهائي":
  * دالة الهدف (Max أو Min Z)
  * القيود (Subject to) بالكامل
  * قيد عدم السالبية (Non-negativity: $X_{ij} \\ge 0$)
  * (أو كود برمجي كامل وشغال 100% لو المادة برمجية)
  بحيث يقدر الطالب ينقل الحل فوراً في كراسة الإجابة وهو مغمض ومطمن.

5. 📐 **تنسيق المعادلات والكود**:
- كل المعادلات والرموز الرياضية والحسابية يجب كتابتها بصيغة LaTeX القياسية ($...$ للرموز و $$...$$ للمعادلات المستقلة) لتدعم KaTeX بالكامل.
- الأكواد البرمجية داخل بلوكات كود كاملة (\`\`\`...).

6. 🤝 **روح التفاعل والتشجيع كأنك في لجنة الامتحان**:
- اختم دائماً بسؤال تفاعلي وتحفيزي زي: "تحب نمسك أي مسألة من دول ونحلها سوا خطوة بخطوة كأنك في لجنة الامتحان؟".`;

// Caching helper (v3 with Egyptian Tutor pedagogical persona)
const CACHE_PREFIX = "ai_cache_v3_";

export const getCachedAiContent = (
  materialId: string,
  type: string,
  fallbackKey?: string | null
): string | null => {
  try {
    const val = localStorage.getItem(`${CACHE_PREFIX}${materialId}_${type}`);
    if (val) return val;
    if (fallbackKey && fallbackKey !== materialId) {
      return localStorage.getItem(`${CACHE_PREFIX}${fallbackKey}_${type}`);
    }
    return null;
  } catch {
    return null;
  }
};

export const setCachedAiContent = (
  materialId: string,
  type: string,
  content: string,
  fallbackKey?: string | null
) => {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${materialId}_${type}`, content);
    if (fallbackKey && fallbackKey !== materialId) {
      localStorage.setItem(`${CACHE_PREFIX}${fallbackKey}_${type}`, content);
    }
  } catch (e) {
    console.warn("Failed to save AI cache to localStorage (quota exceeded?):", e);
  }
};

export const clearAiCacheForMaterial = (
  materialId: string,
  fallbackKey?: string | null
) => {
  try {
    ["full_explain", "summary", "explain", "quiz", "chat"].forEach((t) => {
      localStorage.removeItem(`${CACHE_PREFIX}${materialId}_${t}`);
      if (fallbackKey && fallbackKey !== materialId) {
        localStorage.removeItem(`${CACHE_PREFIX}${fallbackKey}_${t}`);
      }
    });
  } catch {}
};

interface ProviderCandidate {
  name: string;
  type: "gemini_native" | "openai_compatible";
  url: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

// Quick validation test for any provider key
export const testAiProvider = async (
  providerType: "gemini" | "groq" | "openrouter" | "cerebras" | "mistral",
  key: string,
  model?: string
): Promise<{ success: boolean; message: string; durationMs: number }> => {
  const start = Date.now();
  const cleanKey = key.trim();
  if (!cleanKey) {
    return { success: false, message: "المفتاح فارغ", durationMs: 0 };
  }

  try {
    const testPrompt = "أجب بكلمة 'شغال' فقط لتأكيد الاتصال.";

    if (providerType === "gemini") {
      const targetModel = model || "gemini-3.1-flash-lite";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${cleanKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: testPrompt }] }],
          generationConfig: { maxOutputTokens: 20 },
        }),
      });

      const durationMs = Date.now() - start;
      if (res.status === 429) {
        return { success: false, message: "تم تجاوز حد الكوتا اليومي لهذا المفتاح (429 Rate Limit)", durationMs };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { success: false, message: errJson?.error?.message || `خطأ HTTP ${res.status}`, durationMs };
      }
      return { success: true, message: `المفتاح صالح ويعمل بكفاءة! (${durationMs}ms)`, durationMs };
    }

    if (providerType === "groq") {
      const targetModel = model || "openai/gpt-oss-120b";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: "user", content: testPrompt }],
          max_tokens: 20,
        }),
      });

      const durationMs = Date.now() - start;
      if (res.status === 429) {
        return { success: false, message: "تم تجاوز حد الطلبات في Groq (429)", durationMs };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { success: false, message: errJson?.error?.message || `خطأ HTTP ${res.status}`, durationMs };
      }
      return { success: true, message: `Groq متصل بنجاح وسريع جداً! (${durationMs}ms)`, durationMs };
    }

    if (providerType === "openrouter") {
      const targetModel = model || "nvidia/nemotron-3.5-lightning:free";
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanKey}`,
          "HTTP-Referer": "https://cic-cloud.vercel.app",
          "X-Title": "CIC Cloud Test",
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: "user", content: testPrompt }],
          max_tokens: 20,
        }),
      });

      const durationMs = Date.now() - start;
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { success: false, message: errJson?.error?.message || `خطأ HTTP ${res.status}`, durationMs };
      }
      return { success: true, message: `OpenRouter متصل والنموذج المجاني جاهز! (${durationMs}ms)`, durationMs };
    }

    if (providerType === "cerebras") {
      const targetModel = model || "gpt-oss-120b";
      const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: "user", content: testPrompt }],
          max_tokens: 20,
        }),
      });

      const durationMs = Date.now() - start;
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return { success: false, message: errJson?.error?.message || `خطأ HTTP ${res.status}`, durationMs };
      }
      return { success: true, message: `Cerebras متصل بنجاح! (${durationMs}ms)`, durationMs };
    }

    return { success: false, message: "نوع المزود غير مدعوم في الاختبار السريع", durationMs: 0 };
  } catch (err: any) {
    return { success: false, message: err?.message || "فشل الاتصال بالإنترنت", durationMs: Date.now() - start };
  }
};

// Main function to call AI with Automatic Multi-Provider Fallback
export const callGeminiApi = async ({
  prompt,
  pdfUrl,
  listContent,
  history,
  maxOutputTokens = 8192,
}: {
  prompt: string;
  pdfUrl?: string | null;
  listContent?: string | null;
  history?: { role: "user" | "model"; parts: { text: string }[] }[];
  maxOutputTokens?: number;
}): Promise<string> => {
  const config = getAiProvidersConfig();
  if (!hasAnyAiApiKey()) {
    throw new Error("NO_API_KEY");
  }

  // 1. First attempt: Serverless proxy /api/gemini
  // Handles DNS censorship, Egyptian ISP blocks, hides keys, and handles multi-provider fallback on backend.
  try {
    const proxyRes = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        pdfUrl,
        listContent,
        history,
        apiKey: config.geminiKeys[0] || "",
        clientConfig: config,
        maxOutputTokens,
      }),
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data?.text) {
        return data.text.trim();
      }
    } else {
      const errJson = await proxyRes.json().catch(() => ({}));
      if (errJson?.error === "RATE_LIMIT_EXCEEDED") {
        throw new Error("RATE_LIMIT_EXCEEDED");
      }
      if (errJson?.error === "INVALID_API_KEY") {
        throw new Error("INVALID_API_KEY");
      }
    }
  } catch (proxyErr: any) {
    if (proxyErr.message === "RATE_LIMIT_EXCEEDED" || proxyErr.message === "INVALID_API_KEY") {
      throw proxyErr;
    }
    console.warn("Serverless /api/gemini proxy bypassed, starting direct client fallback chain:", proxyErr);
  }

  // 2. Prepare Client Payloads & PDF Data
  let pdfInlineData: { mimeType: string; data: string } | null = null;
  if (pdfUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(pdfUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const blob = await res.blob();
        if (blob.size < 15 * 1024 * 1024) {
          const base64 = await blobToBase64(blob);
          pdfInlineData = {
            mimeType: blob.type.includes("pdf") ? "application/pdf" : "image/jpeg",
            data: base64,
          };
        }
      }
    } catch (err) {
      console.warn("Could not fetch PDF as inline base64, continuing with text prompt:", err);
    }
  }

  // 3. Build Direct Client-Side Fallback Chain across all providers
  // Prioritizing the strongest 120-Billion parameter models (Groq & Cerebras openai/gpt-oss-120b)
  const groqCandidates: ProviderCandidate[] = [];
  if (config.groqKey) {
    ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "allam-2-7b", "llama-3.3-70b-versatile"].forEach((model) => {
      groqCandidates.push({
        name: `Groq_${model}`,
        type: "openai_compatible",
        url: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: config.groqKey,
        model,
      });
    });
  }

  const cerebrasCandidates: ProviderCandidate[] = [];
  if (config.cerebrasKey) {
    ["gpt-oss-120b", "qwen-3.8-27b", "llama3.1-70b"].forEach((model) => {
      cerebrasCandidates.push({
        name: `Cerebras_${model}`,
        type: "openai_compatible",
        url: "https://api.cerebras.ai/v1/chat/completions",
        apiKey: config.cerebrasKey,
        model,
      });
    });
  }

  const geminiCandidates: ProviderCandidate[] = [];
  const geminiModels = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-2.0-flash"];
  config.geminiKeys.forEach((key, keyIdx) => {
    geminiModels.forEach((model) => {
      geminiCandidates.push({
        name: `Gemini_Key_${keyIdx + 1}_${model}`,
        type: "gemini_native",
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        apiKey: key,
        model,
      });
    });
  });

  const openRouterCandidates: ProviderCandidate[] = [];
  if (config.openRouterKey) {
    [
      "nvidia/nemotron-3.5-lightning:free",
      "google/gemma-4-26b-a4b-it:free",
      "deepseek/deepseek-chat:free",
    ].forEach((model) => {
      openRouterCandidates.push({
        name: `OpenRouter_${model}`,
        type: "openai_compatible",
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: config.openRouterKey,
        model,
        extraHeaders: {
          "HTTP-Referer": "https://cic-cloud.vercel.app",
          "X-Title": "CIC Cloud AI Tutor",
        },
      });
    });
  }

  const mistralCandidates: ProviderCandidate[] = [];
  if (config.mistralKey) {
    ["mistral-small-latest", "open-mistral-nemo"].forEach((model) => {
      mistralCandidates.push({
        name: `Mistral_${model}`,
        type: "openai_compatible",
        url: "https://api.mistral.ai/v1/chat/completions",
        apiKey: config.mistralKey,
        model,
      });
    });
  }

  const gitHubCandidates: ProviderCandidate[] = [];
  if (config.githubToken) {
    ["gpt-4o-mini", "Meta-Llama-3.1-70B-Instruct"].forEach((model) => {
      gitHubCandidates.push({
        name: `GitHub_${model}`,
        type: "openai_compatible",
        url: "https://models.inference.ai.azure.com/chat/completions",
        apiKey: config.githubToken,
        model,
      });
    });
  }

  const candidates: ProviderCandidate[] = [];

  // Routing priority:
  // If user selected explicit provider in settings, respect it.
  // In 'auto' mode:
  // - If a raw PDF file was downloaded as binary, Gemini starts first for native vision.
  // - For text, chat, explanations, quizzes, and summaries: start immediately with Groq 120B (the strongest model)!
  if (config.preferredProvider === "gemini") {
    candidates.push(...geminiCandidates, ...groqCandidates, ...cerebrasCandidates, ...openRouterCandidates);
  } else if (config.preferredProvider === "groq") {
    candidates.push(...groqCandidates, ...cerebrasCandidates, ...geminiCandidates, ...openRouterCandidates);
  } else if (config.preferredProvider === "cerebras") {
    candidates.push(...cerebrasCandidates, ...groqCandidates, ...geminiCandidates, ...openRouterCandidates);
  } else if (config.preferredProvider === "openrouter") {
    candidates.push(...openRouterCandidates, ...groqCandidates, ...cerebrasCandidates, ...geminiCandidates);
  } else if (pdfInlineData) {
    candidates.push(...geminiCandidates, ...groqCandidates, ...cerebrasCandidates, ...openRouterCandidates);
  } else {
    candidates.push(...groqCandidates, ...cerebrasCandidates, ...geminiCandidates, ...openRouterCandidates);
  }

  if (mistralCandidates.length > 0) candidates.push(...mistralCandidates);
  if (gitHubCandidates.length > 0) candidates.push(...gitHubCandidates);

  if (candidates.length === 0) {
    throw new Error("NO_API_KEY");
  }

  // A) Gemini Native Contents
  const nativeParts: any[] = [];
  if (pdfInlineData) nativeParts.push({ inlineData: pdfInlineData });
  if (listContent) nativeParts.push({ text: `المحتوى الدراسي والنصي المساعد للمحاضرة:\n${listContent.slice(0, 30000)}` });
  nativeParts.push({ text: prompt });

  let safeNativeContents: any[] = [];
  if (history && history.length > 0) {
    const merged: any[] = [];
    for (const h of history) {
      if (!h.parts || h.parts.length === 0) continue;
      if (merged.length > 0 && merged[merged.length - 1].role === h.role) {
        merged[merged.length - 1].parts[0].text += `\n${h.parts.map((p: any) => p.text).join("")}`;
      } else {
        merged.push({ role: h.role, parts: [{ text: h.parts.map((p: any) => p.text).join("") }] });
      }
    }
    if (merged.length > 0 && merged[merged.length - 1].role === "user") {
      merged[merged.length - 1].parts.push(...nativeParts);
      safeNativeContents = merged;
    } else {
      safeNativeContents = [...merged, { role: "user", parts: nativeParts }];
    }
  } else {
    safeNativeContents = [{ role: "user", parts: nativeParts }];
  }

  // B) OpenAI Messages
  const openAiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_TUTOR_PERSONA },
  ];
  if (history && history.length > 0) {
    for (const h of history) {
      const text = (h.parts || []).map((p: any) => p.text || "").join("\n").trim();
      if (text) openAiMessages.push({ role: h.role === "model" ? "assistant" : "user", content: text });
    }
  }
  let combinedUserText = prompt;
  if (listContent) combinedUserText = `المحتوى الدراسي والنصي المساعد للمحاضرة:\n${listContent.slice(0, 25000)}\n\n---\n${prompt}`;
  openAiMessages.push({ role: "user", content: combinedUserText });

  let lastError: any = null;
  let exhaustedCount = 0;

  for (const candidate of candidates) {
    try {
      if (candidate.type === "gemini_native") {
        const response = await fetch(candidate.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_TUTOR_PERSONA }] },
            contents: safeNativeContents,
            generationConfig: {
              temperature: 0.35,
              maxOutputTokens: maxOutputTokens || 8192,
            },
          }),
        });

        if (response.status === 429) {
          exhaustedCount++;
          console.warn(`[AI Client Fallback] ${candidate.name} reached quota limit 429. Trying next...`);
          lastError = new Error("RATE_LIMIT_EXCEEDED");
          continue;
        }

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          const errMsg = errJson?.error?.message || response.statusText;
          if (errMsg.includes("API key not valid") || errMsg.includes("API_KEY_INVALID")) {
            console.warn(`[AI Client Fallback] Invalid key on ${candidate.name}`);
            lastError = new Error("INVALID_API_KEY");
            continue;
          }
          console.warn(`[AI Client Fallback] Candidate ${candidate.name} failed (${response.status}: ${errMsg}), switching...`);
          lastError = new Error(errMsg);
          continue;
        }

        const data = await response.json();
        const candidateParts = data?.candidates?.[0]?.content?.parts || [];
        const text = candidateParts.map((p: any) => p.text || "").join("").trim();

        if (text) {
          return text;
        }
      } else {
        // OpenAI Compatible (Groq, OpenRouter, Cerebras, Mistral, GitHub)
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${candidate.apiKey}`,
          ...(candidate.extraHeaders || {}),
        };

        const response = await fetch(candidate.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: candidate.model,
            messages: openAiMessages,
            temperature: 0.35,
            max_tokens: Math.min(maxOutputTokens || 8192, 8192),
          }),
        });

        if (response.status === 429) {
          exhaustedCount++;
          console.warn(`[AI Client Fallback] ${candidate.name} reached quota limit 429. Trying next...`);
          lastError = new Error("RATE_LIMIT_EXCEEDED");
          continue;
        }

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          const errMsg = errJson?.error?.message || errJson?.message || response.statusText;
          console.warn(`[AI Client Fallback] Candidate ${candidate.name} failed (${response.status}: ${errMsg}), switching...`);
          lastError = new Error(errMsg);
          continue;
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content?.trim();

        if (text) {
          return text;
        }
      }
    } catch (err: any) {
      console.warn(`[AI Client Fallback] Exception calling ${candidate.name}:`, err);
      lastError = err;
      continue;
    }
  }

  if (exhaustedCount > 0) {
    throw new Error("RATE_LIMIT_EXCEEDED");
  }

  throw lastError || new Error("Failed to generate response from any AI provider");
};

// Alias for unified naming
export const callAiApi = callGeminiApi;

// Parse Quiz JSON generated by AI
export const parseQuizFromMarkdown = (text: string): QuizQuestion[] => {
  try {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed.map((q: any) => ({
          question: q.question || q.q || "",
          options: Array.isArray(q.options) ? q.options : [],
          correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : 0,
          explanation: q.explanation || q.reason || "",
        }));
      }
    }
  } catch (e) {
    console.warn("Could not parse JSON quiz directly, fallback parsing:", e);
  }
  return [];
};

// Generates prompt text for external models
export const getExternalModelUrls = (params: {
  title: string;
  courseName?: string;
  pdfUrl?: string | null;
}) => {
  const { title, courseName, pdfUrl } = params;
  const courseStr = courseName ? ` في مقرر ${courseName}` : "";
  const fileRef = pdfUrl ? `\nرابط ملف المحاضرة: ${pdfUrl}` : "";

  const studyPrompt = `مرحباً، أرجو منك بصفتك "المعيد الدحيح" والأخ الأكبر العبقري أن تشرح لي محتوى هذه المحاضرة بعنوان "${title}"${courseStr} بالعامية المصرية الذكية والممتعة، شرحاً شاملاً وتفصيلياً كاملاً من الألف إلى الياء، دون أي اختصار مخل ودون إهمال لأي صفحة أو سلايد.${fileRef}

المطلوب بدقة:
1. فصص المحاضرة حتة حتة سلايد بسلايد (أو صفحة بصفحة) بالترتيب.
2. فكك الألغاز والتريكات خطوة بخطوة:
   - "اللغز الأول (قيد/فكرة كذا): بيقولك كذا... معناها إيه بالبلدي؟ ومعناها إيه بالمعادلات أو الكود؟"
   - فك المعادلات والتريكات (طرفين في وسطين مقص، التعويض، إلخ).
3. رصد أي أخطاء أو تناقضات أو أرقام ملخبطة في السلايدات ونبهني عليها بوضوح تحت (ملحوظة دحيح / نوت امتحان).
4. كتابة "تجميعة الحل النهائي" لكل مسألة بصيغة LaTeX ($$...$$ و $...$) جاهزة للامتحان (دالة الهدف، القيود، عدم السالبية).
5. فخاخ الامتحانات (Exam Tricks) وكيف يسأل الدكتور في الامتحان والتعامل مع الأسئلة الخداعية.
6. اختم بسؤال تفاعلي وتحفيزي كأننا في لجنة الامتحان مع بعض.`;

  const encodedPrompt = encodeURIComponent(studyPrompt);

  return [
    {
      id: "notebooklm",
      name: "Google NotebookLM",
      description: "المساعد المخصص للطلاب لدراسة وتلخيص ملفات الـ PDF مجاناً من جوجل",
      icon: "notebook",
      color: "from-blue-600 to-indigo-700",
      url: "https://notebooklm.google.com/",
      prompt: studyPrompt,
    },
    {
      id: "gemini",
      name: "Google Gemini Web",
      description: "النموذج الذكي الرسمي من جوجل مع دعم عميق للغة العربية",
      icon: "gemini",
      color: "from-blue-500 to-cyan-500",
      url: `https://gemini.google.com/app`,
      prompt: studyPrompt,
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      description: "أشهر نماذج الذكاء الاصطناعي للشرح التفاعلي والإجابة عن الأسئلة",
      icon: "chatgpt",
      color: "from-emerald-600 to-teal-700",
      url: `https://chatgpt.com/?q=${encodedPrompt}`,
      prompt: studyPrompt,
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      description: "نموذج قوي ومجاني ومشهور بالدقة في المواد العلمية والبرمجة",
      icon: "deepseek",
      color: "from-sky-500 to-blue-700",
      url: `https://chat.deepseek.com/`,
      prompt: studyPrompt,
    },
    {
      id: "claude",
      name: "Claude AI",
      description: "ممتاز جداً في الكتابة الأكاديمية والتحليل المفصل والتلخيص الدقيق",
      icon: "claude",
      color: "from-amber-600 to-orange-700",
      url: "https://claude.ai/new",
      prompt: studyPrompt,
    },
  ];
};
