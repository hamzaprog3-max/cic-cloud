/**
 * Lightweight, zero-dependency Content Fingerprinter for Cloudflare Workers.
 * Computes:
 *   1. Exact SHA-256 hash of file bytes
 *   2. First-5-Pages/Slides normalized text token fingerprint:
 *      - PDF: decompresses FlateDecode streams (including ToUnicode CMaps for Word/PowerPoint PDFs!)
 *             using native Web `DecompressionStream("deflate")` + parses BT..ET Tj/TJ operators
 *      - PDF stream hashes: hashes the first 5 page/image streams (works even on scanned/encrypted PDFs!)
 *      - PPTX: extracts text from ppt/slides/slide1.xml .. slide5.xml via native `DecompressionStream("deflate-raw")`
 *      - DOCX: extracts first ~6,000 chars of text from word/document.xml
 *      - TXT:  extracts first ~6,000 chars directly
 *
 * Detects duplicates even when a file is renamed OR converted between PPTX <-> PDF!
 */

export interface ContentFingerprint {
  sha256: string;
  byteSize: number;
  kind: "pdf" | "pptx" | "docx" | "text" | "binary";
  tokens: string[]; // Deduplicated distinctive tokens from first ~5 pages/slides (sorted)
  streamHashes: string[]; // Short hashes of first 5 non-trivial PDF page/image streams
  sampleText: string; // Short normalized preview
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "will", "have",
  "has", "had", "not", "but", "can", "all", "one", "two", "use", "used", "using", "into",
  "page", "slide", "chapter", "lecture", "unit", "section", "university", "academy", "shorouk",
  "computer", "science", "department", "course", "pdf", "pptx", "microsoft", "powerpoint",
  "font", "arial", "calibri", "times", "roman", "obj", "endobj", "stream", "endstream",
  "type", "subtype", "length", "filter", "flatedecode", "mediabox", "resources", "parent",
  "pages", "kids", "count", "catalog", "procset", "imageb", "imagec", "imagei", "extgstate",
  "xobject", "colorspace", "devicergb", "devicegray", "encoding", "winansiencoding",
  "true", "false", "null", "xml", "xmlns", "http", "https", "www", "schemas", "openxmlformats",
]);

async function computeSha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function decompressBytes(
  compressed: Uint8Array,
  format: "deflate" | "deflate-raw"
): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    const writePromise = writer.write(compressed).then(() => writer.close()).catch(() => {});
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const MAX_OUT = 512 * 1024;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
        if (total >= MAX_OUT) {
          reader.cancel().catch(() => {});
          break;
        }
      }
    }
    await writePromise;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}

function tokenizeText(raw: string): { tokens: string[]; sample: string } {
  const cleaned = raw
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0621-\u064A]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const w of cleaned.split(" ")) {
    if (w.length < 3 || w.length > 32) continue;
    if (/^\d+$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    if (!seen.has(w)) {
      seen.add(w);
      tokens.push(w);
      if (tokens.length >= 220) break;
    }
  }
  return {
    tokens: tokens.sort(),
    sample: cleaned.slice(0, 400),
  };
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\[0-7]{1,3}/g, " ");
}

function hexToUtf16String(hex: string): string {
  let out = "";
  for (let i = 0; i + 3 < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (code >= 32 && code !== 0xfeff) out += String.fromCharCode(code);
  }
  return out;
}

/** Parse PDF ToUnicode CMap tables (beginbfchar & beginbfrange) into glyph-hex -> Unicode char map */
function parseToUnicodeCMap(text: string, targetMap: Map<string, string>): void {
  const charBlockRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = charBlockRe.exec(text)) !== null) {
    const pairRe = /<([0-9A-Fa-f]{2,4})>\s*<([0-9A-Fa-f]{2,16})>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pairRe.exec(m[1])) !== null) {
      const key = pm[1].toUpperCase();
      const val = pm[2].length === 2 ? String.fromCharCode(parseInt(pm[2], 16)) : hexToUtf16String(pm[2]);
      if (val) targetMap.set(key, val);
    }
  }

  const rangeBlockRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeBlockRe.exec(text)) !== null) {
    const lineRe = /<([0-9A-Fa-f]{2,4})>\s*<([0-9A-Fa-f]{2,4})>\s*<([0-9A-Fa-f]{2,8})>/g;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(m[1])) !== null) {
      const start = parseInt(lm[1], 16);
      const end = Math.min(start + 256, parseInt(lm[2], 16));
      const padLen = lm[1].length;
      let dstCode = parseInt(lm[3], 16);
      for (let c = start; c <= end; c++, dstCode++) {
        const key = c.toString(16).toUpperCase().padStart(padLen, "0");
        if (dstCode >= 32) targetMap.set(key, String.fromCharCode(dstCode));
      }
    }
  }
}

function decodeHexTokenWithCMap(hex: string, cmap: Map<string, string>): string {
  const upper = hex.toUpperCase();
  // Try 4-hex-digit CID lookup first if CMap has entries
  if (cmap.size > 0 && upper.length % 4 === 0) {
    let out = "";
    let hits = 0;
    const count = upper.length / 4;
    for (let i = 0; i < upper.length; i += 4) {
      const mapped = cmap.get(upper.slice(i, i + 4));
      if (mapped) {
        out += mapped;
        hits++;
      }
    }
    if (hits > 0 && hits / count >= 0.45) return out;
  }
  // Fallback: direct UTF-16BE printable ASCII / Arabic
  if (upper.length % 4 === 0) {
    let out = "";
    let printable = 0;
    const count = upper.length / 4;
    for (let i = 0; i < upper.length; i += 4) {
      const code = parseInt(upper.slice(i, i + 4), 16);
      if ((code >= 32 && code <= 126) || (code >= 0x0600 && code <= 0x06ff)) {
        out += String.fromCharCode(code);
        printable++;
      }
    }
    if (printable >= 2 && printable / count >= 0.65) return out;
  }
  return "";
}

/** Extract readable text from a PDF content stream (BT ... ET, Tj, TJ, ') with optional CMap */
function extractTextFromPdfStream(streamLatin1: string, cmap: Map<string, string>): string {
  const out: string[] = [];
  if (!streamLatin1.includes("Tj") && !streamLatin1.includes("TJ") && !streamLatin1.includes("BT")) {
    return "";
  }

  // Match TJ arrays: [(Hello) -20 (World)] TJ  OR  [<0024>-3<0038>...] TJ
  const tjArrRe = /\[([\s\S]{1,2000}?)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = tjArrRe.exec(streamLatin1)) !== null) {
    const inner = m[1];
    const parts: string[] = [];
    const tokRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9A-Fa-f]{2,400})>/g;
    let sm: RegExpExecArray | null;
    while ((sm = tokRe.exec(inner)) !== null) {
      if (sm[1] !== undefined) parts.push(decodePdfString(sm[1]));
      else if (sm[2] !== undefined) parts.push(decodeHexTokenWithCMap(sm[2], cmap));
    }
    const joined = parts.join("");
    if (joined.trim()) out.push(joined);
    if (out.length > 500) break;
  }

  // Match simple (Hello) Tj / '
  const tjRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|')/g;
  while ((m = tjRe.exec(streamLatin1)) !== null) {
    out.push(decodePdfString(m[1]));
    if (out.length > 700) break;
  }

  // Match <hex> Tj
  const hexRe = /<([0-9A-Fa-f]{4,400})>\s*Tj/g;
  while ((m = hexRe.exec(streamLatin1)) !== null) {
    const dec = decodeHexTokenWithCMap(m[1], cmap);
    if (dec.trim()) out.push(dec);
    if (out.length > 800) break;
  }

  return out.join(" ");
}

/**
 * Scan the first portion of a PDF:
 *  - Collects ToUnicode CMaps (for Word/PowerPoint CID-encoded PDFs)
 *  - Collects hashes of the first 5 page/image streams
 *  - Extracts text from up to 5 text-bearing page streams
 */
async function extractPdfFirst5Pages(bytes: Uint8Array): Promise<{ text: string; streamHashes: string[] }> {
  const scanLen = Math.min(bytes.byteLength, 6 * 1024 * 1024);
  const decoderLatin1 = new TextDecoder("latin1");
  const raw = decoderLatin1.decode(bytes.subarray(0, scanLen));

  const streamToken = "stream";
  const endToken = "endstream";

  const cmap = new Map<string, string>();
  const candidateContentStreams: string[] = [];
  const streamHashes: string[] = [];

  let pos = 0;
  let streamsChecked = 0;
  const MAX_STREAMS_CHECKED = 140;

  while (pos < raw.length && streamsChecked < MAX_STREAMS_CHECKED) {
    const sIdx = raw.indexOf(streamToken, pos);
    if (sIdx < 0) break;

    const dictStart = Math.max(0, sIdx - 420);
    const dict = raw.slice(dictStart, sIdx);

    let dataStart = sIdx + streamToken.length;
    if (raw[dataStart] === "\r" && raw[dataStart + 1] === "\n") dataStart += 2;
    else if (raw[dataStart] === "\n" || raw[dataStart] === "\r") dataStart += 1;
    else {
      pos = sIdx + streamToken.length;
      continue;
    }

    const eIdx = raw.indexOf(endToken, dataStart);
    if (eIdx < 0) break;
    pos = eIdx + endToken.length;

    let dataEnd = eIdx;
    while (dataEnd > dataStart && (raw[dataEnd - 1] === "\n" || raw[dataEnd - 1] === "\r")) {
      dataEnd--;
    }

    const streamLen = dataEnd - dataStart;
    if (streamLen <= 12) continue;

    // Hash first 5 significant page/image streams (covers scanned & encrypted PDFs!)
    const isFontOrXref =
      /\/Length1\b|\/Subtype\s*\/Type1C\b|\/Subtype\s*\/CIDFontType|\/Type\s*\/XRef\b|\/Type\s*\/Metadata\b/i.test(dict);
    if (!isFontOrXref && streamLen >= 256 && streamHashes.length < 5) {
      const h = await computeSha256Hex(bytes.subarray(dataStart, Math.min(dataEnd, dataStart + 65536)));
      streamHashes.push(h.slice(0, 16));
    }

    const isImage = /\/Subtype\s*\/Image\b|\/DCTDecode\b|\/JPXDecode\b|\/CCITTFaxDecode\b/i.test(dict);
    if (isImage || isFontOrXref || streamLen > 350 * 1024) continue;

    streamsChecked++;
    const isFlate = /\/Filter\s*(?:\[\s*)?\/FlateDecode\b/i.test(dict);
    let streamText = "";

    if (isFlate) {
      const slice = bytes.subarray(dataStart, dataEnd);
      let inflated = await decompressBytes(slice, "deflate");
      if (!inflated && slice.byteLength > 2) {
        inflated = await decompressBytes(slice.subarray(2), "deflate-raw");
      }
      if (inflated) {
        streamText = decoderLatin1.decode(inflated);
      }
    } else if (!/\/Filter\b/i.test(dict)) {
      streamText = raw.slice(dataStart, dataEnd);
    }

    if (!streamText) continue;

    if (streamText.includes("beginbfchar") || streamText.includes("beginbfrange")) {
      parseToUnicodeCMap(streamText, cmap);
    } else if (
      candidateContentStreams.length < 12 &&
      (streamText.includes("Tj") || streamText.includes("TJ") || streamText.includes("BT"))
    ) {
      candidateContentStreams.push(streamText);
    }

    // Stop scanning once we have plenty of page content streams AND any CMaps found nearby
    if (candidateContentStreams.length >= 8 && cmap.size > 20) break;
  }

  // Decode up to 5 text-bearing page streams using all collected ToUnicode CMaps
  const pageTexts: string[] = [];
  for (const cs of candidateContentStreams) {
    if (pageTexts.length >= 5) break;
    const extracted = extractTextFromPdfStream(cs, cmap);
    const { tokens } = tokenizeText(extracted);
    if (tokens.length >= 4) {
      pageTexts.push(extracted);
    }
  }

  return {
    text: pageTexts.join("\n"),
    streamHashes,
  };
}

/**
 * Minimal ZIP reader for PPTX (slide1..slide5.xml) & DOCX (word/document.xml) using native DecompressionStream.
 */
async function extractOfficeFirst5PagesText(
  bytes: Uint8Array,
  kind: "pptx" | "docx"
): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minPos = Math.max(0, bytes.byteLength - 65557);
  let eocdPos = -1;
  for (let i = bytes.byteLength - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) return "";

  const cdEntries = view.getUint16(eocdPos + 10, true);
  const cdOffset = view.getUint32(eocdPos + 16, true);
  const utf8 = new TextDecoder("utf-8", { fatal: false });

  const targetEntries: Array<{ name: string; sortKey: number; method: number; compSize: number; localOffset: number }> = [];
  let cursor = cdOffset;

  for (let i = 0; i < cdEntries && cursor + 46 <= bytes.byteLength; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (kind === "pptx") {
      const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
      if (m) {
        const num = Number(m[1]);
        if (num >= 1 && num <= 5) {
          targetEntries.push({ name, sortKey: num, method, compSize, localOffset });
        }
      }
    } else if (kind === "docx") {
      if (name === "word/document.xml") {
        targetEntries.push({ name, sortKey: 1, method, compSize, localOffset });
      }
    }
  }

  targetEntries.sort((a, b) => a.sortKey - b.sortKey);

  const texts: string[] = [];
  for (const ent of targetEntries) {
    if (ent.localOffset + 30 > bytes.byteLength) continue;
    if (view.getUint32(ent.localOffset, true) !== 0x04034b50) continue;
    const lNameLen = view.getUint16(ent.localOffset + 26, true);
    const lExtraLen = view.getUint16(ent.localOffset + 28, true);
    const dataStart = ent.localOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = Math.min(bytes.byteLength, dataStart + ent.compSize);
    const slice = bytes.subarray(dataStart, dataEnd);

    let xmlBytes: Uint8Array | null = null;
    if (ent.method === 0) {
      xmlBytes = slice;
    } else if (ent.method === 8) {
      xmlBytes = await decompressBytes(slice, "deflate-raw");
    }
    if (!xmlBytes) continue;

    const xml = utf8.decode(xmlBytes).slice(0, 120_000);
    const tagRe = kind === "pptx" ? /<a:t[^>]*>([\s\S]*?)<\/a:t>/g : /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    const parts: string[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(xml)) !== null) {
      parts.push(tm[1]);
      if (parts.length > 800) break;
    }
    if (parts.length > 0) texts.push(parts.join(" "));
  }

  return texts.join("\n").slice(0, 6000);
}

/**
 * Compute full SHA-256 + First-5-Pages/Slides normalized content fingerprint.
 */
export async function computeContentFingerprint(
  fileBytes: ArrayBuffer | Uint8Array,
  fileName = ""
): Promise<ContentFingerprint> {
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  const sha256 = await computeSha256Hex(bytes);
  const lower = fileName.toLowerCase();

  let kind: ContentFingerprint["kind"] = "binary";
  let extractedText = "";
  let streamHashes: string[] = [];

  const isPdfHeader =
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;

  const isZipHeader = bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (isPdfHeader || lower.endsWith(".pdf")) {
    kind = "pdf";
    const pdfRes = await extractPdfFirst5Pages(bytes);
    extractedText = pdfRes.text;
    streamHashes = pdfRes.streamHashes;
  } else if (isZipHeader && lower.endsWith(".pptx")) {
    kind = "pptx";
    extractedText = await extractOfficeFirst5PagesText(bytes, "pptx");
  } else if (isZipHeader && lower.endsWith(".docx")) {
    kind = "docx";
    extractedText = await extractOfficeFirst5PagesText(bytes, "docx");
  } else if (lower.endsWith(".txt")) {
    kind = "text";
    extractedText = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 6000));
  }

  const { tokens, sample } = tokenizeText(extractedText);
  return {
    sha256,
    byteSize: bytes.byteLength,
    kind,
    tokens,
    streamHashes,
    sampleText: sample,
  };
}

/**
 * Compare two content fingerprints:
 *   1. Exact SHA-256 match (100%)
 *   2. First-5-pages PDF stream hash overlap (>= 3 matching page streams — works on scanned/encrypted PDFs!)
 *   3. First-5-pages/slides text token similarity (>= 60% Jaccard OR >= 75% containment)
 */
export function compareFingerprints(
  a: { sha256?: string | null; tokens: string[]; streamHashes?: string[] },
  b: { sha256?: string | null; tokens: string[]; streamHashes?: string[] }
): { isMatch: boolean; score: number; reason: string } {
  if (a.sha256 && b.sha256 && a.sha256 === b.sha256) {
    return { isMatch: true, score: 1.0, reason: "تطابق SHA-256 كامل (100%)" };
  }

  const shA = a.streamHashes || [];
  const shB = b.streamHashes || [];
  if (shA.length >= 2 && shB.length >= 2) {
    const setShA = new Set(shA);
    let sharedStreams = 0;
    for (const h of shB) if (setShA.has(h)) sharedStreams++;
    const ratio = sharedStreams / Math.min(shA.length, shB.length);
    if (sharedStreams >= 2 && ratio >= 0.6) {
      return {
        isMatch: true,
        score: ratio,
        reason: `تطابق صفحات PDF الفعلية (${sharedStreams}/${Math.min(shA.length, shB.length)} صفحات)`,
      };
    }
  }

  if (a.tokens.length < 12 || b.tokens.length < 12) {
    return { isMatch: false, score: 0, reason: "نصوص غير كافية للمقارنة" };
  }

  const setA = new Set(a.tokens);
  const setB = new Set(b.tokens);
  let shared = 0;
  for (const t of setA) {
    if (setB.has(t)) shared++;
  }

  const minSize = Math.min(setA.size, setB.size);
  const maxSize = Math.max(setA.size, setB.size);
  const containment = shared / minSize;
  const jaccard = shared / (setA.size + setB.size - shared);

  if (jaccard >= 0.6 || (containment >= 0.75 && shared >= 12 && maxSize / minSize <= 3.0)) {
    const pct = Math.round(Math.max(jaccard, containment) * 100);
    return {
      isMatch: true,
      score: Math.max(jaccard, containment),
      reason: `تطابق محتوى أول 5 صفحات (${pct}% — ${shared} كلمة مشتركة)`,
    };
  }

  return { isMatch: false, score: jaccard, reason: `اختلاف المحتوى (${Math.round(jaccard * 100)}%)` };
}
