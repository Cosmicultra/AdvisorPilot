import { describe, expect, it } from "vitest";
import { buildRothConversionModel } from "@/lib/roth-conversion-analysis";
import { buildRothComparisonVisualData } from "@/lib/roth-comparison-visuals";

function baseModel() {
  return buildRothConversionModel({
    totalAccountValue: 500_000,
    currentAge: 65,
    retirementAge: 67,
    retirementSpendableIncomeAnnual: 80_000,
    annualSocialSecurityGross: 30_000,
    federalTaxBracketId: "35",
    marriedFilingJointly: true,
    annualAdjustedGrossIncomePreRetirement: 200_000,
    retirementIncomeFromConversionAccount: true,
  });
}

describe("buildRothComparisonVisualData", () => {
  it("derives ending wealth and delta from model rows", () => {
    const model = baseModel();
    const data = buildRothComparisonVisualData(model);

    const stayLast = model.stayTraditional.at(-1)!;
    expect(data.stayEndingWealth).toBe(stayLast.endBalance);
    expect(data.rothEndingWealth).toBe(model.rothConversionTotals.endingTotalRothBalance);
    expect(data.wealthDelta).toBe(data.rothEndingWealth - data.stayEndingWealth);
  });

  it("computes taxes, IRMAA, and savings from path totals", () => {
    const model = baseModel();
    const data = buildRothComparisonVisualData(model);

    const stayFed = model.stayTraditional.reduce((s, r) => s + r.illustrativeFederalTax, 0);
    const rothFed = model.rothConversion.reduce(
      (s, r) => s + (r.rothOnlyPhase ? 0 : r.illustrativeTaxOnConversion),
      0,
    );

    expect(data.stayFederalTaxTotal).toBeCloseTo(stayFed, 0);
    expect(data.rothFederalTaxTotal).toBeCloseTo(rothFed, 0);
    expect(data.stayTaxesAndIrmaa).toBeCloseTo(stayFed + model.stayTraditionalTotals.totalIrmaaPaid, 0);
    expect(data.rothTaxesAndIrmaa).toBeCloseTo(rothFed + model.rothConversionTotals.totalIrmaaPaid, 0);
    expect(data.taxSavings).toBeCloseTo(stayFed - rothFed, 0);
    expect(data.irmaaSavings).toBe(
      model.stayTraditionalTotals.totalIrmaaPaid - model.rothConversionTotals.totalIrmaaPaid,
    );
  });

  it("includes bracket ceiling and filing label", () => {
    const model = baseModel();
    const data = buildRothComparisonVisualData(model);

    expect(data.filingLabel).toBe("Married filing jointly");
    expect(data.maxBracketPct).toBe(35);
    expect(data.grossIncomeCeiling).toBeGreaterThan(data.taxableIncomeCeiling);
    expect(data.conversionAmountTotal).toBe(model.rothConversionTotals.totalGrossConversion);
    expect(data.bracketStrip.length).toBe(7);
    expect(data.stopLinePosition).toBeGreaterThan(0);
    expect(data.stopLinePosition).toBeLessThanOrEqual(1);
  });

  it("derives effective tax + IRMAA rates between 0 and 100", () => {
    const model = baseModel();
    const data = buildRothComparisonVisualData(model);

    expect(data.stayEffectiveTaxIrmaaRate).toBeGreaterThanOrEqual(0);
    expect(data.rothEffectiveTaxIrmaaRate).toBeGreaterThanOrEqual(0);
    expect(data.stayEffectiveTaxIrmaaRate).toBeLessThan(100);
    expect(data.effectiveRateDeltaPts).toBeCloseTo(
      data.stayEffectiveTaxIrmaaRate - data.rothEffectiveTaxIrmaaRate,
      5,
    );
  });
});
