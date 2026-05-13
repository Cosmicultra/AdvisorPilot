/**
 * Hypothetical FIA crediting using firm S&P 500 calendar-year calibration (see ten-year-scenario-models).
 * Annual point-to-point style: 0% when index is down; otherwise min(cap, index return). Not a carrier illustration.
 */

import type { FiaWorksheet } from "@/lib/fia-worksheet";
import { parseMoneyInput, parsePct } from "@/lib/fia-worksheet";
import {
  SP500_ANNUAL_TOTAL_RETURN_PCT,
  TEN_YEAR_SCENARIOS,
  annualizedReturnDecimalFromAnnualPcts,
} from "@/lib/ten-year-scenario-models";
import { uniformLifetimeRmdDivisor } from "@/lib/roth-conversion-analysis";

export type FiaYearSimulationRow = {
  year: number;
  /** Client age during this contract year (for RMD illustration). */
  contractAge: number | null;
  sp500TotalReturnPct: number;
  creditedRatePct: number;
  startingContractValue: number;
  /** Illustrative required minimum distribution from qualified balance at BOY (Uniform Lifetime; age 73+). */
  rmdWithdrawal: number;
  interestCredit: number;
  endingContractValue: number;
  riderBenefitBase: number;
};

export type FiaScenarioSummary = {
  scenarioId: string;
  label: string;
  /** Short tab label for year-by-year path */
  tabLabel: string;
  years: readonly number[];
  annualizedCreditedReturnPct: number;
  endingContractValue: number;
  endingRiderBenefitBase: number;
  /** Sum of illustrative RMDs over the 10-year window (qualified + age 73+ rules only). */
  totalRmdDuringWindow: number;
  rows: FiaYearSimulationRow[];
};

function lookupSp500(year: number): number {
  const v = SP500_ANNUAL_TOTAL_RETURN_PCT[year];
  if (!Number.isFinite(v)) return Number.NaN;
  return v!;
}

/** Credited index rate for one segment year: floor 0, cap applies on upside. */
export function creditedIndexRatePct(indexReturnPct: number, capPct: number): number {
  if (!Number.isFinite(indexReturnPct) || !Number.isFinite(capPct)) return 0;
  if (indexReturnPct < 0) return 0;
  const cap = Math.max(0, capPct);
  return Math.min(cap, indexReturnPct);
}

const FIA_SCENARIO_TAB_LABEL: Record<string, string> = {
  low_recent_2000_2009: "Lowest",
  high_recent_2010_2019: "Highest",
  most_recent_2016_2025: "Most recent",
};

export function fiaScenarioTabLabel(scenarioId: string): string {
  return FIA_SCENARIO_TAB_LABEL[scenarioId] ?? scenarioId;
}

export type SimulateFiaOptions = {
  premium: number;
  capPct: number;
  premiumBonusPct: number;
  trailingBonusPct: number;
  trailBonusYears: number;
  hasRider: boolean;
  riderGuaranteePct: number;
  contractEarningsAddToRider: boolean;
  riderFeePct: number;
  /**
   * Age at contract year 1. When set (qualified illustration), Uniform Lifetime RMD applies from age 73
   * on beginning-of-year account value before interest credit.
   */
  rmdClientStartingAge: number | null;
};

export function simulateFiaTenYearWindow(
  years: readonly number[],
  opts: SimulateFiaOptions
): {
  rows: FiaYearSimulationRow[];
  endingContractValue: number;
  endingRiderBenefitBase: number;
  annualizedCreditedReturnPct: number;
  totalRmdDuringWindow: number;
} {
  if (years.length !== 10 || opts.premium <= 0) {
    return {
      rows: [],
      endingContractValue: 0,
      endingRiderBenefitBase: 0,
      annualizedCreditedReturnPct: Number.NaN,
      totalRmdDuringWindow: 0,
    };
  }

  let contractValue = opts.premium * (1 + opts.premiumBonusPct / 100);
  const initialAfterBonus = contractValue;
  let riderBase = opts.hasRider ? initialAfterBonus : 0;

  const creditedRatesForCagr: number[] = [];
  const rows: FiaYearSimulationRow[] = [];

  for (let i = 0; i < years.length; i++) {
    const year = years[i]!;
    const sp = lookupSp500(year);
    const indexCreditPct = creditedIndexRatePct(sp, opts.capPct);
    /** Contract anniversary years are 1..10 for a 10-calendar-year path; trailing bonus applies to years 1..trailBonusYears. */
    const contractYear = i + 1;
    const inTrailWindow =
      opts.trailingBonusPct > 0 &&
      opts.trailBonusYears > 0 &&
      contractYear >= 1 &&
      contractYear <= opts.trailBonusYears;
    const credPct = inTrailWindow ? indexCreditPct + opts.trailingBonusPct : indexCreditPct;

    const startVal = contractValue;
    const contractAge =
      opts.rmdClientStartingAge != null && Number.isFinite(opts.rmdClientStartingAge)
        ? Math.floor(opts.rmdClientStartingAge) + i
        : null;
    const divisor = contractAge != null ? uniformLifetimeRmdDivisor(contractAge) : null;
    const rmd = divisor != null && startVal > 0 ? Math.min(startVal, startVal / divisor) : 0;
    const afterRmd = startVal - rmd;

    const interest = afterRmd * (credPct / 100);
    let endVal = afterRmd + interest;

    if (opts.hasRider && opts.riderFeePct > 0) {
      endVal *= 1 - opts.riderFeePct / 100;
    }

    if (opts.hasRider) {
      if (opts.riderGuaranteePct > 0) {
        riderBase *= 1 + opts.riderGuaranteePct / 100;
      }
      if (opts.contractEarningsAddToRider) {
        riderBase += interest;
      }
    }

    creditedRatesForCagr.push(credPct);

    rows.push({
      year,
      contractAge,
      sp500TotalReturnPct: sp,
      creditedRatePct: credPct,
      startingContractValue: startVal,
      rmdWithdrawal: rmd,
      interestCredit: interest,
      endingContractValue: endVal,
      riderBenefitBase: riderBase,
    });

    contractValue = endVal;
  }

  const totalRmdDuringWindow = rows.reduce((s, r) => s + r.rmdWithdrawal, 0);

  const cagrDec = annualizedReturnDecimalFromAnnualPcts(creditedRatesForCagr);
  const annualizedCreditedReturnPct = Number.isFinite(cagrDec) ? cagrDec * 100 : Number.NaN;

  return {
    rows,
    endingContractValue: contractValue,
    endingRiderBenefitBase: riderBase,
    annualizedCreditedReturnPct,
    totalRmdDuringWindow,
  };
}

export function worksheetToSimulateOptions(
  ws: FiaWorksheet,
  premium: number,
  clientAge: number | null = null
): SimulateFiaOptions | null {
  if (!(premium > 0)) return null;
  const cap = parsePct(ws.contractCapRatePct);
  if (!(cap > 0)) return null;

  const trailingBonusPct = parsePct(ws.trailingBonusPct);
  let trailBonusYears = Math.max(0, Math.floor(Number(String(ws.trailBonusYears).trim()) || 0));
  if (trailingBonusPct > 0 && trailBonusYears === 0) {
    trailBonusYears = 10;
  }

  const ageFloor =
    clientAge != null && Number.isFinite(clientAge) ? Math.floor(clientAge) : null;
  const rmdClientStartingAge = ws.premiumSource === "qualified" && ageFloor != null ? ageFloor : null;

  return {
    premium,
    capPct: cap,
    premiumBonusPct: parsePct(ws.premiumBonusPct),
    trailingBonusPct,
    trailBonusYears,
    hasRider: ws.hasIncomeRider === true,
    riderGuaranteePct: parsePct(ws.incomeRiderGuaranteePct),
    contractEarningsAddToRider: ws.contractEarningsAddToRiderBase === true,
    riderFeePct: parsePct(ws.incomeRiderFeePct),
    rmdClientStartingAge,
  };
}

export function defaultPremiumForWorksheet(
  ws: FiaWorksheet,
  qualifiedTotal: number,
  nonQualifiedTotal: number
): number {
  const fromRegistration = (registrationTotal: number): number => {
    const cap = Math.max(0, registrationTotal);
    const override = parseMoneyInput(ws.registrationPremiumOverride);
    if (cap > 0) {
      if (override > 0) return Math.min(override, cap);
      return cap;
    }
    return override > 0 ? override : 0;
  };

  switch (ws.premiumSource) {
    case "qualified":
      return fromRegistration(qualifiedTotal);
    case "non_qualified":
      return fromRegistration(nonQualifiedTotal);
    case "custom":
      return parseMoneyInput(ws.premiumAmount);
    default:
      return 0;
  }
}

export function buildFiaScenarioSummaries(
  ws: FiaWorksheet,
  premium: number,
  clientAge: number | null = null
): FiaScenarioSummary[] {
  const opts = worksheetToSimulateOptions(ws, premium, clientAge);
  if (!opts) return [];

  return TEN_YEAR_SCENARIOS.map((sc) => {
    const sim = simulateFiaTenYearWindow(sc.years, opts);
    return {
      scenarioId: sc.id,
      label: sc.label,
      tabLabel: fiaScenarioTabLabel(sc.id),
      years: sc.years,
      annualizedCreditedReturnPct: sim.annualizedCreditedReturnPct,
      endingContractValue: sim.endingContractValue,
      endingRiderBenefitBase: sim.endingRiderBenefitBase,
      totalRmdDuringWindow: sim.totalRmdDuringWindow,
      rows: sim.rows,
    };
  });
}
