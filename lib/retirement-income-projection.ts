import { uniformLifetimeRmdDivisor } from "@/lib/roth-conversion-analysis";

export type RetirementIncomeProjectionRow = {
  yearOffset: number;
  calendarYear: number;
  clientAge: number;
  spouseAge: number | null;
  earnedIncome: number;
  incomeNeed: number;
  socialSecurity: number;
  pension: number;
  otherIncome: number;
  rmd: number;
  portfolioWithdrawalBeyondRmd: number;
  /** RMD plus additional portfolio withdrawal (pretax dollars out). */
  totalPortfolioWithdrawal: number;
  beginningPortfolio: number;
  endingPortfolio: number;
  /** Shortfall vs incomeNeed (after-tax when spendTargetNetOfTax). Same basis as incomeNeed. */
  unmetIncomeNeed: number;
};

export type RetirementIncomeProjectionInput = {
  /** First projection row: client's integer age. */
  clientAgeStart: number;
  spouseAgeStart: number | null;
  married: boolean;
  clientRetirementAge: number;
  spouseRetirementAge: number;
  /** Annual dollars while still working (pre-retirement). */
  earnedClientAnnual: number;
  earnedSpouseAnnual: number;
  /** Retirement spend target at the start of the first fully-retired year (today's dollars). */
  baseRetirementNeedAnnual: number;
  /** Inflation on retirement spending (decimal, e.g. 0.03). */
  needInflationAnnual: number;
  /** Client SS annual benefit at first year of payment (pretax illustration). */
  baseSocialSecurityClientAnnual: number;
  /** Spouse SS annual at first payment (0 if not married / no spouse benefit). */
  baseSocialSecuritySpouseAnnual: number;
  /** Client age when SS payments begin (illustration). */
  clientSocialSecurityStartAge: number;
  /** Spouse age when SS payments begin (ignored if not married). */
  spouseSocialSecurityStartAge: number;
  /** SS COLA (decimal, e.g. 0.02), applied per year in pay status from each person's start age. */
  socialSecurityColaAnnual: number;
  basePensionAnnual: number;
  /** Pension COLA as decimal per year (e.g. 0.01). */
  pensionColaAnnual: number;
  baseOtherIncomeAnnual: number;
  /** Other recurring income growth (decimal per year). */
  otherIncomeGrowthAnnual: number;
  /** Total investable portfolio (all wrappers) at start. */
  initialTotalPortfolio: number;
  /** Traditional tax-deferred balance at start (RMD base). */
  initialQualifiedPortfolio: number;
  /** Constant annual return on portfolio (decimal, e.g. 0.06). */
  portfolioReturnAnnual: number;
  horizonYears: number;
  /** Calendar year for row labels (e.g. new Date().getFullYear()). */
  startCalendarYear: number;
  /**
   * When true, `incomeNeed` is treated as after-tax lifestyle need. A flat `effectiveTaxRateAnnual`
   * scales earned income, SS, pension, other, RMD, and additional withdrawals as fully taxable ordinary
   * income for an illustrative residual withdrawal. Not tax advice.
   */
  spendTargetNetOfTax: boolean;
  /** Decimal 0–0.95; ignored when spendTargetNetOfTax is false. */
  effectiveTaxRateAnnual: number;
};

function clampNonNeg(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function clampTaxRate(t: number): number {
  if (!Number.isFinite(t) || t < 0) return 0;
  if (t > 0.95) return 0.95;
  return t;
}

function isFullyRetired(
  y: number,
  opts: {
    clientAgeStart: number;
    spouseAgeStart: number | null;
    married: boolean;
    clientRetirementAge: number;
    spouseRetirementAge: number;
  },
): boolean {
  const ageC = opts.clientAgeStart + y;
  const clientDone = ageC >= opts.clientRetirementAge;
  if (!opts.married || opts.spouseAgeStart == null) return clientDone;
  const ageS = opts.spouseAgeStart + y;
  const spouseDone = ageS >= opts.spouseRetirementAge;
  return clientDone && spouseDone;
}

function firstFullyRetiredYearIndex(input: RetirementIncomeProjectionInput): number | null {
  for (let y = 0; y < input.horizonYears; y++) {
    if (isFullyRetired(y, input)) return y;
  }
  return null;
}

/** Annual SS (pretax illustration) for a person in pay status with COLA from first payment year. */
function socialSecurityAnnualAtAge(
  age: number | null,
  startAge: number,
  baseAtFirstPayment: number,
  cola: number,
): number {
  if (age == null || baseAtFirstPayment <= 0) return 0;
  if (age < startAge) return 0;
  const c = Number.isFinite(cola) ? cola : 0;
  const yearsInPay = age - startAge;
  return clampNonNeg(baseAtFirstPayment * (1 + c) ** yearsInPay);
}

/** Illustrative spendable income funded in the same basis as incomeNeed. */
function spendableIncomeFunded(
  opts: {
    earned: number;
    ss: number;
    pension: number;
    other: number;
    rmdActual: number;
    gapActual: number;
    useNetTax: boolean;
    omt: number;
  },
): number {
  const pretax = opts.earned + opts.ss + opts.pension + opts.other + opts.rmdActual + opts.gapActual;
  return opts.useNetTax ? pretax * opts.omt : pretax;
}

/**
 * Illustrative year-by-year retirement income bridge: need vs. sources and portfolio balance.
 * Not tax advice; RMD uses Uniform Lifetime divisors on the qualified balance only (client age).
 */
export function buildRetirementIncomeProjection(input: RetirementIncomeProjectionInput): RetirementIncomeProjectionRow[] {
  const rows: RetirementIncomeProjectionRow[] = [];
  const firstRetY = firstFullyRetiredYearIndex(input);

  let totalB = clampNonNeg(input.initialTotalPortfolio);
  let qualB = clampNonNeg(Math.min(input.initialQualifiedPortfolio, totalB || input.initialQualifiedPortfolio));
  const r = Number.isFinite(input.portfolioReturnAnnual) ? input.portfolioReturnAnnual : 0;

  const useNetTax = input.spendTargetNetOfTax === true;
  const t = useNetTax ? clampTaxRate(input.effectiveTaxRateAnnual) : 0;
  const omt = 1 - t;

  const rawStartC = Math.floor(Number(input.clientSocialSecurityStartAge));
  const rawStartS = Math.floor(Number(input.spouseSocialSecurityStartAge));
  const clientSsStart =
    Number.isFinite(rawStartC) && rawStartC >= 50 && rawStartC <= 80 ? rawStartC : 67;
  const spouseSsStart =
    Number.isFinite(rawStartS) && rawStartS >= 50 && rawStartS <= 80 ? rawStartS : 67;

  for (let y = 0; y < input.horizonYears; y++) {
    const ageC = input.clientAgeStart + y;
    const ageS = input.married && input.spouseAgeStart != null ? input.spouseAgeStart + y : null;

    const clientWorking = ageC < input.clientRetirementAge;
    const spouseWorking = input.married && ageS != null && ageS < input.spouseRetirementAge;
    const earned =
      (clientWorking ? clampNonNeg(input.earnedClientAnnual) : 0) +
      (spouseWorking ? clampNonNeg(input.earnedSpouseAnnual) : 0);

    const retiredNow = isFullyRetired(y, input);
    const retiredYears = firstRetY != null && y >= firstRetY ? y - firstRetY : -1;

    let incomeNeed = 0;
    let ss = 0;
    let pension = 0;
    let other = 0;

    if (retiredNow && retiredYears >= 0) {
      incomeNeed = clampNonNeg(input.baseRetirementNeedAnnual) * (1 + input.needInflationAnnual) ** retiredYears;
      const ssCola = Number.isFinite(input.socialSecurityColaAnnual) ? input.socialSecurityColaAnnual : 0;
      const ssC = socialSecurityAnnualAtAge(ageC, clientSsStart, clampNonNeg(input.baseSocialSecurityClientAnnual), ssCola);
      const ssSp =
        input.married && ageS != null
          ? socialSecurityAnnualAtAge(ageS, spouseSsStart, clampNonNeg(input.baseSocialSecuritySpouseAnnual), ssCola)
          : 0;
      ss = ssC + ssSp;
      pension = clampNonNeg(input.basePensionAnnual) * (1 + input.pensionColaAnnual) ** retiredYears;
      other = clampNonNeg(input.baseOtherIncomeAnnual) * (1 + input.otherIncomeGrowthAnnual) ** retiredYears;
    }

    const divisor = uniformLifetimeRmdDivisor(ageC);
    const rmdRequested = divisor != null && qualB > 0 ? Math.min(qualB, qualB / divisor) : 0;

    let gapRequested = 0;
    if (t > 1e-12 && omt > 1e-9) {
      let rem = incomeNeed;
      rem -= earned * omt + ss * omt + pension * omt + other * omt;
      const remAfterRmd = rem - rmdRequested * omt;
      gapRequested = remAfterRmd > 0 ? remAfterRmd / omt : 0;
    } else {
      const afterFixed = incomeNeed - earned - ss - pension - other;
      gapRequested = clampNonNeg(afterFixed - rmdRequested);
    }

    const qualShare = totalB > 0 ? qualB / totalB : 0;

    const beginningPortfolio = totalB;

    const totalAfterGrowth = totalB * (1 + r);
    const qualAfterGrowth = qualB * (1 + r);

    const rmdActual = Math.min(rmdRequested, qualAfterGrowth, totalAfterGrowth);
    const remainingAfterRmd = Math.max(0, totalAfterGrowth - rmdActual);
    const gapActual = Math.min(gapRequested, remainingAfterRmd);

    const totalRemoval = rmdActual + gapActual;
    const qualRemoval = Math.min(qualAfterGrowth, rmdActual + gapActual * qualShare);

    const totalEnd = Math.max(0, totalAfterGrowth - totalRemoval);
    let qualEnd = Math.max(0, qualAfterGrowth - qualRemoval);
    if (qualEnd > totalEnd) qualEnd = totalEnd;

    const funded = spendableIncomeFunded({
      earned,
      ss,
      pension,
      other,
      rmdActual,
      gapActual,
      useNetTax,
      omt,
    });
    const unmetIncomeNeed =
      retiredNow && incomeNeed > 0 ? Math.max(0, incomeNeed - funded) : 0;

    rows.push({
      yearOffset: y,
      calendarYear: input.startCalendarYear + y,
      clientAge: ageC,
      spouseAge: ageS,
      earnedIncome: earned,
      incomeNeed,
      socialSecurity: ss,
      pension,
      otherIncome: other,
      rmd: rmdActual,
      portfolioWithdrawalBeyondRmd: gapActual,
      totalPortfolioWithdrawal: rmdActual + gapActual,
      beginningPortfolio,
      endingPortfolio: totalEnd,
      unmetIncomeNeed,
    });

    totalB = totalEnd;
    qualB = qualEnd;
  }

  return rows;
}
