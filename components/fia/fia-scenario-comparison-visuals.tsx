"use client";

import { useMemo } from "react";
import type { FiaYearSimulationRow } from "@/lib/fia-illustration";
import { buildFiaScenarioVisualData } from "@/lib/fia-comparison-visuals";
import { formatFiaMoneyCompact } from "@/lib/fia-visual-theme";
import { FiaEndingValuePanel } from "@/components/fia/fia-ending-value-panel";
import { FiaProtectionCapPanel } from "@/components/fia/fia-protection-cap-panel";
import { FiaValueDeliveredChart } from "@/components/fia/fia-value-delivered-chart";
import { cn } from "@/lib/utils";

export type FiaScenarioComparisonVisualsProps = {
  rows: readonly FiaYearSimulationRow[];
  scenarioId: string;
  windowLabel: string;
  tabLabel: string;
  capPct: number;
  showRider: boolean;
  className?: string;
};

export function FiaScenarioComparisonVisuals({
  rows,
  windowLabel,
  tabLabel,
  capPct,
  showRider,
  className,
}: FiaScenarioComparisonVisualsProps) {
  const data = useMemo(
    () =>
      buildFiaScenarioVisualData(rows, {
        capPct,
        windowLabel,
        tabLabel,
        showRider,
      }),
    [rows, capPct, windowLabel, tabLabel, showRider]
  );

  if (!data) return null;

  return (
    <div
      className={cn(
        "mt-6 space-y-8 rounded-none border border-slate-200 bg-white p-5 shadow-sm md:p-6",
        "border-t-[3px] border-t-[var(--ap-navy)]",
        className,
      )}
    >
      <p className="text-xs leading-relaxed text-slate-500">
        Illustrative comparison only — not a carrier illustration. S&amp;P 500 returns use firm calendar-year
        calibration; the FIA path applies your entered cap, floor, bonus, and rider rules.
      </p>

      <FiaEndingValuePanel data={data} />

      <div className="border-t border-slate-100 pt-8">
        <FiaValueDeliveredChart data={data} />
      </div>

      <div className="border-t border-slate-100 pt-8">
        <FiaProtectionCapPanel data={data} />
      </div>

      {showRider && data.endingRiderBase != null && data.endingRiderBase > 0 ? (
        <div className="rounded-none border border-cyan-200 bg-cyan-50/50 px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-slate-800">Illustrative rider benefit base (end): </span>
          <span className="tabular-nums font-medium text-cyan-900">
            {formatFiaMoneyCompact(data.endingRiderBase)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
