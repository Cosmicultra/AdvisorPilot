import { canonicalizeAssetClass, type AssetClassId } from "@/lib/asset-classes";
import { SYNTHETIC_CASH_TICKER } from "@/lib/cash-holding-constants";
import { accountGroupKey } from "@/lib/holding-registration";
import { extractLikelySymbol } from "@/lib/holding-validation";

/** Canonical asset classes treated as ETF / mutual fund wrappers for fee drag. */
const ETF_OR_MF_ASSET_CLASSES = new Set<string>([
  "Equity ETF",
  "Bond ETF",
  "Cash ETF",
  "ETF",
  "Equity Mutual Fund",
  "Bond Mutual Fund",
  "Cash Mutual Fund",
  "Mutual Fund",
]);

export function isEtfOrMutualFundAssetClass(assetClass: string): boolean {
  const canon = canonicalizeAssetClass(assetClass);
  return ETF_OR_MF_ASSET_CLASSES.has(canon);
}

export type FeeAnalysisHoldingLike = {
  assetClass: string;
  value?: unknown;
  enrichmentResolvedTicker?: string;
  normalizedSymbol?: string;
  masterResolvedSymbol?: string;
  suggested?: string;
  rawName?: string;
  accountNumber?: string;
  sourceFileIndex?: number;
  registrationType?: unknown;
};

/**
 * Best-effort primary symbol for fee lookup (matches enrichment / scenario precedence).
 */
export function resolveFeeAnalysisTicker(h: FeeAnalysisHoldingLike): string {
  const fromEnrich = String(h.enrichmentResolvedTicker || "").trim().toUpperCase();
  if (fromEnrich && fromEnrich !== SYNTHETIC_CASH_TICKER) return fromEnrich;
  const fromNorm = String(h.normalizedSymbol || "").trim().toUpperCase();
  if (fromNorm && fromNorm !== SYNTHETIC_CASH_TICKER) return fromNorm;
  const fromMaster = String(h.masterResolvedSymbol || "").trim().toUpperCase();
  if (fromMaster && fromMaster !== SYNTHETIC_CASH_TICKER) return fromMaster;
  const inferred = extractLikelySymbol(h.suggested, h.rawName);
  return inferred && inferred !== SYNTHETIC_CASH_TICKER ? inferred : "";
}

/** Interpret advisor fee input as percent points: "1" or "1%" → 0.01 annual. */
export function parseAdvisorFeePercentPoints(raw: string): number {
  const n = Number(String(raw ?? "").trim().replace(/%/g, ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n / 100;
}

export type FeeAnalysisFundRow = {
  ticker: string;
  value: number;
  assetClass: string;
  suggested: string;
  rawName: string;
  accountNumber: string;
};

export type FeeAnalysisApiLine = FeeAnalysisFundRow & {
  expenseRatioAnnual: number | null;
  estimatedAnnualFeeDollars: number;
  lookupNote?: string;
};

export type FeeAnalysisApiAccount = {
  key: string;
  accountNumber: string;
  totalAccountValue: number;
  lines: FeeAnalysisApiLine[];
  fundFeesInAccount: number;
  fundExpensePctOfAccount: number;
  advisorDollarsOnAccount: number;
  allInDragOnAccount: number;
};

export type FeeAnalysisApiResponse = {
  disclaimer: string;
  portfolioValue: number;
  advisorFeeAnnual: number;
  advisorFeeDollarsPortfolio: number;
  totalEstimatedFundFeesDollars: number;
  weightedFundExpensePctOfPortfolio: number;
  allInIllustrativeDragPctAnnual: number;
  accounts: FeeAnalysisApiAccount[];
  uniqueTickerCount: number;
  rowsMissingTicker: number;
};

export type FeeAnalysisAccountGroup = {
  key: string;
  accountNumber: string;
  totalAccountValue: number;
  fundRows: FeeAnalysisFundRow[];
};

export function groupFeeAnalysisFundRowsByAccount(
  holdings: FeeAnalysisHoldingLike[]
): FeeAnalysisAccountGroup[] {
  const fundHoldings = holdings.filter((h) => isEtfOrMutualFundAssetClass(h.assetClass));
  const map = new Map<
    string,
    { accountNumber: string; fundRows: FeeAnalysisFundRow[]; accountValueSum: number }
  >();

  for (const h of holdings) {
    const key = accountGroupKey(h);
    const v = Number(h.value || 0);
    const val = Number.isFinite(v) ? v : 0;
    const existing = map.get(key);
    if (existing) {
      existing.accountValueSum += val;
    } else {
      map.set(key, {
        accountNumber: String(h.accountNumber || "").trim(),
        fundRows: [],
        accountValueSum: val,
      });
    }
  }

  for (const h of fundHoldings) {
    const key = accountGroupKey(h);
    const bucket = map.get(key);
    if (!bucket) continue;
    const value = Number(h.value || 0);
    bucket.fundRows.push({
      ticker: resolveFeeAnalysisTicker(h),
      value: Number.isFinite(value) ? value : 0,
      assetClass: canonicalizeAssetClass(h.assetClass) as AssetClassId,
      suggested: String(h.suggested || ""),
      rawName: String(h.rawName || ""),
      accountNumber: String(h.accountNumber || "").trim(),
    });
  }

  const out: FeeAnalysisAccountGroup[] = [];
  for (const [key, row] of map) {
    if (row.fundRows.length === 0) continue;
    out.push({
      key,
      accountNumber: row.accountNumber,
      totalAccountValue: row.accountValueSum,
      fundRows: row.fundRows,
    });
  }
  out.sort((a, b) => b.totalAccountValue - a.totalAccountValue);
  return out;
}
