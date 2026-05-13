import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** Keep PDF text under a prompt budget; holdings often appear in latter pages. */
export const PDF_TEXT_PROMPT_DEFAULT_MAX_CHARS = 52_000 * 2;

/** Min "content" length (ignoring whitespace) before treating the PDF as having a usable text layer. */
const MIN_USABLE_COMPACT_CHARS = 50;

/**
 * True when the PDF text layer is substantial enough to anchor symbols and dollar amounts.
 * Image-only / scanned PDFs often yield empty or trivial extracted strings — extraction must lean on vision rules.
 */
export function hasUsablePdfTextLayer(text: string | null | undefined): boolean {
  if (!text) return false;
  const compact = String(text).replace(/\s+/g, "");
  if (compact.length < MIN_USABLE_COMPACT_CHARS) return false;
  return /[\d$]/.test(compact) && /[A-Za-z]/.test(compact);
}

/**
 * Extract embedded text from a PDF (when present). Scanned/image-only PDFs return null.
 */
export async function tryExtractPdfText(bytes: Buffer): Promise<string | null> {
  try {
    const data = await pdfParse(bytes);
    const t = typeof data.text === "string" ? data.text.replace(/\r\n/g, "\n").trim() : "";
    if (!hasUsablePdfTextLayer(t)) return null;
    return t;
  } catch {
    return null;
  }
}

/**
 * Trim extracted text for the model: head + tail so page-3/4 holdings are likely included on long files.
 */
export function clipPdfTextForPrompt(
  fullText: string,
  maxChars: number = PDF_TEXT_PROMPT_DEFAULT_MAX_CHARS
): string {
  const t = fullText.trim();
  if (t.length <= maxChars) return t;
  const half = Math.floor((maxChars - 120) / 2);
  return `${t.slice(0, half)}\n\n[... omitted ${t.length - maxChars + 120} characters of PDF text ...]\n\n${t.slice(-half)}`;
}

export function isLikelyPdf(mimeType: string, fileName: string): boolean {
  const m = mimeType.toLowerCase();
  if (m.includes("pdf")) return true;
  return fileName.trim().toLowerCase().endsWith(".pdf");
}
