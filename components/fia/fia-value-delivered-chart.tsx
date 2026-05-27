"use client";

import type { FiaScenarioVisualData } from "@/lib/fia-comparison-visuals";
import {
  formatFiaDeltaCompact,
  formatFiaMoneyCompact,
  formatFiaMoneyFull,
  FIA_VISUAL_COLORS,
} from "@/lib/fia-visual-theme";
import { cn } from "@/lib/utils";

type FiaValueDeliveredChartProps = {
  data: FiaScenarioVisualData;
  className?: string;
};

type StackSegment = { key: string; label: string; value: number; color: string };

function buildSpSegments(data: FiaScenarioVisualData): StackSegment[] {
  const segs: StackSegment[] = [
    {
      key: "ending",
      label: "Ending balance",
      value: data.endingSp500,
      color: FIA_VISUAL_COLORS.sp500,
    },
  ];
  if (data.totalRmd > 0) {
    segs.push({
      key: "rmd",
      label: "Illustrative RMDs taken",
      value: data.totalRmd,
      color: FIA_VISUAL_COLORS.rmd,
    });
  }
  return segs;
}

function buildFiaSegments(data: FiaScenarioVisualData): StackSegment[] {
  const segs: StackSegment[] = [
    {
      key: "ending",
      label: "Ending balance",
      value: data.endingFia,
      color: FIA_VISUAL_COLORS.fiaContract,
    },
  ];
  if (data.totalRmd > 0) {
    segs.push({
      key: "rmd",
      label: "Illustrative RMDs taken",
      value: data.totalRmd,
      color: FIA_VISUAL_COLORS.rmd,
    });
  }
  return segs;
}

function StackedBar({
  title,
  totalLabel,
  segments,
  lossSegment,
  accent,
}: {
  title: string;
  totalLabel: string;
  segments: StackSegment[];
  lossSegment?: StackSegment | null;
  accent: "sp500" | "fia";
}) {
  const positiveTotal = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const lossVal = lossSegment?.value ?? 0;
  const wealthTotal = positiveTotal + lossVal;
  const chartH = 200;
  const barW = 72;
  const lossH = lossVal > 0 && wealthTotal > 0 ? (lossVal / wealthTotal) * chartH * 0.45 : 0;
  const stackH = chartH - lossH;

  let yOffset = 0;
  const positiveSegs = [...segments].reverse();

  return (
    <div className="flex flex-col items-center">
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          accent === "sp500" ? "text-red-800" : "text-[#0b1540]",
        )}
      >
        {title}
      </p>
      <p
        className={cn(
          "mt-1 font-serif text-2xl font-bold tabular-nums",
          accent === "sp500" ? "text-red-900" : "text-[#2563c4]",
        )}
      >
        {totalLabel}
      </p>
      <svg
        width={barW + 8}
        height={chartH + lossH + 8}
        viewBox={`0 0 ${barW + 8} ${chartH + lossH + 8}`}
        className="mt-3"
        role="presentation"
        aria-hidden
      >
        <g transform="translate(4, 4)">
          {positiveSegs.map((seg) => {
            const posSum = positiveSegs.reduce((s, x) => s + x.value, 0);
            const h = posSum > 0 ? (seg.value / posSum) * stackH : 0;
            const y = stackH - yOffset - h;
            yOffset += h;
            if (h < 1) return null;
            return (
              <g key={seg.key}>
                <rect x={0} y={y} width={barW} height={h} fill={seg.color} rx={seg.key === "ending" ? 2 : 0} />
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
                    {formatFiaMoneyCompact(seg.value)}
                  </text>
                )}
              </g>
            );
          })}
          {lossH > 2 && lossSegment ? (
            <g>
              <rect x={0} y={stackH + 4} width={barW} height={lossH} fill={FIA_VISUAL_COLORS.sp500Light} rx={2} />
              <rect
                x={0}
                y={stackH + 4}
                width={barW}
                height={Math.min(4, lossH)}
                fill={FIA_VISUAL_COLORS.sp500}
              />
              {lossH >= 22 && (
                <text
                  x={barW / 2}
                  y={stackH + 4 + lossH / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={FIA_VISUAL_COLORS.sp500}
                  fontSize={7}
                  fontWeight={600}
                >
                  −{formatFiaMoneyCompact(lossVal)}
                </text>
              )}
            </g>
          ) : null}
        </g>
      </svg>
      <ul className="mt-2 w-full space-y-1 text-[0.65rem] text-slate-600">
        {segments.map((seg) => (
          <li key={seg.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
              {seg.label}
            </span>
            <span className="tabular-nums font-medium text-slate-800">{formatFiaMoneyCompact(seg.value)}</span>
          </li>
        ))}
        {lossSegment && lossSegment.value > 0 ? (
          <li className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: FIA_VISUAL_COLORS.sp500 }}
              />
              {lossSegment.label}
            </span>
            <span className="tabular-nums font-medium text-red-800">−{formatFiaMoneyCompact(lossSegment.value)}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

export function FiaValueDeliveredChart({ data, className }: FiaValueDeliveredChartProps) {
  const spSegments = buildSpSegments(data);
  const fiaSegments = buildFiaSegments(data);
  const spTotalDelivered = data.endingSp500 + data.totalRmd;
  const fiaTotalDelivered = data.endingFia + data.totalRmd;

  const lossSegment: StackSegment | null =
    data.spDownYearLossTotal > 0
      ? {
          key: "loss",
          label: "Index losses in down years",
          value: data.spDownYearLossTotal,
          color: FIA_VISUAL_COLORS.sp500,
        }
      : null;

  const ariaLabel = `Where the dollars went: S&P path ${formatFiaMoneyFull(spTotalDelivered)}, FIA path ${formatFiaMoneyFull(fiaTotalDelivered)}, difference ${formatFiaDeltaCompact(data.wealthDelta)}`;

  return (
    <section className={cn("space-y-4", className)} aria-label={ariaLabel}>
      <div>
        <p className="ap-eyebrow">Where the dollars went</p>
        <h3 className="mt-2 font-serif text-xl font-semibold text-slate-900 md:text-2xl">
          How your premium became {formatFiaMoneyCompact(fiaTotalDelivered)} vs {formatFiaMoneyCompact(spTotalDelivered)}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Each bar combines what remains in the account plus illustrative RMDs already taken. The S&amp;P bar also
          shows cumulative index losses in down years; the FIA path credited 0% in those years.
        </p>
      </div>

      <div className="rounded-none border border-slate-200 bg-white p-4 md:p-6">
        <div className="grid grid-cols-1 items-end gap-6 md:grid-cols-[1fr_auto_1fr]">
          <StackedBar
            title="Hypothetical S&P 500"
            totalLabel={formatFiaMoneyCompact(spTotalDelivered)}
            segments={spSegments}
            lossSegment={lossSegment}
            accent="sp500"
          />

          <div className="flex flex-col items-center justify-center px-2 py-4 text-center">
            <span className="text-lg text-slate-400" aria-hidden>
              →
            </span>
            <p className="mt-2 font-serif text-xl font-bold tabular-nums text-[#2563c4]">
              {formatFiaDeltaCompact(data.wealthDelta)}
            </p>
            {data.spDownYearLossTotal > 0 ? (
              <p className="mt-1 max-w-[10rem] text-[0.65rem] font-semibold uppercase tracking-wide text-slate-600">
                Protected in down years
              </p>
            ) : null}
          </div>

          <StackedBar
            title="Your FIA contract"
            totalLabel={formatFiaMoneyCompact(fiaTotalDelivered)}
            segments={fiaSegments}
            accent="fia"
          />
        </div>
      </div>
    </section>
  );
}
