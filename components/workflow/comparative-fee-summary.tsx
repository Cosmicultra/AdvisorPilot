"use client";

import { ComparativeFeeComparisonVisual } from "@/components/workflow/comparative-fee-comparison-visual";
import type {
  ComparativeFeeAnalysisResponse,
  HouseholdScenarioSummary,
} from "@/lib/comparative-fee-analysis";

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatPct(decimal: number) {
  return `${(decimal * 100).toFixed(3)}%`;
}

function ScenarioCard({
  title,
  subtitle,
  scenario,
  variant,
}: {
  title: string;
  subtitle: string;
  scenario: HouseholdScenarioSummary;
  variant: "slate" | "violet" | "amber";
}) {
  const border =
    variant === "violet"
      ? "border-violet-200 bg-violet-50/60"
      : variant === "amber"
        ? "border-amber-200 bg-amber-50/70"
        : "border-slate-200 bg-slate-50/80";
  const titleColor =
    variant === "violet"
      ? "text-violet-950"
      : variant === "amber"
        ? "text-amber-950"
        : "text-slate-900";

  return (
    <div className={`rounded-none border p-5 md:p-6 ${border}`}>
      <h3 className={`font-serif text-xl font-semibold ${titleColor}`}>{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{subtitle}</p>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
          <dt className="text-slate-600">Estimated internal fund expenses</dt>
          <dd className="font-semibold tabular-nums text-slate-900">
            {formatCurrency(scenario.totalEstimatedFundFeesDollars)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
          <dt className="text-slate-600">Advisory fees (illustrative)</dt>
          <dd className="font-semibold tabular-nums text-slate-900">
            {formatCurrency(scenario.totalAdvisorFeesDollars)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2 md:col-span-2">
          <dt className="text-slate-600">Total estimated annual household cost</dt>
          <dd className="font-semibold tabular-nums text-slate-900">
            {formatCurrency(scenario.totalEstimatedAnnualCostDollars)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
          <dt className="text-slate-600">Fund expense load</dt>
          <dd className="font-semibold tabular-nums text-slate-900">
            {formatPct(scenario.fundExpenseLoadPct)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-slate-200/80 pb-2">
          <dt className="text-slate-600">Blended annual drag (fund + advisory)</dt>
          <dd className={`font-semibold tabular-nums ${titleColor}`}>
            {formatPct(scenario.blendedAnnualDragPct)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Household basis for percentages: {formatCurrency(scenario.householdValue)}
      </p>
    </div>
  );
}

export function ComparativeFeeSummaryCards({
  result,
}: {
  result: ComparativeFeeAnalysisResponse;
}) {
  return (
    <div className="space-y-4">
      <ScenarioCard
        title="Current household costs"
        subtitle="Estimated household portfolio costs under current management assumptions."
        scenario={result.current}
        variant="slate"
      />
      <ScenarioCard
        title="Proposed household costs"
        subtitle="Estimated household portfolio costs under the proposed management scenario."
        scenario={result.proposed}
        variant="violet"
      />
      <ComparativeFeeComparisonVisual result={result} />
    </div>
  );
}
