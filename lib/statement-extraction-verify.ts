export const STATEMENT_TOTALS_NOT_MACHINE_READABLE =
  "Could not find readable portfolio totals on this document to verify holdings. Upload an electronic PDF exported from your custodian.";

export const STATEMENT_HOLDINGS_NOT_RECONCILED =
  "Extracted holdings do not reconcile to printed account totals — file quality or layout prevents verified analysis. Upload a clearer custodian-original PDF.";

/** Match comma-separated USD amounts like 1,234,567.89 */
export function parseUsdAmount(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ""));
  return n;
}

/**
 * Pull ending totals from embedded PDF text so we can reject extractions that omit holdings or mis-assign dollars.
 * Prefer paired Account Number → Ending Account Value blocks to avoid grabbing unrelated dollar lines.
 * Schwab Positions exports often put the portfolio total immediately under **Account Summary** (no colon).
 */
export function extractPrintedEndingTotalsFromEmbeddedPdfText(text: string): number[] {
  const amounts: number[] = [];

  // Charles Schwab (web/Positions PDF): total often appears right after **Account Summary** with no colon.
  const schwabAccountSummary =
    /\bAccount\s+Summary\b[\s\n\r]{0,160}\$\s*([\d,]+\.\d{2})\b/gi;
  const schwabHits = [...text.matchAll(schwabAccountSummary)].map((x) =>
    parseUsdAmount(x[1])
  );
  if (schwabHits.length >= 1) {
    const uniq = [...new Set(schwabHits.map((n) => Math.round(n * 100) / 100))];
    if (uniq.length === 1) return [uniq[0]];
    // Multiple different headline totals → don’t guess; fall through.
  }

  let m: RegExpExecArray | null;

  const paired =
    /Account\s+Number\s*:\s*([^\n\r]+)[\s\S]{0,24000}?Ending\s+Account\s+Value\s*:\s*\$\s*([\d,]+\.\d{2})/gi;

  while ((m = paired.exec(text)) !== null) {
    amounts.push(parseUsdAmount(m[2]));
  }
  if (amounts.length > 0) return amounts;

  const endingOnly =
    /\b(?:Ending\s+Account\s+Value|Total\s+Account\s+Value|Total\s+accounts?\s+value|Plan\s+Balance|Contract\s+Value)\s*:\s*\$\s*([\d,]+\.\d{2})/gi;
  while ((m = endingOnly.exec(text)) !== null) {
    amounts.push(parseUsdAmount(m[1]));
  }
  if (amounts.length > 0) return amounts;

  const consolidated =
    /\bTotal\s+(?:Portfolio|Holdings|Investments)\s+(?:Balance|Value)\s*[:.]?\s*\$\s*([\d,]+\.\d{2})/gi;
  while ((m = consolidated.exec(text)) !== null) {
    amounts.push(parseUsdAmount(m[1]));
  }

  return amounts;
}

export function sumHoldingsUsd(holdings: Array<{ value?: unknown }>): number {
  let s = 0;
  for (const h of holdings) {
    const v = Number(h.value);
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(
        "Extracted holdings contain invalid dollar amounts — file may be unreadable or extraction failed."
      );
    }
    s += v;
  }
  return Math.round(s * 100) / 100;
}

/** Used for comparing holdings sum to statement totals (accrued income, pending trades, rounding). */
export function reconciliationToleranceUsd(referenceTotal: number): number {
  const absRef = Math.abs(referenceTotal);
  return Math.max(500, absRef * 0.02);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pass if holdings sum matches **either** machine-parsed PDF totals **or** the model’s statement total.
 * This avoids false failures when regex pulls extra disclaimer lines or the custodian uses labels we do not parse.
 *
 * @throws Error when verification fails
 */
export function assertHoldingsReconcileToVerifiedTotal(params: {
  holdings: Array<{ value?: unknown }>;
  embeddedPdfText: string | null;
  /** Model-emitted portfolio total — can validate extraction when PDF anchors are missing or untrusted. */
  modelStatementEndingValue?: number | null;
}): void {
  const sumH = sumHoldingsUsd(params.holdings);

  const anchors = params.embeddedPdfText
    ? extractPrintedEndingTotalsFromEmbeddedPdfText(params.embeddedPdfText)
    : [];

  const anchorSum =
    anchors.length >= 1 ? round2(anchors.reduce((a, b) => a + b, 0)) : undefined;

  const modelTot =
    params.modelStatementEndingValue != null && Number.isFinite(params.modelStatementEndingValue)
      ? round2(Number(params.modelStatementEndingValue))
      : undefined;

  const matches = (reference: number) =>
    Math.abs(sumH - reference) <= reconciliationToleranceUsd(reference);

  if (anchorSum !== undefined && matches(anchorSum)) return;

  // Several account-level ending totals: holdings must reconcile to their **combined** sum.
  // Otherwise the model often returns one account, sets statementAccountEndingValue to that account only, and incorrectly passes.
  if (anchors.length >= 2) {
    throw new Error(STATEMENT_HOLDINGS_NOT_RECONCILED);
  }

  if (modelTot !== undefined && matches(modelTot)) return;

  if (anchorSum === undefined && modelTot === undefined) {
    throw new Error(STATEMENT_TOTALS_NOT_MACHINE_READABLE);
  }

  throw new Error(STATEMENT_HOLDINGS_NOT_RECONCILED);
}
