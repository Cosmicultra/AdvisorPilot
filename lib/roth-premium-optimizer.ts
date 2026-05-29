import {
  buildRothConversionModel,
  RMD_ILLUSTRATION_START_AGE,
  type RothConversionModelResult,
} from "@/lib/roth-conversion-analysis";

/** Epsilon for "traditional IRA depleted" before RMD illustration age. */
const TRAD_DEPLETED_EPSILON = 1;

/** Epsilon for premium + income hold fitting within total qualified balance. */
const PREMIUM_HOLD_FIT_EPSILON = 0.5;

export type RothConversionModelInput = Parameters<typeof buildRothConversionModel>[0];

export type OptimizeRothPremiumInput = Omit<RothConversionModelInput, "totalAccountValue"> & {
  fullQualifiedBalance: number;
  rmdStartAge?: number;
};

export type OptimizeRothPremiumResult =
  | {
      ok: true;
      amount: number;
      /** Separate qualified reserve for IRA income during conversion years (Yes on income question only). */
      qualifiedIncomeHold?: number;
      marginalRateNominalPct: number;
      protectInitialInvestment: boolean;
      rmdStartAge: number;
    }
  | { ok: false; error: string };

/** Traditional balance remaining after the last pre-RMD conversion year in the illustration. */
export function traditionalRemainingBeforeRmd(
  model: RothConversionModelResult,
  rmdStartAge: number = RMD_ILLUSTRATION_START_AGE
): number {
  const preRmd = model.rothConversion.filter((r) => r.age < rmdStartAge && !r.rothOnlyPhase);
  if (preRmd.length === 0) {
    return model.startingBalance;
  }
  return preRmd[preRmd.length - 1]!.endTraditionalBalance;
}

export function isFullyConvertedBeforeRmd(
  model: RothConversionModelResult,
  rmdStartAge: number = RMD_ILLUSTRATION_START_AGE
): boolean {
  return traditionalRemainingBeforeRmd(model, rmdStartAge) <= TRAD_DEPLETED_EPSILON;
}

function isFeasibleConversionPremium(
  params: OptimizeRothPremiumInput,
  premium: number,
  rmdStartAge: number
): boolean {
  const { fullQualifiedBalance: _cap, rmdStartAge: _rmd, ...modelParams } = params;
  const model = buildRothConversionModel({ ...modelParams, totalAccountValue: premium });
  if (!isFullyConvertedBeforeRmd(model, rmdStartAge)) return false;
  if (params.retirementIncomeFromConversionAccount !== true) return true;
  const hold = computeQualifiedIncomeHoldDuringConversions(model, true);
  return premium + hold <= params.fullQualifiedBalance + PREMIUM_HOLD_FIT_EPSILON;
}

/**
 * Minimum qualified balance at illustration start to fund retirement income shortfall
 * (after Social Security) during years that overlap the Roth conversion window.
 * Advisory only — illustration still uses a single combined pool.
 */
export function computeQualifiedIncomeHoldDuringConversions(
  model: RothConversionModelResult,
  retirementIncomeFromConversionAccount: boolean
): number {
  if (retirementIncomeFromConversionAccount !== true) return 0;

  const conversionRows = model.rothConversion.filter((r) => !r.rothOnlyPhase);
  if (conversionRows.length === 0) return 0;

  const lastConversionAge = conversionRows[conversionRows.length - 1]!.age;
  const { startingAge, retirementAge, retirementSpendableIncomeAnnual: need, annualSocialSecurityGross } =
    model;

  if (retirementAge > lastConversionAge) return 0;

  const rowByAge = new Map(conversionRows.map((r) => [r.age, r]));
  const schedule: { growthRate: number; withdrawal: number }[] = [];

  for (let age = startingAge; age <= lastConversionAge; age++) {
    const row = rowByAge.get(age);
    if (!row) continue;
    const retired = age >= retirementAge;
    const ssThisYear = retired && annualSocialSecurityGross > 0 ? annualSocialSecurityGross : 0;
    const withdrawal = retired ? Math.max(0, need - ssThisYear) : 0;
    schedule.push({ growthRate: row.growthRate, withdrawal });
  }

  if (!schedule.some((s) => s.withdrawal > 0)) return 0;

  const reserveSurvives = (startReserve: number): boolean => {
    let reserve = startReserve;
    for (const { growthRate, withdrawal } of schedule) {
      reserve = reserve * (1 + growthRate) - withdrawal;
      if (reserve < -0.01) return false;
    }
    return true;
  };

  if (reserveSurvives(0)) return 0;

  let high = schedule.reduce((sum, s) => sum + s.withdrawal, 0) * 2 + 1;
  while (!reserveSurvives(high)) {
    high *= 2;
    if (high > 1e12) break;
  }

  let low = 0;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (reserveSurvives(mid)) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const amount = reserveSurvives(low) ? low : high;
  return Math.round(amount);
}

function optimizeSuccessResult(
  input: OptimizeRothPremiumInput,
  model: RothConversionModelResult,
  amount: number,
  protectInitialInvestment: boolean,
  rmdStartAge: number
): Extract<OptimizeRothPremiumResult, { ok: true }> {
  const result: Extract<OptimizeRothPremiumResult, { ok: true }> = {
    ok: true,
    amount,
    marginalRateNominalPct: model.marginalRateNominalPct,
    protectInitialInvestment,
    rmdStartAge,
  };
  if (input.retirementIncomeFromConversionAccount === true) {
    result.qualifiedIncomeHold = computeQualifiedIncomeHoldDuringConversions(
      model,
      true
    );
  }
  return result;
}

/**
 * Largest premium (qualified starting balance) that the existing Roth illustration can fully
 * convert before RMD age while honoring bracket ceiling and optional Roth principal floor (entered premium).
 */
export function computeOptimizedRothPremiumAmount(
  input: OptimizeRothPremiumInput
): OptimizeRothPremiumResult {
  const rmdStartAge = input.rmdStartAge ?? RMD_ILLUSTRATION_START_AGE;
  const fullQualifiedBalance = Math.max(0, Number(input.fullQualifiedBalance) || 0);
  const currentAge = Math.max(0, Math.floor(Number(input.currentAge) || 0));
  const protectInitialInvestment = Boolean(input.protectInitialInvestment);

  if (fullQualifiedBalance <= 0) {
    return { ok: false, error: "No traditional qualified balance is available to optimize." };
  }
  if (currentAge >= rmdStartAge) {
    return {
      ok: false,
      error: `Roth premium optimization requires a client younger than RMD age ${rmdStartAge} (current age modeled: ${currentAge}).`,
    };
  }

  const need = Math.max(0, Number(input.retirementSpendableIncomeAnnual) || 0);
  if (need <= 0) {
    return {
      ok: false,
      error: "Enter annual retirement spendable income to optimize the Roth premium.",
    };
  }
  if (input.retirementIncomeFromConversionAccount !== true && input.retirementIncomeFromConversionAccount !== false) {
    return {
      ok: false,
      error: 'Answer "Income received from conversion account?" (Yes or No) before optimizing premium.',
    };
  }

  const { fullQualifiedBalance: _cap, rmdStartAge: _rmd, ...modelParams } = input;

  if (isFeasibleConversionPremium(input, Math.floor(fullQualifiedBalance), rmdStartAge)) {
    const amount = Math.round(fullQualifiedBalance);
    const model = buildRothConversionModel({
      ...modelParams,
      totalAccountValue: amount,
    });
    return optimizeSuccessResult(input, model, amount, protectInitialInvestment, rmdStartAge);
  }

  if (!isFeasibleConversionPremium(input, 1, rmdStartAge)) {
    return {
      ok: false,
      error:
        "No premium amount can be fully converted within your tax bracket before RMD age at the current age and income settings. Try a higher max tax bracket or turn off Protect initial investment.",
    };
  }

  let low = 1;
  let high = Math.floor(fullQualifiedBalance);

  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (isFeasibleConversionPremium(input, mid, rmdStartAge)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const amount = isFeasibleConversionPremium(input, high, rmdStartAge) ? high : low;
  const finalModel = buildRothConversionModel({ ...modelParams, totalAccountValue: amount });

  return optimizeSuccessResult(input, finalModel, amount, protectInitialInvestment, rmdStartAge);
}
