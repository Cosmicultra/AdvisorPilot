import { describe, expect, it } from "vitest";
import {
  buildRothConversionModel,
  computeFicRothGrowthRateForYear,
  ROTH_ASSUMPTION_VERSION,
  rothPathGrowthAnnual,
  rothPathReturnForAge,
} from "./roth-conversion-analysis";

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
      totalAccountValue: 500_000,
      currentAge: 65,
      retirementAge: 67,
      retirementSpendableIncomeAnnual: 80_000,
      annualAdjustedGrossIncomePreRetirement: 200_000,
      federalTaxBracketId: "22",
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
      totalAccountValue: 500_000,
      currentAge: 65,
      retirementAge: 67,
      retirementSpendableIncomeAnnual: 80_000,
      annualSocialSecurityGross: 30_000,
      federalTaxBracketId: "22",
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
      totalAccountValue: 500_000,
      currentAge: 65,
      retirementAge: 67,
      retirementSpendableIncomeAnnual: 80_000,
      annualSocialSecurityGross: 30_000,
      federalTaxBracketId: "22",
      marriedFilingJointly: false,
      useFixedIndexContract: false,
    });
    expect(model.rothConversion[0]?.growthRate).toBeCloseTo(0.1);
    expect(model.rothPathStartingQualifiedBalance).toBe(model.startingBalance);
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
    });
    const growthByAge = (a: number) => model.rothConversion.find((r) => r.age === a)?.growthRate;
    expect(growthByAge(65)).toBeCloseTo(0.08);
    expect(growthByAge(67)).toBeCloseTo(0.08);
    expect(growthByAge(68)).toBeCloseTo(0.04);
    expect(growthByAge(73)).toBeCloseTo(0.04);
    expect(growthByAge(74)).toBeCloseTo(0.04);
    expect(growthByAge(75)).toBeCloseTo(0.1);
  });
});
