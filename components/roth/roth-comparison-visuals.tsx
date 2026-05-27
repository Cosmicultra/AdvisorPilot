"use client";

import { useMemo } from "react";
import type { RothConversionModelResult } from "@/lib/roth-conversion-analysis";
import { buildRothComparisonVisualData } from "@/lib/roth-comparison-visuals";
import { RothBracketStrategyChart } from "@/components/roth/roth-bracket-strategy-chart";
import { RothLifetimeWealthPanel } from "@/components/roth/roth-lifetime-wealth-panel";
import { RothWealthAllocationChart } from "@/components/roth/roth-wealth-allocation-chart";
import { cn } from "@/lib/utils";

export type RothComparisonVisualsProps = {
  model: RothConversionModelResult;
  clientName?: string;
  className?: string;
};

export function RothComparisonVisuals({ model, clientName, className }: RothComparisonVisualsProps) {
  const data = useMemo(() => buildRothComparisonVisualData(model), [model]);

  return (
    <div
      className={cn(
        "space-y-8 rounded-none border border-slate-200 bg-white p-5 shadow-sm md:p-6",
        "border-t-[3px] border-t-[var(--ap-navy)]",
        className,
      )}
    >
      <p className="text-xs leading-relaxed text-slate-500">
        Illustrative comparison only — not tax, Medicare, or investment advice. Legacy to heirs uses ending
        balance; estate taxes are not modeled.
      </p>

      <RothLifetimeWealthPanel data={data} clientName={clientName} />
      <div className="border-t border-slate-100 pt-8">
        <RothWealthAllocationChart data={data} />
      </div>
      <div className="border-t border-slate-100 pt-8">
        <RothBracketStrategyChart data={data} />
      </div>
    </div>
  );
}
