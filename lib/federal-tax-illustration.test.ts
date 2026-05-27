import { describe, expect, it } from "vitest";
import {
  federalIncomeTaxAfterStandardDeduction,
  incrementalFederalTaxFromConversion,
  incrementalStateTaxFromConversion,
  maxRothConversionGrossThisYear,
  parseStateTaxRateFraction,
  standardDeductionBreakdownIllustration,
  standardDeductionIllustration,
  stateIncomeTaxIllustrative,
} from "./federal-tax-illustration";

const under65Single: Parameters<typeof standardDeductionIllustration>[0] = {
  filing: "single",
  calendarYearOffset: 0,
  clientAge: 64,
};

const under65Mfj: Parameters<typeof standardDeductionIllustration>[0] = {
  filing: "married",
  calendarYearOffset: 0,
  clientAge: 64,
  spouseAge: 64,
};

describe("federal-tax-illustration", () => {
  it("uses expected base standard deductions when under age 65", () => {
    expect(standardDeductionIllustration(under65Single)).toBe(14_600);
    expect(standardDeductionIllustration(under65Mfj)).toBe(29_200);
  });

  it("adds 65+ additional standard deduction per qualifying taxpayer", () => {
    const mfjBoth65 = standardDeductionBreakdownIllustration({
      filing: "married",
      calendarYearOffset: 0,
      clientAge: 65,
      spouseAge: 65,
    });
    expect(mfjBoth65.base).toBe(29_200);
    expect(mfjBoth65.additional65Plus).toBe(3_100);
    expect(mfjBoth65.total).toBe(32_300);

    const single65 = standardDeductionBreakdownIllustration({
      filing: "single",
      calendarYearOffset: 0,
      clientAge: 65,
    });
    expect(single65.additional65Plus).toBe(1_550);
    expect(single65.total).toBe(16_150);
  });

  it("inflates deductions by calendar year offset", () => {
    const y5 = standardDeductionIllustration({ ...under65Single, calendarYearOffset: 5 });
    expect(y5).toBeGreaterThan(14_600);
  });

  it("does not tax income below the standard deduction", () => {
    expect(federalIncomeTaxAfterStandardDeduction(10_000, under65Single)).toBe(0);
  });

  it("calculates incremental conversion tax above existing income", () => {
    const tax = incrementalFederalTaxFromConversion(50_000, 10_000, under65Single);
    expect(tax).toBeGreaterThan(0);
    expect(tax).toBeLessThan(10_000);
  });

  it("caps Roth conversion gross at the stated bracket ceiling", () => {
    const cap = maxRothConversionGrossThisYear({
      otherGrossOrdinaryIncome: 80_000,
      tradBalanceAvailableAfterRmd: 500_000,
      statedBracketId: "22",
      deduction: under65Single,
    });

    expect(cap).toBe(35_125);
  });

  it("uses larger deduction cap when client is 65+", () => {
    const capUnder65 = maxRothConversionGrossThisYear({
      otherGrossOrdinaryIncome: 80_000,
      tradBalanceAvailableAfterRmd: 500_000,
      statedBracketId: "22",
      deduction: under65Single,
    });
    const cap65 = maxRothConversionGrossThisYear({
      otherGrossOrdinaryIncome: 80_000,
      tradBalanceAvailableAfterRmd: 500_000,
      statedBracketId: "22",
      deduction: { ...under65Single, clientAge: 65 },
    });
    expect(cap65).toBeGreaterThan(capUnder65);
  });

  it("parses state tax rate and applies flat tax on taxable ordinary", () => {
    expect(parseStateTaxRateFraction("1")).toBeCloseTo(0.01);
    expect(parseStateTaxRateFraction("")).toBe(0);
    expect(stateIncomeTaxIllustrative(100_000, 0.01)).toBe(1_000);
  });

  it("calculates incremental state tax on conversion", () => {
    const stateTax = incrementalStateTaxFromConversion(50_000, 10_000, under65Single, 0.01);
    expect(stateTax).toBeGreaterThan(0);
    expect(stateTax).toBeLessThan(200);
  });
});
