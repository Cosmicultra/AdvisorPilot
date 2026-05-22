import { describe, expect, it } from "vitest";
import { holdingsForAnalysisPrompt } from "@/lib/holdings-for-analysis";
import { toUiHoldingFromAnnuityContract } from "@/lib/annuity-contract-types";

describe("holdingsForAnalysisPrompt", () => {
  it("adds annuityContractSummary for annuity rows", () => {
    const h = toUiHoldingFromAnnuityContract({
      contractNumber: "ABC",
      carrierName: "Athene",
      qualifiedStatus: "qualified",
      productName: "Ascension",
      contractType: "fia",
      issueDate: "2019-01-01",
      currentValue: 100_000,
      initialPremium: 90_000,
      surrenderValue: 95_000,
      indexingStrategies: [{ name: "S&P", capRatePct: 8 }],
    });
    const out = holdingsForAnalysisPrompt([h]) as Array<Record<string, unknown>>;
    expect(String(out[0]?.annuityContractSummary)).toContain("Athene");
    expect(String(out[0]?.annuityContractSummary)).toContain("S&P");
  });
});
