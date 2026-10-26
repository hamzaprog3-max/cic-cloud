// Gemini AI Service for Lecture Explanations, Summaries, Quizzes, and External Models Routing
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
}

export const DEFAULT_GEMINI_KEY = atob("QVEuQWI4Uk42THhwUVo2UmR5NVp3ZWVFWUJmNm5RS0J0TWdYeTlGRXd4cG8yTVNvcTRBdFE=");

// Key resolution: LocalStorage user override -> Admin saved key -> Vite env -> Default working key
export const getGeminiApiKey = (): string => {
  return (
    localStorage.getItem("lms_gemini_api_key") ||
    localStorage.getItem("admin_gemini_api_key") ||
    (import.meta.env.VITE_GEMINI_API_KEY as string) ||
    DEFAULT_GEMINI_KEY
  ).trim();
};

export const setGeminiApiKey = (key: string) => {
  if (key) {
    localStorage.setItem("lms_gemini_api_key", key.trim());
  } else {
    localStorage.removeItem("lms_gemini_api_key");
  }
};

export const hasGeminiApiKey = (): boolean => {
  return getGeminiApiKey().length > 10;
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
  * قيد عدم السالبية (Non-negativity: $X_{ij} \ge 0$)
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

// Main function to call Gemini API
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
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("NO_API_KEY");
  }

  // 1. First attempt: Use the serverless proxy /api/gemini
  // This bypasses ISP DNS censorship, Egyptian network filters, and client CORS limitations.
  try {
    const proxyRes = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        pdfUrl,
        listContent,
        history,
        apiKey,
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
    console.warn("Serverless /api/gemini not available or failed, falling back to direct fetch:", proxyErr);
  }

  // 2. Fallback: Direct client fetch to generativelanguage.googleapis.com
  const models = [
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
    "gemini-2.5-pro",
    "gemini-pro-latest",
  ];

  let lastError: any = null;

  // Prepare contents parts
  const parts: any[] = [];

  // Try to load PDF as inlineData if available and size < 15MB
  if (pdfUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(pdfUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const blob = await res.blob();
        if (blob.size < 15 * 1024 * 1024) {
          const base64 = await blobToBase64(blob);
          parts.push({
            inlineData: {
              mimeType: blob.type.includes("pdf") ? "application/pdf" : "image/jpeg",
              data: base64,
            },
          });
        }
      }
    } catch (err) {
      console.warn("Could not fetch PDF as inline base64, continuing with text prompt:", err);
    }
  }

  if (listContent) {
    parts.push({
      text: `المحتوى الدراسي والنصي المساعد للمحاضرة:\n${listContent.slice(0, 30000)}`,
    });
  }

  // Add the prompt text
  parts.push({ text: prompt });

  // Normalize history so consecutive user/model roles are merged properly
  let safeContents: any[] = [];
  if (history && history.length > 0) {
    const merged: any[] = [];
    for (const h of history) {
      if (!h.parts || h.parts.length === 0) continue;
      if (merged.length > 0 && merged[merged.length - 1].role === h.role) {
        merged[merged.length - 1].parts[0].text += `\n${h.parts.map((p: any) => p.text).join('')}`;
      } else {
        merged.push({ role: h.role, parts: [{ text: h.parts.map((p: any) => p.text).join('') }] });
      }
    }
    if (merged.length > 0 && merged[merged.length - 1].role === "user") {
      merged[merged.length - 1].parts.push(...parts);
      safeContents = merged;
    } else {
      safeContents = [...merged, { role: "user", parts }];
    }
  } else {
    safeContents = [{ role: "user", parts }];
  }

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const requestBody: any = {
        systemInstruction: {
          parts: [{ text: SYSTEM_TUTOR_PERSONA }],
        },
        contents: safeContents,
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: maxOutputTokens || 8192,
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (response.status === 429) {
        throw new Error("RATE_LIMIT_EXCEEDED");
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || response.statusText;
        if (errMsg.includes("API key not valid") || errMsg.includes("API_KEY_INVALID")) {
          throw new Error("INVALID_API_KEY");
        }
        if (response.status === 404 || errMsg.includes("not found") || errMsg.includes("no longer available")) {
          console.warn(`Model ${model} not available (${errMsg}), trying next model...`);
          lastError = new Error(errMsg);
          continue;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      const candidateParts = data?.candidates?.[0]?.content?.parts || [];
      const text = candidateParts.map((p: any) => p.text || "").join("").trim();
      
      if (!text) {
        throw new Error("EMPTY_RESPONSE");
      }

      return text;
    } catch (err: any) {
      lastError = err;
      if (err.message === "RATE_LIMIT_EXCEEDED" || err.message === "INVALID_API_KEY") {
        throw err;
      }
      console.warn(`Gemini model ${model} failed, trying next:`, err);
    }
  }

  throw lastError || new Error("Failed to generate response from Gemini API");
};

// Parse Quiz JSON generated by Gemini
export const parseQuizFromMarkdown = (text: string): QuizQuestion[] => {
  try {
    // Look for ```json ... ``` block
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
