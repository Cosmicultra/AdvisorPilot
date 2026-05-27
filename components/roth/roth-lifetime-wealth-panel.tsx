"use client";

import type { RothComparisonVisualData } from "@/lib/roth-comparison-visuals";
import {
  formatRothDeltaCompact,
  formatRothMoneyCompact,
  formatRothPct,
  ROTH_VISUAL_COLORS,
} from "@/lib/roth-visual-theme";
import { cn } from "@/lib/utils";

type RothLifetimeWealthPanelProps = {
  data: RothComparisonVisualData;
  clientName?: string;
  className?: string;
};

function deltaTone(n: number): "positive" | "negative" | "neutral" {
  if (n > 500) return "positive";
  if (n < -500) return "negative";
  return "neutral";
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

function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-none border border-slate-200 bg-white p-4 md:p-5", className)}>{children}</div>
  );
}

export function RothLifetimeWealthPanel({ data, clientName, className }: RothLifetimeWealthPanelProps) {
  const headline = clientName
    ? `Lifetime wealth comparison for ${clientName}`
    : "Lifetime wealth comparison";

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="roth-lifetime-heading">
      <PanelCard>
        <p className="ap-eyebrow">Lifetime wealth comparison</p>
        <h3 id="roth-lifetime-heading" className="mt-2 font-serif text-xl font-semibold text-slate-900 md:text-2xl">
          {headline}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          At the end of the modeled horizon, the Roth conversion path leaves{" "}
          {data.wealthDelta >= 0 ? "more" : "less"} after-tax wealth than staying in traditional IRAs.
        </p>
      </PanelCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <PanelCard className="bg-slate-50/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current path</p>
          <p className="mt-2 font-serif text-3xl font-bold tabular-nums text-slate-900">
            {formatRothMoneyCompact(data.stayEndingWealth)}
          </p>
          <p className="mt-1 text-xs text-slate-500">After-tax wealth, no conversion plan</p>
        </PanelCard>

        <div className="flex flex-col items-center justify-center px-2 py-3 md:py-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">Difference</p>
          <p
            className={cn(
              "mt-1 font-serif text-2xl font-bold tabular-nums",
              data.wealthDelta >= 0 ? "text-emerald-800" : "text-amber-900",
            )}
          >
            {formatRothDeltaCompact(data.wealthDelta)}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-slate-600">{formatRothPct(data.wealthDeltaPct, true)}</p>
        </div>

        <PanelCard className="border-emerald-200 bg-emerald-50/40">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: ROTH_VISUAL_COLORS.roth }}>
            Roth conversion path
          </p>
          <p className="mt-2 font-serif text-3xl font-bold tabular-nums" style={{ color: ROTH_VISUAL_COLORS.roth }}>
            {formatRothMoneyCompact(data.rothEndingWealth)}
          </p>
          <p className="mt-1 text-xs text-slate-600">After-tax wealth, with the conversion plan</p>
        </PanelCard>
      </div>

      <PanelCard>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where the difference comes from</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InsightChip
            label="More total wealth"
            value={formatRothDeltaCompact(data.wealthDelta)}
            helper={`${formatRothPct(data.wealthDeltaPct, true)} vs. current path at end of plan`}
            tone={deltaTone(data.wealthDelta)}
          />
          <InsightChip
            label="Tax savings"
            value={formatRothDeltaCompact(data.taxSavings)}
            helper="Federal illustrative tax avoided over the modeled lifetime"
            tone={deltaTone(data.taxSavings)}
          />
          <InsightChip
            label="IRMAA difference"
            value={formatRothDeltaCompact(data.irmaaSavings)}
            helper="Medicare IRMAA surcharges avoided (illustrative)"
            tone={deltaTone(data.irmaaSavings)}
          />
          <InsightChip
            label="Spendable income trade-off"
            value={formatRothDeltaCompact(data.afterTaxIncomeDelta)}
            helper="After-tax income kept during the plan — a lower number can mean more went to heirs"
            tone={deltaTone(data.afterTaxIncomeDelta)}
          />
        </div>
      </PanelCard>
    </section>
  );
}
