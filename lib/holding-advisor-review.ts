/**
 * Whether this holding counts toward advisor review gates (badge count, blocking deep analysis row styling).
 * In-room advisors can bypass with explicit {@link HoldingLikeForAdvisorReview.confirmedMatchOverridesReview}.
 */

export type HoldingLikeForAdvisorReview = {
  confidence?: unknown;
  status?: unknown;
  /** When true, advisor explicitly accepted this match despite confidence / review signals. */
  confirmedMatchOverridesReview?: unknown;
};

export function holdingAdvisorReviewBlocking(h: HoldingLikeForAdvisorReview): boolean {
  if (h.confirmedMatchOverridesReview === true) return false;
  const conf = Number(h.confidence ?? 0);
  const st = String(h.status ?? "").trim().toLowerCase();
  return conf < 75 || st === "review";
}
