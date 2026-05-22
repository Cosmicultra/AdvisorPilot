import type { AssetClassId } from "@/lib/asset-classes";
import { maskAccountNumberDisplay } from "@/lib/mask-account-number";
import type { RegistrationBucket } from "@/lib/holding-registration";
import type { UiHolding } from "@/lib/saved-review-normalize";

export type StatementDocumentKind = "brokerage" | "annuity";

export type AnnuityContractType = "fia" | "myga" | "variable" | "unknown";

export type AnnuityQualifiedStatus = "qualified" | "non_qualified" | "unknown";

export type IncomeBasePaymentFrequency = "annual" | "monthly" | "unknown";

export type AnnuityIndexingStrategy = {
  name: string;
  capRatePct?: number;
  participationRatePct?: number;
  fixedRatePct?: number;
};

export type AnnuityRiderCharge = {
  raw?: string;
  amountUsd?: number;
  percentPct?: number;
};

/** Structured annuity contract fields extracted from carrier statements. */
export type AnnuityContractDetails = {
  contractNumber: string;
  carrierName: string;
  qualifiedStatus: AnnuityQualifiedStatus;
  productName: string;
  contractType: AnnuityContractType;
  issueDate: string;
  maturityDate?: string;
  currentValue: number;
  initialPremium: number;
  riderCharge?: AnnuityRiderCharge;
  surrenderValue: number;
  incomeRiderName?: string;
  incomeBaseValue?: number;
  incomeBasePaymentAmount?: number;
  incomeBasePaymentFrequency?: IncomeBasePaymentFrequency;
  incomeBaseRollUpRatePct?: number;
  indexingStrategies: AnnuityIndexingStrategy[];
};

export type ExtractedAnnuityContract = AnnuityContractDetails & {
  confidence?: number;
  statementContractValue?: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseQualifiedStatus(v: unknown): AnnuityQualifiedStatus {
  const s = str(v).toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
  if (s === "qualified" || s === "q" || s.includes("tax_deferred") || s.includes("ira")) {
    if (s.includes("non")) return "non_qualified";
    return "qualified";
  }
  if (s === "non_qualified" || s === "nonqualified" || s.includes("non_qualified")) {
    return "non_qualified";
  }
  return "unknown";
}

function parseContractType(v: unknown): AnnuityContractType {
  const s = str(v).toLowerCase();
  if (s === "fia" || s.includes("fixed indexed") || s.includes("fixed index")) return "fia";
  if (s === "myga" || s.includes("multi year guarantee") || s.includes("multi-year")) return "myga";
  if (s === "variable" || s.includes("variable annuity") || s === "va") return "variable";
  return "unknown";
}

function parsePaymentFrequency(v: unknown): IncomeBasePaymentFrequency | undefined {
  const s = str(v).toLowerCase();
  if (!s) return undefined;
  if (s.includes("month")) return "monthly";
  if (s.includes("annual") || s.includes("year")) return "annual";
  return "unknown";
}

function normalizeIndexingStrategies(raw: unknown): AnnuityIndexingStrategy[] {
  if (!Array.isArray(raw)) return [];
  const out: AnnuityIndexingStrategy[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    const strat: AnnuityIndexingStrategy = { name };
    const cap = num(r.capRatePct);
    const part = num(r.participationRatePct);
    const fixed = num(r.fixedRatePct);
    if (cap !== undefined) strat.capRatePct = cap;
    if (part !== undefined) strat.participationRatePct = part;
    if (fixed !== undefined) strat.fixedRatePct = fixed;
    out.push(strat);
  }
  return out;
}

function normalizeRiderCharge(raw: unknown): AnnuityRiderCharge | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string" && raw.trim()) {
    return { raw: raw.trim() };
  }
  if (typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const charge: AnnuityRiderCharge = {};
  if (typeof r.raw === "string" && r.raw.trim()) charge.raw = r.raw.trim();
  const amt = num(r.amountUsd);
  const pct = num(r.percentPct);
  if (amt !== undefined) charge.amountUsd = amt;
  if (pct !== undefined) charge.percentPct = pct;
  if (!charge.raw && charge.amountUsd === undefined && charge.percentPct === undefined) {
    return undefined;
  }
  return charge;
}

/** Normalize model JSON into a strict contract record. */
export function normalizeAnnuityContractDetails(raw: unknown): AnnuityContractDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const carrierName = str(r.carrierName);
  const productName = str(r.productName);
  const contractNumber = str(r.contractNumber);
  const currentValue = num(r.currentValue);
  const initialPremium = num(r.initialPremium);
  const surrenderValue = num(r.surrenderValue);

  if (!carrierName || !productName || currentValue === undefined || currentValue < 0) {
    return null;
  }

  const contract: AnnuityContractDetails = {
    contractNumber,
    carrierName,
    qualifiedStatus: parseQualifiedStatus(r.qualifiedStatus),
    productName,
    contractType: parseContractType(r.contractType),
    issueDate: str(r.issueDate),
    currentValue,
    initialPremium: initialPremium ?? 0,
    surrenderValue: surrenderValue ?? 0,
    indexingStrategies: normalizeIndexingStrategies(r.indexingStrategies),
  };

  const maturity = str(r.maturityDate);
  if (maturity) contract.maturityDate = maturity;

  const rider = normalizeRiderCharge(r.riderCharge);
  if (rider) contract.riderCharge = rider;

  const incomeRiderName = str(r.incomeRiderName);
  if (incomeRiderName) contract.incomeRiderName = incomeRiderName;

  const incomeBaseValue = num(r.incomeBaseValue);
  if (incomeBaseValue !== undefined) contract.incomeBaseValue = incomeBaseValue;

  const incomeBasePaymentAmount = num(r.incomeBasePaymentAmount);
  if (incomeBasePaymentAmount !== undefined) {
    contract.incomeBasePaymentAmount = incomeBasePaymentAmount;
  }

  const freq = parsePaymentFrequency(r.incomeBasePaymentFrequency);
  if (freq) contract.incomeBasePaymentFrequency = freq;

  const rollUp = num(r.incomeBaseRollUpRatePct);
  if (rollUp !== undefined) contract.incomeBaseRollUpRatePct = rollUp;

  return contract;
}

export function annuityContractTypeToAssetClass(contractType: AnnuityContractType): AssetClassId {
  switch (contractType) {
    case "fia":
      return "Fixed Indexed Annuity";
    case "myga":
      return "MYGA / Fixed Annuity";
    case "variable":
      return "Variable Annuity";
    default:
      return "Alternative / Other";
  }
}

export function annuityQualifiedToRegistration(
  status: AnnuityQualifiedStatus
): RegistrationBucket {
  if (status === "qualified") return "qualified";
  if (status === "non_qualified") return "non_qualified";
  return "unknown";
}

export function isAnnuityContractHolding(
  h: { annuityContract?: unknown; documentKind?: unknown }
): boolean {
  return (
    h.documentKind === "annuity" ||
    (h.annuityContract != null && typeof h.annuityContract === "object")
  );
}

/** Short CRM label: FIA, MYGA, VA, or Annuity when unknown. */
export function annuityContractTypeShortLabel(contractType: AnnuityContractType): string {
  switch (contractType) {
    case "fia":
      return "FIA";
    case "myga":
      return "MYGA";
    case "variable":
      return "VA";
    default:
      return "Annuity";
  }
}

/**
 * Account header subtitle for annuity contracts — e.g. "FIA · Athene".
 * Uses the highest-value annuity holding when multiple share an account key.
 */
export function annuityAccountTypeCarrierLabel(
  holdings: Array<{ value?: unknown; annuityContract?: unknown; documentKind?: unknown }>
): string | null {
  let best: AnnuityContractDetails | null = null;
  let bestValue = -1;
  for (const h of holdings) {
    if (!isAnnuityContractHolding(h)) continue;
    const contract = normalizeAnnuityContractFromStorage(h.annuityContract);
    if (!contract) continue;
    const v = Number(h.value);
    const valueUsd = Number.isFinite(v) ? v : 0;
    if (valueUsd >= bestValue) {
      bestValue = valueUsd;
      best = contract;
    }
  }
  if (!best) return null;
  const typeLabel = annuityContractTypeShortLabel(best.contractType);
  const carrier = best.carrierName.trim();
  return carrier ? `${typeLabel} · ${carrier}` : typeLabel;
}

export function maskContractNumberDisplay(contractNumber: string): string {
  const masked = maskAccountNumberDisplay(contractNumber);
  return masked || contractNumber;
}

/** Build a UiHolding row from structured annuity contract extraction. */
export function toUiHoldingFromAnnuityContract(
  contract: AnnuityContractDetails,
  meta?: {
    confidence?: number;
    sourceFileName?: string;
    sourceFileIndex?: number;
  }
): UiHolding {
  const confidence = Math.min(100, Math.max(0, Math.round(meta?.confidence ?? 85)));
  const maskedContract = contract.contractNumber
    ? maskContractNumberDisplay(contract.contractNumber)
    : "";
  const needsReview = !contract.contractNumber.trim() || contract.currentValue <= 0;

  const holding: UiHolding = {
    rawName: `${contract.carrierName} — ${contract.productName}`,
    suggested: maskedContract || "Contract",
    confidence,
    assetClass: annuityContractTypeToAssetClass(contract.contractType),
    value: contract.currentValue,
    status: needsReview ? "review" : "matched",
    options: maskedContract
      ? [maskedContract, "Manual contract entry"]
      : ["Contract", "Manual contract entry"],
    registrationType: annuityQualifiedToRegistration(contract.qualifiedStatus),
    documentKind: "annuity",
    annuityContract: contract,
    enrichmentIsProprietaryOrThinData: true,
  };

  if (maskedContract) holding.accountNumber = maskedContract;
  if (meta?.sourceFileName) holding.sourceFileName = meta.sourceFileName;
  if (meta?.sourceFileIndex != null && Number.isFinite(meta.sourceFileIndex)) {
    holding.sourceFileIndex = meta.sourceFileIndex;
  }

  return holding;
}

export function normalizeAnnuityContractFromStorage(raw: unknown): AnnuityContractDetails | undefined {
  const n = normalizeAnnuityContractDetails(raw);
  return n ?? undefined;
}

export type AnnuityIndexingStrategyDisplay = {
  strategyName: string;
  ratesLabel: string;
};

function formatRatePct(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded}%`;
}

/** Human-readable cap / participation / fixed rates for one indexing bucket. */
export function formatIndexingStrategyRates(strategy: AnnuityIndexingStrategy): string {
  const parts: string[] = [];
  if (strategy.capRatePct != null && Number.isFinite(strategy.capRatePct)) {
    parts.push(`Cap ${formatRatePct(strategy.capRatePct)}`);
  }
  if (strategy.participationRatePct != null && Number.isFinite(strategy.participationRatePct)) {
    parts.push(`Participation ${formatRatePct(strategy.participationRatePct)}`);
  }
  if (strategy.fixedRatePct != null && Number.isFinite(strategy.fixedRatePct)) {
    parts.push(`Fixed ${formatRatePct(strategy.fixedRatePct)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Rates not listed on statement";
}

/** CRM/UI rows for each indexing strategy on an annuity contract. */
export function annuityIndexingStrategyDisplays(
  contract: AnnuityContractDetails | undefined
): AnnuityIndexingStrategyDisplay[] {
  if (!contract?.indexingStrategies?.length) return [];
  return contract.indexingStrategies.map((strategy) => ({
    strategyName: strategy.name,
    ratesLabel: formatIndexingStrategyRates(strategy),
  }));
}

export function annuityIndexingStrategyDisplaysForHolding(
  holding: { annuityContract?: unknown } | null | undefined
): AnnuityIndexingStrategyDisplay[] {
  if (!holding) return [];
  const contract = normalizeAnnuityContractFromStorage(holding.annuityContract);
  return annuityIndexingStrategyDisplays(contract);
}

/** Account grouping key — contract # for annuities when accountNumber is absent. */
export function accountKeyForHolding(h: {
  accountNumber?: string;
  annuityContract?: unknown;
  documentKind?: unknown;
}): string {
  const acct = String(h.accountNumber ?? "").trim();
  if (acct) return acct;
  if (!isAnnuityContractHolding(h)) return "";
  const contract = normalizeAnnuityContractFromStorage(h.annuityContract);
  const num = contract?.contractNumber?.trim();
  if (!num) return "";
  return maskAccountNumberDisplay(num) || num;
}

/** Short summary for portfolio analysis prompts. */
export function formatAnnuityContractForAnalysis(contract: AnnuityContractDetails): string {
  const lines: string[] = [
    `Carrier: ${contract.carrierName}`,
    `Product: ${contract.productName}`,
    `Contract #: ${contract.contractNumber || "(not listed)"}`,
    `Type: ${contract.contractType}`,
    `Tax status: ${contract.qualifiedStatus}`,
    `Current/accumulation value: $${contract.currentValue.toLocaleString("en-US")}`,
    `Initial premium: $${contract.initialPremium.toLocaleString("en-US")}`,
    `Surrender value: $${contract.surrenderValue.toLocaleString("en-US")}`,
  ];
  if (contract.issueDate) lines.push(`Issue date: ${contract.issueDate}`);
  if (contract.maturityDate) lines.push(`Maturity date: ${contract.maturityDate}`);
  if (contract.riderCharge) {
    const rc = contract.riderCharge;
    lines.push(
      `Rider charge: ${rc.raw ?? ""}${rc.amountUsd != null ? ` $${rc.amountUsd}` : ""}${rc.percentPct != null ? ` ${rc.percentPct}%` : ""}`.trim()
    );
  }
  if (contract.incomeRiderName) lines.push(`Income rider: ${contract.incomeRiderName}`);
  if (contract.incomeBaseValue != null) {
    lines.push(`Income base value: $${contract.incomeBaseValue.toLocaleString("en-US")}`);
  }
  if (contract.incomeBasePaymentAmount != null) {
    lines.push(
      `Income payment: $${contract.incomeBasePaymentAmount.toLocaleString("en-US")} (${contract.incomeBasePaymentFrequency ?? "unknown"})`
    );
  }
  if (contract.incomeBaseRollUpRatePct != null) {
    lines.push(`Income base roll-up rate: ${contract.incomeBaseRollUpRatePct}%`);
  }
  if (contract.indexingStrategies.length) {
    for (const s of contract.indexingStrategies) {
      const rates: string[] = [];
      if (s.capRatePct != null) rates.push(`cap ${s.capRatePct}%`);
      if (s.participationRatePct != null) rates.push(`participation ${s.participationRatePct}%`);
      if (s.fixedRatePct != null) rates.push(`fixed ${s.fixedRatePct}%`);
      lines.push(`Indexing: ${s.name}${rates.length ? ` (${rates.join(", ")})` : ""}`);
    }
  }
  return lines.join("; ");
}
