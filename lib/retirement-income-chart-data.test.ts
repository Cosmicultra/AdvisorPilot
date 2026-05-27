import { describe, expect, it } from "vitest";
import {
  computeRetirementIncomeChartSummary,
  mapRetirementIncomeProjectionToChartRows,
  type RetirementIncomeChartRow,
} from "@/lib/retirement-income-chart-data";
import type { RetirementIncomeProjectionRow } from "@/lib/retirement-income-projection";

const sampleProjection: RetirementIncomeProjectionRow[] = [
  {
    yearOffset: 0,
    calendarYear: 2030,
    clientAge: 65,
    spouseAge: 63,
    earnedIncome: 0,
    incomeNeed: 80_000,
    socialSecurity: 30_000,
    pension: 10_000,
    otherIncome: 0,
    rmd: 0,
    portfolioWithdrawalBeyondRmd: 40_000,
    totalPortfolioWithdrawal: 40_000,
    beginningPortfolio: 1_000_000,
    endingPortfolio: 980_000,
    unmetIncomeNeed: 0,
  },
  {
    yearOffset: 1,
    calendarYear: 2031,
    clientAge: 66,
    spouseAge: 64,
    earnedIncome: 0,
    incomeNeed: 82_400,
    socialSecurity: 30_600,
    pension: 10_200,
    otherIncome: 0,
    rmd: 0,
    portfolioWithdrawalBeyondRmd: 50_000,
    totalPortfolioWithdrawal: 50_000,
    beginningPortfolio: 980_000,
    endingPortfolio: 940_000,
    unmetIncomeNeed: 0,
  },
];

describe("mapRetirementIncomeProjectionToChartRows", () => {
  it("maps projection fields to chart row shape", () => {
    const out = mapRetirementIncomeProjectionToChartRows(sampleProjection);
    expect(out[0]).toMatchObject({
      year: 2030,
      age: 65,
      incomeNeed: 80_000,
      incomeGapWithdrawal: 40_000,
      totalWithdrawalsPreTax: 40_000,
      portfolioEnd: 980_000,
      hasRmd: false,
    });
  });
});

describe("computeRetirementIncomeChartSummary", () => {
  it("counts fully funded years and deficits", () => {
    const rows: RetirementIncomeChartRow[] = [
      {
        year: 2030,
        age: 65,
        incomeNeed: 100_000,
        earnedIncome: 100_000,
        socialSecurity: 0,
        pension: 0,
        otherIncome: 0,
        rmd: 0,
        incomeGapWithdrawal: 0,
        totalWithdrawalsPreTax: 0,
        portfolioEnd: 1e6,
        unmetIncomeNeed: 0,
        hasRmd: false,
      },
      {
        year: 2031,
        age: 66,
        incomeNeed: 100_000,
        earnedIncome: 50_000,
        socialSecurity: 0,
        pension: 0,
        otherIncome: 0,
        rmd: 0,
        incomeGapWithdrawal: 40_000,
        totalWithdrawalsPreTax: 40_000,
        portfolioEnd: 900_000,
        unmetIncomeNeed: 10_000,
        hasRmd: false,
      },
    ];
    const s = computeRetirementIncomeChartSummary(rows, { discountRateAnnual: 0 });
    expect(s.yearsFullyFunded).toBe(1);
    expect(s.totalUnmetNeed).toBe(10_000);
    expect(s.highestGapAmount).toBe(10_000);
    expect(s.highestGapAge).toBe(66);
  });
});
