import { describe, expect, it } from "vitest";
import { buildRothConversionModel, RMD_ILLUSTRATION_START_AGE } from "@/lib/roth-conversion-analysis";
import {
  computeOptimizedRothPremiumAmount,
  isFullyConvertedBeforeRmd,
  traditionalRemainingBeforeRmd,
  type OptimizeRothPremiumInput,
} from "@/lib/roth-premium-optimizer";

const optimizeBase: OptimizeRothPremiumInput = {
  fullQualifiedBalance: 500_000,
  currentAge: 65,
  retirementAge: 67,
  retirementSpendableIncomeAnnual: 80_000,
  federalTaxBracketId: "22",
  retirementIncomeFromConversionAccount: true,
};

describe("roth-premium-optimizer", () => {
  it("isFullyConvertedBeforeRmd is true when traditional is depleted by age 72", () => {
    const model = buildRothConversionModel({
      ...optimizeBase,
      totalAccountValue: 50_000,
      protectInitialInvestment: false,
      endAge: 75,
    });
    expect(isFullyConvertedBeforeRmd(model)).toBe(true);
    expect(traditionalRemainingBeforeRmd(model)).toBeLessThanOrEqual(1);
  });

  it("returns full qualified balance when the entire pool clears before RMD", () => {
    const result = computeOptimizedRothPremiumAmount({
      ...optimizeBase,
      protectInitialInvestment: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount).toBeGreaterThan(0);
    const model = buildRothConversionModel({
      ...optimizeBase,
      totalAccountValue: result.amount,
      protectInitialInvestment: false,
    });
    expect(isFullyConvertedBeforeRmd(model)).toBe(true);
  });

  it("with protect on, optimized model keeps Roth at or above entered premium when full pool clears", () => {
    const result = computeOptimizedRothPremiumAmount({
      ...optimizeBase,
      protectInitialInvestment: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const model = buildRothConversionModel({
      ...optimizeBase,
      totalAccountValue: result.amount,
      protectInitialInvestment: true,
    });
    expect(isFullyConvertedBeforeRmd(model)).toBe(true);
    expect(model.rothConversionTotals.endingTotalRothBalance).toBeGreaterThanOrEqual(model.startingBalance);
  });

  it("with protect on, optimized amount clears before RMD with ending Roth at or above that premium", () => {
    const result = computeOptimizedRothPremiumAmount({
      ...optimizeBase,
      protectInitialInvestment: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const model = buildRothConversionModel({
      ...optimizeBase,
      totalAccountValue: result.amount,
      protectInitialInvestment: true,
    });
    expect(isFullyConvertedBeforeRmd(model)).toBe(true);
    expect(model.rothConversionTotals.endingTotalRothBalance).toBeGreaterThanOrEqual(model.startingBalance);
  });

  it("a tighter max bracket yields a lower optimized amount", () => {
    const wide = computeOptimizedRothPremiumAmount({
      ...optimizeBase,
      federalTaxBracketId: "37",
      protectInitialInvestment: false,
    });
    const tight = computeOptimizedRothPremiumAmount({
      ...optimizeBase,
      federalTaxBracketId: "12",
      protectInitialInvestment: false,
      annualAdjustedGrossIncomePreRetirement: 200_000,
    });
    expect(wide.ok).toBe(true);
    expect(tight.ok).toBe(true);
    if (!wide.ok || !tight.ok) return;
    expect(tight.amount).toBeLessThan(wide.amount);
  });

  it("rejects clients at or above RMD illustration age", () => {
    const result = computeOptimizedRothPremiumAmount({
      ...optimizeBase,
      currentAge: RMD_ILLUSTRATION_START_AGE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(String(RMD_ILLUSTRATION_START_AGE));
  });

  it("returns a positive amount for a one-year pre-RMD horizon at age 72", () => {
    const result = computeOptimizedRothPremiumAmount({
      ...optimizeBase,
      currentAge: 72,
      fullQualifiedBalance: 500_000,
      protectInitialInvestment: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount).toBeGreaterThan(0);
    expect(result.amount).toBeLessThan(500_000);
  });
});
