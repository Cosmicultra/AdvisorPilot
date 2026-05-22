import {
  formatAnnuityContractForAnalysis,
  isAnnuityContractHolding,
  normalizeAnnuityContractFromStorage,
} from "@/lib/annuity-contract-types";

/**
 * Holdings payload for generate-analysis: includes annuity contract summaries inline.
 */
export function holdingsForAnalysisPrompt(holdings: unknown[]): unknown[] {
  if (!Array.isArray(holdings)) return [];
  return holdings.map((item) => {
    if (!item || typeof item !== "object") return item;
    const h = item as Record<string, unknown>;
    if (!isAnnuityContractHolding(h)) return item;

    const contract = normalizeAnnuityContractFromStorage(h.annuityContract);
    return {
      ...h,
      annuityContractSummary: contract ? formatAnnuityContractForAnalysis(contract) : undefined,
    };
  });
}
