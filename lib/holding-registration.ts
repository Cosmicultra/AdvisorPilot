/** Tax registration / wrapper for holdings (advisor-reviewed; not tax advice). */

export type RegistrationBucket = "qualified" | "non_qualified" | "roth" | "unknown";

export type HoldingRegistrationFields = {
  accountNumber?: string;
  registrationType?: RegistrationBucket;
  costBasis?: number;
};

/** Sum of deferred traditional "qualified" holdings only (eligible as traditional conversion sources). Roth and taxable excluded. */
export function sumTraditionalQualifiedValue(
  holdings: Array<{ value?: unknown; registrationType?: unknown }>
): number {
  return holdings.reduce((sum, h) => {
    if (normalizeRegistrationType(h.registrationType) !== "qualified") return sum;
    const v = Number(h.value || 0);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}

export function normalizeRegistrationType(raw: unknown): RegistrationBucket {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");

  if (
    s === "qualified" ||
    s === "traditional" ||
    s === "tax_deferred" ||
    s === "taxdeferred" ||
    s === "ira" ||
    s === "401k" ||
    s === "403b" ||
    s === "sep" ||
    s === "simple"
  ) {
    return "qualified";
  }
  if (
    s === "non_qualified" ||
    s === "nonqualified" ||
    s === "taxable" ||
    s === "brokerage" ||
    s === "individual" ||
    s === "jt" ||
    s === "joint"
  ) {
    return "non_qualified";
  }
  if (s === "roth" || s === "roth_ira" || s === "rothira") {
    return "roth";
  }
  return "unknown";
}

export function registrationLabel(t: RegistrationBucket): string {
  switch (t) {
    case "qualified":
      return "Traditional / tax-deferred";
    case "non_qualified":
      return "Non-qualified (taxable)";
    case "roth":
      return "Roth IRA";
    default:
      return "Unknown";
  }
}

/** UI / persistence: canonical bucket ids */
export const REGISTRATION_BUCKET_VALUES: RegistrationBucket[] = [
  "qualified",
  "non_qualified",
  "roth",
  "unknown",
];

export function accountGroupKey(h: {
  accountNumber?: unknown;
  sourceFileIndex?: unknown;
}): string {
  const n = String(h.accountNumber || "").trim();
  if (n) return `acct:${n}`;
  const f = Number(h.sourceFileIndex);
  if (Number.isFinite(f)) return `file:${f}`;
  return "unlabeled";
}

export type AccountRollup = {
  key: string;
  accountNumber: string;
  sourceFileIndex?: number;
  totalValue: number;
  /** Most common registration among rows; "mixed" if rows disagree. */
  dominantRegistration: RegistrationBucket | "mixed";
  registrationCounts: Record<RegistrationBucket, number>;
};

export function rollupAccounts(
  holdings: Array<{
    value?: unknown;
    registrationType?: unknown;
    accountNumber?: unknown;
    sourceFileIndex?: unknown;
  }>
): AccountRollup[] {
  const map = new Map<
    string,
    {
      accountNumber: string;
      sourceFileIndex?: number;
      totalValue: number;
      counts: Record<RegistrationBucket, number>;
    }
  >();

  for (const h of holdings) {
    const key = accountGroupKey(h);
    const v = Number(h.value || 0);
    const val = Number.isFinite(v) ? v : 0;
    const reg = normalizeRegistrationType(h.registrationType);
    const acct = String(h.accountNumber || "").trim();

    const existing = map.get(key);
    if (existing) {
      existing.totalValue += val;
      existing.counts[reg] += 1;
      if (!existing.accountNumber && acct) existing.accountNumber = acct;
    } else {
      const counts: Record<RegistrationBucket, number> = {
        qualified: 0,
        non_qualified: 0,
        roth: 0,
        unknown: 0,
      };
      counts[reg] += 1;
      map.set(key, {
        accountNumber: acct,
        sourceFileIndex: Number.isFinite(Number(h.sourceFileIndex))
          ? Number(h.sourceFileIndex)
          : undefined,
        totalValue: val,
        counts,
      });
    }
  }

  const rows: AccountRollup[] = [];
  for (const [key, row] of map) {
    const entries = (Object.entries(row.counts) as [RegistrationBucket, number][]).filter(
      ([, c]) => c > 0
    );
    let dominant: RegistrationBucket | "mixed" = "unknown";
    if (entries.length === 1) dominant = entries[0][0];
    else if (entries.length > 1) dominant = "mixed";

    rows.push({
      key,
      accountNumber: row.accountNumber,
      sourceFileIndex: row.sourceFileIndex,
      totalValue: row.totalValue,
      dominantRegistration: dominant,
      registrationCounts: row.counts,
    });
  }

  rows.sort((a, b) => b.totalValue - a.totalValue);
  return rows;
}

export function buildRegistrationSummaryForAnalysis(holdings: unknown[]) {
  if (!Array.isArray(holdings)) {
    return {
      traditionalQualifiedValue: 0,
      nonQualifiedValue: 0,
      rothValue: 0,
      unknownValue: 0,
      accounts: [] as AccountRollup[],
      nonQualifiedWithCostBasis: [] as { rawName: string; value: number; costBasis: number }[],
    };
  }

  let traditionalQualifiedValue = 0;
  let nonQualifiedValue = 0;
  let rothValue = 0;
  let unknownValue = 0;
  const nonQualifiedWithCostBasis: { rawName: string; value: number; costBasis: number }[] = [];

  for (const item of holdings) {
    const h = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const v = Number(h.value || 0);
    const val = Number.isFinite(v) ? v : 0;
    const reg = normalizeRegistrationType(h.registrationType);
    if (reg === "qualified") traditionalQualifiedValue += val;
    else if (reg === "non_qualified") nonQualifiedValue += val;
    else if (reg === "roth") rothValue += val;
    else unknownValue += val;

    const cb = Number(h.costBasis);
    if (
      reg === "non_qualified" &&
      Number.isFinite(cb) &&
      cb > 0 &&
      val > 0
    ) {
      nonQualifiedWithCostBasis.push({
        rawName: String(h.rawName || h.suggested || "Holding"),
        value: val,
        costBasis: cb,
      });
    }
  }

  return {
    traditionalQualifiedValue,
    nonQualifiedValue,
    rothValue,
    unknownValue,
    accounts: rollupAccounts(
      holdings.map((item) =>
        item && typeof item === "object" ? (item as Record<string, unknown>) : {}
      )
    ),
    nonQualifiedWithCostBasis,
  };
}
