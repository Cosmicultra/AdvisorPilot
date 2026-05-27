import type { ComparativeFeeAnalysisResponse } from "@/lib/comparative-fee-analysis";

export type FeeComparisonDeltaTone = "positive" | "negative" | "neutral";

export type ComparativeFeeComparisonVisualData = {
  currentTotal: number;
  proposedTotal: number;
  /** Positive when proposed annual cost is lower than current. */
  annualCostDelta: number;
  deltaLabel: string;
  deltaHeadline: string;
  deltaTone: FeeComparisonDeltaTone;
  blendedDragDeltaPts: number;
  proposedCoveragePct: number;
  proposedManagedAssets: number;
  selfManagedAssets: number;
  excludedAssets: number;
  showSelfManaged: boolean;
  showExcluded: boolean;
  showCoverageBar: boolean;
  narrativeHints: string[];
  disclaimer: string;
  uniqueTickerCount: number;
  rowsMissingTicker: number;
};

function deltaToneFromAmount(delta: number): FeeComparisonDeltaTone {
  if (delta > 0) return "positive";
  if (delta < 0) return "negative";
  return "neutral";
}

function buildDeltaLabel(delta: number): string {
  if (delta > 0) return "Lower estimated annual cost under the proposed scenario.";
  if (delta < 0) return "Higher estimated annual cost under the proposed scenario.";
  return "No illustrative difference in total annual household cost.";
}

function buildDeltaHeadline(delta: number): string {
  const abs = Math.abs(delta);
  if (delta > 0) return `${formatHeadlineMoney(abs)} lower per year`;
  if (delta < 0) return `${formatHeadlineMoney(abs)} higher per year`;
  return "No illustrative difference";
}

function formatHeadlineMoney(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function buildComparativeFeeComparisonVisualData(
  result: ComparativeFeeAnalysisResponse,
): ComparativeFeeComparisonVisualData {
  const annualCostDelta = result.comparison.annualCostDifferenceDollars;
  const proposedCoveragePct = result.coverage.proposedCoveragePct;

  return {
    currentTotal: result.current.totalEstimatedAnnualCostDollars,
    proposedTotal: result.proposed.totalEstimatedAnnualCostDollars,
    annualCostDelta,
    deltaLabel: buildDeltaLabel(annualCostDelta),
    deltaHeadline: buildDeltaHeadline(annualCostDelta),
    deltaTone: deltaToneFromAmount(annualCostDelta),
    blendedDragDeltaPts: result.comparison.blendedDragDifferencePct,
    proposedCoveragePct,
    proposedManagedAssets: result.coverage.proposedManagedAssets,
    selfManagedAssets: result.coverage.selfManagedAssets,
    excludedAssets: result.coverage.excludedAssets,
    showSelfManaged: result.coverage.selfManagedAssets > 0,
    showExcluded: result.coverage.excludedAssets > 0,
    showCoverageBar: proposedCoveragePct < 1,
    narrativeHints: result.comparison.narrativeHints,
    disclaimer: result.disclaimer,
    uniqueTickerCount: result.uniqueTickerCount,
    rowsMissingTicker: result.rowsMissingTicker,
  };
}
