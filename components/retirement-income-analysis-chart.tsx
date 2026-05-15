"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  computeRetirementIncomeChartSummary,
  type RetirementIncomeChartRow,
} from "@/lib/retirement-income-chart-data";

export type { RetirementIncomeChartRow } from "@/lib/retirement-income-chart-data";

/** Stacked segment colors — classic income-planning palette. */
export const RETIREMENT_INCOME_CHART_COLORS = {
  socialSecurity: "#86efac",
  pension: "#166534",
  otherIncome: "#0d9488",
  earnedIncome: "#2563eb",
  rmd: "#b45309",
  incomeGapWithdrawal: "#eab308",
  incomeNeedOverlay: "rgba(220, 38, 38, 0.32)",
} as const;

const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyFmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return moneyFmt.format(Math.round(n));
}

function formatMoneyCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return moneyFmtCompact.format(n);
}

function totalSources(d: RetirementIncomeChartRow): number {
  return (
    d.earnedIncome +
    d.socialSecurity +
    d.pension +
    d.otherIncome +
    d.rmd +
    d.incomeGapWithdrawal
  );
}

function surplusOrDeficit(d: RetirementIncomeChartRow): { label: string; value: number; tone: "ok" | "warn" } {
  const need = Math.max(0, d.incomeNeed);
  const src = totalSources(d);
  if (need <= 0) return { label: "Retirement need", value: 0, tone: "ok" };
  const diff = src - need;
  if (diff >= -1) return { label: "Surplus", value: diff, tone: "ok" };
  return { label: "Deficit", value: diff, tone: "warn" };
}

type TooltipPayload = {
  dataKey?: string;
  name?: string;
  value?: number;
  color?: string;
  payload?: RetirementIncomeChartRow;
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const total = totalSources(row);
  const sod = surplusOrDeficit(row);
  const lines: { k: string; v: string }[] = [
    { k: "Year", v: String(row.year) },
    { k: "Client age", v: String(row.age) },
    { k: "Earned income", v: formatMoney(row.earnedIncome) },
    { k: "Social Security", v: formatMoney(row.socialSecurity) },
    { k: "Pension", v: formatMoney(row.pension) },
    { k: "Other income", v: formatMoney(row.otherIncome) },
    { k: "RMD", v: formatMoney(row.rmd) },
    { k: "Income gap W/D", v: formatMoney(row.incomeGapWithdrawal) },
    { k: "Total income (sources)", v: formatMoney(total) },
    { k: "Income need", v: formatMoney(row.incomeNeed) },
    {
      k: sod.label,
      v: formatMoney(sod.value),
    },
    { k: "Total W/D pre-tax", v: formatMoney(row.totalWithdrawalsPreTax) },
    { k: "Portfolio (end)", v: formatMoney(row.portfolioEnd) },
  ];

  return (
    <div className="max-w-xs rounded-none border border-slate-200 bg-white px-3 py-2.5 text-xs shadow-lg">
      <p className="border-b border-slate-100 pb-1.5 font-semibold text-slate-900">Age {label}</p>
      <ul className="mt-1.5 space-y-1 text-slate-700">
        {lines.map((x) => (
          <li key={x.k} className="flex justify-between gap-4 tabular-nums">
            <span className="text-slate-500">{x.k}</span>
            <span className={x.k === sod.label && sod.tone === "warn" ? "font-semibold text-amber-800" : ""}>{x.v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LEGEND_ITEMS: { key: keyof typeof RETIREMENT_INCOME_CHART_COLORS; label: string }[] = [
  { key: "socialSecurity", label: "Social Security" },
  { key: "pension", label: "Pension" },
  { key: "otherIncome", label: "Other income" },
  { key: "earnedIncome", label: "Earned income" },
  { key: "rmd", label: "RMD" },
  { key: "incomeGapWithdrawal", label: "Income gap W/D" },
  { key: "incomeNeedOverlay", label: "Income need (overlay)" },
];

export type RetirementIncomeAnalysisChartProps = {
  data: RetirementIncomeChartRow[];
  className?: string;
  /** Chart body height in px (responsive width is 100%). */
  height?: number;
  /** Annual discount rate for illustrative PV of unmet need (e.g. 0.03). */
  discountRateAnnual?: number;
  heading?: string;
};

export function RetirementIncomeAnalysisChart({
  data,
  className,
  height = 380,
  discountRateAnnual = 0.03,
  heading = "Retirement income sources vs. need",
}: RetirementIncomeAnalysisChartProps) {
  const summary = useMemo(
    () => computeRetirementIncomeChartSummary(data, { discountRateAnnual }),
    [data, discountRateAnnual],
  );

  const firstRmdAge = useMemo(() => data.find((r) => r.hasRmd)?.age ?? null, [data]);

  const yDomainMax = useMemo(() => {
    let m = 0;
    for (const r of data) {
      const src = totalSources(r);
      const top = Math.max(src, r.incomeNeed);
      if (top > m) m = top;
    }
    if (m <= 0) return 100_000;
    return m * 1.08;
  }, [data]);

  const legendItems = useMemo(() => {
    const hasPension = data.some((r) => r.pension > 1e-6);
    const hasOtherIncome = data.some((r) => r.otherIncome > 1e-6);
    return LEGEND_ITEMS.filter((item) => {
      if (item.key === "pension") return hasPension;
      if (item.key === "otherIncome") return hasOtherIncome;
      return true;
    });
  }, [data]);

  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[200px] items-center justify-center rounded-none border border-dashed border-slate-200 bg-white text-sm text-slate-500",
          className,
        )}
      >
        Add projection data to view the retirement income chart.
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn("rounded-none border border-slate-200 bg-white shadow-sm", className)}
    >
      <div className="border-b border-slate-100 px-4 py-4 md:px-6">
        <h3 className="font-serif text-lg font-semibold text-slate-900 md:text-xl">{heading}</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Stacked bars show annual income sources. Red overlay is retirement income need; surplus shows as colored bars
          above the overlay, shortfall as visible red above sources.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-3">
          {legendItems.map((item) => (
            <div key={item.key} className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <span
                className="h-2.5 w-4 shrink-0 rounded-sm border border-slate-200/80"
                style={{ backgroundColor: RETIREMENT_INCOME_CHART_COLORS[item.key] }}
              />
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="px-2 pb-2 pt-4 md:px-4" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 12, right: 12, left: 4, bottom: 28 }}
            barCategoryGap="18%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="age"
              tickLine={{ stroke: "#cbd5e1" }}
              axisLine={{ stroke: "#cbd5e1" }}
              tick={({ x, y, payload }) => {
                const age = Number(payload.value);
                const row = data.find((d) => d.age === age);
                const rmdYear = row?.hasRmd;
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      dy={14}
                      textAnchor="middle"
                      fill={rmdYear ? "#9a3412" : "#64748b"}
                      fontSize={11}
                      fontWeight={rmdYear ? 700 : 500}
                    >
                      {payload.value}
                    </text>
                  </g>
                );
              }}
              label={{ value: "Client age", position: "insideBottom", offset: -18, fill: "#475569", fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(v) => formatMoneyCompact(Number(v))}
              tick={{ fill: "#64748b", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              domain={[0, yDomainMax]}
              width={56}
              label={{
                value: "Annual income",
                angle: -90,
                position: "insideLeft",
                style: { fill: "#475569", fontSize: 12, textAnchor: "middle" },
                offset: 2,
              }}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
              animationDuration={200}
            />
            {/* Need overlay first; stacked income sources draw on top for surplus/deficit read. */}
            <Bar
              dataKey="incomeNeed"
              name="Income need"
              fill={RETIREMENT_INCOME_CHART_COLORS.incomeNeedOverlay}
              radius={[6, 6, 0, 0]}
              isAnimationActive
              animationDuration={500}
              animationEasing="ease-out"
            />
            <Bar
              dataKey="earnedIncome"
              stackId="income"
              name="Earned income"
              fill={RETIREMENT_INCOME_CHART_COLORS.earnedIncome}
              radius={[0, 0, 0, 0]}
              isAnimationActive
              animationDuration={500}
            />
            <Bar
              dataKey="socialSecurity"
              stackId="income"
              name="Social Security"
              fill={RETIREMENT_INCOME_CHART_COLORS.socialSecurity}
              isAnimationActive
              animationDuration={500}
            />
            <Bar
              dataKey="pension"
              stackId="income"
              name="Pension"
              fill={RETIREMENT_INCOME_CHART_COLORS.pension}
              isAnimationActive
              animationDuration={500}
            />
            <Bar
              dataKey="otherIncome"
              stackId="income"
              name="Other income"
              fill={RETIREMENT_INCOME_CHART_COLORS.otherIncome}
              isAnimationActive
              animationDuration={500}
            />
            <Bar
              dataKey="rmd"
              stackId="income"
              name="RMD"
              fill={RETIREMENT_INCOME_CHART_COLORS.rmd}
              isAnimationActive
              animationDuration={500}
            />
            <Bar
              dataKey="incomeGapWithdrawal"
              stackId="income"
              name="Income gap W/D"
              fill={RETIREMENT_INCOME_CHART_COLORS.incomeGapWithdrawal}
              radius={[6, 6, 0, 0]}
              isAnimationActive
              animationDuration={500}
            />
            {firstRmdAge != null ? (
              <ReferenceLine
                x={firstRmdAge}
                stroke="#b45309"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: "RMD",
                  position: "top",
                  fill: "#9a3412",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-slate-100 bg-slate-50/80 px-4 py-4 text-xs sm:grid-cols-2 lg:grid-cols-5 md:px-6">
        <SummaryStat
          label="Years fully funded"
          value={String(summary.yearsFullyFunded)}
          hint="Years with retirement need met by income sources"
        />
        <SummaryStat
          label="Total unmet need"
          value={formatMoney(summary.totalUnmetNeed)}
          hint="Sum of annual shortfalls (undiscounted)"
        />
        <SummaryStat
          label="Largest gap"
          value={
            summary.highestGapAge != null
              ? `${formatMoney(summary.highestGapAmount)} (age ${summary.highestGapAge})`
              : "—"
          }
          hint={summary.highestGapYear != null ? `Calendar year ${summary.highestGapYear}` : undefined}
        />
        <SummaryStat
          label="Portfolio longevity (age)"
          value={summary.portfolioLongevityAge != null ? String(summary.portfolioLongevityAge) : "—"}
          hint="Last projected year with ending portfolio above zero"
        />
        <SummaryStat
          label="PV of unmet need"
          value={formatMoney(summary.presentValueUnmetNeed)}
          hint={`Illustrative, ${(discountRateAnnual * 100).toFixed(1)}% discount / year`}
        />
      </div>
    </motion.div>
  );
}

function SummaryStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-none border border-slate-200/80 bg-white px-3 py-2.5 shadow-sm">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 font-serif text-base font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-[0.65rem] leading-snug text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Example rows for demos or tests — illustrative only. */
export const MOCK_RETIREMENT_INCOME_CHART_DATA: RetirementIncomeChartRow[] = [
  {
    year: 2026,
    age: 60,
    incomeNeed: 0,
    earnedIncome: 120_000,
    socialSecurity: 0,
    pension: 0,
    otherIncome: 0,
    rmd: 0,
    incomeGapWithdrawal: 0,
    totalWithdrawalsPreTax: 0,
    portfolioEnd: 2_100_000,
    hasRmd: false,
  },
  {
    year: 2027,
    age: 61,
    incomeNeed: 0,
    earnedIncome: 122_000,
    socialSecurity: 0,
    pension: 0,
    otherIncome: 0,
    rmd: 0,
    incomeGapWithdrawal: 0,
    totalWithdrawalsPreTax: 0,
    portfolioEnd: 2_150_000,
    hasRmd: false,
  },
  {
    year: 2033,
    age: 67,
    incomeNeed: 85_000,
    earnedIncome: 0,
    socialSecurity: 0,
    pension: 0,
    otherIncome: 0,
    rmd: 0,
    incomeGapWithdrawal: 106_250,
    totalWithdrawalsPreTax: 106_250,
    portfolioEnd: 2_173_351,
    hasRmd: false,
  },
  {
    year: 2034,
    age: 68,
    incomeNeed: 87_550,
    earnedIncome: 0,
    socialSecurity: 28_000,
    pension: 12_000,
    otherIncome: 4_000,
    rmd: 0,
    incomeGapWithdrawal: 58_000,
    totalWithdrawalsPreTax: 58_000,
    portfolioEnd: 2_080_000,
    hasRmd: false,
  },
  {
    year: 2035,
    age: 69,
    incomeNeed: 90_177,
    earnedIncome: 0,
    socialSecurity: 28_560,
    pension: 12_240,
    otherIncome: 4_080,
    rmd: 0,
    incomeGapWithdrawal: 52_000,
    totalWithdrawalsPreTax: 52_000,
    portfolioEnd: 1_995_000,
    hasRmd: false,
  },
  {
    year: 2042,
    age: 76,
    incomeNeed: 108_000,
    earnedIncome: 0,
    socialSecurity: 32_000,
    pension: 14_000,
    otherIncome: 5_000,
    rmd: 42_000,
    incomeGapWithdrawal: 28_000,
    totalWithdrawalsPreTax: 70_000,
    portfolioEnd: 1_420_000,
    hasRmd: true,
  },
  {
    year: 2043,
    age: 77,
    incomeNeed: 111_240,
    earnedIncome: 0,
    socialSecurity: 32_640,
    pension: 14_280,
    otherIncome: 5_100,
    rmd: 44_000,
    incomeGapWithdrawal: 22_000,
    totalWithdrawalsPreTax: 66_000,
    portfolioEnd: 1_355_000,
    hasRmd: true,
  },
];

export default RetirementIncomeAnalysisChart;
