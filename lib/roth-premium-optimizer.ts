import {
  buildRothConversionModel,
  RMD_ILLUSTRATION_START_AGE,
  type RothConversionModelResult,
} from "@/lib/roth-conversion-analysis";

/** Epsilon for "traditional IRA depleted" before RMD illustration age. */
const TRAD_DEPLETED_EPSILON = 1;

export type RothConversionModelInput = Parameters<typeof buildRothConversionModel>[0];

export type OptimizeRothPremiumInput = Omit<RothConversionModelInput, "totalAccountValue"> & {
  fullQualifiedBalance: number;
  rmdStartAge?: number;
};

export type OptimizeRothPremiumResult =
  | {
      ok: true;
      amount: number;
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

function simulateAndCheckConverted(
  params: OptimizeRothPremiumInput,
  totalAccountValue: number,
  rmdStartAge: number
): boolean {
  const model = buildRothConversionModel({ ...params, totalAccountValue });
  return isFullyConvertedBeforeRmd(model, rmdStartAge);
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

  if (simulateAndCheckConverted(input, fullQualifiedBalance, rmdStartAge)) {
    const model = buildRothConversionModel({
      ...modelParams,
      totalAccountValue: fullQualifiedBalance,
    });
    return {
      ok: true,
      amount: Math.round(fullQualifiedBalance),
      marginalRateNominalPct: model.marginalRateNominalPct,
      protectInitialInvestment,
      rmdStartAge,
    };
  }

  if (!simulateAndCheckConverted(input, 1, rmdStartAge)) {
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
    if (simulateAndCheckConverted(input, mid, rmdStartAge)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const amount = simulateAndCheckConverted(input, high, rmdStartAge) ? high : low;
  const finalModel = buildRothConversionModel({ ...modelParams, totalAccountValue: amount });

  return {
    ok: true,
    amount,
    marginalRateNominalPct: finalModel.marginalRateNominalPct,
    protectInitialInvestment,
    rmdStartAge,
  };
}
