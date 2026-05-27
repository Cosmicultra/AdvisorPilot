/**
 * Approximate ordinary federal income tax + IRMAA for advisor illustrations only.
 * 2024-ish brackets and standard deductions — not tax advice.
 */

/** Married filing jointly vs single — uses `married` from intake when true. */
export type IllustrationFiling = "married" | "single";

export function illustrationFiling(married: boolean): IllustrationFiling {
  return married ? "married" : "single";
}

export type IllustrationDeductionInput = {
  filing: IllustrationFiling;
  /** 0 = illustration start year */
  calendarYearOffset: number;
  clientAge: number;
  /** MFJ only; null/undefined when spouse age unknown */
  spouseAge?: number | null;
};

const DEDUCTION_INFLATION_ANNUAL = 0.025;
const BASE_STD_SINGLE_2024 = 14_600;
const BASE_STD_MFJ_2024 = 29_200;
const ADDITIONAL_65_PER_PERSON_2024 = 1_550;

function deductionInflationFactor(calendarYearOffset: number): number {
  return Math.pow(1 + DEDUCTION_INFLATION_ANNUAL, Math.max(0, calendarYearOffset));
}

function baseStandardDeductionAmount(filing: IllustrationFiling, calendarYearOffset: number): number {
  const base = filing === "married" ? BASE_STD_MFJ_2024 : BASE_STD_SINGLE_2024;
  return Math.round(base * deductionInflationFactor(calendarYearOffset));
}

function additional65PlusDeductionAmount(params: IllustrationDeductionInput): number {
  const perPerson = Math.round(ADDITIONAL_65_PER_PERSON_2024 * deductionInflationFactor(params.calendarYearOffset));
  let count = 0;
  if (params.clientAge >= 65) count += 1;
  if (params.filing === "married" && params.spouseAge != null && params.spouseAge >= 65) count += 1;
  return count * perPerson;
}

export type StandardDeductionBreakdown = {
  total: number;
  base: number;
  additional65Plus: number;
};

export function standardDeductionBreakdownIllustration(
  params: IllustrationDeductionInput
): StandardDeductionBreakdown {
  const base = baseStandardDeductionAmount(params.filing, params.calendarYearOffset);
  const additional65Plus = additional65PlusDeductionAmount(params);
  return { total: base + additional65Plus, base, additional65Plus };
}

/** Total standard deduction (base + age 65+ add-ons) for the illustration year. */
export function standardDeductionIllustration(params: IllustrationDeductionInput): number {
  return standardDeductionBreakdownIllustration(params).total;
}

type RateBand = { low: number; high: number; rate: number };

/** Taxable ordinary income brackets (Rev. Proc. 2023–34 inflation-adjusted figures, illustration). */
const SINGLE_BRACKETS: RateBand[] = [
  { low: 0, high: 11_600, rate: 0.1 },
  { low: 11_600, high: 47_150, rate: 0.12 },
  { low: 47_150, high: 100_525, rate: 0.22 },
  { low: 100_525, high: 191_950, rate: 0.24 },
  { low: 191_950, high: 243_725, rate: 0.32 },
  { low: 243_725, high: 609_350, rate: 0.35 },
  { low: 609_350, high: Number.POSITIVE_INFINITY, rate: 0.37 },
];

const MFJ_BRACKETS: RateBand[] = [
  { low: 0, high: 23_200, rate: 0.1 },
  { low: 23_200, high: 94_300, rate: 0.12 },
  { low: 94_300, high: 201_050, rate: 0.22 },
  { low: 201_050, high: 383_900, rate: 0.24 },
  { low: 383_900, high: 487_450, rate: 0.32 },
  { low: 487_450, high: 731_200, rate: 0.35 },
  { low: 731_200, high: Number.POSITIVE_INFINITY, rate: 0.37 },
];

/** Progressive tax on positive taxable ordinary income only. */
export function federalIncomeTaxOnTaxable(taxableOrdinaryIncome: number, filing: IllustrationFiling): number {
  const t = Math.max(0, taxableOrdinaryIncome);
  const brackets = filing === "married" ? MFJ_BRACKETS : SINGLE_BRACKETS;
  let tax = 0;
  for (const band of brackets) {
    if (t <= band.low) break;
    const incomeInBand = Math.min(t, band.high) - band.low;
    if (incomeInBand > 0) tax += incomeInBand * band.rate;
  }
  return tax;
}

export function taxableOrdinaryAfterDeduction(
  grossOrdinaryIncome: number,
  deduction: IllustrationDeductionInput
): number {
  const sd = standardDeductionIllustration(deduction);
  return Math.max(0, grossOrdinaryIncome - sd);
}

/** Federal income tax on gross ordinary income after standard deduction (age/year-aware). */
export function federalIncomeTaxAfterStandardDeduction(
  grossOrdinaryIncome: number,
  deduction: IllustrationDeductionInput
): number {
  const taxable = taxableOrdinaryAfterDeduction(grossOrdinaryIncome, deduction);
  return federalIncomeTaxOnTaxable(taxable, deduction.filing);
}

/**
 * Extra federal income tax attributable to adding conversion gross to other ordinary gross (same deduction once).
 */
export function incrementalFederalTaxFromConversion(
  otherGrossOrdinaryIncome: number,
  grossConversionAmount: number,
  deduction: IllustrationDeductionInput
): number {
  const sd = standardDeductionIllustration(deduction);
  const baseTax = federalIncomeTaxOnTaxable(Math.max(0, otherGrossOrdinaryIncome - sd), deduction.filing);
  const withConvTax = federalIncomeTaxOnTaxable(
    Math.max(0, otherGrossOrdinaryIncome + grossConversionAmount - sd),
    deduction.filing
  );
  return Math.max(0, withConvTax - baseTax);
}

/** Parse worksheet state tax % string to a 0–1 fraction (0 when blank/invalid). */
export function parseStateTaxRateFraction(raw: string | undefined): number {
  const n = Number(String(raw ?? "").replace(/%/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100) / 100;
}

/** Flat illustrative state income tax on federal taxable ordinary income. */
export function stateIncomeTaxIllustrative(taxableOrdinaryIncome: number, rateFraction: number): number {
  const t = Math.max(0, taxableOrdinaryIncome);
  const r = Math.max(0, Math.min(1, rateFraction));
  return t * r;
}

/** Incremental state tax from adding conversion gross (parallel to federal incremental). */
export function incrementalStateTaxFromConversion(
  otherGrossOrdinaryIncome: number,
  grossConversionAmount: number,
  deduction: IllustrationDeductionInput,
  rateFraction: number
): number {
  if (rateFraction <= 0) return 0;
  const baseTaxable = taxableOrdinaryAfterDeduction(otherGrossOrdinaryIncome, deduction);
  const withConvTaxable = taxableOrdinaryAfterDeduction(
    otherGrossOrdinaryIncome + grossConversionAmount,
    deduction
  );
  return Math.max(0, stateIncomeTaxIllustrative(withConvTaxable, rateFraction) - stateIncomeTaxIllustrative(baseTaxable, rateFraction));
}

/** Maximum taxable ordinary income allowed before entering the bracket above user's stated marginal (illustration cap). */
const TAXABLE_CEILING_BEFORE_NEXT_BRACKET: Record<string, number> = {
  "10": 11_600,
  "12": 47_150,
  "22": 100_525,
  "24": 191_950,
  "32": 243_725,
  "35": 609_350,
  "37": Number.POSITIVE_INFINITY,
};

const TAXABLE_CEILING_MFJ_BEFORE_NEXT_BRACKET: Record<string, number> = {
  "10": 23_200,
  "12": 94_300,
  "22": 201_050,
  "24": 383_900,
  "32": 487_450,
  "35": 731_200,
  "37": Number.POSITIVE_INFINITY,
};

export function taxableIncomeCeilingForStatedBracket(
  bracketId: string,
  filing: IllustrationFiling
): number {
  const table = filing === "married" ? TAXABLE_CEILING_MFJ_BEFORE_NEXT_BRACKET : TAXABLE_CEILING_BEFORE_NEXT_BRACKET;
  const c = table[bracketId];
  return c ?? TAXABLE_CEILING_BEFORE_NEXT_BRACKET["22"]!;
}

/**
 * Max Roth conversion gross this year trad → Roth, trad balance after growth and RMD = `tradAvailableForConversion`,
 * other gross ordinary already counted = `otherGrossOrdinary` (retirement draws + RMD, etc.).
 */
export function maxRothConversionGrossThisYear(params: {
  otherGrossOrdinaryIncome: number;
  tradBalanceAvailableAfterRmd: number;
  statedBracketId: string;
  deduction: IllustrationDeductionInput;
}): number {
  const sd = standardDeductionIllustration(params.deduction);
  const C = taxableIncomeCeilingForStatedBracket(params.statedBracketId, params.deduction.filing);
  if (!Number.isFinite(C)) return Math.max(0, params.tradBalanceAvailableAfterRmd);

  const og = Math.max(0, params.otherGrossOrdinaryIncome);
  /** Need max(0, og + G - sd) <= C ⇒ G <= C + sd - og when non-negative */
  const capFromBracket = Math.max(0, C + sd - og);
  return Math.min(capFromBracket, Math.max(0, params.tradBalanceAvailableAfterRmd));
}

/** MAGI tiers for illustrative annual IRMAA Part B + D surcharge (combined, single enrollee illustration). */
export function irmaaAnnualSurchargeIllustrative(magi: number, filing: IllustrationFiling): number {
  const thresholds =
    filing === "married"
      ? [206_000, 258_000, 322_000, 386_000, 750_000]
      : [103_000, 129_000, 161_000, 193_000, 500_000];
  const surcharge = [1_264, 3_160, 5_056, 7_096, 9_136];
  let tier = -1;
  for (let i = 0; i < thresholds.length; i++) {
    if (magi > thresholds[i]!) tier = i;
  }
  return tier >= 0 ? surcharge[tier]! : 0;
}

/**
 * Human-readable citation for brackets/deductions baked into illustration math.
 * AdvisorPilot does not query the IRS in real time; parameters are revised in shipped releases when law changes are incorporated.
 */
export const FEDERAL_TAX_ILLUSTRATION_REFERENCE =
  "Ordinary taxable income brackets mirror Rev. Proc. 2023–34 (2024-era) illustrative bands for single and MFJ; standard deduction is inflation-indexed from 2024 base with additional amounts for taxpayers age 65+; IRMAA uses simplified tier surcharges.";
