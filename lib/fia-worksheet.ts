/** FIA hypothetical worksheet fields persisted on the client profile JSON (illustrative only). */

export type FiaPremiumSource = "qualified" | "non_qualified" | "custom";

export type FiaWorksheet = {
  premiumSource: FiaPremiumSource;
  /** When premiumSource is custom; ignored otherwise for default display */
  premiumAmount: string;
  /**
   * When premiumSource is qualified or non_qualified: optional partial premium.
   * Blank = use full registration total; positive value is used, capped at that registration total.
   */
  registrationPremiumOverride: string;
  carrierName: string;
  productName: string;
  premiumBonusPct: string;
  trailingBonusPct: string;
  trailBonusYears: string;
  contractCapRatePct: string;
  penaltyFreeWithdrawalPct: string;
  surrenderYears: string;
  hasIncomeRider: boolean | null;
  /** Front-end bonus on income/rider benefit base only (on premium); separate from contract premium bonus. */
  incomeBaseBonusPct: string;
  incomeRiderGuaranteePct: string;
  /** If true, credited interest this year is added to rider benefit base (simplified illustration). */
  contractEarningsAddToRiderBase: boolean | null;
  incomeRiderFeePct: string;
};

export function emptyFiaWorksheet(): FiaWorksheet {
  return {
    premiumSource: "qualified",
    premiumAmount: "",
    registrationPremiumOverride: "",
    carrierName: "",
    productName: "",
    premiumBonusPct: "",
    trailingBonusPct: "",
    trailBonusYears: "",
    contractCapRatePct: "",
    penaltyFreeWithdrawalPct: "",
    surrenderYears: "",
    hasIncomeRider: null,
    incomeBaseBonusPct: "",
    incomeRiderGuaranteePct: "",
    contractEarningsAddToRiderBase: null,
    incomeRiderFeePct: "",
  };
}

function triBool(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null;
}

/** String field for storage — avoids `null` and literal "undefined" from bad JSON. */
function normStr(raw: unknown, base: string): string {
  if (raw == null) return base;
  const s = String(raw);
  if (s === "undefined" || s === "null") return base;
  return s;
}

/** For React controlled `<Input value={…} />` — must stay a string for the component lifetime. */
export function fiaInputValue(raw: string | undefined | null): string {
  return typeof raw === "string" ? raw : "";
}

export function normalizeFiaWorksheet(raw: unknown): FiaWorksheet {
  const base = emptyFiaWorksheet();
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const src = normStr(r.premiumSource, "").trim().toLowerCase();
  const premiumSource: FiaPremiumSource =
    src === "non_qualified" || src === "nonqualified" || src === "taxable"
      ? "non_qualified"
      : src === "custom"
        ? "custom"
        : "qualified";

  return {
    premiumSource,
    premiumAmount: normStr(r.premiumAmount, base.premiumAmount),
    registrationPremiumOverride: normStr(r.registrationPremiumOverride, base.registrationPremiumOverride),
    carrierName: normStr(r.carrierName, base.carrierName),
    productName: normStr(r.productName, base.productName),
    premiumBonusPct: normStr(r.premiumBonusPct, base.premiumBonusPct),
    trailingBonusPct: normStr(r.trailingBonusPct, base.trailingBonusPct),
    trailBonusYears: normStr(r.trailBonusYears, base.trailBonusYears),
    contractCapRatePct: normStr(r.contractCapRatePct, base.contractCapRatePct),
    penaltyFreeWithdrawalPct: normStr(r.penaltyFreeWithdrawalPct, base.penaltyFreeWithdrawalPct),
    surrenderYears: normStr(r.surrenderYears, base.surrenderYears),
    hasIncomeRider: triBool(r.hasIncomeRider),
    incomeBaseBonusPct: normStr(r.incomeBaseBonusPct, base.incomeBaseBonusPct),
    incomeRiderGuaranteePct: normStr(r.incomeRiderGuaranteePct, base.incomeRiderGuaranteePct),
    contractEarningsAddToRiderBase: triBool(r.contractEarningsAddToRiderBase),
    incomeRiderFeePct: normStr(r.incomeRiderFeePct, base.incomeRiderFeePct),
  };
}

export function parsePct(raw: string): number {
  const n = Number(String(raw ?? "").replace(/%/g, "").trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseMoneyInput(s: string): number {
  const n = Number(String(s ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}
