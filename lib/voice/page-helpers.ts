/**
 * Helpers shared between the voice agent's tool handlers and the host page's
 * `voiceActions` adapter. Pure data shaping over the already-loaded
 * `savedReviews` array — no API calls, no react state.
 */

import type { HoldingsBreakdown, AllocationSummary } from "./tool-handlers";

interface ReviewHolding {
  rawName?: string | null;
  suggested?: string | null;
  enrichmentResolvedName?: string | null;
  enrichmentResolvedTicker?: string | null;
  assetClass?: string | null;
  value?: number | string | null;
}

interface ReviewClient {
  firstName?: string | null;
  lastName?: string | null;
  age?: string | null;
  riskProfile?: string | null;
  retirementAge?: string | null;
  [k: string]: unknown;
}

interface ReviewLike {
  id: string;
  client: ReviewClient;
  holdings?: ReviewHolding[] | null;
  analysis?: unknown;
  rothWorksheet?: unknown;
  status?: string | null;
  lastContactedAt?: string | null;
}

/** Sum the dollar value of all holdings on a review, defensively coercing. */
export function sumHoldingsValue(holdings: ReviewHolding[] | null | undefined): number {
  if (!Array.isArray(holdings)) return 0;
  return holdings.reduce((sum, h) => sum + (Number(h?.value) || 0), 0);
}

export function parseClientAge(age: unknown): number | null {
  if (typeof age === "string" && age) {
    const n = Number(age);
    if (Number.isFinite(n)) return n;
  }
  if (typeof age === "number" && Number.isFinite(age)) return age;
  return null;
}

/**
 * Pick the review the voice tool is asking about: explicit clientId wins,
 * then the active review (the one currently loaded on screen), else null.
 */
export function resolveVoiceTargetReview<T extends ReviewLike>(
  savedReviews: T[],
  clientId: string | undefined,
  activeReviewId: string | null
): T | null {
  if (clientId) {
    return savedReviews.find((r) => r.id === clientId) ?? null;
  }
  if (activeReviewId) {
    return savedReviews.find((r) => r.id === activeReviewId) ?? null;
  }
  return null;
}

/** Top 5 positions by weight + total value + count. */
export function buildHoldingsBreakdown(review: ReviewLike): HoldingsBreakdown {
  const holdings = review.holdings ?? [];
  const totalValue = sumHoldingsValue(holdings);
  const sorted = [...holdings].sort(
    (a, b) => (Number(b?.value) || 0) - (Number(a?.value) || 0)
  );
  const topPositions = sorted.slice(0, 5).map((h) => ({
    ticker: (h.enrichmentResolvedTicker || h.suggested || "").toUpperCase(),
    name: h.enrichmentResolvedName || h.rawName || h.suggested || "",
    assetClass: h.assetClass || "Unknown",
    valueUsd: Number(h.value) || 0,
    weightPct: totalValue > 0 ? ((Number(h.value) || 0) / totalValue) * 100 : 0,
  }));
  return {
    clientId: review.id,
    totalValue,
    holdingCount: holdings.length,
    topPositions,
  };
}

/**
 * Bucket holdings into broad asset classes for an allocation summary. Same
 * grouping the existing analysis flow uses (equity / fixed / cash / alt).
 */
export function buildAllocationSummary(review: ReviewLike): AllocationSummary {
  const holdings = review.holdings ?? [];
  const totalValue = sumHoldingsValue(holdings);
  const bucketMap = new Map<string, number>();
  for (const h of holdings) {
    const bucket = classifyAssetClass(h.assetClass);
    const v = Number(h?.value) || 0;
    bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + v);
  }
  const buckets = [...bucketMap.entries()]
    .map(([name, valueUsd]) => ({
      name,
      valueUsd,
      weightPct: totalValue > 0 ? (valueUsd / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
  return {
    clientId: review.id,
    totalValue,
    buckets,
  };
}

function classifyAssetClass(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (!s) return "Other";
  if (s.includes("stock") || s.includes("equity")) return "Equity";
  if (s.includes("bond") || s.includes("fixed") || s.includes("treasury")) return "Fixed";
  if (s.includes("cash") || s.includes("money market")) return "Cash";
  if (s.includes("annuity") || s.includes("fia") || s.includes("myga") || s.includes("spia")) return "Annuity";
  if (s.includes("real estate") || s.includes("reit")) return "Real Estate";
  if (s.includes("commod")) return "Commodities";
  if (s.includes("mutual fund")) return "Mutual Fund";
  if (s.includes("etf")) return "ETF";
  return raw ?? "Other";
}
