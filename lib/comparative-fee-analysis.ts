import {
  parseAdvisorFeePercentPoints,
  type FeeAnalysisAccountGroup,
  type FeeAnalysisApiLine,
  type FeeAnalysisFundRow,
} from "@/lib/fee-analysis";

// ─── Management enums ─────────────────────────────────────────────────────────

export const CURRENT_MANAGEMENT_STATES = [
  "other_advisor",
  "self_managed",
  "managed_by_me",
  "unmanaged_employer",
  "excluded",
] as const;

export type CurrentManagementState = (typeof CURRENT_MANAGEMENT_STATES)[number];

export const PROPOSED_MANAGEMENT_STATES = [
  "keep_current",
  "transition_to_me",
  "self_managed",
  "excluded",
] as const;

export type ProposedManagementState = (typeof PROPOSED_MANAGEMENT_STATES)[number];

export function isCurrentManagementState(v: unknown): v is CurrentManagementState {
  return (
    typeof v === "string" &&
    (CURRENT_MANAGEMENT_STATES as readonly string[]).includes(v)
  );
}

export function isProposedManagementState(v: unknown): v is ProposedManagementState {
  return (
    typeof v === "string" &&
    (PROPOSED_MANAGEMENT_STATES as readonly string[]).includes(v)
  );
}

/** Default proposed state when an account first appears in the worksheet. */
export function defaultProposedForCurrent(
  current: CurrentManagementState
): ProposedManagementState {
  switch (current) {
    case "other_advisor":
      return "transition_to_me";
    case "self_managed":
      return "self_managed";
    case "managed_by_me":
    case "unmanaged_employer":
      return "keep_current";
    case "excluded":
      return "excluded";
    default:
      return "keep_current";
  }
}

// ─── Worksheet persistence ────────────────────────────────────────────────────

export type FeeAnalysisWorksheetAccount = {
  currentManagement: CurrentManagementState;
  proposedManagement: ProposedManagementState;
  /** UI percent points, e.g. "1.25" for 1.25% */
  currentAdvisorFeePctInput?: string;
  /** UI percent points for proposed transition fee */
  proposedAdvisorFeePctInput?: string;
};

export type FeeAnalysisWorksheet = {
  schemaVersion: 1;
  /** @deprecated use myAdvisoryFeePctInput — kept for loaded rows */
  myAdvisoryFeeAnnual?: number;
  myAdvisoryFeePctInput?: string;
  accounts: Record<string, FeeAnalysisWorksheetAccount>;
  lastResult?: ComparativeFeeAnalysisResponse;
};

export function emptyFeeAnalysisWorksheet(): FeeAnalysisWorksheet {
  return {
    schemaVersion: 1,
    myAdvisoryFeeAnnual: 0.01,
    myAdvisoryFeePctInput: "1",
    accounts: {},
  };
}

export function normalizeFeeAnalysisWorksheet(raw: unknown): FeeAnalysisWorksheet {
  const base = emptyFeeAnalysisWorksheet();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const myRaw = Number(r.myAdvisoryFeeAnnual);
  if (Number.isFinite(myRaw) && myRaw >= 0 && myRaw <= 0.2) {
    base.myAdvisoryFeeAnnual = myRaw;
  }
  if (typeof r.myAdvisoryFeePctInput === "string") {
    base.myAdvisoryFeePctInput = r.myAdvisoryFeePctInput;
  } else if (base.myAdvisoryFeeAnnual != null) {
    base.myAdvisoryFeePctInput = String(base.myAdvisoryFeeAnnual * 100);
  }
  if (r.accounts && typeof r.accounts === "object" && !Array.isArray(r.accounts)) {
    for (const [key, val] of Object.entries(r.accounts as Record<string, unknown>)) {
      if (!val || typeof val !== "object") continue;
      const a = val as Record<string, unknown>;
      if (!isCurrentManagementState(a.currentManagement)) continue;
      if (!isProposedManagementState(a.proposedManagement)) continue;
      const entry: FeeAnalysisWorksheetAccount = {
        currentManagement: a.currentManagement,
        proposedManagement: a.proposedManagement,
      };
      if (typeof a.currentAdvisorFeePctInput === "string") {
        entry.currentAdvisorFeePctInput = a.currentAdvisorFeePctInput;
      }
      if (typeof a.proposedAdvisorFeePctInput === "string") {
        entry.proposedAdvisorFeePctInput = a.proposedAdvisorFeePctInput;
      }
      base.accounts[key] = entry;
    }
  }
  if (r.lastResult && typeof r.lastResult === "object") {
    const lr = r.lastResult as Record<string, unknown>;
    if (lr.schemaVersion === 2) {
      base.lastResult = lr as unknown as ComparativeFeeAnalysisResponse;
    }
  }
  return base;
}

/** Merge worksheet account settings for known groups; apply smart defaults for new keys. */
export function mergeWorksheetAccounts(
  worksheet: FeeAnalysisWorksheet,
  accountKeys: Array<{ key: string; defaultCurrent?: CurrentManagementState }>
): FeeAnalysisWorksheet {
  const accounts = { ...worksheet.accounts };
  for (const { key, defaultCurrent = "other_advisor" } of accountKeys) {
    if (!accounts[key]) {
      accounts[key] = {
        currentManagement: defaultCurrent,
        proposedManagement: defaultProposedForCurrent(defaultCurrent),
      };
    }
  }
  return { ...worksheet, accounts };
}

// ─── API input / output ───────────────────────────────────────────────────────

export type FeeAnalysisAccountInput = {
  key: string;
  accountNumber: string;
  totalAccountValue: number;
  fundRows: FeeAnalysisFundRow[];
  currentManagement: CurrentManagementState;
  proposedManagement: ProposedManagementState;
  currentAdvisorFeeAnnual?: number | null;
  proposedAdvisorFeeAnnual?: number | null;
};

export type AccountScenarioSlice = {
  fundFeesDollars: number;
  advisorFeesDollars: number;
  totalAnnualCostDollars: number;
  fundExpensePctOfAccount: number;
  advisorFeePctOfAccount: number;
  allInDragPctOfAccount: number;
};

export type HouseholdScenarioSummary = {
  totalEstimatedFundFeesDollars: number;
  totalAdvisorFeesDollars: number;
  totalEstimatedAnnualCostDollars: number;
  blendedAnnualDragPct: number;
  fundExpenseLoadPct: number;
  advisorFeeLoadPct: number;
  householdValue: number;
};

export type ComparativeFeeAnalysisAccount = {
  key: string;
  accountNumber: string;
  totalAccountValue: number;
  currentManagement: CurrentManagementState;
  proposedManagement: ProposedManagementState;
  lines: FeeAnalysisApiLine[];
  current: AccountScenarioSlice;
  proposed: AccountScenarioSlice;
  includedInProposedRollup: boolean;
};

export type ComparativeFeeAnalysisResponse = {
  schemaVersion: 2;
  disclaimer: string;
  portfolioValue: number;
  uniqueTickerCount: number;
  rowsMissingTicker: number;
  coverage: {
    proposedCoveragePct: number;
    proposedManagedAssets: number;
    selfManagedAssets: number;
    excludedAssets: number;
  };
  current: HouseholdScenarioSummary;
  proposed: HouseholdScenarioSummary;
  comparison: {
    annualCostDifferenceDollars: number;
    blendedDragDifferencePct: number;
    narrativeHints: string[];
  };
  accounts: ComparativeFeeAnalysisAccount[];
  /** @deprecated v1 — populated for backward compat */
  advisorFeeAnnual?: number;
  advisorFeeDollarsPortfolio?: number;
  totalEstimatedFundFeesDollars?: number;
  weightedFundExpensePctOfPortfolio?: number;
  allInIllustrativeDragPctAnnual?: number;
};

export type ParsedAccountForComparative = {
  key: string;
  accountNumber: string;
  totalAccountValue: number;
  fundRows: FeeAnalysisFundRow[];
  currentManagement: CurrentManagementState;
  proposedManagement: ProposedManagementState;
  currentAdvisorFeeAnnual: number | null;
  proposedAdvisorFeeAnnual: number | null;
};

export type ExpenseRatioLookup = Map<
  string,
  { expenseRatioAnnual: number | null; note: string }
>;

/** Current-scenario advisor fee rate (annual decimal). */
export function currentScenarioAdvisorFeeRate(
  acct: ParsedAccountForComparative,
  myAdvisoryFeeAnnual: number
): number {
  switch (acct.currentManagement) {
    case "other_advisor":
      return acct.currentAdvisorFeeAnnual ?? 0;
    case "managed_by_me":
      return acct.proposedAdvisorFeeAnnual ?? myAdvisoryFeeAnnual;
    default:
      return 0;
  }
}

/** Proposed-scenario advisor fee rate (annual decimal). */
export function proposedScenarioAdvisorFeeRate(
  acct: ParsedAccountForComparative,
  myAdvisoryFeeAnnual: number
): number {
  switch (acct.proposedManagement) {
    case "transition_to_me":
      return acct.proposedAdvisorFeeAnnual ?? myAdvisoryFeeAnnual;
    case "keep_current":
      return currentScenarioAdvisorFeeRate(acct, myAdvisoryFeeAnnual);
    case "self_managed":
    case "excluded":
    default:
      return 0;
  }
}

export function accountIncludedInProposedRollup(
  acct: ParsedAccountForComparative
): boolean {
  return acct.proposedManagement !== "excluded";
}

export function isProposedManagedAsset(acct: ParsedAccountForComparative): boolean {
  if (acct.proposedManagement === "transition_to_me") return true;
  if (acct.proposedManagement === "keep_current") {
    return (
      acct.currentManagement === "other_advisor" ||
      acct.currentManagement === "managed_by_me"
    );
  }
  return false;
}

export function isSelfManagedAsset(acct: ParsedAccountForComparative): boolean {
  if (acct.proposedManagement === "self_managed") return true;
  if (
    acct.proposedManagement === "keep_current" &&
    acct.currentManagement === "self_managed"
  ) {
    return true;
  }
  return false;
}

function buildLinesWithExpenseRatios(
  fundRows: FeeAnalysisFundRow[],
  ratioByTicker: ExpenseRatioLookup
): FeeAnalysisApiLine[] {
  return fundRows.map((row) => {
    const t = row.ticker.trim().toUpperCase();
    const hit = t ? ratioByTicker.get(t) : undefined;
    const expenseRatioAnnual = hit?.expenseRatioAnnual ?? null;
    const estimatedAnnualFeeDollars =
      expenseRatioAnnual != null && row.value > 0 ? row.value * expenseRatioAnnual : 0;
    const lookupNote = !t
      ? "No ticker on file — add a symbol on Confirm Holdings to estimate fund fees."
      : !hit
        ? "Model did not return an estimate for this ticker."
        : hit.note ||
          (expenseRatioAnnual == null
            ? "Expense ratio unavailable — verify on prospectus."
            : undefined);
    return {
      ...row,
      expenseRatioAnnual,
      estimatedAnnualFeeDollars,
      lookupNote,
    };
  });
}

function accountSlice(
  fundFees: number,
  advisorFees: number,
  accountValue: number
): AccountScenarioSlice {
  const total = fundFees + advisorFees;
  const denom = accountValue > 0 ? accountValue : 0;
  return {
    fundFeesDollars: fundFees,
    advisorFeesDollars: advisorFees,
    totalAnnualCostDollars: total,
    fundExpensePctOfAccount: denom > 0 ? fundFees / denom : 0,
    advisorFeePctOfAccount: denom > 0 ? advisorFees / denom : 0,
    allInDragPctOfAccount: denom > 0 ? total / denom : 0,
  };
}

function rollupHousehold(
  fundFees: number,
  advisorFees: number,
  householdValue: number
): HouseholdScenarioSummary {
  const total = fundFees + advisorFees;
  const denom = householdValue > 0 ? householdValue : 0;
  return {
    totalEstimatedFundFeesDollars: fundFees,
    totalAdvisorFeesDollars: advisorFees,
    totalEstimatedAnnualCostDollars: total,
    blendedAnnualDragPct: denom > 0 ? total / denom : 0,
    fundExpenseLoadPct: denom > 0 ? fundFees / denom : 0,
    advisorFeeLoadPct: denom > 0 ? advisorFees / denom : 0,
    householdValue: denom,
  };
}

function buildNarrativeHints(
  coverage: ComparativeFeeAnalysisResponse["coverage"]
): string[] {
  const hints: string[] = [
    "Fund expense estimates held constant; comparison reflects management-fee assumptions only.",
    "Illustrative annual cost comparison — confirm expense ratios and advisory fees on official documents.",
  ];
  if (coverage.selfManagedAssets > 0) {
    hints.push(
      "Accounts marked self-managed were excluded from advisor fee assumptions."
    );
  }
  if (coverage.excludedAssets > 0) {
    hints.push(
      "Accounts marked excluded were omitted from proposed household rollups."
    );
  }
  if (coverage.proposedCoveragePct > 0 && coverage.proposedCoveragePct < 1) {
    hints.push(
      `${(coverage.proposedCoveragePct * 100).toFixed(0)}% of household assets included in the proposed management scenario.`
    );
  }
  return hints;
}

export function myAdvisoryFeeAnnualFromWorksheet(ws: FeeAnalysisWorksheet): number {
  const fromPct = parseAdvisorFeePercentPoints(
    String(ws.myAdvisoryFeePctInput ?? (ws.myAdvisoryFeeAnnual != null ? ws.myAdvisoryFeeAnnual * 100 : "1"))
  );
  return Number.isFinite(fromPct) && fromPct >= 0 ? fromPct : 0.01;
}

/** Build POST /api/fee-analysis account payload from grouped holdings + worksheet. */
export function buildComparativeFeeApiAccounts(
  groups: FeeAnalysisAccountGroup[],
  worksheet: FeeAnalysisWorksheet
) {
  const merged = mergeWorksheetAccounts(worksheet, groups.map((g) => ({ key: g.key })));
  return groups.map((grp) => {
    const settings = merged.accounts[grp.key] ?? {
      currentManagement: "other_advisor" as const,
      proposedManagement: defaultProposedForCurrent("other_advisor"),
    };
    const currentAdvisorFeeAnnual =
      settings.currentManagement === "other_advisor"
        ? parseAdvisorFeePercentPoints(settings.currentAdvisorFeePctInput ?? "")
        : null;
    const proposedAdvisorFeeAnnual =
      settings.proposedManagement === "transition_to_me"
        ? parseAdvisorFeePercentPoints(settings.proposedAdvisorFeePctInput ?? "")
        : null;

    return {
      key: grp.key,
      accountNumber: grp.accountNumber,
      totalAccountValue: grp.totalAccountValue,
      fundRows: grp.fundRows,
      currentManagement: settings.currentManagement,
      proposedManagement: settings.proposedManagement,
      currentAdvisorFeeAnnual:
        currentAdvisorFeeAnnual != null && currentAdvisorFeeAnnual > 0
          ? currentAdvisorFeeAnnual
          : null,
      proposedAdvisorFeeAnnual:
        proposedAdvisorFeeAnnual != null && proposedAdvisorFeeAnnual > 0
          ? proposedAdvisorFeeAnnual
          : null,
    };
  });
}

/** Synthesize legacy v1-style accounts when only advisorFeeAnnual is sent. */
export function synthesizeLegacyAccounts(
  accounts: Array<{
    key: string;
    accountNumber: string;
    totalAccountValue: number;
    fundRows: FeeAnalysisFundRow[];
  }>,
  advisorFeeAnnual: number
): ParsedAccountForComparative[] {
  return accounts.map((a) => ({
    ...a,
    currentManagement: "other_advisor" as const,
    proposedManagement: "transition_to_me" as const,
    currentAdvisorFeeAnnual: advisorFeeAnnual,
    proposedAdvisorFeeAnnual: advisorFeeAnnual,
  }));
}

export function buildComparativeFeeAnalysisResponse(args: {
  portfolioValue: number;
  myAdvisoryFeeAnnual: number;
  accounts: ParsedAccountForComparative[];
  ratioByTicker: ExpenseRatioLookup;
  disclaimer: string;
  uniqueTickerCount: number;
  rowsMissingTicker: number;
}): ComparativeFeeAnalysisResponse {
  const {
    portfolioValue,
    myAdvisoryFeeAnnual,
    accounts,
    ratioByTicker,
    disclaimer,
    uniqueTickerCount,
    rowsMissingTicker,
  } = args;

  let currentFundTotal = 0;
  let currentAdvisorTotal = 0;
  let proposedFundTotal = 0;
  let proposedAdvisorTotal = 0;
  let proposedManagedAssets = 0;
  let selfManagedAssets = 0;
  let excludedAssets = 0;
  let proposedHouseholdValue = 0;

  const accountResults: ComparativeFeeAnalysisAccount[] = accounts.map((acct) => {
    const lines = buildLinesWithExpenseRatios(acct.fundRows, ratioByTicker);
    const fundFees = lines.reduce((s, l) => s + l.estimatedAnnualFeeDollars, 0);

    const curAdvisorRate = currentScenarioAdvisorFeeRate(acct, myAdvisoryFeeAnnual);
    const propAdvisorRate = proposedScenarioAdvisorFeeRate(acct, myAdvisoryFeeAnnual);
    const curAdvisorDollars = acct.totalAccountValue * curAdvisorRate;
    const propAdvisorDollars = acct.totalAccountValue * propAdvisorRate;

    currentFundTotal += fundFees;
    currentAdvisorTotal += curAdvisorDollars;
    proposedFundTotal += fundFees;

    const included = accountIncludedInProposedRollup(acct);
    if (included) {
      proposedAdvisorTotal += propAdvisorDollars;
      proposedHouseholdValue += acct.totalAccountValue;
    }

    if (acct.proposedManagement === "excluded") {
      excludedAssets += acct.totalAccountValue;
    }
    if (isSelfManagedAsset(acct)) {
      selfManagedAssets += acct.totalAccountValue;
    }
    if (isProposedManagedAsset(acct)) {
      proposedManagedAssets += acct.totalAccountValue;
    }

    return {
      key: acct.key,
      accountNumber: acct.accountNumber,
      totalAccountValue: acct.totalAccountValue,
      currentManagement: acct.currentManagement,
      proposedManagement: acct.proposedManagement,
      lines,
      current: accountSlice(fundFees, curAdvisorDollars, acct.totalAccountValue),
      proposed: accountSlice(fundFees, propAdvisorDollars, acct.totalAccountValue),
      includedInProposedRollup: included,
    };
  });

  const currentHousehold = rollupHousehold(
    currentFundTotal,
    currentAdvisorTotal,
    portfolioValue
  );
  const proposedHousehold = rollupHousehold(
    proposedFundTotal,
    proposedAdvisorTotal,
    proposedHouseholdValue > 0 ? proposedHouseholdValue : portfolioValue
  );

  const coverage = {
    proposedCoveragePct:
      portfolioValue > 0 ? proposedManagedAssets / portfolioValue : 0,
    proposedManagedAssets,
    selfManagedAssets,
    excludedAssets,
  };

  const comparison = {
    annualCostDifferenceDollars:
      currentHousehold.totalEstimatedAnnualCostDollars -
      proposedHousehold.totalEstimatedAnnualCostDollars,
    blendedDragDifferencePct:
      currentHousehold.blendedAnnualDragPct - proposedHousehold.blendedAnnualDragPct,
    narrativeHints: buildNarrativeHints(coverage),
  };

  return {
    schemaVersion: 2,
    disclaimer,
    portfolioValue,
    uniqueTickerCount,
    rowsMissingTicker,
    coverage,
    current: currentHousehold,
    proposed: proposedHousehold,
    comparison,
    accounts: accountResults,
    advisorFeeAnnual: myAdvisoryFeeAnnual,
    advisorFeeDollarsPortfolio: proposedHousehold.totalAdvisorFeesDollars,
    totalEstimatedFundFeesDollars: proposedFundTotal,
    weightedFundExpensePctOfPortfolio: proposedHousehold.fundExpenseLoadPct,
    allInIllustrativeDragPctAnnual: proposedHousehold.blendedAnnualDragPct,
  };
}
