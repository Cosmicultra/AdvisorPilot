import { canonicalizeAssetClass, type AssetClassId } from "./asset-classes";
import { SYNTHETIC_CASH_TICKER } from "./cash-holding-constants";

export type HoldingValidationStatus = "validated" | "needs_review" | "unverified";

export type HoldingValidationMetadata = {
  provider: "local-heuristic";
  reason: string;
  validatedAt: string;
};

export type HoldingValidationResult = {
  normalizedSymbol: string;
  normalizedCusip: string;
  validationStatus: HoldingValidationStatus;
  validationMetadata: HoldingValidationMetadata;
};

const CUSIP_RE = /\b[0-9A-Z]{9}\b/;
const TICKER_RE = /\b[A-Z]{1,5}\b/;

/** Cash-sleeve classes that may use SYNTHETIC_CASH_TICKER when no real symbol exists on the statement. */
const CASH_SLEEVE_FOR_SYNTHETIC_TICKER = new Set<AssetClassId>([
  "Cash / Money Market",
  "Money Market Account",
  "Cash ETF",
  "Cash Mutual Fund",
]);

const SWEEP_OR_CASH_DESCRIPTION =
  /sweep|bank deposit|\bfdic\b|core position|settlement|liquidity|uninvested|awaiting investment|money market|prime money|govt\.?\s*money|federal money|insured (cash|balances?)|cash balance|brokerage cash|excess liquidity/i;

/** Uppercase “words” often picked by ticker heuristics from descriptions, not exchange symbols. */
const TICKER_LIKELY_ENGLISH_NOISE = new Set([
  "BANK",
  "CASH",
  "CORE",
  "DEPOS",
  "FDIC",
  "FREE",
  "HIGH",
  "OPEN",
  "NEW",
  "SAVE",
  "THE",
  "FOR",
  "AND",
  "MONEY",
  "SWEEP",
]);

function cleanToken(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function extractLikelyCusip(...values: unknown[]) {
  for (const value of values) {
    const match = cleanToken(value).match(CUSIP_RE);
    if (match) return match[0];
  }
  return "";
}

export function extractLikelySymbol(...values: unknown[]) {
  for (const value of values) {
    const text = cleanToken(value);
    if (text === SYNTHETIC_CASH_TICKER) return SYNTHETIC_CASH_TICKER;
    if (/NEEDS\s+ADVISOR|MANUAL\s+TICKER|CASH\s+EQUIVALENT/.test(text)) continue;
    const firstDelimited = text.match(/^([A-Z]{1,5})(?:\s+|[.-])/);
    if (firstDelimited) return firstDelimited[1];
    const paren = text.match(/\(([A-Z]{1,5})\)/);
    if (paren) return paren[1];
    const generic = text.match(TICKER_RE);
    if (generic) return generic[0];
  }
  return "";
}

/** True when the model guessed a short “symbol” that is usually English from a sweep/MM description (not a ticker). */
export function isLikelyDescriptionOnlyTickerSymbol(
  symbol: string,
  suggested: string,
  rawName: string
): boolean {
  const s = symbol.trim().toUpperCase();
  if (!s) return false;
  const blob = `${suggested} ${rawName}`.trim();
  if (!SWEEP_OR_CASH_DESCRIPTION.test(blob) && !/\bcash\b|money market|\bmmf\b/i.test(blob.toLowerCase())) {
    return false;
  }
  return TICKER_LIKELY_ENGLISH_NOISE.has(s);
}

function inferredSymbolForSyntheticDecision(suggested: unknown, rawName: unknown): string {
  const sym = extractLikelySymbol(suggested, rawName);
  if (!sym) return "";
  if (sym === SYNTHETIC_CASH_TICKER) return sym;
  if (isLikelyDescriptionOnlyTickerSymbol(sym, String(suggested ?? ""), String(rawName ?? ""))) return "";
  return sym;
}

/**
 * For cash-sleeve holdings with no CUSIP and no reliable ticker on the statement, set `suggested` to {@link SYNTHETIC_CASH_TICKER}.
 */
export function applySyntheticCashTickerIfEligible<T extends { assetClass?: string; suggested?: string; rawName?: string }>(
  holding: T
): T {
  const canon = canonicalizeAssetClass(String(holding.assetClass ?? "Unknown"));
  if (!CASH_SLEEVE_FOR_SYNTHETIC_TICKER.has(canon)) return holding;

  if (String(holding.suggested ?? "").trim().toUpperCase() === SYNTHETIC_CASH_TICKER) {
    return holding;
  }

  const cusip = extractLikelyCusip(holding.suggested, holding.rawName);
  if (cusip) return holding;

  if (inferredSymbolForSyntheticDecision(holding.suggested, holding.rawName)) return holding;

  return { ...holding, suggested: SYNTHETIC_CASH_TICKER };
}

export function validateHoldingLocally(holding: {
  rawName?: unknown;
  suggested?: unknown;
  confidence?: unknown;
  status?: unknown;
  assetClass?: unknown;
}): HoldingValidationResult {
  const normalizedCusip = extractLikelyCusip(holding.suggested, holding.rawName);
  let normalizedSymbol = normalizedCusip ? "" : extractLikelySymbol(holding.suggested, holding.rawName);
  if (cleanToken(holding.suggested) === SYNTHETIC_CASH_TICKER) {
    normalizedSymbol = SYNTHETIC_CASH_TICKER;
  }
  const confidence = Number(holding.confidence || 0);
  const status = String(holding.status || "").toLowerCase();
  const assetClass = String(holding.assetClass || "").toLowerCase();

  let validationStatus: HoldingValidationStatus = "unverified";
  let reason = "No ticker or CUSIP could be inferred locally.";

  if (normalizedCusip) {
    validationStatus = confidence >= 75 && status !== "review" ? "validated" : "needs_review";
    reason = "A CUSIP-like identifier was found; advisor should confirm issuer and maturity.";
  } else if (normalizedSymbol === SYNTHETIC_CASH_TICKER) {
    validationStatus = "validated";
    reason =
      "Synthetic cash / sweep label — not a listed ticker; allocation uses the cash sleeve (scenario models use a T-bill–style proxy for cash returns).";
  } else if (normalizedSymbol) {
    validationStatus = confidence >= 75 && status !== "review" ? "validated" : "needs_review";
    reason = "A ticker-like symbol was inferred from the selected holding label.";
  } else if (assetClass.includes("cash") || assetClass.includes("money market")) {
    validationStatus = "validated";
    reason = "Cash or money-market position does not require a market ticker for this workflow.";
  }

  return {
    normalizedSymbol,
    normalizedCusip,
    validationStatus,
    validationMetadata: {
      provider: "local-heuristic",
      reason,
      validatedAt: new Date().toISOString(),
    },
  };
}
