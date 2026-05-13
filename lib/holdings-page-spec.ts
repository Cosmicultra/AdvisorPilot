import { PDFDocument } from "pdf-lib";

/** Normalize user/pasted punctuation before splitting (commas, bullets, "page" labels, etc.). */
function normalizeHoldingsPageSpecInput(raw: string): string {
  let s = raw.trim();
  if (!s) return "";

  s = s.replace(/^\s*pages?\s*[:]?\s*/i, "");

  s = s
    .replace(/[\uFF0C\u060C\u3001\u037E]/g, ",") // fullwidth / Arabic / Greek question
    .replace(/[\u00B7\u2022\u2023\u2981]/g, ",") // middle dot, bullets (incl. placeholder ·)
    .replace(/[;|]/g, ",")
    .replace(/\t/g, ",");

  s = s.replace(/\s+and\s+/gi, ",");

  return s;
}

/**
 * Expand advisor page notation into sorted unique 1-based page indices.
 * Examples: "1-2" → [1,2]; "1,3,9" → [1,3,9]; "1-3,5-6,10-11" → [1,2,3,5,6,10,11].
 * Returns [] if the string is empty or nothing valid parses.
 */
export function expandHoldingsPageSpec(spec: string): number[] {
  const s = normalizeHoldingsPageSpecInput(spec);
  if (!s) return [];

  const out = new Set<number>();
  for (const rawPart of s.split(",")) {
    let part = rawPart.trim();
    if (!part) continue;
    part = part.replace(/^pages?\s*/i, "").trim();
    part = part.replace(/\s+/g, "");
    part = part.replace(/[\u2013\u2014]/g, "-"); // en dash, em dash → hyphen for ranges
    if (!part) continue;

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      let a = Number(rangeMatch[1]);
      let b = Number(rangeMatch[2]);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) continue;
      if (a > b) [a, b] = [b, a];
      const cap = 10_000;
      if (b - a > cap) b = a + cap;
      for (let p = a; p <= b; p++) out.add(p);
      continue;
    }

    if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (Number.isInteger(p) && p >= 1) out.add(p);
    }
  }

  return [...out].sort((a, b) => a - b);
}

/**
 * Build a new PDF buffer that contains only the given 1-based pages, in order.
 * Pages outside 1..pageCount are skipped. Returns null if load fails or no pages remain.
 */
export async function slicePdfBytesToPages(bytes: Buffer, oneBasedPages: number[]): Promise<Buffer | null> {
  if (oneBasedPages.length === 0) return null;
  try {
    const src = await PDFDocument.load(bytes);
    const n = src.getPageCount();
    const wanted = [...new Set(oneBasedPages)].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
    if (wanted.length === 0) return null;

    const out = await PDFDocument.create();
    for (const p of wanted) {
      const [copied] = await out.copyPages(src, [p - 1]);
      out.addPage(copied);
    }
    const outBytes = await out.save();
    return Buffer.from(outBytes);
  } catch {
    return null;
  }
}
