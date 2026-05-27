import type { FiaYearSimulationRow } from "@/lib/fia-illustration";

export type FiaScenarioVisualData = {
  windowLabel: string;
  tabLabel: string;
  capPct: number;
  startingValue: number;
  endingFia: number;
  endingSp500: number;
  wealthDelta: number;
  wealthDeltaPct: number;
  totalRmd: number;
  totalFiaInterest: number;
  downYearCount: number;
  upYearCount: number;
  /** Illustrative sum of index losses in down years (S&P path only). */
  spDownYearLossTotal: number;
  cappedUpYearCount: number;
  endingRiderBase: number | null;
  worstDownYear: { year: number; spReturnPct: number } | null;
};

export type BuildFiaScenarioVisualDataOpts = {
  capPct: number;
  windowLabel: string;
  tabLabel: string;
  showRider: boolean;
};

/**
 * Hypothetical S&P-only account in dollars: same BOY balance and illustrative RMD
 * withdrawals as the FIA row each year, then grow remainder by that year's S&P total return.
 */
export function hypotheticalSp500EndValues(rows: readonly FiaYearSimulationRow[]): number[] {
  if (rows.length === 0) return [];
  let balance = rows[0]!.startingContractValue;
  if (!Number.isFinite(balance) || balance < 0) balance = 0;
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const rmd = Number.isFinite(r.rmdWithdrawal) ? Math.max(0, r.rmdWithdrawal) : 0;
    const afterRmd = Math.max(0, balance - rmd);
    const pct = Number.isFinite(r.sp500TotalReturnPct) ? r.sp500TotalReturnPct : 0;
    balance = afterRmd * (1 + pct / 100);
    out.push(balance);
  }
  return out;
}

/** Sum of illustrative index losses in down years on the S&P path (after RMD, before return). */
export function spDownYearLossTotal(rows: readonly FiaYearSimulationRow[]): number {
  if (rows.length === 0) return 0;
  let balance = rows[0]!.startingContractValue;
  if (!Number.isFinite(balance) || balance < 0) balance = 0;
  let lossTotal = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const rmd = Number.isFinite(r.rmdWithdrawal) ? Math.max(0, r.rmdWithdrawal) : 0;
    const afterRmd = Math.max(0, balance - rmd);
    const pct = Number.isFinite(r.sp500TotalReturnPct) ? r.sp500TotalReturnPct : 0;
    if (pct < 0) {
      lossTotal += afterRmd * (pct / 100);
    }
    balance = afterRmd * (1 + pct / 100);
  }
  return Math.abs(lossTotal);
}

/**
 * Maps FIA scenario simulation rows into chart-ready comparison metrics.
 * Illustrative only — no new simulation logic.
 */
export function buildFiaScenarioVisualData(
  rows: readonly FiaYearSimulationRow[],
  opts: BuildFiaScenarioVisualDataOpts
): FiaScenarioVisualData | null {
  if (rows.length === 0) return null;

  const spEndValues = hypotheticalSp500EndValues(rows);
  const last = rows.length - 1;
  const startingValue = rows[0]!.startingContractValue;
  const endingFia = rows[last]!.endingContractValue;
  const endingSp500 = spEndValues[last] ?? 0;

  const totalRmd = rows.reduce((s, r) => s + (Number.isFinite(r.rmdWithdrawal) ? Math.max(0, r.rmdWithdrawal) : 0), 0);
  const totalFiaInterest = rows.reduce(
    (s, r) => s + (Number.isFinite(r.interestCredit) ? Math.max(0, r.interestCredit) : 0),
    0
  );

  let downYearCount = 0;
  let upYearCount = 0;
  let cappedUpYearCount = 0;
  let worstDownYear: { year: number; spReturnPct: number } | null = null;

  const cap = Math.max(0, opts.capPct);
  for (const r of rows) {
    const sp = Number.isFinite(r.sp500TotalReturnPct) ? r.sp500TotalReturnPct : 0;
    if (sp < 0) {
      downYearCount++;
      if (!worstDownYear || sp < worstDownYear.spReturnPct) {
        worstDownYear = { year: r.year, spReturnPct: sp };
      }
    } else if (sp > 0) {
      upYearCount++;
      if (cap > 0 && sp > cap) {
        cappedUpYearCount++;
      }
    }
  }

  const downLoss = spDownYearLossTotal(rows);
  const wealthDelta = endingFia - endingSp500;
  const wealthDeltaPct = endingSp500 > 0 ? (wealthDelta / endingSp500) * 100 : 0;

  const endingRiderBase =
    opts.showRider && last >= 0 ? rows[last]!.riderBenefitBase : null;

  return {
    windowLabel: opts.windowLabel,
    tabLabel: opts.tabLabel,
    capPct: cap,
    startingValue,
    endingFia,
    endingSp500,
    wealthDelta,
    wealthDeltaPct,
    totalRmd,
    totalFiaInterest,
    downYearCount,
    upYearCount,
    spDownYearLossTotal: downLoss,
    cappedUpYearCount,
    endingRiderBase,
    worstDownYear,
  };
}
