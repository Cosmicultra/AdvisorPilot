"use client";

import type { FiaYearSimulationRow } from "@/lib/fia-illustration";

type FiaScenarioReturnChartProps = {
  rows: readonly FiaYearSimulationRow[];
  scenarioId: string;
  /** e.g. "2000–2009" for caption context */
  windowLabel: string;
};

const slug = (id: string) => id.replace(/[^a-z0-9_-]/gi, "_");

/** Compact USD for chart ticks (e.g. $1.2M, $450K). */
function formatAxisDollars(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `$${Math.round(n / 1000)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Full USD for tooltips / legend detail */
function formatLegendDollars(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/**
 * Hypothetical S&P-only account in dollars: same BOY balance and illustrative RMD
 * withdrawals as the FIA row each year, then grow remainder by that year's S&P total return.
 */
function hypotheticalSp500EndValues(rows: readonly FiaYearSimulationRow[]): number[] {
  if (rows.length === 0) return [];
  let balance = rows[0]!.startingContractValue;
  if (!Number.isFinite(balance) || balance < 0) balance = 0;
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const rmd = Number.isFinite(r.rmdWithdrawal) ? Math.max(0, r.rmdWithdrawal) : 0;
    const afterRmd = Math.max(0, balance - rmd);
    const pct = Number.isFinite(r.sp500TotalReturnPct) ? r.sp500TotalReturnPct : 0;
    balance = afterRmd * (1 + pct / 100);
    out.push(balance);
  }
  return out;
}

function buildLinePath(values: number[], xAt: (i: number) => number, yAt: (v: number) => number): string {
  if (values.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = xAt(i);
    const y = yAt(values[i]!);
    parts.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  return parts.join(" ");
}

function buildAreaPathD(
  values: number[],
  xAt: (i: number) => number,
  yAt: (v: number) => number,
  bottomY: number
): string {
  if (values.length === 0) return "";
  let d = `M ${xAt(0)} ${bottomY} L ${xAt(0)} ${yAt(values[0]!)}`;
  for (let i = 1; i < values.length; i++) {
    d += ` L ${xAt(i)} ${yAt(values[i]!)}`;
  }
  d += ` L ${xAt(values.length - 1)} ${bottomY} Z`;
  return d;
}

/** Dollar paths: hypothetical S&P vs FIA contract end-of-year values from the same table. */
export function FiaScenarioReturnChart({ rows, scenarioId, windowLabel }: FiaScenarioReturnChartProps) {
  if (rows.length === 0) return null;

  const spDollars = hypotheticalSp500EndValues(rows);
  const fiaDollars = rows.map((r) => r.endingContractValue);

  let vmin = Math.min(...spDollars, ...fiaDollars);
  let vmax = Math.max(...spDollars, ...fiaDollars);
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return null;
  if (vmin === vmax) {
    vmin = Math.max(0, vmin * 0.92);
    vmax *= 1.08;
  }
  const span = vmax - vmin;
  const pad = Math.max(span * 0.06, 1);
  vmin = Math.max(0, vmin - pad);
  vmax += pad;

  const W = 580;
  const H = 292;
  const padL = 58;
  const padR = 14;
  const padT = 32;
  const padB = 54;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const bottomY = padT + plotH;
  const n = rows.length;
  const xAt = (i: number) => {
    if (n <= 1) return padL + plotW / 2;
    return padL + (i / (n - 1)) * plotW;
  };
  const yAt = (v: number) => padT + plotH - ((v - vmin) / (vmax - vmin)) * plotH;

  const spPath = buildLinePath(spDollars, xAt, yAt);
  const fiaPath = buildLinePath(fiaDollars, xAt, yAt);
  const spArea = buildAreaPathD(spDollars, xAt, yAt, bottomY);
  const fiaArea = buildAreaPathD(fiaDollars, xAt, yAt, bottomY);

  const yTicks = 5;
  const tickVals: number[] = [];
  for (let t = 0; t <= yTicks; t++) {
    tickVals.push(vmin + (t / yTicks) * (vmax - vmin));
  }

  const idBase = slug(scenarioId);
  const headingId = `fia-return-chart-h-${idBase}`;
  const gidSp = `grad-sp-${idBase}`;
  const gidFia = `grad-fia-${idBase}`;
  const fidGlow = `glow-${idBase}`;

  const last = n - 1;
  const endSp = spDollars[last]!;
  const endFia = fiaDollars[last]!;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p id={headingId} className="font-serif text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
        Contract vs S&amp;P 500 — end of year ({windowLabel})
      </p>
      <p className="mt-2 max-w-[52ch] text-xs leading-relaxed text-slate-600">
        Both lines are <span className="font-medium text-slate-800">dollars</span> (USD). Red: hypothetical portfolio fully exposed to the same calendar-year S&amp;P 500 total returns as Hypothetical Allocation Stress, starting from the same beginning-of-year balance and using the same illustrative RMD withdrawals as the table. Teal: FIA contract value (End value column) with your cap, floor, bonus, and rider rules.
      </p>

      <svg
        className="mt-5 w-full max-w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={headingId}
      >
        <defs>
          <linearGradient id={gidSp} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(248 113 113)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(248 113 113)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={gidFia} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(13 148 136)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="rgb(13 148 136)" stopOpacity="0" />
          </linearGradient>
          <filter id={fidGlow} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Plot frame */}
        <rect
          x={padL}
          y={padT}
          width={plotW}
          height={plotH}
          rx="6"
          fill="rgb(248 250 252)"
          stroke="rgb(226 232 240)"
          strokeWidth={1}
        />

        {tickVals.map((tv, ti) => {
          const yy = yAt(tv);
          return (
            <g key={`yt-${ti}`}>
              <line x1={padL} x2={padL + plotW} y1={yy} y2={yy} stroke="rgb(226 232 240)" strokeWidth={1} />
              <text
                x={padL - 10}
                y={yy}
                textAnchor="end"
                dominantBaseline="middle"
                fill="rgb(71 85 105)"
                fontSize={11}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
              >
                {formatAxisDollars(tv)}
              </text>
            </g>
          );
        })}

        <path d={spArea} fill={`url(#${gidSp})`} opacity={0.95} />
        <path d={fiaArea} fill={`url(#${gidFia})`} opacity={0.95} />

        <path
          d={spPath}
          fill="none"
          stroke="rgb(252 165 165)"
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          filter={`url(#${fidGlow})`}
        />
        <path
          d={spPath}
          fill="none"
          stroke="rgb(220 38 38)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <path
          d={fiaPath}
          fill="none"
          stroke="rgb(13 148 136)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {rows.map((r, i) => (
          <g key={r.year}>
            <circle cx={xAt(i)} cy={yAt(spDollars[i]!)} r={4} fill="rgb(254 202 202)" stroke="rgb(185 28 28)" strokeWidth={1.5} />
            <circle cx={xAt(i)} cy={yAt(fiaDollars[i]!)} r={4} fill="rgb(204 251 241)" stroke="rgb(13 148 136)" strokeWidth={1.5} />
          </g>
        ))}

        {rows.map((r, i) => (
          <text
            key={`xl-${r.year}`}
            x={xAt(i)}
            y={H - 12}
            textAnchor="middle"
            fill="rgb(51 65 85)"
            fontSize={11}
            fontWeight={600}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            {r.year}
          </text>
        ))}
      </svg>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs">
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <span className="inline-flex items-center gap-2.5 text-slate-700">
            <span className="relative flex h-2 w-8 items-center" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-red-500/25 blur-[2px]" />
              <span className="relative h-0.5 w-8 rounded-full bg-red-600" />
            </span>
            S&amp;P 500 (hypothetical)
          </span>
          <span className="inline-flex items-center gap-2.5 text-slate-700">
            <span className="relative flex h-2 w-8 items-center" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-teal-500/25 blur-[2px]" />
              <span className="relative h-0.5 w-8 rounded-full bg-teal-600" />
            </span>
            FIA contract (table)
          </span>
        </div>
        <div className="tabular-nums text-slate-600">
          Final year: <span className="font-medium text-red-700">{formatLegendDollars(endSp)}</span>
          <span className="mx-1.5 text-slate-400">·</span>
          <span className="font-medium text-teal-700">{formatLegendDollars(endFia)}</span>
        </div>
      </div>
    </div>
  );
}
