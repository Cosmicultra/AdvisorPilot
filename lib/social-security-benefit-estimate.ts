/**
 * Illustrative Social Security retirement benefit (monthly), modeled after the SSA Quick Calculator flow:
 * DOB → approximate full retirement age → AIME proxy from level covered earnings × years worked →
 * PIA at FRA via bend points → factor for claiming age. Does not access SSA records.
 *
 * Not a substitute for ssa.gov estimates or legal/tax advice. Bend points are for workers first eligible in 2026
 * (OACT parameters published for planning illustrations).
 */

/** Bend points (AIME dollars/month) — eligibility year 2026, illustrative. */
const BEND_FIRST = 1286;
const BEND_SECOND = 7749;

/** Approx. annual OASDI covered earnings cap for computing a crude AIME ceiling. */
const ILLUSTRATIVE_TAXABLE_MAX = 176_100;

export type SsaIllustrativeRetirementEstimateInput = {
  /** Calendar year of birth */
  birthYear: number;
  /** Average annual Social Security–covered earnings (same entry style as Quick Calculator). */
  annualCoveredEarnings: number;
  /** Count of years with substantial covered earnings, capped at 35 (defaults assumed elsewhere). */
  yearsWorkedCapped35: number;
  /** Age (whole years) when benefits begin, 62–70. */
  benefitStartAge: number;
};

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

/** Whole-year full retirement age for retirement benefits (simplified SSA table by birth year). */
export function illustrativeFullRetirementAgeYears(birthYear: number): number {
  if (!Number.isFinite(birthYear)) return 67;
  if (birthYear >= 1960) return 67;
  if (birthYear >= 1955) return 66;
  return 66;
}

/**
 * Crude AIME monthly proxy: (capped annual × years) ÷ 420, same spirit as assuming a level earnings pattern
 * when no earnings record is available (see SSA Quick Calculator disclaimers).
 */
export function illustrativeAimeMonthly(annualCovered: number, yearsWorked: number): number {
  const cap = Math.max(0, annualCovered);
  const w = Math.min(cap, ILLUSTRATIVE_TAXABLE_MAX);
  const y = clampInt(yearsWorked, 1, 35);
  return (w * y) / 420;
}

/** Primary insurance amount (monthly) at full retirement age, from AIME. */
export function illustrativePiaMonthlyAtFra(aime: number): number {
  const a = Math.max(0, aime);
  const first = Math.min(a, BEND_FIRST);
  const second = Math.min(Math.max(a - BEND_FIRST, 0), BEND_SECOND - BEND_FIRST);
  const third = Math.max(a - BEND_SECOND, 0);
  return 0.9 * first + 0.32 * second + 0.15 * third;
}

/**
 * Rough factor applied to PIA for retirement benefits by claiming age vs FRA (1960+ cohort: FRA 67;
 * older cohorts use slightly earlier FRA in reality — this stays illustrative).
 */
export function illustrativeRetirementFactorForClaimAge(claimAge: number, fraYears: number): number {
  const c = clampInt(claimAge, 62, 70);
  const fra = Math.min(67, Math.max(65, Math.round(Number.isFinite(fraYears) ? fraYears : 67)));
  if (c < fra) {
    const span = Math.max(1, fra - 62);
    const earliest = fra >= 67 ? 0.7 : fra === 66 ? 0.75 : 0.8;
    return earliest + ((c - 62) / span) * (1 - earliest);
  }
  const delay = Math.min(3, Math.max(0, c - fra));
  return 1 + delay * 0.08;
}

/** Worker's Primary Insurance Amount (monthly at full retirement age) from covered earnings pattern. */
export function illustrativeWorkerPiaMonthly(input: {
  birthYear: number;
  annualCoveredEarnings: number;
  yearsWorkedCapped35: number;
}): number | null {
  const earnings = Number(input.annualCoveredEarnings);
  if (!Number.isFinite(earnings) || earnings <= 0) return null;
  const years = clampInt(input.yearsWorkedCapped35, 1, 35);
  const aime = illustrativeAimeMonthly(earnings, years);
  const pia = illustrativePiaMonthlyAtFra(aime);
  return Number.isFinite(pia) && pia > 0 ? pia : null;
}

/**
 * Illustrative spouse benefit when comparing own retirement vs. spousal on the worker's record:
 * `max(own retirement at claim, 50% × worker PIA × spouse claiming factor)`.
 *
 * SSA uses dual-entitlement rules, excess spousal, deeming, and different reduction schedules — not modeled here.
 */
export function illustrativeSpouseMonthlyMaxOwnOrSpousal(opts: {
  workerPiaMonthly: number | null;
  spouseInput: SsaIllustrativeRetirementEstimateInput;
  useSpousalLayer: boolean;
}): number | null {
  const own = illustrativeSsaRetirementBenefitMonthly(opts.spouseInput);
  const ownAmt = own ?? 0;
  if (!opts.useSpousalLayer) {
    return own;
  }
  const wp = opts.workerPiaMonthly;
  if (wp == null || !Number.isFinite(wp) || wp <= 0) {
    return own;
  }
  const fraS = illustrativeFullRetirementAgeYears(opts.spouseInput.birthYear);
  const factor = illustrativeRetirementFactorForClaimAge(opts.spouseInput.benefitStartAge, fraS);
  const spousalIllustrative = 0.5 * wp * factor;
  const rounded = Math.floor(spousalIllustrative + 0.5);
  const out = Math.max(ownAmt, rounded);
  return out > 0 ? out : own;
}

/** Monthly retirement benefit (rounded); null if inputs unusable. */
export function illustrativeSsaRetirementBenefitMonthly(
  input: SsaIllustrativeRetirementEstimateInput
): number | null {
  const by = clampInt(input.birthYear, 1900, new Date().getFullYear());
  const earnings = Number(input.annualCoveredEarnings);
  if (!Number.isFinite(earnings) || earnings <= 0) return null;
  const years = clampInt(input.yearsWorkedCapped35, 1, 35);
  const startAge = clampInt(input.benefitStartAge, 62, 70);
  const fra = illustrativeFullRetirementAgeYears(by);
  const aime = illustrativeAimeMonthly(earnings, years);
  const pia = illustrativePiaMonthlyAtFra(aime);
  const factor = illustrativeRetirementFactorForClaimAge(startAge, fra);
  const monthly = pia * factor;
  if (!Number.isFinite(monthly) || monthly < 0) return null;
  return Math.max(0, Math.floor(monthly + 0.5));
}

export function parseBirthYearFromIsoDob(dob: string): number | null {
  const t = String(dob || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y >= 1900 ? y : null;
}
