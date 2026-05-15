/**
 * Helpers for shaping the PDF text-layer context delivered to the model.
 *
 * Extracted from `attachments.ts` so they can be unit-tested directly with
 * canned text input — avoids fragile pdf-lib → pdf-parse round-trips in
 * test fixtures.
 */

import { clipPdfTextForPrompt, PDF_TEXT_PROMPT_DEFAULT_MAX_CHARS } from "../extract-pdf-text-layer";
import type { PdfTextLayerContext } from "./types";

/**
 * Returns the unique account numbers detected in the embedded PDF text,
 * preserving first-seen order.
 */
export function collectAccountNumbers(pdfText: string): string[] {
  const ids = [...pdfText.matchAll(/Account Number:\s*([^\n\r]+)/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  return unique;
}

/** Count of printed "Ending Account Value: $..." lines in the PDF text. */
export function countEndingValues(pdfText: string): number {
  return [...pdfText.matchAll(/Ending Account Value:\s*\$[\d,]+\.\d{2}/gi)].length;
}

/**
 * Build the multi-account hint string injected into the extraction prompt
 * when the embedded PDF text references more than one Account Number.
 */
export function buildMultiAccountHint(ids: string[], endingCount: number): string {
  return `
MULTI-ACCOUNT DOCUMENT (embedded PDF text lists ${ids.length} distinct account numbers — ${endingCount} printed ending-account totals):
${ids.map((id, i) => `${i + 1}. ${id}`).join("\n")}
Extract holdings[] for **every** position line under **each** account block above (every holdings table tied to each account number). Do not stop after the first account's table.
When the same ticker appears in two accounts, emit separate holdings[] rows and set accountNumber to the printed id for that row.

`;
}

/**
 * Build the full PdfTextLayerContext from raw extracted text. Used by
 * `normalizeAttachment` (and directly by tests).
 */
export function buildTextLayerContext(
  fullText: string,
  pdfPhysicallySliced: boolean
): PdfTextLayerContext {
  const ids = collectAccountNumbers(fullText);
  const endingCount = countEndingValues(fullText);
  const multiAccountHint = ids.length > 1 ? buildMultiAccountHint(ids, endingCount) : "";
  const clippedText = clipPdfTextForPrompt(
    fullText,
    pdfPhysicallySliced ? Number.MAX_SAFE_INTEGER : PDF_TEXT_PROMPT_DEFAULT_MAX_CHARS
  );
  return {
    fullText,
    clippedText,
    multiAccountHint,
    accountCount: ids.length,
  };
}
