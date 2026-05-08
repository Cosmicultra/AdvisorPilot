/**
 * Decade scenarios: 10-calendar-year CAGR. Biggest-drawdown row: single modeled calendar year (defaults to 2008, worst S&P year in calibration).
 *
 * Sleeve sources:
 * - S&P 500: firm-supplied calibration for the listed scenario years.
 * - Bonds: Bloomberg US Aggregate Bond Index total return (AGG-equivalent sleeve).
 * - Cash/MM: annual-average 3-month Treasury bill rates (approximate MM proxy; not fund-specific).
 */

import { classifyAllocationBucket, isCashLikeHolding } from "./asset-classes";
import { extractLikelySymbol } from "./holding-validation";

export type ScenarioHoldingLike = {
  rawName?: string;
  suggested?: string;
  assetClass?: string;
  value?: number;
  enrichmentResolvedTicker?: string;
  normalizedSymbol?: string;
  duplicateOfIndex?: number;
};

export type TenYearScenario = {
  id: string;
  label: string;
  description: string;
  /** Inclusive calendar years — must be length 10 */
  years: readonly number[];
};

/** S&P 500 total return (%), firm calibration. */
export const SP500_ANNUAL_TOTAL_RETURN_PCT: Readonly<Record<number, number>> = {
  2000: -9.03,
  2001: -11.85,
  2002: -21.97,
  2003: 28.36,
  2004: 10.74,
  2005: 4.83,
  2006: 15.61,
  2007: 5.48,
  2008: -36.55,
  2009: 26.46,
  2010: 15.06,
  2011: 2.11,
  2012: 16.0,
  2013: 32.39,
  2014: 13.69,
  2015: 1.38,
  2016: 11.96,
  2017: 21.83,
  2018: -4.38,
  2019: 31.49,
  2020: 18.4,
  2021: 28.71,
  2022: -18.11,
  2023: 26.29,
  2024: 25.02,
  2025: 17.88,
};

/** Bloomberg US Aggregate Bond Index, calendar total return (%), AGG sleeve proxy. */
export const US_AGG_TOTAL_RETURN_PROXY_PCT: Readonly<Record<number, number>> = {
  2000: 11.6,
  2001: 8.4,
  2002: 10.3,
  2003: 4.1,
  2004: 4.3,
  2005: 2.4,
  2006: 4.3,
  2007: 7.0,
  2008: 5.2,
  2009: 5.9,
  2010: 6.5,
  2011: 7.8,
  2012: 4.2,
  2013: -2.0,
  2014: 6.0,
  2015: 0.5,
  2016: 2.6,
  2017: 3.5,
  2018: 0.0,
  2019: 8.7,
  2020: 7.5,
  2021: -1.5,
  2022: -13.0,
  2023: 5.5,
  2024: 1.7,
  2025: 7.1,
};

/** Treasury bill annual average (%) — cash / MM proxy. */
export const TREASURY_BILL_MM_PROXY_PCT: Readonly<Record<number, number>> = {
  2000: 5.82,
  2001: 3.4,
  2002: 1.61,
  2003: 1.01,
  2004: 1.37,
  2005: 3.15,
  2006: 4.73,
  2007: 4.36,
  2008: 1.37,
  2009: 0.15,
  2010: 0.13,
  2011: 0.05,
  2012: 0.09,
  2013: 0.06,
  2014: 0.03,
  2015: 0.05,
  2016: 0.34,
  2017: 1.07,
  2018: 2.02,
  2019: 2.06,
  2020: 0.38,
  2021: 0.06,
  2022: 2.71,
  2023: 5.06,
  2024: 5.14,
  2025: 4.33,
};

export const TEN_YEAR_SCENARIOS: readonly TenYearScenario[] = [
  {
    id: "low_recent_2000_2009",
    label: "Lowest recent decade",
    description: "2000–2009 consecutive calendar years.",
    years: [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009],
  },
  {
    id: "high_recent_2010_2019",
    label: "Highest recent decade",
    description: "2010–2019 consecutive calendar years.",
    years: [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019],
  },
  {
    id: "most_recent_2016_2025",
    label: "Most recent decade",
    description: "2016–2025 consecutive calendar years.",
    years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  },
];

/**
 * Per-ticker overrides for equity calendar returns (%). Sparse years fall back to the firm's S&P 500 calibration.
 * Keys are uppercase tickers (e.g. "AAPL").
 */
export type EquityAnnualPctTable = Partial<Record<number, number>>;

/** Populated later as needed — empty means equities use SP500 surrogate for scenario years (per policy). */
export const EQUITY_ANNUAL_PCT_BY_TICKER: Record<string, Readonly<EquityAnnualPctTable>> = {};

function tickerFromHolding(h: ScenarioHoldingLike): string {
  const enrich = String(h.enrichmentResolvedTicker || "")
    .trim()
    .toUpperCase();
  const enrichedToken = enrich.match(/^([A-Z]{1,5})\b/)?.[1];
  if (enrichedToken && !/^(NEEDS|MANUAL)$/.test(enrichedToken)) return enrichedToken;
  const norm = String(h.normalizedSymbol || "")
    .trim()
    .toUpperCase();
  const normalizedToken = norm.match(/^([A-Z]{1,5})\b/)?.[1];
  if (normalizedToken && !/^(NEEDS|MANUAL)$/.test(normalizedToken)) return normalizedToken;
  return extractLikelySymbol(h.suggested, h.rawName);
}

function lookupCalYearReturnPct(calendarYear: number, table: Readonly<Record<number, number>>): number {
  const v = table[calendarYear];
  if (!Number.isFinite(v)) throw new Error(`Missing index return for year ${calendarYear}`);
  return v!;
}

function lookupSeries(years: readonly number[], table: Readonly<Record<number, number>>): number[] {
  return years.map((y) => lookupCalYearReturnPct(y, table));
}

/** Cumulative path return: Π(1 + r_i) − 1 (not surfaced in Portfolio Review scenarios). */
export function compoundedReturnFromAnnualPcts(pcts: readonly number[]): number {
  let m = 1;
  for (const p of pcts) {
    if (!Number.isFinite(p)) return Number.NaN;
    m *= 1 + p / 100;
  }
  return m - 1;
}

/**
 * Geometric annualized return (CAGR) over `pcts.length` years from calendar-year % returns.
 * Returns a **per-year decimal** (e.g. `0.072` ≡ 7.2%/year).
 */
export function annualizedReturnDecimalFromAnnualPcts(pcts: readonly number[]): number {
  const n = pcts.length;
  if (n <= 0) return Number.NaN;
  let m = 1;
  for (const p of pcts) {
    if (!Number.isFinite(p)) return Number.NaN;
    m *= 1 + p / 100;
  }
  return m ** (1 / n) - 1;
}

/** Proposed sleeve: equities → S&P calibration, fixed → Aggregate proxy, cash → MM proxy (reweighted to sum to 100%). Returns CAGR decimal over the scenario years. */
export function scenarioProposedPortfolioReturnDecimal(
  years: readonly number[],
  allocationPct: { equity: number; fixedIncome: number; cash: number }
): number {
  const e = Math.max(0, Number(allocationPct.equity) || 0) / 100;
  const f = Math.max(0, Number(allocationPct.fixedIncome) || 0) / 100;
  const c = Math.max(0, Number(allocationPct.cash) || 0) / 100;
  const denom = e + f + c;
  if (denom <= 0 || years.length !== 10) return Number.NaN;
  const wE = e / denom;
  const wF = f / denom;
  const wC = c / denom;
  const sp = lookupSeries(years, SP500_ANNUAL_TOTAL_RETURN_PCT);
  const agg = lookupSeries(years, US_AGG_TOTAL_RETURN_PROXY_PCT);
  const mm = lookupSeries(years, TREASURY_BILL_MM_PROXY_PCT);
  const blended = years.map((_, i) => wE * sp[i] + wF * agg[i] + wC * mm[i]);
  return annualizedReturnDecimalFromAnnualPcts(blended);
}

/** Holdings-weighted calendar-year sleeves, then CAGR over the scenario. Equity/bond/cash/other rules as documented. */
export function scenarioHoldingsPortfolioReturnDecimal(
  years: readonly number[],
  holdings: readonly ScenarioHoldingLike[]
): number {
  const usable = holdings.filter((h) => h.duplicateOfIndex === undefined);
  const invested = usable.reduce((s, h) => s + Math.max(0, Number(h.value) || 0), 0);
  if (invested <= 0 || years.length !== 10) return Number.NaN;

  const sp = lookupSeries(years, SP500_ANNUAL_TOTAL_RETURN_PCT);
  const agg = lookupSeries(years, US_AGG_TOTAL_RETURN_PROXY_PCT);
  const mm = lookupSeries(years, TREASURY_BILL_MM_PROXY_PCT);

  function equityPctForTicker(sym: string, yearIndex: number): number {
    const y = years[yearIndex]!;
    const custom = EQUITY_ANNUAL_PCT_BY_TICKER[sym]?.[y];
    if (Number.isFinite(custom)) return custom!;
    return sp[yearIndex]!;
  }

  const weightedAnnualPct = years.map((_y, yi) => {
    let accPct = 0;
    for (const h of usable) {
      const w = Math.max(0, Number(h.value) || 0) / invested;
      const ac = String(h.assetClass || "");
      const sug = String(h.suggested || "");
      const raw = String(h.rawName || "");
      const sym = tickerFromHolding(h).toUpperCase();
      const bucket = classifyAllocationBucket(ac, sug, raw);
      let r: number;
      if (bucket === "cash" || isCashLikeHolding(ac, sug, raw)) {
        r = mm[yi]!;
      } else if (bucket === "fixedIncome") {
        r = agg[yi]!;
      } else if (bucket === "equity") {
        r = equityPctForTicker(sym, yi);
      } else {
        r = (sp[yi]! + agg[yi]!) / 2;
      }
      accPct += w * r;
    }
    return accPct;
  });

  return annualizedReturnDecimalFromAnnualPcts(weightedAnnualPct);
}

export const BIGGEST_DRAWDOWN_SCENARIO_YEAR = 2008;

/** Proposed weights: blended **calendar-year** total return as a decimal for one year (not CAGR). */
export function scenarioProposedPortfolioSingleYearReturnDecimal(
  calendarYear: number,
  allocationPct: { equity: number; fixedIncome: number; cash: number },
): number {
  const e = Math.max(0, Number(allocationPct.equity) || 0) / 100;
  const f = Math.max(0, Number(allocationPct.fixedIncome) || 0) / 100;
  const c = Math.max(0, Number(allocationPct.cash) || 0) / 100;
  const denom = e + f + c;
  if (denom <= 0) return Number.NaN;
  const wE = e / denom;
  const wF = f / denom;
  const wC = c / denom;
  try {
    const sp = lookupCalYearReturnPct(calendarYear, SP500_ANNUAL_TOTAL_RETURN_PCT);
    const agg = lookupCalYearReturnPct(calendarYear, US_AGG_TOTAL_RETURN_PROXY_PCT);
    const mm = lookupCalYearReturnPct(calendarYear, TREASURY_BILL_MM_PROXY_PCT);
    const blendedPct = wE * sp + wF * agg + wC * mm;
    return blendedPct / 100;
  } catch {
    return Number.NaN;
  }
}

/** Holdings-weighted **calendar-year** total return as a decimal for one year. */
export function scenarioHoldingsPortfolioSingleYearReturnDecimal(
  calendarYear: number,
  holdings: readonly ScenarioHoldingLike[],
): number {
  const usable = holdings.filter((h) => h.duplicateOfIndex === undefined);
  const invested = usable.reduce((s, h) => s + Math.max(0, Number(h.value) || 0), 0);
  if (invested <= 0) return Number.NaN;

  let sp: number;
  let agg: number;
  let mm: number;
  try {
    sp = lookupCalYearReturnPct(calendarYear, SP500_ANNUAL_TOTAL_RETURN_PCT);
    agg = lookupCalYearReturnPct(calendarYear, US_AGG_TOTAL_RETURN_PROXY_PCT);
    mm = lookupCalYearReturnPct(calendarYear, TREASURY_BILL_MM_PROXY_PCT);
  } catch {
    return Number.NaN;
  }

  let accPct = 0;
  for (const h of usable) {
    const w = Math.max(0, Number(h.value) || 0) / invested;
    const ac = String(h.assetClass || "");
    const sug = String(h.suggested || "");
    const raw = String(h.rawName || "");
    const sym = tickerFromHolding(h).toUpperCase();
    const bucket = classifyAllocationBucket(ac, sug, raw);
    let r: number;
    if (bucket === "cash" || isCashLikeHolding(ac, sug, raw)) {
      r = mm;
    } else if (bucket === "fixedIncome") {
      r = agg;
    } else if (bucket === "equity") {
      const custom = EQUITY_ANNUAL_PCT_BY_TICKER[sym]?.[calendarYear];
      r = Number.isFinite(custom) ? custom! : sp;
    } else {
      r = (sp + agg) / 2;
    }
    accPct += w * r;
  }
  return accPct / 100;
}

/** Formats a return **decimal** (CAGR-style or calendar-year total) as a ± % string for display. */
export function formatTenYearScenarioPercent(returnDecimal: number, fractionDigits = 1): string {
  if (!Number.isFinite(returnDecimal)) return "—";
  const p = returnDecimal * 100;
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(fractionDigits)}%`;
}
