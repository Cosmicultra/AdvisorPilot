import { classifyAllocationBucket } from "@/lib/asset-classes";
import { bucketValuesToPercents } from "@/lib/allocation-math";

/** Sleeve colors — match step 04 Analysis donut charts (legacy-app-shell). */
export const ALLOCATION_SLEEVE_COLORS = {
  equity: "#0f766e",
  fixedIncome: "#1d4ed8",
  cash: "#c99700",
  other: "#64748b",
} as const;

export type AllocationSleeveKey = keyof typeof ALLOCATION_SLEEVE_COLORS;

export const ALLOCATION_SLEEVE_DISPLAY: Record<
  AllocationSleeveKey,
  { label: string; color: string }
> = {
  equity: { label: "Equity", color: ALLOCATION_SLEEVE_COLORS.equity },
  fixedIncome: { label: "Fixed", color: ALLOCATION_SLEEVE_COLORS.fixedIncome },
  cash: { label: "Cash", color: ALLOCATION_SLEEVE_COLORS.cash },
  other: { label: "Alternative investments", color: ALLOCATION_SLEEVE_COLORS.other },
};

/** Light row tint for CRM account holding lines (matches sleeve color). */
export const ALLOCATION_SLEEVE_ROW_BG: Record<AllocationSleeveKey, string> = {
  equity: "rgba(15, 118, 110, 0.1)",
  fixedIncome: "rgba(29, 78, 216, 0.09)",
  cash: "rgba(201, 151, 0, 0.14)",
  other: "rgba(100, 116, 139, 0.11)",
};

export function classifyHoldingAllocationSleeve(holding: HoldingLike): AllocationSleeveKey {
  return classifyAllocationBucket(
    String(holding?.assetClass ?? ""),
    String(holding?.suggested ?? ""),
    String(holding?.rawName ?? "")
  );
}

export function holdingAllocationSleeveMeta(holding: HoldingLike) {
  const key = classifyHoldingAllocationSleeve(holding);
  const display = ALLOCATION_SLEEVE_DISPLAY[key];
  return {
    key,
    label: display.label,
    color: display.color,
    rowBg: ALLOCATION_SLEEVE_ROW_BG[key],
  };
}

const SLEEVE_ORDER: AllocationSleeveKey[] = ["equity", "fixedIncome", "cash", "other"];

export type SleeveAllocationBucket = {
  name: string;
  valueUsd: number;
  weightPct: number;
  color: string;
};

export type SleeveAllocationSummary = {
  totalValue: number;
  buckets: SleeveAllocationBucket[];
};

type HoldingLike = {
  assetClass?: string | null;
  suggested?: string | null;
  rawName?: string | null;
  value?: number | string | null;
};

/** Current allocation by equity / fixed / cash / alt — same buckets as Analysis step 04. */
export function buildSleeveAllocationSummary(
  holdings: HoldingLike[] | null | undefined
): SleeveAllocationSummary {
  const list = Array.isArray(holdings) ? holdings : [];
  const totalValue = list.reduce((sum, h) => sum + (Number(h?.value) || 0), 0);

  const dollars = list.reduce(
    (acc, h) => {
      const bucket = classifyAllocationBucket(
        String(h?.assetClass ?? ""),
        String(h?.suggested ?? ""),
        String(h?.rawName ?? "")
      );
      acc[bucket] += Number(h?.value) || 0;
      return acc;
    },
    { equity: 0, fixedIncome: 0, cash: 0, other: 0 }
  );

  const percents = bucketValuesToPercents(dollars, totalValue);

  const buckets: SleeveAllocationBucket[] = [];
  for (const key of SLEEVE_ORDER) {
    if (dollars[key] <= 0) continue;
    const meta = ALLOCATION_SLEEVE_DISPLAY[key];
    buckets.push({
      name: meta.label,
      valueUsd: dollars[key],
      weightPct: percents[key],
      color: meta.color,
    });
  }

  buckets.sort((a, b) => b.valueUsd - a.valueUsd);
  return { totalValue, buckets };
}
