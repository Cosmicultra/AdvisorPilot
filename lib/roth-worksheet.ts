/** Roth conversion worksheet fields persisted with a saved client profile (not tax advice). */

export type RothFixedIndexContractFields = {
  carrierName: string;
  productName: string;
  premiumBonusPct: string;
  trailingBonusPct: string;
  trailBonusYears: string;
  contractEstimatedRateOfReturnPct: string;
  maxTaxRatePct: string;
  protectInitialInvestment: boolean;
  penaltyFreeWithdrawalPct: string;
  surrenderYears: string;
};

export type RothWorksheet = {
  /** `null` = not yet answered in the UI */
  useEntireQualifiedBalance: boolean | null;
  qualifiedAssetValue: string;
  specificConversionAmount: string;
  useFixedIndexContract: boolean | null;
  fic: RothFixedIndexContractFields;
};

export function emptyRothWorksheet(): RothWorksheet {
  return {
    useEntireQualifiedBalance: null,
    qualifiedAssetValue: "",
    specificConversionAmount: "",
    useFixedIndexContract: null,
    fic: {
      carrierName: "",
      productName: "",
      premiumBonusPct: "",
      trailingBonusPct: "",
      trailBonusYears: "",
      contractEstimatedRateOfReturnPct: "",
      maxTaxRatePct: "",
      protectInitialInvestment: false,
      penaltyFreeWithdrawalPct: "",
      surrenderYears: "",
    },
  };
}

export function normalizeRothWorksheet(raw: unknown): RothWorksheet {
  const base = emptyRothWorksheet();
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tri = (v: unknown): boolean | null =>
    v === true ? true : v === false ? false : null;
  const ficRaw = r.fic && typeof r.fic === "object" ? (r.fic as Record<string, unknown>) : {};

  return {
    useEntireQualifiedBalance: tri(r.useEntireQualifiedBalance),
    qualifiedAssetValue:
      typeof r.qualifiedAssetValue === "string" ? r.qualifiedAssetValue : base.qualifiedAssetValue,
    specificConversionAmount:
      typeof r.specificConversionAmount === "string"
        ? r.specificConversionAmount
        : base.specificConversionAmount,
    useFixedIndexContract: tri(r.useFixedIndexContract),
    fic: {
      carrierName: String(ficRaw.carrierName ?? base.fic.carrierName),
      productName: String(ficRaw.productName ?? base.fic.productName),
      premiumBonusPct: String(ficRaw.premiumBonusPct ?? base.fic.premiumBonusPct),
      trailingBonusPct: String(ficRaw.trailingBonusPct ?? base.fic.trailingBonusPct),
      trailBonusYears: String(ficRaw.trailBonusYears ?? base.fic.trailBonusYears),
      contractEstimatedRateOfReturnPct: String(
        ficRaw.contractEstimatedRateOfReturnPct ?? base.fic.contractEstimatedRateOfReturnPct
      ),
      maxTaxRatePct: String(ficRaw.maxTaxRatePct ?? base.fic.maxTaxRatePct),
      protectInitialInvestment: Boolean(ficRaw.protectInitialInvestment),
      penaltyFreeWithdrawalPct: String(
        ficRaw.penaltyFreeWithdrawalPct ?? base.fic.penaltyFreeWithdrawalPct
      ),
      surrenderYears: String(ficRaw.surrenderYears ?? base.fic.surrenderYears),
    },
  };
}

const FEDERAL_BRACKET_IDS = new Set(["10", "12", "22", "24", "32", "35", "37"]);

/** Map Roth worksheet "Max tax rate %" entry to a federal bracket id used as conversion ceiling. */
export function federalBracketIdFromWorksheetPct(raw: string): string | null {
  const n = String(raw || "").replace(/%/g, "").trim();
  return FEDERAL_BRACKET_IDS.has(n) ? n : null;
}

export function parseMoneyInput(s: string): number {
  const n = Number(String(s ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Qualified (traditional tax-deferred) balance sent into the Roth illustration API.
 * When holdings include a breakdown, totals are capped to traditional-qualified assets only (taxable & Roth excluded).
 * When unanswered, prefers that breakdown total over the full portfolio when available.
 */
export function rothIllustrationQualifiedBalance(
  ws: RothWorksheet,
  portfolioStatementTotal: number,
  traditionalQualifiedTotal?: number
): number {
  const stmt = Number.isFinite(portfolioStatementTotal) ? portfolioStatementTotal : 0;
  const qTradRaw = Number(traditionalQualifiedTotal);
  const cap =
    Number.isFinite(qTradRaw) && qTradRaw > 0 ? qTradRaw : null;

  const defaultIllustrationBase = cap !== null ? cap : stmt;

  if (ws.useEntireQualifiedBalance === true) {
    const entered = parseMoneyInput(ws.qualifiedAssetValue);
    const base = entered > 0 ? entered : defaultIllustrationBase;
    if (cap !== null) return Math.min(base, cap);
    return base;
  }
  if (ws.useEntireQualifiedBalance === false) {
    const spec = parseMoneyInput(ws.specificConversionAmount);
    if (cap !== null && spec > 0) return Math.min(spec, cap);
    return spec;
  }

  return defaultIllustrationBase;
}
