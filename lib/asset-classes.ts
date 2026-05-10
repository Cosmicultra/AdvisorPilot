export const ASSET_CLASSES = [
  "U.S. Large Cap Equity",
  "U.S. Mid Cap Equity",
  "U.S. Small Cap Equity",
  "International Equity",
  "Emerging Markets Equity",
  "Equity ETF",
  "Bond ETF",
  "Cash ETF",
  "Equity Mutual Fund",
  "Bond Mutual Fund",
  "Cash Mutual Fund",
  "ETF",
  "Mutual Fund",
  "Individual Stock",
  "Bond Fund",
  "Treasury / Government Bond",
  "Corporate Bond",
  "Municipal Bond",
  "Cash / Money Market",
  "Money Market Account",
  "Fixed Indexed Annuity",
  "MYGA / Fixed Annuity",
  "SPIA / Income Annuity",
  "Alternative / Other",
  "Unknown",
] as const;

export type AssetClassId = (typeof ASSET_CLASSES)[number];

const ASSET_CLASS_SET = new Set<string>(ASSET_CLASSES);
export function isCanonicalAssetClass(s: string): s is AssetClassId {
  return ASSET_CLASS_SET.has(s);
}

function classifyWrapperOrUnknown(blob: string): "equity" | "fixedIncome" | "cash" | "other" {
  const lower = blob.toLowerCase();
  const cashHints =
    /money market|cash|treasury bill|t-?bill|govt?\.?\s*money|ultra[- ]?short|liquid assets|sweep|fdic|currency fund|\bvmfxx\b|\bsgov\b|\bshv\b|\bicsu\b/i;
  const bondHints =
    /bond|treasury(?! bill)|tips|\bmuni\b|munis|aggregate|investment grade|high yield|duration|credit|mortgage|short[- ]term fixed|government bond|inflation[- ]protected|fixed income|tip\b|aggregate bond/i;
  const equityHints =
    /equity|stock|growth|value|dividend|s&p|sp500|sp 500|nasdaq|index fund|large cap|mid cap|small cap|international|emerging|msci|total market(?!\s*bond)|equity market|reit\b|403b|401k/i;

  const c = cashHints.test(lower);
  const b = bondHints.test(lower);
  const e = equityHints.test(lower);
  if (c && !b && !e) return "cash";
  if (b && !e) return "fixedIncome";
  if (e && !b) return "equity";
  if (c && !e) return "cash";
  return "other";
}

/**
 * Map extraction / enrichment labels onto AdvisorPilot ASSET_CLASSES.
 */
export function canonicalizeAssetClass(raw: string): AssetClassId {
  const t = String(raw ?? "").trim();
  if (ASSET_CLASS_SET.has(t)) return t as AssetClassId;

  const lower = t.toLowerCase();

  if (
    /equity\s*etf|stock\s*etf|etf\s*\(?\s*equity/i.test(lower) ||
    lower === "equity etf"
  ) {
    return "Equity ETF";
  }
  if (/bond\s*etf|fixed\s*income\s*etf|etf\s*\(?\s*bond/i.test(lower) || lower === "bond etf") {
    return "Bond ETF";
  }
  if (/cash\s*etf|money market\s*etf|etf\s*\(?\s*cash/i.test(lower) || lower === "cash etf") {
    return "Cash ETF";
  }
  if (
    /equity\s*mutual\s*fund|stock\s*mutual\s*fund|mutual\s*fund\s*\(?\s*equity/i.test(lower) ||
    lower === "equity mutual fund"
  ) {
    return "Equity Mutual Fund";
  }
  if (/bond\s*mutual\s*fund|mutual\s*fund\s*\(?\s*bond/i.test(lower) || lower === "bond mutual fund") {
    return "Bond Mutual Fund";
  }
  if (/cash\s*mutual\s*fund|money market\s*mutual|mutual\s*fund\s*\(?\s*cash/i.test(lower) || lower === "cash mutual fund") {
    return "Cash Mutual Fund";
  }

  if (/money\s*market\s*account/i.test(lower)) {
    return "Money Market Account";
  }

  if (
    (lower.includes("cash") || lower.includes("money market")) &&
    !/\betf\b/.test(lower) &&
    !lower.includes("mutual fund")
  ) {
    return "Cash / Money Market";
  }
  if (lower.includes("large cap") && lower.includes("u.s")) return "U.S. Large Cap Equity";
  if (lower.includes("mid cap") && lower.includes("u.s")) return "U.S. Mid Cap Equity";
  if (lower.includes("small cap") && lower.includes("u.s")) return "U.S. Small Cap Equity";
  if (lower.includes("international") && lower.includes("equity")) return "International Equity";
  if (lower.includes("emerging")) return "Emerging Markets Equity";

  const isMutualFund = lower.includes("mutual fund");
  const isEtf = lower === "etf" || /\betf\b/.test(lower) || lower.includes("exchange traded");

  if (isEtf && !isMutualFund) {
    const w = classifyWrapperOrUnknown(`${t} ${lower.includes("etf") ? "" : "etf"}`);
    if (w === "equity") return "Equity ETF";
    if (w === "fixedIncome") return "Bond ETF";
    if (w === "cash") return "Cash ETF";
    return "ETF";
  }

  if (isMutualFund || (lower === "fund" && !isEtf)) {
    const w = classifyWrapperOrUnknown(t);
    if (w === "equity") return "Equity Mutual Fund";
    if (w === "fixedIncome") return "Bond Mutual Fund";
    if (w === "cash") return "Cash Mutual Fund";
    return "Mutual Fund";
  }

  if (lower.includes("exchange traded")) return "ETF";
  if (lower.includes("individual stock") || lower.includes("common stock") || lower === "stock")
    return "Individual Stock";
  if (lower.includes("bond fund") || lower.includes("fixed income fund")) return "Bond Fund";
  if (lower.includes("treasury") || lower.includes("government bond")) return "Treasury / Government Bond";
  if (lower.includes("corporate bond")) return "Corporate Bond";
  if (lower.includes("municipal")) return "Municipal Bond";
  if (lower.includes("fixed indexed") || lower.includes("fixed index")) return "Fixed Indexed Annuity";
  if (lower.includes("myga")) return "MYGA / Fixed Annuity";
  if (lower.includes("spia") || lower.includes("income annuity") || lower.includes("immediate annuity"))
    return "SPIA / Income Annuity";
  if (lower.includes("alternative") || lower.includes("interval fund") || lower.includes("non-traded")) {
    return "Alternative / Other";
  }
  if (lower.includes("annuity")) return "Alternative / Other";

  return "Unknown";
}

export function classifyAllocationBucket(
  assetClass: string,
  suggested = "",
  rawName = ""
): "equity" | "fixedIncome" | "cash" | "other" {
  const canon = canonicalizeAssetClass(assetClass);
  const blob = `${suggested} ${rawName} ${canon}`.toLowerCase();

  if (
    canon === "Cash / Money Market" ||
    canon === "Money Market Account" ||
    canon === "Cash ETF" ||
    canon === "Cash Mutual Fund"
  )
    return "cash";

  const fixedCanon: AssetClassId[] = [
    "Bond Fund",
    "Bond ETF",
    "Bond Mutual Fund",
    "Treasury / Government Bond",
    "Corporate Bond",
    "Municipal Bond",
    "Fixed Indexed Annuity",
    "MYGA / Fixed Annuity",
    "SPIA / Income Annuity",
  ];
  if (fixedCanon.includes(canon)) return "fixedIncome";

  if (canon === "ETF" || canon === "Mutual Fund" || canon === "Unknown" || canon === "Alternative / Other") {
    return classifyWrapperOrUnknown(blob);
  }

  if (canon === "Individual Stock") return "equity";
  if (canon.includes("Equity")) return "equity";

  return "other";
}

export function isCashLikeHolding(assetClass: string, suggested: string, rawName: string): boolean {
  const blob = `${assetClass} ${suggested} ${rawName}`.toLowerCase();
  if (/\betf\b|exchange traded/.test(blob)) return false;
  if (blob.includes("mutual fund") && !/money market|cash management|prime money|liquidity|govt\.?\s*mm|government money/i.test(blob)) {
    return false;
  }
  if (blob.includes("cash") || blob.includes("money market")) return true;
  if (blob.includes("cash equivalent")) return true;
  return false;
}
