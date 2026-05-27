"use client";

import type { RothComparisonVisualData } from "@/lib/roth-comparison-visuals";
import {
  formatEffectiveRate,
  formatRothMoneyFull,
  ROTH_VISUAL_COLORS,
} from "@/lib/roth-visual-theme";
import { cn } from "@/lib/utils";

type RothBracketStrategyChartProps = {
  data: RothComparisonVisualData;
  className?: string;
};

const BRACKET_ORDER = [10, 12, 22, 24, 32, 35, 37] as const;

function nextBracketPct(current: number): number | null {
  const idx = BRACKET_ORDER.indexOf(current as (typeof BRACKET_ORDER)[number]);
  if (idx < 0 || idx >= BRACKET_ORDER.length - 1) return null;
  return BRACKET_ORDER[idx + 1]!;
}

function ExplainerCard({ title, body, accent }: { title: string; body: string; accent: string }) {
  return (
    <div className="rounded-none border border-slate-200 bg-slate-50/60 p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
        <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: accent }} />
        {title}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

export function RothBracketStrategyChart({ data, className }: RothBracketStrategyChartProps) {
  const stopPct = Math.min(0.98, Math.max(0.02, data.stopLinePosition));
  const stopPctLabel = Math.round(stopPct * 1000) / 10;
  const nextBracket = nextBracketPct(data.maxBracketPct);
  const showConvertLabel = stopPct >= 0.2;
  const showAvoidLabel = stopPct <= 0.78;

  const ariaLabel = `Marginal tax bracket strategy: convert up to ${data.maxBracketPct}% bracket ceiling at ${formatRothMoneyFull(data.grossIncomeCeiling)} gross income. Effective tax and IRMAA rate from ${formatEffectiveRate(data.stayEffectiveTaxIrmaaRate)} to ${formatEffectiveRate(data.rothEffectiveTaxIrmaaRate)}.`;

  return (
    <section className={cn("space-y-4", className)} aria-label={ariaLabel}>
      <div>
        <p className="ap-eyebrow">Your optimal income zone</p>
        <h3 className="mt-2 font-serif text-xl font-semibold text-slate-900 md:text-2xl">
          Marginal tax bracket management
        </h3>
        <p className="mt-1 text-sm italic text-slate-600">{data.filingLabel}</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Each conversion year, we fill room up to your{" "}
          <span className="font-semibold" style={{ color: ROTH_VISUAL_COLORS.accent }}>
            {data.maxBracketPct}% bracket ceiling
          </span>{" "}
          ({formatRothMoneyFull(data.grossIncomeCeiling)} illustrative gross income) — then stop before income
          would cross into a higher bracket.
        </p>
      </div>

      <div className="rounded-none border border-slate-200 bg-white p-4 md:p-6">
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: ROTH_VISUAL_COLORS.convertZone }} />
            Convert in this zone
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-px bg-slate-800" aria-hidden />
            Your ceiling
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: ROTH_VISUAL_COLORS.avoidZone }} />
            Avoid crossing into next bracket
          </span>
        </div>

        <div className="mx-auto max-w-3xl space-y-4">
          <div className="relative pt-2" role="img" aria-label={ariaLabel}>
            <div className="flex h-10 w-full overflow-hidden rounded-full border border-slate-200/80 shadow-inner">
              <ConvertZone stopPctLabel={stopPctLabel} showConvertLabel={showConvertLabel} />
              <AvoidZone showAvoidLabel={showAvoidLabel} />
            </div>
            <div
              className="pointer-events-none absolute top-2 h-10 w-0.5 border-l-2 border-dashed border-slate-800"
              style={{ left: `${stopPctLabel}%`, transform: "translateX(-50%)" }}
              aria-hidden
            />
          </div>

          <div className="rounded-none border border-slate-200 bg-slate-50/80 px-4 py-3 text-center">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
              Your conversion ceiling
            </p>
            <p className="mt-1 font-serif text-xl font-bold tabular-nums text-slate-900">
              {formatRothMoneyFull(data.grossIncomeCeiling)}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Illustrative gross income limit — top of your {data.maxBracketPct}% marginal bracket
              {nextBracket ? ` (before ${nextBracket}%)` : ""}
            </p>
          </div>
        </div>

        <div className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
          <ExplainerCard
            title="Convert zone"
            accent={ROTH_VISUAL_COLORS.convertZone}
            body={`Roth conversions are sized to keep illustrative gross income at or below ${formatRothMoneyFull(data.grossIncomeCeiling)} — the top of your ${data.maxBracketPct}% marginal bracket.`}
          />
          <ExplainerCard
            title="Your ceiling"
            accent={ROTH_VISUAL_COLORS.stopLine}
            body={`This is the stop line on the bar above. Conversions use available room each year without pushing ordinary income into the next bracket${nextBracket ? ` (${nextBracket}%)` : ""}.`}
          />
          <ExplainerCard
            title="Avoid zone"
            accent={ROTH_VISUAL_COLORS.avoidZone}
            body="Income above the ceiling would cross into a higher marginal rate. The plan avoids converting so much that you spill into this zone."
          />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
              Effective tax + IRMAA rate
            </p>
            <p className="mt-1 text-sm text-slate-700">
              From{" "}
              <span className="font-bold tabular-nums text-slate-900">
                {formatEffectiveRate(data.stayEffectiveTaxIrmaaRate)}
              </span>{" "}
              down to{" "}
              <span className="font-bold tabular-nums" style={{ color: ROTH_VISUAL_COLORS.roth }}>
                {formatEffectiveRate(data.rothEffectiveTaxIrmaaRate)}
              </span>
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <div className="text-center">
              <p className="text-[0.65rem] font-semibold uppercase text-slate-500">Current</p>
              <p className="font-serif text-2xl font-bold tabular-nums text-slate-900">
                {formatEffectiveRate(data.stayEffectiveTaxIrmaaRate)}
              </p>
            </div>
            <span className="text-xl text-slate-400" aria-hidden>
              →
            </span>
            <RothPlanRate rate={data.rothEffectiveTaxIrmaaRate} />
          </div>

          <p className="text-sm text-slate-700 md:text-right">
            {data.effectiveRateDeltaPts > 0 ? (
              <>
                A{" "}
                <span className="font-semibold" style={{ color: ROTH_VISUAL_COLORS.accent }}>
                  {formatEffectiveRate(data.effectiveRateDeltaPts)} point decrease
                </span>{" "}
                in your illustrative effective tax and IRMAA rate over the modeled lifetime.
              </>
            ) : (
              <>Effective rate change is illustrative only — confirm with your tax professional.</>
            )}
          </p>
        </div>

        {data.conversionAmountTotal > 0 ? (
          <p className="mt-4 text-xs text-slate-500">
            Total gross conversions modeled: {formatRothMoneyFull(data.conversionAmountTotal)}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ConvertZone({
  stopPctLabel,
  showConvertLabel,
}: {
  stopPctLabel: number;
  showConvertLabel: boolean;
}) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: `${stopPctLabel}%`,
        backgroundColor: ROTH_VISUAL_COLORS.convertZone,
      }}
    >
      {showConvertLabel ? (
        <span className="px-2 text-xs font-semibold uppercase tracking-wide text-white">Convert</span>
      ) : null}
    </div>
  );
}

function AvoidZone({ showAvoidLabel }: { showAvoidLabel: boolean }) {
  return (
    <div
      className="flex flex-1 items-center justify-center"
      style={{ backgroundColor: ROTH_VISUAL_COLORS.avoidZoneLight }}
    >
      {showAvoidLabel ? (
        <span className="px-2 text-xs font-semibold uppercase tracking-wide text-rose-800">Avoid</span>
      ) : null}
    </div>
  );
}

function RothPlanRate({ rate }: { rate: number }) {
  return (
    <div className="text-center">
      <p className="text-[0.65rem] font-semibold uppercase text-emerald-800">Roth plan</p>
      <p className="font-serif text-2xl font-bold tabular-nums text-emerald-800">{formatEffectiveRate(rate)}</p>
    </div>
  );
}
