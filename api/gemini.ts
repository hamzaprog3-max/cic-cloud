// Vercel Serverless Function: Proxy requests to Google Gemini API
// Solves ISP censorship, DNS blocks, and client-side CORS issues

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, pdfUrl, listContent, history, apiKey: clientApiKey, maxOutputTokens } = req.body || {};

    const apiKey = (clientApiKey || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();

    if (!apiKey) {
      return res.status(400).json({ error: 'NO_API_KEY', message: 'API key not configured in environment' });
    }

    if (!prompt) {
      return res.status(400).json({ error: 'PROMPT_REQUIRED' });
    }

    const parts: any[] = [];

    // Download PDF on server if under 18MB with comprehensive SSRF protection
    if (pdfUrl) {
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

        if (isPrivate) {
          throw new Error('Invalid or restricted PDF URL');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const pdfRes = await fetch(pdfUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (pdfRes.ok) {
          const arrayBuffer = await pdfRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length < 18 * 1024 * 1024) {
            const base64 = buffer.toString('base64');
            const contentType = pdfRes.headers.get('content-type') || 'application/pdf';
            parts.push({
              inlineData: {
                mimeType: contentType.includes('pdf') ? 'application/pdf' : 'image/jpeg',
                data: base64,
              },
            });
          }
        }
      } catch (err) {
        console.warn('Server failed to fetch PDF inline, continuing with prompt:', err);
      }
    }

    if (listContent) {
      parts.push({
        text: `المحتوى الدراسي والنصي المساعد:\n${listContent.slice(0, 30000)}`,
      });
    }

    parts.push({ text: prompt });

    const models = [
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      'gemini-2.5-pro',
      'gemini-pro-latest',
    ];

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
      if (merged.length > 0 && merged[merged.length - 1].role === 'user') {
        merged[merged.length - 1].parts.push(...parts);
        safeContents = merged;
      } else {
        safeContents = [...merged, { role: 'user', parts }];
      }
    } else {
      safeContents = [{ role: 'user', parts }];
    }

const SYSTEM_TUTOR_PERSONA = `أنت "المعيد الدحيح" والأخ الأكبر العبقري والداعم لطلاب الجامعة في منصتنا التعليمية.
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

    let lastError = '';

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
            maxOutputTokens: typeof maxOutputTokens === 'number' ? maxOutputTokens : 8192,
          },
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (response.status === 429) {
          return res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
        }

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          const errMsg = errJson?.error?.message || response.statusText;
          if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID')) {
            return res.status(401).json({ error: 'INVALID_API_KEY' });
          }
          if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('no longer available')) {
            lastError = errMsg;
            continue;
          }
          return res.status(response.status).json({ error: errMsg });
        }

        const data = await response.json();
        const candidateParts = data?.candidates?.[0]?.content?.parts || [];
        const text = candidateParts.map((p: any) => p.text || '').join('').trim();

        if (!text) {
          return res.status(500).json({ error: 'EMPTY_RESPONSE' });
        }

        return res.status(200).json({ text });
      } catch (err: any) {
        lastError = err?.message || String(err);
        console.warn(`Model ${model} proxy call failed:`, err);
      }
    }

    return res.status(500).json({ error: lastError || 'Failed to generate response' });
  } catch (err: any) {
    console.error('Gemini proxy error:', err);
    return res.status(500).json({ error: err?.message || 'Internal server error' });
  }
}
