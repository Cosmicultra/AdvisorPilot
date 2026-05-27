"use client";

import type { RothComparisonVisualData } from "@/lib/roth-comparison-visuals";
import {
  formatRothDeltaCompact,
  formatRothMoneyCompact,
  formatRothMoneyFull,
  ROTH_VISUAL_COLORS,
} from "@/lib/roth-visual-theme";
import { cn } from "@/lib/utils";

type RothWealthAllocationChartProps = {
  data: RothComparisonVisualData;
  className?: string;
};

type StackSegment = { key: string; label: string; value: number; color: string };

function buildStackSegments(
  afterTaxIncome: number,
  heirsLegacy: number,
  taxesAndIrmaa: number,
): StackSegment[] {
  return [
    { key: "heirs", label: "Legacy to heirs", value: heirsLegacy, color: ROTH_VISUAL_COLORS.heirs },
    { key: "income", label: "Income you keep", value: afterTaxIncome, color: ROTH_VISUAL_COLORS.income },
    { key: "taxes", label: "Taxes + IRMAA", value: taxesAndIrmaa, color: ROTH_VISUAL_COLORS.taxes },
  ];
}

function StackedBar({
  title,
  totalLabel,
  segments,
  accent,
}: {
  title: string;
  totalLabel: string;
  segments: StackSegment[];
  accent: "stay" | "roth";
}) {
  const positiveTotal = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const taxSeg = segments.find((s) => s.key === "taxes");
  const taxVal = taxSeg?.value ?? 0;
  const wealthTotal = positiveTotal;
  const chartH = 200;
  const barW = 72;
  const taxH = taxVal > 0 && wealthTotal > 0 ? (taxVal / wealthTotal) * chartH * 0.45 : 0;
  const stackH = chartH - taxH;

  let yOffset = 0;
  const positiveSegs = segments.filter((s) => s.key !== "taxes").sort((a, b) => {
    if (a.key === "income") return -1;
    if (b.key === "income") return 1;
    return 0;
  });
  const posSum = positiveSegs.reduce((s, seg) => s + seg.value, 0);

  return (
    <div className="flex flex-col items-center">
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          accent === "stay" ? "text-slate-600" : "text-emerald-900",
        )}
      >
        {title}
      </p>
      <p
        className={cn(
          "mt-1 font-serif text-2xl font-bold tabular-nums",
          accent === "stay" ? "text-slate-900" : "text-emerald-900",
        )}
      >
        {totalLabel}
      </p>
      <svg
        width={barW + 8}
        height={chartH + taxH + 8}
        viewBox={`0 0 ${barW + 8} ${chartH + taxH + 8}`}
        className="mt-3"
        role="presentation"
        aria-hidden
      >
        <g transform={`translate(4, 4)`}>
          {positiveSegs.map((seg) => {
            const h = posSum > 0 ? (seg.value / posSum) * stackH : 0;
            const y = stackH - yOffset - h;
            yOffset += h;
            if (h < 1) return null;
            return (
              <g key={seg.key}>
                <rect x={0} y={y} width={barW} height={h} fill={seg.color} rx={seg.key === "heirs" ? 2 : 0} />
                {h >= 28 && (
                  <text
                    x={barW / 2}
                    y={y + h / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={8}
                    fontWeight={600}
                  >
                    {formatRothMoneyCompact(seg.value)}
                  </text>
                )}
              </g>
            );
          })}
          {taxH > 2 && (
            <g>
              <rect x={0} y={stackH + 4} width={barW} height={taxH} fill={ROTH_VISUAL_COLORS.taxesLight} rx={2} />
              <rect
                x={0}
                y={stackH + 4}
                width={barW}
                height={Math.min(4, taxH)}
                fill={ROTH_VISUAL_COLORS.taxes}
              />
              {taxH >= 22 && (
                <text
                  x={barW / 2}
                  y={stackH + 4 + taxH / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={ROTH_VISUAL_COLORS.taxes}
                  fontSize={7}
                  fontWeight={600}
                >
                  −{formatRothMoneyCompact(taxVal)}
                </text>
              )}
            </g>
          )}
        </g>
      </svg>
      <ul className="mt-2 w-full space-y-1 text-[0.65rem] text-slate-600">
        {segments.map((seg) => (
          <li key={seg.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
              {seg.label}
            </span>
            <span className="tabular-nums font-medium text-slate-800">{formatRothMoneyCompact(seg.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RothWealthAllocationChart({ data, className }: RothWealthAllocationChartProps) {
  const staySegments = buildStackSegments(
    data.stayAfterTaxIncome,
    data.stayHeirsLegacy,
    data.stayTaxesAndIrmaa,
  );
  const rothSegments = buildStackSegments(
    data.rothAfterTaxIncome,
    data.rothHeirsLegacy,
    data.rothTaxesAndIrmaa,
  );

  const stayTotal = data.stayAfterTaxIncome + data.stayHeirsLegacy;
  const rothTotal = data.rothAfterTaxIncome + data.rothHeirsLegacy;
  const taxShift = data.stayTaxesAndIrmaa - data.rothTaxesAndIrmaa;

  const ariaLabel = `Where the dollars go: current path total ${formatRothMoneyFull(stayTotal)}, Roth path ${formatRothMoneyFull(rothTotal)}, difference ${formatRothDeltaCompact(data.wealthDelta)}`;

  return (
    <section className={cn("space-y-4", className)} aria-label={ariaLabel}>
      <div>
        <p className="ap-eyebrow">Where the dollars go</p>
        <h3 className="mt-2 font-serif text-xl font-semibold text-slate-900 md:text-2xl">
          How your {formatRothMoneyCompact(stayTotal)} becomes {formatRothMoneyCompact(rothTotal)}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Each bar splits lifetime value into income you keep, legacy to heirs (ending balance), and taxes plus IRMAA paid.
          Legacy is illustrative — estate taxes are not modeled.
        </p>
      </div>

      <div className="rounded-none border border-slate-200 bg-white p-4 md:p-6">
        <div className="grid grid-cols-1 items-end gap-6 md:grid-cols-[1fr_auto_1fr]">
          <StackedBar
            title="Current path"
            totalLabel={formatRothMoneyCompact(stayTotal)}
            segments={staySegments}
            accent="stay"
          />

          <div className="flex flex-col items-center justify-center px-2 py-4 text-center">
            <span className="text-lg text-slate-400" aria-hidden>
              →
            </span>
            <p className="mt-2 font-serif text-xl font-bold tabular-nums text-emerald-800">
              {formatRothDeltaCompact(data.wealthDelta)}
            </p>
            {taxShift > 0 ? (
              <p className="mt-1 max-w-[10rem] text-[0.65rem] font-semibold uppercase tracking-wide text-slate-600">
                Shifted from taxes &amp; IRMAA
              </p>
            ) : null}
          </div>

          <StackedBar
            title="Roth conversion path"
            totalLabel={formatRothMoneyCompact(rothTotal)}
            segments={rothSegments}
            accent="roth"
          />
        </div>
      </div>
    </section>
  );
}
