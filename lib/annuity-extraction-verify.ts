import {
  extractPrintedEndingTotalsFromEmbeddedPdfText,
  parseUsdAmount,
  reconciliationToleranceUsd,
  sumHoldingsUsd,
} from "@/lib/statement-extraction-verify";

export const ANNUITY_TOTALS_NOT_MACHINE_READABLE =
  "Could not find readable contract or accumulation totals on this document to verify extracted values. Upload a clearer carrier-original PDF.";

export const ANNUITY_CONTRACTS_NOT_RECONCILED =
  "Extracted annuity contract values do not reconcile to printed contract or accumulation totals — verify the file or re-upload a clearer statement.";

/**
 * Pull contract-level dollar totals from embedded PDF text.
 */
export function extractPrintedAnnuityTotalsFromEmbeddedPdfText(text: string): number[] {
  const amounts: number[] = [];
  let m: RegExpExecArray | null;

  const labeled =
    /\b(?:Contract\s+Value|Accumulation\s+Value|Current\s+Value|Account\s+Value|Policy\s+Value|Total\s+Contract\s+Value)\s*[:.]?\s*\$\s*([\d,]+\.\d{2})/gi;
  while ((m = labeled.exec(text)) !== null) {
    amounts.push(parseUsdAmount(m[1]));
  }

  if (amounts.length > 0) return amounts;

  const planBalance = /\bPlan\s+Balance\s*[:.]?\s*\$\s*([\d,]+\.\d{2})/gi;
  while ((m = planBalance.exec(text)) !== null) {
    amounts.push(parseUsdAmount(m[1]));
  }

  return amounts;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Verify sum of contract currentValue fields against printed totals or model headline value.
 */
export function assertAnnuityContractsReconcile(params: {
  contracts: Array<{ currentValue?: unknown }>;
  embeddedPdfText: string | null;
  modelStatementContractValue?: number | null;
}): void {
  const sumContracts = sumHoldingsUsd(
    params.contracts.map((c) => ({ value: c.currentValue }))
  );

  const anchors = params.embeddedPdfText
    ? extractPrintedAnnuityTotalsFromEmbeddedPdfText(params.embeddedPdfText)
    : [];

  const anchorSum =
    anchors.length >= 1 ? round2(anchors.reduce((a, b) => a + b, 0)) : undefined;

  const modelTot =
    params.modelStatementContractValue != null &&
    Number.isFinite(params.modelStatementContractValue)
      ? round2(Number(params.modelStatementContractValue))
      : undefined;

  const matches = (reference: number) =>
    Math.abs(sumContracts - reference) <= reconciliationToleranceUsd(reference);

  if (anchorSum !== undefined && matches(anchorSum)) return;

  if (anchors.length >= 2) {
    throw new Error(ANNUITY_CONTRACTS_NOT_RECONCILED);
  }

  if (modelTot !== undefined && matches(modelTot)) return;

  if (anchorSum === undefined && modelTot === undefined) {
    if (params.contracts.length === 1) {
      return;
    }
    throw new Error(ANNUITY_TOTALS_NOT_MACHINE_READABLE);
  }

  throw new Error(ANNUITY_CONTRACTS_NOT_RECONCILED);
}
