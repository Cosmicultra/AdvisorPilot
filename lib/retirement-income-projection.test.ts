import { describe, expect, it } from "vitest";
import { buildRetirementIncomeProjection } from "@/lib/retirement-income-projection";

const baseInput = {
  clientAgeStart: 60,
  spouseAgeStart: 58,
  married: true,
  clientRetirementAge: 65,
  spouseRetirementAge: 64,
  earnedClientAnnual: 100_000,
  earnedSpouseAnnual: 50_000,
  baseRetirementNeedAnnual: 80_000,
  needInflationAnnual: 0.03,
  baseSocialSecurityClientAnnual: 20_000,
  baseSocialSecuritySpouseAnnual: 20_000,
  clientSocialSecurityStartAge: 65,
  spouseSocialSecurityStartAge: 64,
  socialSecurityColaAnnual: 0,
  basePensionAnnual: 0,
  pensionColaAnnual: 0,
  baseOtherIncomeAnnual: 0,
  otherIncomeGrowthAnnual: 0,
  initialTotalPortfolio: 1_000_000,
  initialQualifiedPortfolio: 600_000,
  portfolioReturnAnnual: 0.05,
  horizonYears: 10,
  startCalendarYear: 2026,
  spendTargetNetOfTax: false,
  effectiveTaxRateAnnual: 0,
};

describe("buildRetirementIncomeProjection", () => {
  it("zeros retirement need until both spouses pass retirement ages", () => {
    const rows = buildRetirementIncomeProjection(baseInput);
    expect(rows[0]?.incomeNeed).toBe(0);
    expect(rows[0]?.earnedIncome).toBe(150_000);
    expect(rows[4]?.clientAge).toBe(64);
    expect(rows[4]?.incomeNeed).toBe(0);
    // y=5: ages 65 and 63 — spouse still working
    expect(rows[5]?.incomeNeed).toBe(0);
    expect(rows[5]?.earnedIncome).toBe(50_000);
    // y=6: 66 and 64 — both retired; SS: client age 66 ≥ 65, spouse 64 ≥ 64, COLA 0 → 40k combined
    expect(rows[6]?.earnedIncome).toBe(0);
    expect(rows[6]?.incomeNeed).toBeGreaterThan(0);
    expect(rows[6]?.socialSecurity).toBe(40_000);
  });

  it("applies RMD from age 73 on qualified balance", () => {
    const rows = buildRetirementIncomeProjection({
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      clientAgeStart: 72,
      baseRetirementNeedAnnual: 50_000,
      needInflationAnnual: 0,
      baseSocialSecurityClientAnnual: 30_000,
      baseSocialSecuritySpouseAnnual: 0,
      clientSocialSecurityStartAge: 62,
      spouseSocialSecurityStartAge: 67,
      socialSecurityColaAnnual: 0,
      initialTotalPortfolio: 500_000,
      initialQualifiedPortfolio: 500_000,
      portfolioReturnAnnual: 0,
      horizonYears: 3,
    });
    expect(rows[0]?.rmd).toBe(0);
    expect(rows[1]?.clientAge).toBe(73);
    expect(rows[1]?.rmd).toBeGreaterThan(0);
  });

  it("defers SS until each person's start age after full retirement", () => {
    const rows = buildRetirementIncomeProjection({
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      clientAgeStart: 64,
      clientRetirementAge: 64,
      spouseRetirementAge: 67,
      baseRetirementNeedAnnual: 60_000,
      needInflationAnnual: 0,
      baseSocialSecurityClientAnnual: 24_000,
      baseSocialSecuritySpouseAnnual: 0,
      clientSocialSecurityStartAge: 67,
      socialSecurityColaAnnual: 0,
      initialTotalPortfolio: 800_000,
      initialQualifiedPortfolio: 400_000,
      portfolioReturnAnnual: 0,
      horizonYears: 6,
    });
    // y=0 age 64: first retired year, SS not yet (starts 67)
    expect(rows[0]?.socialSecurity).toBe(0);
    expect(rows[0]?.incomeNeed).toBe(60_000);
    // y=3 age 67: SS begins
    expect(rows[3]?.clientAge).toBe(67);
    expect(rows[3]?.socialSecurity).toBe(24_000);
  });

  it("increases illustrative withdrawal when spend is net-of-tax with a positive effective rate", () => {
    const taxTestInput = {
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      clientAgeStart: 70,
      spouseRetirementAge: 67,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      clientRetirementAge: 65,
      baseRetirementNeedAnnual: 80_000,
      needInflationAnnual: 0,
      baseSocialSecurityClientAnnual: 0,
      baseSocialSecuritySpouseAnnual: 0,
      clientSocialSecurityStartAge: 67,
      socialSecurityColaAnnual: 0,
      basePensionAnnual: 0,
      baseOtherIncomeAnnual: 0,
      initialTotalPortfolio: 500_000,
      initialQualifiedPortfolio: 500_000,
      portfolioReturnAnnual: 0,
      horizonYears: 2,
      spendTargetNetOfTax: false,
      effectiveTaxRateAnnual: 0,
    };
    const gross = buildRetirementIncomeProjection(taxTestInput);
    const netTax = buildRetirementIncomeProjection({
      ...taxTestInput,
      spendTargetNetOfTax: true,
      effectiveTaxRateAnnual: 0.25,
    });
    const i = gross.findIndex((r) => r.incomeNeed > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(netTax[i]!.portfolioWithdrawalBeyondRmd).toBeGreaterThan(gross[i]!.portfolioWithdrawalBeyondRmd);
  });

  it("exposes total portfolio withdrawal as RMD plus add-on draw", () => {
    const rows = buildRetirementIncomeProjection({
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      clientAgeStart: 73,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      baseRetirementNeedAnnual: 200_000,
      needInflationAnnual: 0,
      baseSocialSecurityClientAnnual: 0,
      baseSocialSecuritySpouseAnnual: 0,
      clientSocialSecurityStartAge: 67,
      socialSecurityColaAnnual: 0,
      initialTotalPortfolio: 400_000,
      initialQualifiedPortfolio: 400_000,
      portfolioReturnAnnual: 0,
      horizonYears: 1,
    });
    const r = rows[0]!;
    expect(r.totalPortfolioWithdrawal).toBe(r.rmd + r.portfolioWithdrawalBeyondRmd);
  });

  it("never withdraws more than post-growth portfolio balance", () => {
    const rows = buildRetirementIncomeProjection({
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      clientAgeStart: 65,
      clientRetirementAge: 65,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      baseRetirementNeedAnnual: 500_000,
      needInflationAnnual: 0.05,
      baseSocialSecurityClientAnnual: 40_000,
      baseSocialSecuritySpouseAnnual: 0,
      initialTotalPortfolio: 2_000_000,
      initialQualifiedPortfolio: 1_500_000,
      portfolioReturnAnnual: 0.04,
      horizonYears: 25,
    });
    for (const r of rows) {
      const cap = r.beginningPortfolio * (1 + 0.04) + 1e-6;
      expect(r.totalPortfolioWithdrawal).toBeLessThanOrEqual(cap);
      expect(r.endingPortfolio).toBeGreaterThanOrEqual(0);
      expect(r.unmetIncomeNeed).toBeGreaterThanOrEqual(0);
      if (r.incomeNeed > 0) {
        const funded =
          r.earnedIncome +
          r.socialSecurity +
          r.pension +
          r.otherIncome +
          r.rmd +
          r.portfolioWithdrawalBeyondRmd;
        expect(funded + r.unmetIncomeNeed).toBeGreaterThanOrEqual(r.incomeNeed - 1);
      }
    }
  });

  it("shows unmet need after portfolio depletion with zero further gap withdrawals", () => {
    const rows = buildRetirementIncomeProjection({
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      clientAgeStart: 70,
      clientRetirementAge: 65,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      baseRetirementNeedAnnual: 200_000,
      needInflationAnnual: 0.03,
      baseSocialSecurityClientAnnual: 30_000,
      baseSocialSecuritySpouseAnnual: 0,
      clientSocialSecurityStartAge: 67,
      socialSecurityColaAnnual: 0,
      basePensionAnnual: 0,
      baseOtherIncomeAnnual: 0,
      initialTotalPortfolio: 300_000,
      initialQualifiedPortfolio: 300_000,
      portfolioReturnAnnual: 0,
      horizonYears: 20,
    });
    const firstZero = rows.find((r) => r.endingPortfolio <= 0 && r.incomeNeed > 0);
    expect(firstZero).toBeDefined();
    const afterDepletion = rows.filter(
      (r) => r.clientAge >= firstZero!.clientAge && r.incomeNeed > 0 && r.beginningPortfolio <= 0,
    );
    expect(afterDepletion.length).toBeGreaterThan(0);
    for (const r of afterDepletion) {
      expect(r.portfolioWithdrawalBeyondRmd).toBe(0);
      expect(r.unmetIncomeNeed).toBeGreaterThan(0);
    }
  });

  it("keeps unmet near zero when portfolio can fund net-of-tax need", () => {
    const rows = buildRetirementIncomeProjection({
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      clientAgeStart: 70,
      clientRetirementAge: 65,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      baseRetirementNeedAnnual: 80_000,
      needInflationAnnual: 0,
      baseSocialSecurityClientAnnual: 0,
      baseSocialSecuritySpouseAnnual: 0,
      clientSocialSecurityStartAge: 67,
      initialTotalPortfolio: 2_000_000,
      initialQualifiedPortfolio: 2_000_000,
      portfolioReturnAnnual: 0.05,
      horizonYears: 3,
      spendTargetNetOfTax: true,
      effectiveTaxRateAnnual: 0.25,
    });
    const funded = rows.filter((r) => r.incomeNeed > 0 && r.endingPortfolio > 0);
    expect(funded.length).toBeGreaterThan(0);
    for (const r of funded) {
      expect(r.unmetIncomeNeed).toBeLessThanOrEqual(1);
    }
  });

  it("does not report false surplus after depletion in net-of-tax mode", () => {
    const rows = buildRetirementIncomeProjection({
      ...baseInput,
      married: false,
      spouseAgeStart: null,
      clientAgeStart: 65,
      clientRetirementAge: 65,
      earnedClientAnnual: 0,
      earnedSpouseAnnual: 0,
      baseRetirementNeedAnnual: 1_000_000,
      needInflationAnnual: 0.03,
      baseSocialSecurityClientAnnual: 50_000,
      baseSocialSecuritySpouseAnnual: 0,
      clientSocialSecurityStartAge: 67,
      socialSecurityColaAnnual: 0.02,
      basePensionAnnual: 15_000,
      pensionColaAnnual: 0.01,
      baseOtherIncomeAnnual: 10_000,
      otherIncomeGrowthAnnual: 0,
      initialTotalPortfolio: 5_000_000,
      initialQualifiedPortfolio: 4_000_000,
      portfolioReturnAnnual: 0.04,
      horizonYears: 35,
      spendTargetNetOfTax: true,
      effectiveTaxRateAnnual: 0.35,
    });
    const depleted = rows.filter((r) => r.endingPortfolio <= 0 && r.incomeNeed > 0);
    expect(depleted.length).toBeGreaterThan(0);
    for (const r of depleted) {
      expect(r.unmetIncomeNeed).toBeGreaterThan(1000);
      const pretaxSources =
        r.socialSecurity + r.pension + r.otherIncome + r.rmd + r.portfolioWithdrawalBeyondRmd;
      expect(pretaxSources).toBeLessThan(r.incomeNeed);
    }
  });
});
