import { describe, expect, it } from "vitest";
import {
  annuityAccountTypeCarrierLabel,
  annuityContractTypeShortLabel,
  annuityIndexingStrategyDisplaysForHolding,
  formatIndexingStrategyRates,
  normalizeAnnuityContractDetails,
  toUiHoldingFromAnnuityContract,
} from "@/lib/annuity-contract-types";
import { normalizeHoldingsForUi } from "@/lib/saved-review-normalize";

describe("annuity-contract-types", () => {
  it("normalizes model contract JSON", () => {
    const c = normalizeAnnuityContractDetails({
      contractNumber: "POL-998877",
      carrierName: "Athene",
      qualifiedStatus: "qualified",
      productName: "Ascension 10",
      contractType: "fia",
      issueDate: "2019-06-01",
      currentValue: 250_000,
      initialPremium: 200_000,
      surrenderValue: 235_000,
      indexingStrategies: [
        { name: "S&P 500 P2P", capRatePct: 9.25, participationRatePct: 100 },
      ],
    });
    expect(c?.carrierName).toBe("Athene");
    expect(c?.indexingStrategies).toHaveLength(1);
    expect(c?.indexingStrategies[0]?.capRatePct).toBe(9.25);
  });

  it("maps to UiHolding with masked contract number", () => {
    const c = normalizeAnnuityContractDetails({
      contractNumber: "1234567890",
      carrierName: "Nationwide",
      qualifiedStatus: "non_qualified",
      productName: "New Heights",
      contractType: "myga",
      issueDate: "2020-01-15",
      currentValue: 100_000,
      initialPremium: 100_000,
      surrenderValue: 98_000,
      indexingStrategies: [],
    });
    expect(c).toBeTruthy();
    const h = toUiHoldingFromAnnuityContract(c!);
    expect(h.documentKind).toBe("annuity");
    expect(h.assetClass).toBe("MYGA / Fixed Annuity");
    expect(h.suggested).toMatch(/\d{4}$/);
    expect(h.annuityContract?.contractNumber).toBe("1234567890");
  });

  it("builds annuity account header type and carrier label", () => {
    expect(annuityContractTypeShortLabel("fia")).toBe("FIA");
    expect(annuityContractTypeShortLabel("myga")).toBe("MYGA");
    expect(annuityContractTypeShortLabel("variable")).toBe("VA");

    const h = toUiHoldingFromAnnuityContract({
      contractNumber: "POL-1",
      carrierName: "Athene",
      qualifiedStatus: "qualified",
      productName: "Ascension",
      contractType: "fia",
      issueDate: "2019-01-01",
      currentValue: 250_000,
      initialPremium: 200_000,
      surrenderValue: 235_000,
      indexingStrategies: [],
    });
    expect(annuityAccountTypeCarrierLabel([h])).toBe("FIA · Athene");
  });

  it("formats indexing strategy rates for CRM display", () => {
    const label = formatIndexingStrategyRates({
      name: "S&P 500 P2P",
      capRatePct: 9.25,
      participationRatePct: 100,
    });
    expect(label).toContain("Cap 9.25%");
    expect(label).toContain("Participation 100%");

    const h = toUiHoldingFromAnnuityContract({
      contractNumber: "A1",
      carrierName: "Athene",
      qualifiedStatus: "qualified",
      productName: "Ascension",
      contractType: "fia",
      issueDate: "2019-01-01",
      currentValue: 100_000,
      initialPremium: 90_000,
      surrenderValue: 95_000,
      indexingStrategies: [
        { name: "S&P 500 Annual P2P", capRatePct: 8, participationRatePct: 95 },
        { name: "Fixed Account", fixedRatePct: 3.5 },
      ],
    });
    const rows = annuityIndexingStrategyDisplaysForHolding(h);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.ratesLabel).toContain("Cap 8%");
    expect(rows[1]?.ratesLabel).toContain("Fixed 3.5%");
  });

  it("round-trips through normalizeHoldingsForUi", () => {
    const h = toUiHoldingFromAnnuityContract({
      contractNumber: "X-1",
      carrierName: "Allianz",
      qualifiedStatus: "unknown",
      productName: "Benefit Control",
      contractType: "variable",
      issueDate: "2018-03-01",
      currentValue: 500_000,
      initialPremium: 400_000,
      surrenderValue: 480_000,
      indexingStrategies: [],
    });
    const [out] = normalizeHoldingsForUi([h]);
    expect(out.documentKind).toBe("annuity");
    expect(out.annuityContract?.carrierName).toBe("Allianz");
    expect(out.assetClass).toBe("Variable Annuity");
  });
});
