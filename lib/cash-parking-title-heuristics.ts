/**
 * Statement line titles that usually represent sweep / cash sleeve / MMF / stable-value parking,
 * not uniquely identifiable listed securities. Used with securities-master lookup: when no catalog
 * match, holdings normalize to {@link SYNTHETIC_CASH_TICKER} and {@link CASH_PARKING_SYNTHETIC_ASSET_CLASS}.
 */

import { SYNTHETIC_CASH_TICKER } from "./cash-holding-constants";

export const CASH_PARKING_SYNTHETIC_ASSET_CLASS = "Money Market Account" as const;

/**
 * Multi-word and specific phrases (lowercase). Longer phrases are checked first via sort.
 * Avoid bare single words like "cash" or "liquidity" to limit false positives on equity/bond names.
 */
const CASH_PARKING_PHRASES: string[] = [
  // Core cash / sweep
  "fdic insured deposit sweep",
  "uninvested cash",
  "free credit balance",
  "available cash",
  "insured cash account",
  "brokerage cash",
  "cash reserves",
  "cash reserve",
  "liquidity position",
  "liquidity fund",
  "settlement account",
  "settlement fund",
  "sweep account",
  "bank sweep",
  "core position",
  "core account",
  "cash balance",
  // Government / treasury MMF
  "vanguard federal money market fund",
  "fidelity government money market fund",
  "schwab government money fund",
  "treasury obligations fund",
  "treasury trust fund",
  "government liquid assets fund",
  "government cash reserves",
  "u.s. government money market fund",
  "treasury money market fund",
  "government money market fund",
  // Prime / general MMF
  "institutional prime fund",
  "retail prime fund",
  "prime money market fund",
  "prime cash fund",
  "cash management fund",
  // Municipal MMF
  "tax-free cash reserves",
  "california municipal money market fund",
  "tax-exempt money fund",
  "municipal money market fund",
  // Stable value / plan cash
  "cash preservation option",
  "preservation portfolio",
  "fixed interest option",
  "guaranteed interest account",
  "principal preservation fund",
  "capital preservation fund",
  "guaranteed income fund",
  "stable value fund",
  "retirement reserve fund",
  "short-term reserve fund",
  // ETF / ultra-short (titles often on statements)
  "ultra short treasury etf",
  "spdr bloomberg 1-3 month t-bill etf",
  "ishares 0-3 month treasury bond etf",
  "short treasury fund",
  "t-bill etf",
  "ultra short bond etf",
  "cash management etf",
  "enhanced cash etf",
  "short duration etf",
  "floating rate etf",
  "treasury etf",
  "pimco enhanced short maturity active etf",
  "jpmorgan ultra-short income etf",
  // Annuity / interim
  "sweep fixed account",
  "dollar cost averaging account",
  "general account allocation",
  "declared rate account",
  "daily interest account",
  "guaranteed fixed account",
  "fixed interest allocation",
  "fixed strategy",
  "interim account",
  "holding account",
  // IRA / custodial
  "retirement cash reserves",
  "qualified cash",
  "rollover ira settlement fund",
  "sep ira cash",
  "roth ira core position",
  "traditional ira core",
  "ira sweep",
  "ira cash",
  // Bank / advisory
  "cma sweep",
  "cash management account",
  "fdic sweep program",
  "insured deposit program",
  "demand deposit sweep",
  "interest bearing cash",
  "deposit account",
  // Typical sleeve labels
  "sweep vehicle",
  "treasury cash",
  "capital preservation",
  "ultra short fixed income",
  "short-term reserves",
  "cash & equivalents",
  "cash equivalents",
  "cash equivalent",
  "money market",
  "general account",
  "fixed account",
  "stable value",
].sort((a, b) => b.length - a.length);

const SORTED = CASH_PARKING_PHRASES;

function normalizeForMatch(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[_/]+/g, " ")
    .trim();
}

/** Exact single-token title "cash" (common brokerage sweep line). */
function isBareCashTitle(normalized: string): boolean {
  return normalized === "cash";
}

export function cashParkingTitleMatches(rawName: string): boolean {
  const n = normalizeForMatch(rawName);
  if (!n) return false;
  if (isBareCashTitle(n)) return true;
  return SORTED.some((phrase) => n.includes(phrase));
}

export type RecordLike = Record<string, unknown>;

/** Force synthetic cash ticker + Money Market Account when the parking title did not match the firm catalog. */
export function buildCashParkingSyntheticHolding(rec: RecordLike): RecordLike {
  const priorOptions = Array.isArray(rec.options) ? rec.options.map((o) => String(o)).filter(Boolean) : [];
  const options = Array.from(
    new Set<string>([SYNTHETIC_CASH_TICKER, ...priorOptions, "Manual ticker / CUSIP entry"])
  );
  const conf = Math.max(Number(rec.confidence) || 0, 90);
  return {
    ...rec,
    suggested: SYNTHETIC_CASH_TICKER,
    assetClass: CASH_PARKING_SYNTHETIC_ASSET_CLASS,
    confidence: conf,
    status: "matched",
    options,
  };
}
