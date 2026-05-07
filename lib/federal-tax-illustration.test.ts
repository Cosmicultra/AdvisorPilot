import { describe, expect, it } from "vitest";
import {
  federalIncomeTaxAfterStandardDeduction,
  incrementalFederalTaxFromConversion,
  maxRothConversionGrossThisYear,
  standardDeductionIllustration,
} from "./federal-tax-illustration";

describe("federal-tax-illustration", () => {
  it("uses expected standard deductions", () => {
    expect(standardDeductionIllustration("single")).toBe(14_600);
    expect(standardDeductionIllustration("married")).toBe(29_200);
  });

  it("does not tax income below the standard deduction", () => {
    expect(federalIncomeTaxAfterStandardDeduction(10_000, "single")).toBe(0);
  });

  it("calculates incremental conversion tax above existing income", () => {
    const tax = incrementalFederalTaxFromConversion(50_000, 10_000, "single");
    expect(tax).toBeGreaterThan(0);
    expect(tax).toBeLessThan(10_000);
  });

  it("caps Roth conversion gross at the stated bracket ceiling", () => {
    const cap = maxRothConversionGrossThisYear({
      otherGrossOrdinaryIncome: 80_000,
      tradBalanceAvailableAfterRmd: 500_000,
      statedBracketId: "22",
      filing: "single",
    });

    expect(cap).toBe(35_125);
  });
});
