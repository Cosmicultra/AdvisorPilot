"use client";

import { useMemo } from "react";
import type { ComparativeFeeAnalysisResponse } from "@/lib/comparative-fee-analysis";
import { buildComparativeFeeComparisonVisualData } from "@/lib/comparative-fee-comparison-visuals";
import {
  FEE_VISUAL_COLORS,
  formatFeeDragPts,
  formatFeeMoneyCompact,
  formatFeeMoneyFull,
  formatFeePctWhole,
} from "@/lib/comparative-fee-visual-theme";
import { cn } from "@/lib/utils";

type ComparativeFeeComparisonVisualProps = {
  result: ComparativeFeeAnalysisResponse;
  className?: string;
};

function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-none border border-slate-200 bg-white p-4 md:p-5", className)}>{children}</div>;
}

function InsightChip({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  tone: "positive" | "negative" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-none border bg-white p-4",
        tone === "positive" && "border-emerald-200",
        tone === "negative" && "border-amber-200",
        tone === "neutral" && "border-slate-200",
      )}
    >
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-base font-bold tabular-nums",
          tone === "positive" && "text-emerald-800",
          tone === "negative" && "text-amber-900",
          tone === "neutral" && "text-slate-900",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs leading-snug text-slate-600">{helper}</p>
    </div>
  );
}

function dragChipTone(ptsDecimal: number): "positive" | "negative" | "neutral" {
  const pts = ptsDecimal * 100;
  if (pts < -0.001) return "positive";
  if (pts > 0.001) return "negative";
  return "neutral";
}

export function ComparativeFeeComparisonVisual({ result, className }: ComparativeFeeComparisonVisualProps) {
  const data = useMemo(() => buildComparativeFeeComparisonVisualData(result), [result]);

  const centerColor =
    data.deltaTone === "positive"
      ? "text-emerald-800"
      : data.deltaTone === "negative"
        ? "text-amber-900"
        : "text-slate-800";

  return (
    <div
      className={cn(
        "space-y-4 rounded-none border border-slate-200 bg-white p-5 shadow-sm md:p-6",
        "border-t-[3px] border-t-[var(--ap-navy)]",
        className,
      )}
    >
      <p className="text-xs leading-relaxed text-slate-500">
        Illustrative comparison only — not a prospectus or fee schedule. Confirm expense ratios and advisory fees on
        official documents.
      </p>

      <section className="space-y-4" aria-labelledby="fee-comparison-heading">
        <PanelCard>
          <p className="ap-eyebrow">Illustrative comparison</p>
          <h3 id="fee-comparison-heading" className="mt-2 font-serif text-xl font-semibold text-slate-900 md:text-2xl">
            Annual household cost: current vs proposed
          </h3>
          <p className="mt-2 text-sm text-slate-600">{data.deltaLabel}</p>
        </PanelCard>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <PanelCard className="bg-slate-50/50">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current scenario</p>
            <p className="mt-2 font-serif text-3xl font-bold tabular-nums text-slate-900">
              {formatFeeMoneyCompact(data.currentTotal)}
            </p>
            <p className="mt-1 text-xs text-slate-600">Estimated total annual household cost</p>
          </PanelCard>

          <div className="flex flex-col items-center justify-center px-2 py-3 md:py-0">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">Annual difference</p>
            <p className={cn("mt-1 text-center font-serif text-2xl font-bold tabular-nums", centerColor)}>
              {data.deltaHeadline}
            </p>
            <p className="mt-0.5 text-center text-xs text-slate-600">Proposed vs current (illustrative)</p>
          </div>

          <PanelCard className="border-violet-200 bg-violet-50/40">
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: FEE_VISUAL_COLORS.proposed }}
            >
              Proposed scenario
            </p>
            <p
              className="mt-2 font-serif text-3xl font-bold tabular-nums"
              style={{ color: FEE_VISUAL_COLORS.proposed }}
            >
              {formatFeeMoneyCompact(data.proposedTotal)}
            </p>
            <p className="mt-1 text-xs text-slate-600">Estimated total annual household cost</p>
          </PanelCard>
        </div>

        {data.showCoverageBar ? (
          <PanelCard>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Assets in proposed management
              </p>
              <p className="font-serif text-lg font-bold tabular-nums text-slate-900">
                {formatFeePctWhole(data.proposedCoveragePct)}
              </p>
            </div>
            <div
              className="mt-3 h-3 w-full overflow-hidden rounded-none border border-slate-200 bg-slate-100"
              role="progressbar"
              aria-valuenow={Math.round(data.proposedCoveragePct * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Share of household assets in proposed management"
            >
              <div
                className="h-full transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, Math.max(0, data.proposedCoveragePct * 100))}%`,
                  backgroundColor: FEE_VISUAL_COLORS.coverage,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {formatFeeMoneyFull(data.proposedManagedAssets)} of household assets included in proposed rollups.
            </p>
          </PanelCard>
        ) : null}

        <PanelCard>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supporting details</p>
          <div
            className={cn(
              "mt-3 grid grid-cols-1 gap-3",
              data.showSelfManaged || data.showExcluded ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2",
            )}
          >
            <InsightChip
              label="Blended drag change"
              value={formatFeeDragPts(data.blendedDragDeltaPts, true)}
              helper="Change in fund + advisory drag on the household (percentage points)"
              tone={dragChipTone(data.blendedDragDeltaPts)}
            />
            <InsightChip
              label="Proposed coverage"
              value={`${formatFeePctWhole(data.proposedCoveragePct)} (${formatFeeMoneyCompact(data.proposedManagedAssets)})`}
              helper="Share and dollar amount included in proposed management rollups"
              tone="neutral"
            />
            {data.showSelfManaged ? (
              <InsightChip
                label="Self-managed"
                value={formatFeeMoneyCompact(data.selfManagedAssets)}
                helper="Excluded from proposed advisor fee assumptions"
                tone="neutral"
              />
            ) : null}
            {data.showExcluded ? (
              <InsightChip
                label="Excluded from rollups"
                value={formatFeeMoneyCompact(data.excludedAssets)}
                helper="Omitted from proposed household totals"
                tone="neutral"
              />
            ) : null}
          </div>
        </PanelCard>

        <PanelCard className="bg-slate-50/40">
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-600">
            {data.narrativeHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-violet-950/90">{data.disclaimer}</p>
          <p className="mt-2 text-[0.65rem] text-slate-500">
            Unique tickers sent to the model: {data.uniqueTickerCount}. Holdings missing a ticker:{" "}
            {data.rowsMissingTicker}.
          </p>
        </PanelCard>
      </section>
    </div>
  );
}
