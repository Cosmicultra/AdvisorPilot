"use client";

import type { FiaScenarioVisualData } from "@/lib/fia-comparison-visuals";
import { formatFiaMoneyCompact, formatFiaPct, FIA_VISUAL_COLORS } from "@/lib/fia-visual-theme";
import { cn } from "@/lib/utils";

type FiaProtectionCapPanelProps = {
  data: FiaScenarioVisualData;
  className?: string;
};

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

export function FiaProtectionCapPanel({ data, className }: FiaProtectionCapPanelProps) {
  const totalYears = data.downYearCount + data.upYearCount;
  const downPct =
    totalYears > 0 ? Math.min(0.98, Math.max(0.02, data.downYearCount / totalYears)) : 0.5;
  const downPctLabel = Math.round(downPct * 1000) / 10;
  const showDownLabel = downPct >= 0.18;
  const showUpLabel = downPct <= 0.82;

  const worstLine = data.worstDownYear
    ? `${data.worstDownYear.year}: S&P ${formatFiaPct(data.worstDownYear.spReturnPct)} → FIA credited 0%`
    : "No down years in this window.";

  const ariaLabel = `Downside protection and upside cap: ${data.downYearCount} down years credited 0%, up years capped at ${data.capPct}%, ${data.cappedUpYearCount} years hit the cap.`;

  return (
    <section className={cn("space-y-4", className)} aria-label={ariaLabel}>
      <div>
        <p className="ap-eyebrow">How the FIA responded</p>
        <h3 className="mt-2 font-serif text-xl font-semibold text-slate-900 md:text-2xl">
          Downside protection and upside cap
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          In this {data.tabLabel.toLowerCase()} window ({data.windowLabel}), down S&amp;P years credited{" "}
          <span className="font-semibold" style={{ color: FIA_VISUAL_COLORS.protection }}>
            0%
          </span>{" "}
          on the contract. Up years credited the lesser of the index return and your{" "}
          <span className="font-semibold" style={{ color: FIA_VISUAL_COLORS.cap }}>
            {data.capPct}% cap
          </span>
          .
        </p>
      </div>

      <div className="rounded-none border border-slate-200 bg-white p-4 md:p-6">
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: FIA_VISUAL_COLORS.downZone }} />
            Down years → 0% credited
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: FIA_VISUAL_COLORS.upZone }} />
            Up years → up to {data.capPct}% credited
          </span>
        </div>

        <div className="mx-auto max-w-3xl space-y-4">
          <div className="relative pt-2" role="img" aria-label={ariaLabel}>
            <div className="flex h-10 w-full overflow-hidden rounded-full border border-slate-200/80 shadow-inner">
              <div
                className="flex items-center justify-center"
                style={{
                  width: `${downPctLabel}%`,
                  backgroundColor: FIA_VISUAL_COLORS.downZone,
                }}
              >
                {showDownLabel ? (
                  <span className="px-2 text-xs font-semibold uppercase tracking-wide text-white">
                    {data.downYearCount} down {data.downYearCount === 1 ? "year" : "years"}
                  </span>
                ) : null}
              </div>
              <div
                className="flex flex-1 items-center justify-center"
                style={{ backgroundColor: FIA_VISUAL_COLORS.upZoneLight }}
              >
                {showUpLabel ? (
                  <span className="px-2 text-xs font-semibold uppercase tracking-wide text-emerald-900">
                    {data.upYearCount} up {data.upYearCount === 1 ? "year" : "years"}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {data.cappedUpYearCount > 0 ? (
            <div className="rounded-none border border-slate-200 bg-slate-50/80 px-4 py-3 text-center">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">Cap applied</p>
              <p className="mt-1 font-serif text-xl font-bold tabular-nums text-slate-900">
                {data.cappedUpYearCount} {data.cappedUpYearCount === 1 ? "year" : "years"} hit the {data.capPct}% cap
              </p>
              <p className="mt-1 text-xs text-slate-600">
                When the index rose more than {data.capPct}%, the contract credited {data.capPct}% instead.
              </p>
            </div>
          ) : null}
        </div>

        <div className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
          <ExplainerCard
            title="Zero floor"
            accent={FIA_VISUAL_COLORS.protection}
            body={
              data.spDownYearLossTotal > 0
                ? `In ${data.downYearCount} down ${data.downYearCount === 1 ? "year" : "years"} the contract credited 0%. A fully exposed S&P portfolio lost ${formatFiaMoneyCompact(data.spDownYearLossTotal)} cumulatively in those years (illustrative).`
                : `No down years in this window — both paths experienced positive or flat index returns.`
            }
          />
          <ExplainerCard
            title="Your cap"
            accent={FIA_VISUAL_COLORS.cap}
            body={`Up years credit the lesser of the calendar-year S&P return and your ${data.capPct}% contract cap. ${data.cappedUpYearCount > 0 ? `${data.cappedUpYearCount} years were limited by the cap.` : "The cap did not bind in this window."}`}
          />
          <ExplainerCard title="Worst down year" accent={FIA_VISUAL_COLORS.sp500} body={worstLine} />
        </div>
      </div>
    </section>
  );
}
