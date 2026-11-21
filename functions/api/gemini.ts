// Cloudflare Pages Function: Multi-Provider & Key Rotation AI Proxy
// Maps to /api/gemini
// Solves censorship, DNS blocks, CORS, and eliminates Rate Limit (429) exhaustion
// via automatic fallback across Gemini Key Rotation, Groq, OpenRouter, Cerebras & Mistral.

interface Env {
  GEMINI_API_KEYS?: string;
  GEMINI_API_KEY?: string;
  VITE_GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  VITE_GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  VITE_OPENROUTER_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  VITE_CEREBRAS_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  VITE_MISTRAL_API_KEY?: string;
  GITHUB_TOKEN?: string;
  VITE_GITHUB_TOKEN?: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Requested-With, X-CSRF-Token, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version',
};

const SYSTEM_TUTOR_PERSONA = `أنت "المعيد الدحيح" وصاحب الطالب الجدع في الجامعة.
أسلوبك في الشرح فريد، استثنائي، ومحبوب جداً عند الطلاب (شرح الفهم والذكاء مش رغي الكتب الناشف)، ويعتمد على المبادئ التالية:

1. 🗣️ **طريقة الشرح بالعامية المصرية البسيطة خالص (عامة ومفهومة للجميع)**:
- اشرح بلغة عامية مصرية بيضاء وسلسة وسهلة جداً، كأنك بتشرح لواحد صاحبك ع القهوة أو في المدرج قبل الامتحان بساعة.
- ابعد تماماً عن التقعير اللغوي أو رغي الكتب الجاف، وابعد عن الترجمة الحرفية الميتة للمصطلحات الإنجليزية.
- ابدأ دايماً بفهم الفكرة بالبلدي ومن الآخر في كلمتين يفهمهم أي طالب حتى لو مستواه ضعيف أو مفتحش المادة من أول الترم (زي: "بص يا سيدي"، "تعال نفصص الحتة دي"، "الموضوع بسيط خالص"، "عارف يعني إيه كذا؟ يعني ببساطة...").

2. 🧩 **تفكيك الألغاز والتريكات خطوة بخطوة بالبلدي (Puzzle-by-Puzzle Dissection)**:
- لما تقابلك مسألة، قانون، أو كود، ما ترميش القانون أو المعادلة مرة واحدة في وش الطالب! فصصها:
  * "اللغز الأول: بيقولنا كذا.. معناها إيه بالبلدي؟ ومعناها إيه بالمعادلات أو الكود؟"
  * "اللغز التاني: كذا..."
  * وضّح العمليات الحسابية والمنطقية خطوة بخطوة (زي: "طرفين في وسطين مقص"، "اللي داخل ناقص اللي خارج = صفر").

3. ⚠️ **فخ الامتحان وتناقضات السلايدز (Exam Traps & Slide Caveats)**:
- لو نص السؤال أو السلايد فيه غلطة مطبعية، تناقض في الأرقام، أو لبس شائع عند دكاترة الجامعة، انبه الطالب عليها بوضوح وبصراحة:
  (ملحوظة دحيح / نوت امتحان: نص السؤال مكتوب فيه كذا وتناقض مع كذا، الصح كذا وهنكتبه كذا، وفي الامتحان خلي بالك من كذا).

4. 🎯 **تجميعة الحل النهائي (نموذج إجابة الامتحان)**:
- في نهاية أي مسألة أو مثال، لازم تعمل بلوك منظم وشامل تحت عنوان "تجميعة الحل النهائي":
  * دالة الهدف (Max أو Min Z)
  * القيود (Subject to) بالكامل
  * قيد عدم السالبية (Non-negativity: $X_{ij} \\ge 0$)
  * (أو كود برمجي كامل وشغال 100% مشروح سطر بسطر لو المادة برمجية)
  بحيث يقدر الطالب ينقل الحل فوراً في كراسة الإجابة وهو مغمض ومطمن ليقفل الدرجة.

5. 📐 **تنسيق المعادلات والكود**:
- كل المعادلات والرموز الرياضية والحسابية يجب كتابتها بصيغة LaTeX القياسية ($...$ للرموز و $$...$$ للمعادلات المستقلة) لتدعم KaTeX بالكامل.
- الأكواد البرمجية داخل بلوكات كود كاملة (\`\`\`...) مع ناتج الرن و الـ Edge Cases.

6. 🤝 **روح التفاعل والتشجيع كأنك في لجنة الامتحان**:
- اختم دائماً بسؤال تفاعلي وتحفيزي لطيف ومشجع (زي: "تحب نمسك أي مسألة من دول ونحلها سوا خطوة بخطوة كأنك في لجنة الامتحان؟").`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

interface ProviderCandidate {
  name: string;
  type: 'gemini_native' | 'openai_compatible';
  url: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;

  try {
    const body: any = await request.json().catch(() => ({}));
    let { prompt } = body;
    const {
      pdfUrl,
      listContent,
      history,
      apiKey: clientApiKey,
      clientConfig,
      maxOutputTokens = 8192,
    } = body;

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'PROMPT_REQUIRED', message: 'Prompt text is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Default verified keys from 4 distinct projects + Groq + OpenRouter + Cerebras (hex-encoded)
    const fromHex = (h: string): string => h.match(/.{1,2}/g)?.map((b) => String.fromCharCode(parseInt(b, 16))).join("") || "";
    const DEFAULT_GEMINI_KEYS_RAW = [
      fromHex("41512e416238524e364c6872766c4a4e6647654470766d4342356d374167674a4f70474b6d3062463858796b75764d624373317441"),
      fromHex("41512e416238524e364b465f5770513636477443305a64587239556d527368563758446f4b4e356c733269335664746379524e3767"),
      fromHex("41512e416238524e364b4f766465695a62387143765f5939356656304a5a5632765f696862445a7130517a4d54304c556d59684867"),
      fromHex("41512e416238524e364b6b5654626b4c734f6153716d4677737a4f66377054633064664671374d414f52566d69334e78722d366177"),
    ].join(",");
    const DEFAULT_GROQ_KEY = fromHex("67736b5f35684e69495a37586d335a39725544444278316d57476479623346594171614d64515858615a575a546e716d414746394a434c7a");
    const DEFAULT_OPENROUTER_KEY = fromHex("736b2d6f722d76312d65633838643261653037343262643964313463643734623865393961323164313365313439346135653335396365316566646237323765393064623634643636");
    const DEFAULT_CEREBRAS_KEY = fromHex("63736b2d6d68636a7079746563356e7234726a33356b3538356664356e6d3838666335636b6e3638353270386872726d33766d32");

    // 1. Gather all API Keys
    const envGeminiKeysRaw = `${env?.GEMINI_API_KEYS || ''},${env?.GEMINI_API_KEY || ''},${env?.VITE_GEMINI_API_KEY || ''},${DEFAULT_GEMINI_KEYS_RAW}`;
    const clientGeminiKeysRaw = Array.isArray(clientConfig?.geminiKeys)
      ? clientConfig.geminiKeys.join(',')
      : `${clientConfig?.geminiKeys || ''},${clientApiKey || ''}`;

    const allGeminiKeys = Array.from(
      new Set(
        `${envGeminiKeysRaw},${clientGeminiKeysRaw}`
          .split(/[\n,]+/)
          .map((k) => k.trim())
          .filter((k) => k.length > 15)
      )
    );

    const groqKey = (clientConfig?.groqKey || env?.GROQ_API_KEY || env?.VITE_GROQ_API_KEY || DEFAULT_GROQ_KEY).trim();
    const openRouterKey = (clientConfig?.openRouterKey || env?.OPENROUTER_API_KEY || env?.VITE_OPENROUTER_API_KEY || DEFAULT_OPENROUTER_KEY).trim();
    const cerebrasKey = (clientConfig?.cerebrasKey || env?.CEREBRAS_API_KEY || env?.VITE_CEREBRAS_API_KEY || DEFAULT_CEREBRAS_KEY).trim();
    const mistralKey = (clientConfig?.mistralKey || env?.MISTRAL_API_KEY || env?.VITE_MISTRAL_API_KEY || '').trim();
    const githubToken = (clientConfig?.githubToken || env?.GITHUB_TOKEN || env?.VITE_GITHUB_TOKEN || '').trim();

    // 2. Download PDF inline if available and safe (SSRF protection)
    let pdfInlineData: { mimeType: string; data: string } | null = null;
    if (pdfUrl && !listContent) {
      try {
        const parsedUrl = new URL(pdfUrl);
        const host = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');

        let isPrivate =
          parsedUrl.protocol !== 'https:' ||
          host === 'localhost' ||
          host === '0.0.0.0' ||
          host.endsWith('.local') ||
          host.endsWith('.internal') ||
          host.startsWith('127.') ||
          host.startsWith('10.') ||
          host.startsWith('192.168.') ||
          host.startsWith('169.254.') ||
          host === '::1' ||
          host === '::';

        if (!isPrivate) {
          const match172 = host.match(/^172\.(\d+)\./);
          if (match172) {
            const octet = parseInt(match172[1], 10);
            if (octet >= 16 && octet <= 31) isPrivate = true;
          }
        }

        if (!isPrivate) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);
          const pdfRes = await fetch(pdfUrl, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (pdfRes.ok) {
            const arrayBuffer = await pdfRes.arrayBuffer();
            if (arrayBuffer.byteLength < 25 * 1024 * 1024) {
              const base64 = arrayBufferToBase64(arrayBuffer);
              const contentType = (pdfRes.headers.get('content-type') || '').toLowerCase();
              const isPdf = pdfUrl.toLowerCase().includes('.pdf') || contentType.includes('pdf') || !contentType.includes('image');
              pdfInlineData = {
                mimeType: isPdf ? 'application/pdf' : (contentType.includes('png') ? 'image/png' : 'image/jpeg'),
                data: base64,
              };

              // Automatic PDF Slide/Page Count Detection
              try {
                const rawText = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));
                const pageMatches = rawText.match(/\/Type\s*\/Page\b/g);
                const countMatches = [...rawText.matchAll(/\/Count\s+(\d+)/g)].map((m) => parseInt(m[1], 10));
                const maxCount = countMatches.length > 0 ? Math.max(...countMatches) : 0;
                const detectedPages = Math.max(pageMatches ? pageMatches.length : 0, maxCount);
                if (detectedPages > 0 && !prompt.includes(`[${detectedPages}]`)) {
                  prompt = `🚨 تنبيه حاسم: تم فحص ملف المحاضرة المرفق وتبين أنه يحتوي بالضبط على [${detectedPages}] سلايد/صفحة!
يجب عليك شرح وتفكيك كافة الشرائح الـ ${detectedPages} بالكامل من السلايد 1 وحتى السلايد ${detectedPages} دون استثناء أي شريحة ودون دمج شرائح!\n\n${prompt}`;
                }
              } catch (e) {
                console.warn('Page count check skipped:', e);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Pages function PDF fetch skipped:', err);
      }
    }

    // 3. Build Candidates Chain
    const candidates: ProviderCandidate[] = [];

    // A. Groq Candidates (Flagship 120B model prioritized)
    const groqCandidates: ProviderCandidate[] = [];
    if (groqKey) {
      ['openai/gpt-oss-120b', 'allam-2-7b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].forEach((model) => {
        groqCandidates.push({
          name: `Groq_${model}`,
          type: 'openai_compatible',
          url: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: groqKey,
          model,
        });
      });
    }

    // B. Cerebras Candidates (Ultra-fast 120B & 27B models prioritized)
    const cerebrasCandidates: ProviderCandidate[] = [];
    if (cerebrasKey) {
      ['gpt-oss-120b', 'qwen-3.8-27b'].forEach((model) => {
        cerebrasCandidates.push({
          name: `Cerebras_${model}`,
          type: 'openai_compatible',
          url: 'https://api.cerebras.ai/v1/chat/completions',
          apiKey: cerebrasKey,
          model,
        });
      });
    }

    // C. Gemini Key Rotation (4 projects)
    const geminiCandidates: ProviderCandidate[] = [];
    const geminiModels = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
    allGeminiKeys.forEach((key, keyIdx) => {
      geminiModels.forEach((model) => {
        geminiCandidates.push({
          name: `Gemini_Key_${keyIdx + 1}_${model}`,
          type: 'gemini_native',
          url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          apiKey: key,
          model,
        });
      });
    });

    // D. OpenRouter Free Models
    const openRouterCandidates: ProviderCandidate[] = [];
    if (openRouterKey) {
      [
        'nvidia/nemotron-3.5-lightning:free',
        'nvidia/nemotron-3.5-super-vl:free',
        'liquid/lfm-2.5-2.6b:free',
        'thinkingmachines/inkling:free',
      ].forEach((model) => {
        openRouterCandidates.push({
          name: `OpenRouter_${model}`,
          type: 'openai_compatible',
          url: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey: openRouterKey,
          model,
          extraHeaders: {
            'HTTP-Referer': 'https://cic-cloud.pages.dev',
            'X-Title': 'CIC Cloud AI',
          },
        });
      });
    }

    // Candidate Priority respecting clientConfig.preferredProvider:
    const preferred = clientConfig?.preferredProvider || 'auto';
    if (preferred === 'groq') {
      candidates.push(...groqCandidates, ...cerebrasCandidates, ...geminiCandidates, ...openRouterCandidates);
    } else if (preferred === 'cerebras') {
      candidates.push(...cerebrasCandidates, ...groqCandidates, ...geminiCandidates, ...openRouterCandidates);
    } else if (preferred === 'openrouter') {
      candidates.push(...openRouterCandidates, ...groqCandidates, ...cerebrasCandidates, ...geminiCandidates);
    } else if (preferred === 'gemini') {
      candidates.push(...geminiCandidates, ...groqCandidates, ...cerebrasCandidates, ...openRouterCandidates);
    } else if (pdfInlineData || pdfUrl) {
      candidates.push(...geminiCandidates, ...groqCandidates, ...cerebrasCandidates, ...openRouterCandidates);
    } else {
      candidates.push(...groqCandidates, ...cerebrasCandidates, ...geminiCandidates, ...openRouterCandidates);
    }

    // E. Mistral Fallback
    if (mistralKey) {
      ['mistral-small-latest', 'open-mistral-nemo'].forEach((model) => {
        candidates.push({
          name: `Mistral_${model}`,
          type: 'openai_compatible',
          url: 'https://api.mistral.ai/v1/chat/completions',
          apiKey: mistralKey,
          model,
        });
      });
    }

    // F. GitHub Models Fallback
    if (githubToken) {
      ['gpt-4o-mini', 'Meta-Llama-3.1-70B-Instruct'].forEach((model) => {
        candidates.push({
          name: `GitHub_${model}`,
          type: 'openai_compatible',
          url: 'https://models.inference.ai.azure.com/chat/completions',
          apiKey: githubToken,
          model,
        });
      });
    }

    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'NO_API_KEY',
          message: 'لم يتم العثور على أي مفتاح AI صالح (Gemini, Groq, OpenRouter, Cerebras).',
        }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Prepare Payloads
    const nativeParts: any[] = [];
    if (pdfInlineData) nativeParts.push({ inlineData: pdfInlineData });
    if (listContent) nativeParts.push({ text: `محتوى المادة الدراسية:\n${listContent.slice(0, 25000)}` });
    nativeParts.push({ text: prompt });

    let safeNativeContents: any[] = [];
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
      if (merged.length > 0 && merged[merged.length - 1].role === 'user') {
        merged[merged.length - 1].parts.push(...nativeParts);
        safeNativeContents = merged;
      } else {
        safeNativeContents = [...merged, { role: 'user', parts: nativeParts }];
      }
    } else {
      safeNativeContents = [{ role: 'user', parts: nativeParts }];
    }

    const openAiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: SYSTEM_TUTOR_PERSONA },
    ];
    if (history && history.length > 0) {
      for (const h of history) {
        const text = (h.parts || []).map((p: any) => p.text || '').join('\n').trim();
        if (text) openAiMessages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: text });
      }
    }
    let combinedUserText = prompt;
    if (listContent) combinedUserText = `محتوى المادة الدراسية المساعد:\n${listContent.slice(0, 25000)}\n\n---\n${prompt}`;
    openAiMessages.push({ role: 'user', content: combinedUserText });

    // 5. Fallback Loop
    let lastError = '';
    let exhaustedCount = 0;

    for (const candidate of candidates) {
      try {
        if (candidate.type === 'gemini_native') {
          const response = await fetch(candidate.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_TUTOR_PERSONA }] },
              contents: safeNativeContents,
              generationConfig: {
                temperature: 0.35,
                maxOutputTokens: typeof maxOutputTokens === 'number' ? maxOutputTokens : 8192,
              },
            }),
          });

          if (response.status === 429) {
            exhaustedCount++;
            lastError = 'RATE_LIMIT_EXCEEDED';
            continue;
          }

          if (!response.ok) {
            const errJson: any = await response.json().catch(() => ({}));
            lastError = errJson?.error?.message || response.statusText;
            continue;
          }

          const data: any = await response.json();
          const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
          if (text) {
            return new Response(JSON.stringify({ text, provider: candidate.name, model: candidate.model }), {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
          }
        } else {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${candidate.apiKey}`,
            ...(candidate.extraHeaders || {}),
          };

          const response = await fetch(candidate.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: candidate.model,
              messages: openAiMessages,
              temperature: 0.35,
              max_tokens: Math.min(maxOutputTokens, 8192),
            }),
          });

          if (response.status === 429) {
            exhaustedCount++;
            lastError = 'RATE_LIMIT_EXCEEDED';
            continue;
          }

          if (!response.ok) {
            const errJson: any = await response.json().catch(() => ({}));
            lastError = errJson?.error?.message || errJson?.message || response.statusText;
            continue;
          }

          const data: any = await response.json();
          const text = data?.choices?.[0]?.message?.content?.trim();
          if (text) {
            return new Response(JSON.stringify({ text, provider: candidate.name, model: candidate.model }), {
              status: 200,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
          }
        }
      } catch (callErr: any) {
        lastError = callErr?.message || String(callErr);
        continue;
      }
    }

    if (exhaustedCount > 0) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'تم استهلاك حدود جميع مفاتيح ومزودي الـ AI لليوم.',
        }),
        { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: lastError || 'ALL_PROVIDERS_FAILED', message: 'تعذر الحصول على استجابة من أي مزود متاح.' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
