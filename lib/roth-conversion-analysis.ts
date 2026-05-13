/**
 * Illustrative Roth conversion vs. stay-traditional + RMD modeling for advisor PDFs.
 * Not tax advice — uses simplified brackets, IRMAA, and RMD factors.
 */

import {
  incrementalFederalTaxFromConversion,
  federalIncomeTaxAfterStandardDeduction,
  illustrationFiling,
  irmaaAnnualSurchargeIllustrative,
  maxRothConversionGrossThisYear,
  standardDeductionIllustration,
  type IllustrationFiling,
} from "@/lib/federal-tax-illustration";

export const ROTH_ASSUMPTION_VERSION = "2026-05-advisorpilot-v2";

/** IRS Uniform Lifetime Table distribution periods (ages 73–95), 2023+ SECURE-era. */
export const RMD_DISTRIBUTION_PERIOD: Record<number, number> = {
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 13.0,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
};

/** Divisor for Uniform Lifetime RMD factor; null below age 73 (illustration start age). Also used by FIA qualified illustration. */
export function uniformLifetimeRmdDivisor(age: number): number | null {
  if (age < 73) return null;
  const d = RMD_DISTRIBUTION_PERIOD[age];
  if (d) return d;
  if (age > 95) return Math.max(2.0, 8.9 - (age - 95) * 0.35);
  return null;
}

/** Kept for UI / legacy id checks; Roth model uses progressive tax + standard deduction instead. */
export const FEDERAL_MARGINAL_RATE: Record<string, number> = {
  "10": 0.1,
  "12": 0.12,
  "22": 0.22,
  "24": 0.24,
  "32": 0.32,
  "35": 0.35,
  "37": 0.37,
};

function rmdDivisor(age: number): number | null {
  return uniformLifetimeRmdDivisor(age);
}

/**
 * Roth path growth (legacy illustration schedule): 4% annually through age 69, 10% from age 70 onward.
 * The main worksheet-driven model prefers {@link rothPathGrowthAnnual} (10% or FIC rate).
 */
export function rothPathReturnForAge(age: number): number {
  return age < 70 ? 0.04 : 0.1;
}

/** Parse "10", "10%", or "0.10" into an annual decimal return. */
export function parseAnnualReturnFromPercentField(raw: string | undefined): number | null {
  const n = Number(String(raw ?? "").replace(/%/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1 ? n / 100 : n;
}

/** Non-negative whole years; blank → null; invalid → null. */
function parseNonNegativeIntegerYears(raw: string | undefined): number | null {
  const s = String(raw ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Surrender period length in illustration years. Blank / invalid → null (no end to contract phase:
 * Roth path never steps up to the current-allocation rate from surrender alone).
 */
function parseSurrenderYearsForFic(raw: string | undefined): number | null {
  const s = String(raw ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Roth-path growth for FIC worksheet: trailing bonus adds to contract rate for the first
 * `trailBonusYears`; remaining years inside the surrender window use contract rate only.
 * From `surrenderYears` onward (0-based offset), growth matches {@link stayTraditionalReturn}.
 */
export function computeFicRothGrowthRateForYear(params: {
  yearOffset: number;
  surrenderYears: number | null;
  trailBonusYears: number;
  contractRateAnnual: number;
  trailingBonusAnnual: number;
  postSurrenderRateAnnual: number;
}): number {
  const inSurrender =
    params.surrenderYears == null ? true : params.yearOffset < params.surrenderYears;
  if (!inSurrender) return params.postSurrenderRateAnnual;
  const trail = Math.max(0, Math.floor(params.trailBonusYears));
  const extra = params.yearOffset < trail ? params.trailingBonusAnnual : 0;
  return params.contractRateAnnual + extra;
}

/**
 * Roth conversion bucket growth: flat 10% when not using a fixed indexed contract worksheet path;
 * otherwise contract estimated annual return if parseable (else 10%).
 * For the full per-year FIC schedule (trail + surrender + post-surrender), see
 * {@link computeFicRothGrowthRateForYear} inside {@link buildRothConversionModel}.
 */
export function rothPathGrowthAnnual(params: {
  useFixedIndexContract: boolean;
  contractEstimatedRateOfReturnPct: string | undefined;
}): number {
  if (!params.useFixedIndexContract) return 0.1;
  const d = parseAnnualReturnFromPercentField(params.contractEstimatedRateOfReturnPct);
  return d ?? 0.1;
}

export type StayTraditionalYearRow = {
  calendarYearOffset: number;
  age: number;
  yearStartBalance: number;
  growthRate: number;
  rmd: number;
  /** Total spendable need from intake (Q5) in retirement years; 0 before retirement age. */
  retirementNeedAnnual: number;
  /** Annual gross Social Security (Q6) included in satisfying that need when taking benefits. */
  socialSecurityAnnualGross: number;
  /** Amount of Q5 need still funded from IRA after Social Security (illustration). */
  portfolioIncomeShortfall: number;
  /** Total distribution from IRA: max(RMD, shortfall) in retirement so RMD is always satisfied. */
  totalIraDistribution: number;
  /** PDF "Income": illustrated AGI before retirement age only; annual spendable retirement income at/after retirement. */
  reportIncomeAnnual: number;
  endBalance: number;
  /** gross ordinary for tax / IRMAA: modeled SS plus IRA distributions (illustration). */
  totalOrdinaryForIllustration: number;
  illustrativeFederalTax: number;
  irmaaSurchargeAnnual: number;
};

export type RothConversionYearRow = {
  sequence: number;
  age: number;
  /** RMD From traditional IRA in conversion phase (IRS rules apply through age < converted); 0 in Roth-only years. */
  rmdTraditional: number;
  /** MAGI-linked illustrative IRMAA; 0 in Roth-only phase (no surcharge from Roth dist.). */
  irmaaSurchargeAnnual: number;
  yearStartTraditional: number;
  yearStartRoth: number;
  growthRate: number;
  balanceBeforeConversion: number;
  grossConversion: number;
  illustrativeTaxOnConversion: number;
  netConversionToRoth: number;
  endTraditionalBalance: number;
  totalRothBalance: number;
  capFromBracketConversion: number;
  retirementIncomeAnnual: number;
  /** PDF "Income" column (AGI before retirement; spendable retirement income need when retired). */
  reportIncomeAnnual: number;
  rothOnlyPhase: boolean;
};

export type StayTraditionalTotals = {
  totalRmdWithdrawals: number;
  totalTaxAttributableToRmds: number;
  totalIrmaaPaid: number;
};

export type RothConversionTotals = {
  totalRmdTraditional: number;
  totalIrmaaPaid: number;
  totalGrossConversion: number;
  totalConversionTaxPaid: number;
  totalNetConversionToRoth: number;
  endingTotalRothBalance: number;
};

export type RothConversionModelResult = {
  assumptions: string[];
  /** Modeled qualified starting balance for the stay-traditional path (no FIC premium bonus). */
  startingBalance: number;
  /** First-year traditional balance on the Roth illustration path (includes FIC premium bonus when modeled). */
  rothPathStartingQualifiedBalance: number;
  startingAge: number;
  retirementAge: number;
  retirementSpendableIncomeAnnual: number;
  /** Combined annual gross Social Security (client + spouse monthly x 12) when taking benefits; 0 otherwise. */
  annualSocialSecurityGross: number;
  federalBracketId: string;
  /** Stated marginal bracket band used as conversion ceiling (illustrative). */
  marginalRateNominalPct: number;
  marriedFilingJointly: boolean;
  illustrationFiling: IllustrationFiling;
  standardDeductionAnnual: number;
  /** Narrative inserted into disclosures / headings (Roth bucket return assumptions). */
  rothGrowthAssumptionLabel: string;
  annualAgiPreRetirementIllustration: number;
  stayTraditional: StayTraditionalYearRow[];
  stayTraditionalTotals: StayTraditionalTotals;
  rothConversion: RothConversionYearRow[];
  rothConversionTotals: RothConversionTotals;
};

export function buildRothConversionModel(input: {
  totalAccountValue: number;
  currentAge: number;
  retirementAge: number;
  retirementSpendableIncomeAnnual: number;
  /** Gross Social Security per year from intake (Q6); 0 if not taking or blank. */
  annualSocialSecurityGross?: number;
  federalTaxBracketId: string;
  /** When true, use MFJ brackets, standard deduction, and IRMAA thresholds (illustration). */
  marriedFilingJointly?: boolean;
  stayTraditionalReturn?: number;
  endAge?: number;
  /**
   * Annual AGI illustrated before retirement age: used in tax/ordinary modeling with IRA flows, in Roth conversion bracket-headroom stacking (with spendable retirement need pre-retirement),
   * and in the report Income column alone (not combined with retirement income in that column).
   */
  annualAdjustedGrossIncomePreRetirement?: number;
  /** When true, pace conversions (pre- and post-retirement) with amortization caps; when false, convert as fast as bracket allows. */
  protectInitialInvestment?: boolean;
  /** Worksheet: using fixed index contract path (affects Roth bucket return assumption). */
  useFixedIndexContract?: boolean;
  /** Worksheet FIC estimated rate of return % string; used when useFixedIndexContract. */
  contractEstimatedRateOfReturnPct?: string;
  /** Premium bonus adds this percent to Roth-path starting qualified balance only (stay-traditional unchanged). */
  ficPremiumBonusPct?: string;
  /** Adds to contract rate for the first `ficTrailBonusYears` Roth-path illustration years inside surrender (when FIC). */
  ficTrailingBonusPct?: string;
  /** Count of Roth-path illustration years that receive trailing bonus on top of contract rate (when FIC). */
  ficTrailBonusYears?: string;
  /** After this many Roth-path illustration years, Roth growth steps up to {@link stayTraditionalReturn} when FIC. Blank keeps contract-phase rates through the modeled horizon. */
  ficSurrenderYears?: string;
}): RothConversionModelResult {
  const stayR = input.stayTraditionalReturn ?? 0.1;
  const endAge = input.endAge ?? 95;
  const bracketId = input.federalTaxBracketId in FEDERAL_MARGINAL_RATE ? input.federalTaxBracketId : "22";
  const nominalMarginal = Math.round((FEDERAL_MARGINAL_RATE[bracketId] ?? 0.22) * 100);

  const need = Math.max(0, Number(input.retirementSpendableIncomeAnnual) || 0);
  const annualSS = Math.max(0, Number(input.annualSocialSecurityGross) || 0);
  const startAge = Math.max(0, Math.floor(Number(input.currentAge) || 0));
  const retireAge = Math.max(0, Math.floor(Number(input.retirementAge) || 67));
  const startBal = Math.max(0, Number(input.totalAccountValue) || 0);
  const married = Boolean(input.marriedFilingJointly);
  const filing = illustrationFiling(married);
  const sd = standardDeductionIllustration(filing);
  const agiAnnual = Math.max(0, Number(input.annualAdjustedGrossIncomePreRetirement) || 0);
  const protectPrincipal = Boolean(input.protectInitialInvestment);
  const useFic = Boolean(input.useFixedIndexContract);
  const contractRateAnnual = rothPathGrowthAnnual({
    useFixedIndexContract: useFic,
    contractEstimatedRateOfReturnPct: input.contractEstimatedRateOfReturnPct,
  });
  const premiumBonusFrac = useFic ? parseAnnualReturnFromPercentField(input.ficPremiumBonusPct) ?? 0 : 0;
  const trailingBonusFrac = useFic ? parseAnnualReturnFromPercentField(input.ficTrailingBonusPct) ?? 0 : 0;
  const surrenderYearsParsed = useFic ? parseSurrenderYearsForFic(input.ficSurrenderYears) : null;
  const trailBonusYearsN = useFic ? parseNonNegativeIntegerYears(input.ficTrailBonusYears) ?? 0 : 0;

  const rothPathStartingQualifiedBalance =
    startBal > 0 && useFic ? startBal * (1 + Math.max(0, premiumBonusFrac)) : startBal;

  const rothGrowthForOffset = (yearOffset: number) =>
    !useFic
      ? 0.1
      : computeFicRothGrowthRateForYear({
          yearOffset,
          surrenderYears: surrenderYearsParsed,
          trailBonusYears: trailBonusYearsN,
          contractRateAnnual,
          trailingBonusAnnual: Math.max(0, trailingBonusFrac),
          postSurrenderRateAnnual: stayR,
        });

  const surrenderWindowText =
    surrenderYearsParsed == null
      ? "Surrender years left blank — Roth path keeps contract-phase returns through the modeled horizon (no automatic step-up to current allocation)."
      : `For the first ${surrenderYearsParsed} Roth-path illustration year(s), returns follow the worksheet contract phase; afterward Roth-path growth matches current allocation (${(stayR * 100).toFixed(0)}%).`;

  const rothGrowthAssumptionLabel = useFic
    ? [
        premiumBonusFrac > 0 ? `Premium bonus boosts Roth-path starting qualified balance by ${(premiumBonusFrac * 100).toFixed(2)}% (stay-traditional path omits).` : null,
        surrenderWindowText,
        `Trailing bonus (${(trailingBonusFrac * 100).toFixed(2)}%) adds to contract ${(contractRateAnnual * 100).toFixed(2)}% for the first ${trailBonusYearsN} illustration year(s) of that surrender phase; remaining surrender-phase years use contract ${(contractRateAnnual * 100).toFixed(2)}% only.`,
        "Illustration only — confirm with carrier prospectus or illustration.",
      ]
        .filter((s): s is string => Boolean(s))
        .join(" ")
    : "Roth path balance growth: 10% annually (historical-style S&P 500 long-run growth illustration; not a forecast).";

  const assumptions = [
    `Assumption version: ${ROTH_ASSUMPTION_VERSION}.`,
    "Illustration only — not tax or investment advice. Confirm assumptions with the client and their CPA.",
    useFic && premiumBonusFrac > 0
      ? `Roth conversion path begins with qualified balance modeled at starting balance plus a ${(premiumBonusFrac * 100).toFixed(2)}% premium bonus (${rothPathStartingQualifiedBalance.toLocaleString("en-US")}); current-allocation path uses the same starting balance without that bonus (${startBal.toLocaleString("en-US")}). Paths are otherwise not cross-linked.`
      : "Current allocation and Roth conversion paths each begin with the same starting qualified balance and are not cross-linked.",
    filing === "married"
      ? `Filing illustration: married filing jointly — standard deduction about ${sd.toLocaleString("en-US")}/yr; ordinary tax uses progressive MFJ taxable income brackets (2024-style). IRMAA uses illustrative married thresholds.`
      : `Filing illustration: single — standard deduction about ${sd.toLocaleString("en-US")}/yr; progressive single brackets. IRMAA uses illustrative single thresholds.`,
    `Current allocation (stay-traditional): ${(stayR * 100).toFixed(0)}% annual growth; RMDs begin at age 73 using Uniform Lifetime divisors (IRS tables).`,
    protectPrincipal
      ? "Roth conversion pacing: protect initial investment — annual conversion is smoothed (pre-retirement: spread to retirement age; post-retirement: spread over remaining modeled years) while respecting the stated marginal bracket ceiling."
      : "Roth conversion pacing: maximize annual conversion within the stated marginal bracket ceiling (no smoothing cap).",
    "Report Income column (Current allocation and Roth tables): before intake retirement age, shows illustrated AGI only; at/after intake retirement age, shows annual spendable retirement income goal only.",
    agiAnnual > 0
      ? `Pre-retirement ordinary income stack for conversion headroom: AGI about ${agiAnnual.toLocaleString("en-US")}/yr plus annual spendable income need from intake; AGI is removed from the stack at/after retirement age (spendable income need and Social Security apply in retirement).`
      : "Pre-retirement AGI for conversion stacking: not modeled (zero or blank).",
    `Roth conversion path: while assets remain in traditional IRA, modeled RMDs apply from age 73; conversions stay within the stated marginal bracket ceiling (after standard deduction). Through age ${endAge}.`,
    annualSS > 0
      ? `Social Security (intake): about ${annualSS.toLocaleString("en-US")}/yr gross counted toward retirement cash flow and ordinary income (illustration; not tax-exact). Remaining annual need after SS is modeled as coming from the qualified IRA until converted to Roth.`
      : "Social Security: not modeled (not taking or no amounts on intake).",
  ];

  const stayTraditional: StayTraditionalYearRow[] = [];
  let bStay = startBal;

  for (let age = startAge; age <= endAge; age++) {
    const divisor = rmdDivisor(age);
    const rmd = divisor && bStay > 0 ? Math.min(bStay, bStay / divisor) : 0;
    const retired = age >= retireAge;
    const retirementNeedAnnual = retired ? need : 0;
    /** SS treated as flowing in retirement only for this illustration. */
    const ssThisYear = retired && annualSS > 0 ? annualSS : 0;
    const portfolioIncomeShortfall = retired ? Math.max(0, need - ssThisYear) : 0;
    const totalIraDistribution =
      retired ? Math.max(rmd, portfolioIncomeShortfall) : rmd;
    const totalOrd = retired ? ssThisYear + totalIraDistribution : agiAnnual + totalIraDistribution;
    const illustrativeFedTax = federalIncomeTaxAfterStandardDeduction(totalOrd, filing);
    const irmaa = irmaaAnnualSurchargeIllustrative(totalOrd, filing);
    const reportIncomeAnnual = retired ? need : agiAnnual;

    const endBal = (bStay - totalIraDistribution) * (1 + stayR);
    stayTraditional.push({
      calendarYearOffset: age - startAge,
      age,
      yearStartBalance: bStay,
      growthRate: stayR,
      rmd,
      retirementNeedAnnual,
      socialSecurityAnnualGross: ssThisYear,
      portfolioIncomeShortfall,
      totalIraDistribution,
      reportIncomeAnnual,
      endBalance: endBal,
      totalOrdinaryForIllustration: totalOrd,
      illustrativeFederalTax: illustrativeFedTax,
      irmaaSurchargeAnnual: irmaa,
    });

    bStay = endBal;
  }

  let totalRmdWithdrawals = 0;
  let totalTaxAttributableToRmds = 0;
  let totalIrmaaPaidStay = 0;
  for (const r of stayTraditional) {
    totalRmdWithdrawals += r.rmd;
    totalIrmaaPaidStay += r.irmaaSurchargeAnnual;
    if (r.totalIraDistribution > 0 && r.totalOrdinaryForIllustration > 0) {
      totalTaxAttributableToRmds += r.illustrativeFederalTax * (r.rmd / r.totalOrdinaryForIllustration);
    }
  }

  const rothConversion: RothConversionYearRow[] = [];
  let bTrad = rothPathStartingQualifiedBalance;
  let rothBalance = 0;
  let sequence = 0;

  for (let age = startAge; age <= endAge; age++) {
    sequence += 1;
    const yearOffset = age - startAge;
    const rGrowth = rothGrowthForOffset(yearOffset);
    const tradAtYearStart = bTrad;
    const rothAtYearStart = rothBalance;
    const retired = age >= retireAge;
    const ssThisYear = retired && annualSS > 0 ? annualSS : 0;
    const portfolioIncomeShortfall = retired ? Math.max(0, need - ssThisYear) : 0;
    const retirementIncomeAnnual = retired ? need : 0;
    const reportIncomeAnnual = retired ? need : agiAnnual;

    if (tradAtYearStart > 0.01) {
      const tradAfterGrowth = tradAtYearStart * (1 + rGrowth);
      const divisor = rmdDivisor(age);
      const rmdTake =
        divisor && tradAfterGrowth > 0 ? Math.min(tradAfterGrowth, tradAfterGrowth / divisor) : 0;
      const totalIraWithdrawalPreConversion = retired ? Math.max(rmdTake, portfolioIncomeShortfall) : rmdTake;
      const tradAfterSpendingAndRmd = Math.max(0, tradAfterGrowth - totalIraWithdrawalPreConversion);
      const baseOrdinaryBracketStack = retired ? need + ssThisYear : agiAnnual + need;
      const otherGrossOrdinaryCashFlow = baseOrdinaryBracketStack + totalIraWithdrawalPreConversion;
      const otherGrossOrdinaryForBracketCap = baseOrdinaryBracketStack + rmdTake;

      const bracketMaxConvThisYear = maxRothConversionGrossThisYear({
        otherGrossOrdinaryIncome: otherGrossOrdinaryForBracketCap,
        tradBalanceAvailableAfterRmd: tradAfterSpendingAndRmd,
        statedBracketId: bracketId,
        filing,
      });
      let amortCap = Number.POSITIVE_INFINITY;
      if (protectPrincipal) {
        if (!retired) {
          amortCap = tradAfterSpendingAndRmd / Math.max(1, retireAge - age);
        } else {
          amortCap = tradAfterSpendingAndRmd / Math.max(1, endAge - age + 1);
        }
      }
      const grossConv = Math.min(bracketMaxConvThisYear, amortCap);

      const taxOnConversion = incrementalFederalTaxFromConversion(otherGrossOrdinaryForBracketCap, grossConv, filing);
      const net = Math.max(0, grossConv - taxOnConversion);
      const rothAfterGrowth = rothAtYearStart * (1 + rGrowth);
      rothBalance = rothAfterGrowth + net;
      const endTrad = Math.max(0, tradAfterSpendingAndRmd - grossConv);

      const magiRough = otherGrossOrdinaryCashFlow + grossConv;
      const irmaa = irmaaAnnualSurchargeIllustrative(magiRough, filing);

      const capFromBracketConversion = maxRothConversionGrossThisYear({
        otherGrossOrdinaryIncome: otherGrossOrdinaryForBracketCap,
        tradBalanceAvailableAfterRmd: tradAfterGrowth,
        statedBracketId: bracketId,
        filing,
      });

      rothConversion.push({
        sequence,
        age,
        rmdTraditional: rmdTake,
        irmaaSurchargeAnnual: irmaa,
        yearStartTraditional: tradAtYearStart,
        yearStartRoth: rothAtYearStart,
        growthRate: rGrowth,
        balanceBeforeConversion: tradAfterSpendingAndRmd,
        grossConversion: grossConv,
        illustrativeTaxOnConversion: taxOnConversion,
        netConversionToRoth: net,
        endTraditionalBalance: endTrad,
        totalRothBalance: rothBalance,
        capFromBracketConversion,
        retirementIncomeAnnual,
        reportIncomeAnnual,
        rothOnlyPhase: false,
      });

      bTrad = endTrad;
    } else {
      /** Roth only: qualified growth; no illustrative IRMAA from distributions. */
      rothBalance = rothAtYearStart * (1 + rGrowth);
      rothConversion.push({
        sequence,
        age,
        rmdTraditional: 0,
        irmaaSurchargeAnnual: 0,
        yearStartTraditional: 0,
        yearStartRoth: rothAtYearStart,
        growthRate: rGrowth,
        balanceBeforeConversion: 0,
        grossConversion: 0,
        illustrativeTaxOnConversion: 0,
        netConversionToRoth: 0,
        endTraditionalBalance: 0,
        totalRothBalance: rothBalance,
        capFromBracketConversion: 0,
        retirementIncomeAnnual: retired ? need : 0,
        reportIncomeAnnual,
        rothOnlyPhase: true,
      });
      bTrad = 0;
    }
  }

  let totalGrossConversion = 0;
  let totalConversionTaxPaid = 0;
  let totalNetConversionToRoth = 0;
  let totalRmdRothTable = 0;
  let totalIrmaaRothTable = 0;
  for (const row of rothConversion) {
    if (!row.rothOnlyPhase) {
      totalGrossConversion += row.grossConversion;
      totalConversionTaxPaid += row.illustrativeTaxOnConversion;
      totalNetConversionToRoth += row.netConversionToRoth;
      totalRmdRothTable += row.rmdTraditional;
      totalIrmaaRothTable += row.irmaaSurchargeAnnual;
    }
  }
  const endingTotalRothBalance = rothConversion.length ? rothConversion[rothConversion.length - 1]!.totalRothBalance : 0;

  return {
    assumptions,
    startingBalance: startBal,
    rothPathStartingQualifiedBalance,
    startingAge: startAge,
    retirementAge: retireAge,
    retirementSpendableIncomeAnnual: need,
    annualSocialSecurityGross: annualSS,
    federalBracketId: bracketId,
    marginalRateNominalPct: nominalMarginal,
    marriedFilingJointly: married,
    illustrationFiling: filing,
    standardDeductionAnnual: sd,
    rothGrowthAssumptionLabel,
    annualAgiPreRetirementIllustration: agiAnnual,
    stayTraditional,
    stayTraditionalTotals: {
      totalRmdWithdrawals,
      totalTaxAttributableToRmds,
      totalIrmaaPaid: totalIrmaaPaidStay,
    },
    rothConversion,
    rothConversionTotals: {
      totalRmdTraditional: totalRmdRothTable,
      totalIrmaaPaid: totalIrmaaRothTable,
      totalGrossConversion,
      totalConversionTaxPaid,
      totalNetConversionToRoth,
      endingTotalRothBalance,
    },
  };
}
