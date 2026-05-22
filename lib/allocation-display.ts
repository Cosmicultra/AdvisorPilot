import { accountKeyForHolding } from "@/lib/annuity-contract-types";
import { classifyAllocationBucket } from "@/lib/asset-classes";
import type { IntakeClient } from "@/lib/intake-config";
import { bucketValuesToPercents, targetAllocationBuckets } from "@/lib/allocation-math";
import { parseClientAgeForIllustration } from "@/lib/roth-inputs";
import { maskAccountNumberDisplay } from "@/lib/mask-account-number";
import {
  normalizeRegistrationType,
  type RegistrationBucket,
} from "@/lib/holding-registration";

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
  accountNumber?: string | null;
  registrationType?: string | null;
  annuityContract?: unknown;
  documentKind?: unknown;
};

export type SleeveAccountRow = {
  accountLabel: string;
  pctOfSleeve: number;
};

export type InteractiveAllocationSleeve = AllocationDonutSegment & {
  sleeveKey: AllocationSleeveKey;
  valueUsd: number;
  accounts: SleeveAccountRow[];
};

const UNASSIGNED_ACCOUNT_KEY = "__unassigned__";

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

export type AllocationDonutSegment = {
  label: string;
  value: number;
  color: string;
};

/** Donut chart segments for current allocation (Analysis step 04 / CRM Portfolio tab). */
export function buildCurrentAllocationDonutData(
  holdings: HoldingLike[] | null | undefined
): AllocationDonutSegment[] {
  const summary = buildSleeveAllocationSummary(holdings);
  return summary.buckets.map((bucket) => ({
    label: bucket.name,
    value: Math.round(bucket.weightPct * 10) / 10,
    color: bucket.color,
  }));
}

/** Popup row label — e.g. "Brk 5502", "401(K) 7710". */
export function formatAllocationPopupAccountLabel(params: {
  accountKey: string;
  registrationType?: RegistrationBucket | string | null;
}): string {
  const key = params.accountKey.trim();
  if (!key || key === UNASSIGNED_ACCOUNT_KEY) return "Unassigned";

  const masked = maskAccountNumberDisplay(key);
  const digits = key.replace(/\D/g, "");
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits || key.slice(-4);

  const prefixFromKey = key.match(/^([A-Za-z][A-Za-z0-9]*)[-\s]/);
  const prefixFromMasked = masked.match(/^([A-Za-z][A-Za-z0-9]*)-/);
  const prefix = (prefixFromKey?.[1] || prefixFromMasked?.[1] || "").trim();
  if (prefix) {
    const friendly = prefix.length <= 4 ? prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase() : prefix.toUpperCase();
    return last4 ? `${friendly} ${last4}` : friendly;
  }

  const reg = normalizeRegistrationType(params.registrationType);
  if (reg === "qualified") return last4 ? `401(K) ${last4}` : "401(K)";
  if (reg === "roth") return last4 ? `Roth ${last4}` : "Roth";
  if (reg === "non_qualified") return last4 ? `Brk ${last4}` : "Brokerage";
  return masked || key;
}

/**
 * Interactive donut data: each sleeve includes accounts with % of that sleeve.
 */
export function buildInteractiveSleeveAllocation(
  holdings: HoldingLike[] | null | undefined
): InteractiveAllocationSleeve[] {
  const list = Array.isArray(holdings) ? holdings : [];
  const summary = buildSleeveAllocationSummary(list);

  const accountBySleeve = new Map<
    AllocationSleeveKey,
    Map<string, { valueUsd: number; registrationType?: RegistrationBucket }>
  >();

  for (const h of list) {
    const sleeveKey = classifyHoldingAllocationSleeve(h);
    const valueUsd = Number(h.value) || 0;
    if (valueUsd <= 0) continue;

    const accountKey =
      accountKeyForHolding({
        accountNumber: h.accountNumber ?? undefined,
        annuityContract: h.annuityContract,
        documentKind: h.documentKind,
      }) || UNASSIGNED_ACCOUNT_KEY;
    const sleeveMap = accountBySleeve.get(sleeveKey) ?? new Map();
    const existing = sleeveMap.get(accountKey);
    if (existing) {
      existing.valueUsd += valueUsd;
    } else {
      sleeveMap.set(accountKey, {
        valueUsd,
        registrationType: normalizeRegistrationType(h.registrationType),
      });
    }
    accountBySleeve.set(sleeveKey, sleeveMap);
  }

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
  const totalValue = summary.totalValue;
  const percents = bucketValuesToPercents(dollars, totalValue);

  const segments: InteractiveAllocationSleeve[] = [];
  for (const sleeveKey of SLEEVE_ORDER) {
    const sleeveTotal = dollars[sleeveKey];
    if (sleeveTotal <= 0) continue;
    const meta = ALLOCATION_SLEEVE_DISPLAY[sleeveKey];
    const accountsMap = accountBySleeve.get(sleeveKey) ?? new Map();

    const accounts: SleeveAccountRow[] = [];
    for (const [accountKey, row] of accountsMap) {
      accounts.push({
        accountLabel: formatAllocationPopupAccountLabel({
          accountKey,
          registrationType: row.registrationType,
        }),
        pctOfSleeve: sleeveTotal > 0 ? Math.round((row.valueUsd / sleeveTotal) * 1000) / 10 : 0,
      });
    }
    accounts.sort((a, b) => b.pctOfSleeve - a.pctOfSleeve);

    segments.push({
      sleeveKey,
      label: meta.label,
      value: Math.round(percents[sleeveKey] * 10) / 10,
      color: meta.color,
      valueUsd: sleeveTotal,
      accounts,
    });
  }

  segments.sort((a, b) => b.valueUsd - a.valueUsd);
  return segments;
}

export type DonutSleeveSlice = {
  sleeveKey: AllocationSleeveKey;
  label: string;
  value: number;
  color: string;
};

/** Proposed allocation donut slices (Analysis calibration — equity / fixed / cash only). */
export function buildProposedAllocationDonutSleeves(client: IntakeClient): DonutSleeveSlice[] {
  const age = parseClientAgeForIllustration(client);
  const target = targetAllocationBuckets(age, client.riskProfile || "moderate-conservative");

  const slices: DonutSleeveSlice[] = [];
  const entries: Array<{ key: AllocationSleeveKey; pct: number }> = [
    { key: "equity", pct: target.equity },
    { key: "fixedIncome", pct: target.fixedIncome },
    { key: "cash", pct: target.cash },
  ];
  for (const { key, pct } of entries) {
    if (pct <= 0) continue;
    const meta = ALLOCATION_SLEEVE_DISPLAY[key];
    slices.push({
      sleeveKey: key,
      label: meta.label,
      value: pct,
      color: meta.color,
    });
  }
  return slices;
}

export function riskProfileDisplayLabel(riskProfile: string): string {
  const s = String(riskProfile || "").trim();
  if (!s) return "Moderate conservative";
  return s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
