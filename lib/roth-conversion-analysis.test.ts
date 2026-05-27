import { describe, expect, it } from "vitest";
import {
  buildRothConversionModel,
  computeFicRothGrowthRateForYear,
  maxGrossConversionRespectingRothFloor,
  ROTH_ASSUMPTION_VERSION,
  rothPathGrowthAnnual,
  rothPathReturnForAge,
} from "./roth-conversion-analysis";
import { standardDeductionBreakdownIllustration } from "./federal-tax-illustration";

const baseInput = {
  totalAccountValue: 500_000,
  currentAge: 65,
  retirementAge: 67,
  retirementSpendableIncomeAnnual: 80_000,
  federalTaxBracketId: "22",
  retirementIncomeFromConversionAccount: true,
};

describe("roth-conversion-analysis", () => {
  it("uses the documented legacy age-based Roth path helper (still exported)", () => {
    expect(rothPathReturnForAge(69)).toBe(0.04);
    expect(rothPathReturnForAge(70)).toBe(0.1);
  });

  it("uses worksheet FIC percent when provided", () => {
    expect(
      rothPathGrowthAnnual({ useFixedIndexContract: true, contractEstimatedRateOfReturnPct: "7.5" })
    ).toBeCloseTo(0.075);
  });

  it("report Income column: AGI-only pre-retirement, retirement income only after retirement age", () => {
    const model = buildRothConversionModel({
      ...baseInput,
      annualAdjustedGrossIncomePreRetirement: 200_000,
      marriedFilingJointly: false,
    });
    const pre = model.stayTraditional.find((r) => r.age === 65);
    const post = model.stayTraditional.find((r) => r.age === 67);
    expect(pre?.reportIncomeAnnual).toBe(200_000);
    expect(post?.reportIncomeAnnual).toBe(80_000);
    const rothPre = model.rothConversion.find((r) => r.age === 65);
    const rothPost = model.rothConversion.find((r) => r.age === 67);
    expect(rothPre?.reportIncomeAnnual).toBe(200_000);
    expect(rothPost?.reportIncomeAnnual).toBe(80_000);
  });

  it("builds rows through age 95 and preserves core inputs", () => {
    const model = buildRothConversionModel({
      ...baseInput,
      annualSocialSecurityGross: 30_000,
      marriedFilingJointly: false,
    });

    expect(model.startingBalance).toBe(500_000);
    expect(model.stayTraditional[0]?.age).toBe(65);
    expect(model.stayTraditional.at(-1)?.age).toBe(95);
    expect(model.rothConversion.length).toBe(model.stayTraditional.length);
    expect(model.rothConversionTotals.totalGrossConversion).toBeGreaterThan(0);
    expect(model.assumptions[0]).toContain(ROTH_ASSUMPTION_VERSION);
  });

  it("uses flat 10% Roth path growth without FIC worksheet path", () => {
    const model = buildRothConversionModel({
      ...baseInput,
      annualSocialSecurityGross: 30_000,
      marriedFilingJointly: false,
      useFixedIndexContract: false,
    });
    expect(model.rothConversion[0]?.growthRate).toBeCloseTo(0.1);
    expect(model.rothPathStartingQualifiedBalance).toBe(model.startingBalance);
  });

  it("when income is not from conversion account, IRA distributions are RMD-only in retirement", () => {
    const model = buildRothConversionModel({
      ...baseInput,
      annualSocialSecurityGross: 0,
      marriedFilingJointly: false,
      retirementIncomeFromConversionAccount: false,
      endAge: 75,
    });
    const retiredWithRmd = model.stayTraditional.find((r) => r.age === 73);
    expect(retiredWithRmd).toBeDefined();
    if (!retiredWithRmd) return;
    expect(retiredWithRmd.portfolioIncomeShortfall).toBe(0);
    expect(retiredWithRmd.nonIraRetirementIncome).toBe(80_000);
    expect(retiredWithRmd.totalIraDistribution).toBe(retiredWithRmd.rmd);
    expect(retiredWithRmd.totalOrdinaryForIllustration).toBe(80_000 + retiredWithRmd.rmd);
  });

  it("when income is from conversion account, IRA funds retirement shortfall", () => {
    const model = buildRothConversionModel({
      ...baseInput,
      annualSocialSecurityGross: 0,
      marriedFilingJointly: false,
      retirementIncomeFromConversionAccount: true,
      endAge: 75,
    });
    const retired = model.stayTraditional.find((r) => r.age === 67);
    expect(retired).toBeDefined();
    if (!retired) return;
    expect(retired.portfolioIncomeShortfall).toBe(80_000);
    expect(retired.nonIraRetirementIncome).toBe(0);
    expect(retired.totalIraDistribution).toBeGreaterThanOrEqual(80_000);
  });

  it("applies 65+ additional standard deduction in tax years", () => {
    const under65 = buildRothConversionModel({
      ...baseInput,
      currentAge: 64,
      endAge: 64,
      marriedFilingJointly: false,
      annualAdjustedGrossIncomePreRetirement: 100_000,
    });
    const at65 = buildRothConversionModel({
      ...baseInput,
      currentAge: 65,
      endAge: 65,
      marriedFilingJointly: false,
      annualAdjustedGrossIncomePreRetirement: 100_000,
    });
    expect(at65.stayTraditional[0]!.additionalDeduction65Plus).toBe(1_550);
    expect(at65.stayTraditional[0]!.illustrativeFederalTax).toBeLessThan(
      under65.stayTraditional[0]!.illustrativeFederalTax
    );
  });

  it("applies state tax when rate is provided", () => {
    const model = buildRothConversionModel({
      ...baseInput,
      currentAge: 73,
      endAge: 73,
      marriedFilingJointly: false,
      stateTaxRatePct: "1",
      retirementIncomeFromConversionAccount: false,
    });
    expect(model.stayTraditional[0]!.illustrativeStateTax).toBeGreaterThan(0);
  });

  it("FIC: premium bonus inflates Roth-path starting balance only", () => {
    const model = buildRothConversionModel({
      totalAccountValue: 800_000,
      currentAge: 65,
      retirementAge: 80,
      retirementSpendableIncomeAnnual: 60_000,
      federalTaxBracketId: "22",
      marriedFilingJointly: false,
      useFixedIndexContract: true,
      contractEstimatedRateOfReturnPct: "4",
      ficPremiumBonusPct: "11",
      retirementIncomeFromConversionAccount: true,
    });
    expect(model.startingBalance).toBe(800_000);
    expect(model.rothPathStartingQualifiedBalance).toBeCloseTo(888_000);
    expect(model.rothConversion[0]?.yearStartTraditional).toBeCloseTo(888_000);
    expect(model.stayTraditional[0]?.yearStartBalance).toBeCloseTo(800_000);
  });

  it("FIC: trailing bonus + surrender yields contract+trail, then contract, then current allocation rate", () => {
    /** Offsets 0–2: 4%+4%; 3–9: 4%; from 10+: 10% */
    const rates = [0, 1, 2, 3, 9, 10].map((off) =>
      computeFicRothGrowthRateForYear({
        yearOffset: off,
        surrenderYears: 10,
        trailBonusYears: 3,
        contractRateAnnual: 0.04,
        trailingBonusAnnual: 0.04,
        postSurrenderRateAnnual: 0.1,
      })
    );
    expect(rates[0]).toBeCloseTo(0.08);
    expect(rates[1]).toBeCloseTo(0.08);
    expect(rates[2]).toBeCloseTo(0.08);
    expect(rates[3]).toBeCloseTo(0.04);
    expect(rates[4]).toBeCloseTo(0.04);
    expect(rates[5]).toBeCloseTo(0.1);

    const model = buildRothConversionModel({
      totalAccountValue: 100_000,
      currentAge: 65,
      retirementAge: 80,
      retirementSpendableIncomeAnnual: 40_000,
      federalTaxBracketId: "22",
      marriedFilingJointly: false,
      useFixedIndexContract: true,
      contractEstimatedRateOfReturnPct: "4",
      ficTrailingBonusPct: "4",
      ficTrailBonusYears: "3",
      ficSurrenderYears: "10",
      endAge: 75,
      stayTraditionalReturn: 0.1,
      retirementIncomeFromConversionAccount: true,
    });
    const growthByAge = (a: number) => model.rothConversion.find((r) => r.age === a)?.growthRate;
    expect(growthByAge(65)).toBeCloseTo(0.08);
    expect(growthByAge(67)).toBeCloseTo(0.08);
    expect(growthByAge(68)).toBeCloseTo(0.04);
    expect(growthByAge(73)).toBeCloseTo(0.04);
    expect(growthByAge(74)).toBeCloseTo(0.04);
    expect(growthByAge(75)).toBeCloseTo(0.1);
  });

  it("protect off: depletes traditional by retirement with bracket-max conversions (FIA-style)", () => {
    const model = buildRothConversionModel({
      totalAccountValue: 1_170_419,
      currentAge: 60,
      retirementAge: 67,
      retirementSpendableIncomeAnnual: 85_000,
      federalTaxBracketId: "32",
      marriedFilingJointly: true,
      annualAdjustedGrossIncomePreRetirement: 250_000,
      protectInitialInvestment: false,
      useFixedIndexContract: true,
      contractEstimatedRateOfReturnPct: "4",
      ficPremiumBonusPct: "10",
      retirementIncomeFromConversionAccount: true,
      endAge: 72,
    });
    const atRetire = model.rothConversion.find((r) => r.age === 67);
    expect(atRetire).toBeDefined();
    if (!atRetire) return;
    expect(atRetire.endTraditionalBalance).toBeLessThanOrEqual(1);
    expect(atRetire.rothOnlyPhase || atRetire.endTraditionalBalance <= 1).toBe(true);
  });

  it("protect on: same pace as bracket max — not amortization-sized conversions at age 67", () => {
    const shared = {
      totalAccountValue: 800_000,
      currentAge: 60,
      retirementAge: 67,
      retirementSpendableIncomeAnnual: 85_000,
      federalTaxBracketId: "32",
      marriedFilingJointly: true,
      annualAdjustedGrossIncomePreRetirement: 250_000,
      useFixedIndexContract: true,
      contractEstimatedRateOfReturnPct: "4",
      retirementIncomeFromConversionAccount: true,
      endAge: 72,
    };
    const withProtect = buildRothConversionModel({ ...shared, protectInitialInvestment: true });
    const withoutProtect = buildRothConversionModel({ ...shared, protectInitialInvestment: false });
    const protectAt67 = withProtect.rothConversion.find((r) => r.age === 67);
    const offAt67 = withoutProtect.rothConversion.find((r) => r.age === 67);
    expect(protectAt67).toBeDefined();
    expect(offAt67).toBeDefined();
    if (!protectAt67 || !offAt67) return;
    if (protectAt67.grossConversion > 0 && protectAt67.yearStartTraditional > 0) {
      const amortStyleCap = protectAt67.balanceBeforeConversion / (72 - 67 + 1);
      expect(protectAt67.grossConversion).toBeGreaterThan(amortStyleCap * 2);
    }
  });

  it("protect on: preserves Roth floor after Roth has reached entered premium", () => {
    const model = buildRothConversionModel({
      ...baseInput,
      totalAccountValue: 500_000,
      currentAge: 65,
      protectInitialInvestment: true,
      endAge: 75,
    });
    for (const row of model.rothConversion) {
      if (!row.rothOnlyPhase) {
        const rothAfterGrowth = row.yearStartRoth * (1 + row.growthRate);
        if (rothAfterGrowth >= model.startingBalance) {
          expect(row.totalRothBalance).toBeGreaterThanOrEqual(model.startingBalance);
        }
      }
    }
    const lastTrad = [...model.rothConversion].reverse().find((r) => !r.rothOnlyPhase);
    if ((lastTrad?.endTraditionalBalance ?? 1) <= 1) {
      if (model.rothConversionTotals.endingTotalRothBalance < model.startingBalance) {
        expect(
          model.assumptions.some((a) => a.includes("Protect initial investment") && a.includes("below the entered premium"))
        ).toBe(true);
      } else {
        expect(model.rothConversionTotals.endingTotalRothBalance).toBeGreaterThanOrEqual(model.startingBalance);
      }
    }
  });

  it("maxGrossConversionRespectingRothFloor returns 0 when no gross keeps Roth above floor", () => {
    const ded = standardDeductionBreakdownIllustration({
      filing: "single",
      calendarYearOffset: 0,
      clientAge: 65,
    });
    const cap = maxGrossConversionRespectingRothFloor({
      rothBalanceAfterGrowth: 100_000,
      maxGross: 500_000,
      otherGrossOrdinaryForBracketCap: 80_000,
      protectedPrincipalFloor: 500_000,
      deduction: { filing: "single", calendarYearOffset: 0, clientAge: 65 },
      stateTaxRateFraction: 0,
    });
    expect(cap).toBe(0);
    expect(ded.total).toBeGreaterThan(0);
  });
});
