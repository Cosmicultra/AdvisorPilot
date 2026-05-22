import type { PDFFont } from "pdf-lib";

/** Strip control chars; collapse whitespace (matches generate-report cleanText). */
export function cleanWrapText(value: unknown): string {
  return String(value || "")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Word-boundary line wrap for PDF body text.
 * Never splits mid-word; oversized tokens stay on one line.
 */
export function wrapLinesToWidth(
  text: unknown,
  font: PDFFont,
  fontSize: number,
  maxWidthPt: number,
): string[] {
  const raw = cleanWrapText(text);
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const widthOf = (s: string) => font.widthOfTextAtSize(s, fontSize);
  const linesOut: string[] = [];
  let current = "";

  const flush = () => {
    if (current) {
      linesOut.push(current);
      current = "";
    }
  };

  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (widthOf(trial) <= maxWidthPt) {
      current = trial;
      continue;
    }

    flush();
    current = word;
  }

  flush();
  return linesOut.length ? linesOut : [""];
}

export function estimateWrappedLines(
  text: unknown,
  font: PDFFont,
  fontSize: number,
  maxWidthPt: number,
): number {
  return Math.max(1, wrapLinesToWidth(text, font, fontSize, maxWidthPt).length);
}
