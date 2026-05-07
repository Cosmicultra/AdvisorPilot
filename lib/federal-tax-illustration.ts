/**
 * Approximate ordinary federal income tax + IRMAA for advisor illustrations only.
 * 2024-ish brackets and standard deductions — not tax advice.
 */

/** Married filing jointly vs single — uses `married` from intake when true. */
export type IllustrationFiling = "married" | "single";

export function illustrationFiling(married: boolean): IllustrationFiling {
  return married ? "married" : "single";
}

/** 2024 standard deduction (both under age 65; illustration). */
export function standardDeductionIllustration(filing: IllustrationFiling): number {
  return filing === "married" ? 29_200 : 14_600;
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

/** Federal income tax on gross ordinary income after standard deduction. */
export function federalIncomeTaxAfterStandardDeduction(
  grossOrdinaryIncome: number,
  filing: IllustrationFiling
): number {
  const sd = standardDeductionIllustration(filing);
  const taxable = Math.max(0, grossOrdinaryIncome - sd);
  return federalIncomeTaxOnTaxable(taxable, filing);
}

/**
 * Extra federal income tax attributable to adding conversion gross to other ordinary gross (same deduction once).
 */
export function incrementalFederalTaxFromConversion(
  otherGrossOrdinaryIncome: number,
  grossConversionAmount: number,
  filing: IllustrationFiling
): number {
  const sd = standardDeductionIllustration(filing);
  const baseTax = federalIncomeTaxOnTaxable(Math.max(0, otherGrossOrdinaryIncome - sd), filing);
  const withConvTax = federalIncomeTaxOnTaxable(Math.max(0, otherGrossOrdinaryIncome + grossConversionAmount - sd), filing);
  return Math.max(0, withConvTax - baseTax);
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
  filing: IllustrationFiling;
}): number {
  const sd = standardDeductionIllustration(params.filing);
  const C = taxableIncomeCeilingForStatedBracket(params.statedBracketId, params.filing);
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
  "Ordinary taxable income brackets and standard deduction mirror Rev. Proc. 2023–34 (2024-era) illustrative bands for single and MFJ; IRMAA uses simplified tier surcharges.";
