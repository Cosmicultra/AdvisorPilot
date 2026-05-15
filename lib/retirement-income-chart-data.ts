import type { RetirementIncomeProjectionRow } from "@/lib/retirement-income-projection";

/** One row of data for the retirement income stacked bar chart (advisor UI). */
export type RetirementIncomeChartRow = {
  year: number;
  age: number;
  incomeNeed: number;
  earnedIncome: number;
  socialSecurity: number;
  pension: number;
  otherIncome: number;
  rmd: number;
  incomeGapWithdrawal: number;
  totalWithdrawalsPreTax: number;
  portfolioEnd: number;
  /** True when RMD applies this year (for axis emphasis). */
  hasRmd: boolean;
};

export type RetirementIncomeChartSummary = {
  yearsFullyFunded: number;
  totalUnmetNeed: number;
  highestGapYear: number | null;
  highestGapAge: number | null;
  highestGapAmount: number;
  /** Last client age in the series with a positive ending portfolio (illustrative). */
  portfolioLongevityAge: number | null;
  /** First client age where ending portfolio is zero (if any). */
  firstPortfolioDepletionAge: number | null;
  /** Sum of annual deficits discounted to the first row year (illustrative). */
  presentValueUnmetNeed: number;
};

export function mapRetirementIncomeProjectionToChartRows(
  rows: RetirementIncomeProjectionRow[],
): RetirementIncomeChartRow[] {
  return rows.map((r) => ({
    year: r.calendarYear,
    age: r.clientAge,
    incomeNeed: r.incomeNeed,
    earnedIncome: r.earnedIncome,
    socialSecurity: r.socialSecurity,
    pension: r.pension,
    otherIncome: r.otherIncome,
    rmd: r.rmd,
    incomeGapWithdrawal: r.portfolioWithdrawalBeyondRmd,
    totalWithdrawalsPreTax: r.totalPortfolioWithdrawal,
    portfolioEnd: r.endingPortfolio,
    hasRmd: r.rmd > 1e-6,
  }));
}

function totalIncomeSources(r: RetirementIncomeChartRow): number {
  return (
    r.earnedIncome +
    r.socialSecurity +
    r.pension +
    r.otherIncome +
    r.rmd +
    r.incomeGapWithdrawal
  );
}

function deficit(r: RetirementIncomeChartRow): number {
  const need = Math.max(0, r.incomeNeed);
  const src = totalIncomeSources(r);
  return Math.max(0, need - src);
}

/**
 * Summary metrics for the chart footer. Deficits and PV are illustrative only.
 */
export function computeRetirementIncomeChartSummary(
  rows: RetirementIncomeChartRow[],
  opts?: { discountRateAnnual?: number },
): RetirementIncomeChartSummary {
  const discount = Number.isFinite(opts?.discountRateAnnual ?? 0.03)
    ? Math.max(0, Math.min(0.2, opts?.discountRateAnnual ?? 0.03))
    : 0.03;

  let yearsFullyFunded = 0;
  let totalUnmetNeed = 0;
  let highestGapAmount = 0;
  let highestGapYear: number | null = null;
  let highestGapAge: number | null = null;
  let pvUnmet = 0;

  rows.forEach((r, idx) => {
    const need = Math.max(0, r.incomeNeed);
    const src = totalIncomeSources(r);
    const def = deficit(r);
    if (need <= 0) return;
    if (src + 1e-6 >= need) yearsFullyFunded += 1;
    if (def > 0) {
      totalUnmetNeed += def;
      pvUnmet += def / (1 + discount) ** idx;
      if (def > highestGapAmount + 1e-6) {
        highestGapAmount = def;
        highestGapYear = r.year;
        highestGapAge = r.age;
      }
    }
  });

  let portfolioLongevityAge: number | null = null;
  let firstPortfolioDepletionAge: number | null = null;
  for (const r of rows) {
    if (r.portfolioEnd > 0) portfolioLongevityAge = r.age;
    if (r.portfolioEnd <= 0 && firstPortfolioDepletionAge == null) firstPortfolioDepletionAge = r.age;
  }

  return {
    yearsFullyFunded,
    totalUnmetNeed,
    highestGapYear,
    highestGapAge,
    highestGapAmount,
    portfolioLongevityAge,
    firstPortfolioDepletionAge,
    presentValueUnmetNeed: pvUnmet,
  };
}
