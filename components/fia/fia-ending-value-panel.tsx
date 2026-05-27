"use client";

import type { FiaScenarioVisualData } from "@/lib/fia-comparison-visuals";
import {
  formatFiaDeltaCompact,
  formatFiaMoneyCompact,
  formatFiaPct,
  FIA_VISUAL_COLORS,
} from "@/lib/fia-visual-theme";
import { cn } from "@/lib/utils";

type FiaEndingValuePanelProps = {
  data: FiaScenarioVisualData;
  className?: string;
};

function PanelCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-none border border-slate-200 bg-white p-4 md:p-5", className)}>{children}</div>;
}

export function FiaEndingValuePanel({ data, className }: FiaEndingValuePanelProps) {
  const fiaAhead = data.wealthDelta >= 0;

  return (
    <section className={cn("space-y-4", className)} aria-labelledby="fia-ending-value-heading">
      <PanelCard>
        <p className="ap-eyebrow">After 10 years ({data.windowLabel})</p>
        <h3 id="fia-ending-value-heading" className="mt-2 font-serif text-xl font-semibold text-slate-900 md:text-2xl">
          Contract value vs fully exposed S&amp;P 500
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          Same calendar years, same starting premium, and the same illustrative RMD withdrawals. The FIA path uses your
          cap, floor, bonus, and rider rules; the S&amp;P path is fully exposed to each year&apos;s index return.
        </p>
      </PanelCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <PanelCard className="bg-red-50/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-800">Hypothetical S&amp;P 500</p>
          <p className="mt-2 font-serif text-3xl font-bold tabular-nums text-red-900">
            {formatFiaMoneyCompact(data.endingSp500)}
          </p>
          <p className="mt-1 text-xs text-slate-600">Ending balance, fully exposed to index returns</p>
        </PanelCard>

        <div className="flex flex-col items-center justify-center px-2 py-3 md:py-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">Difference</p>
          <p
            className={cn(
              "mt-1 font-serif text-2xl font-bold tabular-nums",
              fiaAhead ? "text-[#0b1540]" : "text-amber-900",
            )}
          >
            {formatFiaDeltaCompact(data.wealthDelta)}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-slate-600">{formatFiaPct(data.wealthDeltaPct, true)}</p>
          <p className="mt-1 text-[0.65rem] text-slate-500">FIA minus S&amp;P</p>
        </div>

        <PanelCard className="border-[#93c5fd] bg-[#dbeafe]/60">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: FIA_VISUAL_COLORS.fiaContract }}>
            Your FIA contract
          </p>
          <p
            className="mt-2 font-serif text-3xl font-bold tabular-nums"
            style={{ color: FIA_VISUAL_COLORS.fiaContract }}
          >
            {formatFiaMoneyCompact(data.endingFia)}
          </p>
          <p className="mt-1 text-xs text-slate-600">Ending contract value with cap and floor rules</p>
        </PanelCard>
      </div>
    </section>
  );
}
