import { buildRothConversionModel, type RothConversionModelResult } from "@/lib/roth-conversion-analysis";
import type { IntakeClient } from "@/lib/intake-config";
import { annualSocialSecurityGrossForIllustration, parseClientAgeForIllustration, parseSpouseAgeForIllustration } from "@/lib/roth-inputs";
import {
  computeOptimizedRothPremiumAmount,
  type OptimizeRothPremiumInput,
  type OptimizeRothPremiumResult,
} from "@/lib/roth-premium-optimizer";
import { federalBracketIdFromWorksheetPct, normalizeRothWorksheet, type RothWorksheet } from "@/lib/roth-worksheet";

export type RothAdvisorUiModelResult =
  | { ok: true; model: RothConversionModelResult }
  | { ok: false; error: string };

export type RothOptimizePremiumUiResult = OptimizeRothPremiumResult;

type RothAdvisorModelParamsResult =
  | { ok: true; params: OptimizeRothPremiumInput }
  | { ok: false; error: string };

function buildRothAdvisorModelParams(
  client: IntakeClient,
  rothWorksheet: RothWorksheet,
  fullQualifiedBalance: number,
  options?: { minClientAge?: number }
): RothAdvisorModelParamsResult {
  const minAge = options?.minClientAge ?? 60;
  const age = parseClientAgeForIllustration(client);
  if (age < minAge) {
    return {
      ok: false,
      error: `Roth illustration runs for clients age ${minAge} and older (current age modeled: ${age}).`,
    };
  }
  if (!Number.isFinite(fullQualifiedBalance) || fullQualifiedBalance <= 0) {
    return {
      ok: false,
      error: "No traditional qualified balance is available to optimize.",
    };
  }

  const bracketRaw = String(client.federalTaxBracket || "22").replace(/%/g, "").trim();
  const intakeFederal = ["10", "12", "22", "24", "32", "35", "37"].includes(bracketRaw) ? bracketRaw : "22";
  const ws = normalizeRothWorksheet(rothWorksheet);
  const worksheetBracketId = ws.fic.maxTaxRatePct ? federalBracketIdFromWorksheetPct(ws.fic.maxTaxRatePct) : null;
  const federal = worksheetBracketId ?? intakeFederal;

  const retireAge = Math.max(50, Math.floor(Number(client.retirementAge) || 67));
  const incomeRaw = String(client.retirementSpendableIncomeAnnual || "").replace(/[$,]/g, "");
  const need = Math.max(0, Number(incomeRaw) || 0);
  if (need <= 0) {
    return {
      ok: false,
      error: "Enter annual retirement spendable income (above or on intake) to run this illustration.",
    };
  }

  const marriedFilingJointly = client.married === true || String(client.married).toLowerCase() === "true";
  const annualSocialSecurityGross = annualSocialSecurityGrossForIllustration(client);

  const agiRaw = String(client.adjustedGrossIncomeAnnual || "").replace(/[$,]/g, "");
  const annualAgi = Math.max(0, Number(agiRaw) || 0);

  const useFixedIndexContract = ws.useFixedIndexContract === true;
  const protectInitialInvestment = Boolean(ws.fic.protectInitialInvestment);

  if (ws.retirementIncomeFromConversionAccount === null) {
    return {
      ok: false,
      error: 'Answer "Income received from conversion account?" (Yes or No) before running this illustration.',
    };
  }

  return {
    ok: true,
    params: {
      fullQualifiedBalance,
      currentAge: age,
      retirementAge: retireAge,
      retirementSpendableIncomeAnnual: need,
      annualSocialSecurityGross,
      federalTaxBracketId: federal,
      marriedFilingJointly,
      annualAdjustedGrossIncomePreRetirement: annualAgi,
      protectInitialInvestment,
      useFixedIndexContract,
      contractEstimatedRateOfReturnPct: ws.fic.contractEstimatedRateOfReturnPct || "",
      ficPremiumBonusPct: ws.fic.premiumBonusPct,
      ficTrailingBonusPct: ws.fic.trailingBonusPct,
      ficTrailBonusYears: ws.fic.trailBonusYears,
      ficSurrenderYears: ws.fic.surrenderYears,
      spouseStartAge: parseSpouseAgeForIllustration(client),
      stateTaxRatePct: ws.fic.stateTaxPct,
      retirementIncomeFromConversionAccount: ws.retirementIncomeFromConversionAccount,
    },
  };
}

/**
 * Builds the same Roth illustration as {@link app/api/generate-roth-report/route.ts} for advisor UI.
 */
export function buildRothConversionModelForAdvisorUi(
  client: IntakeClient,
  rothWorksheet: RothWorksheet,
  qualifiedIllustrationBalance: number,
  options?: { minClientAge?: number }
): RothAdvisorUiModelResult {
  if (!Number.isFinite(qualifiedIllustrationBalance) || qualifiedIllustrationBalance <= 0) {
    return {
      ok: false,
      error: "Enter a qualified balance for the illustration (choose Yes/No above and a dollar amount).",
    };
  }

  const built = buildRothAdvisorModelParams(client, rothWorksheet, qualifiedIllustrationBalance, options);
  if (!built.ok) return built;

  const { fullQualifiedBalance: _full, ...modelParams } = built.params;
  const model = buildRothConversionModel({
    ...modelParams,
    totalAccountValue: qualifiedIllustrationBalance,
  });

  return { ok: true, model };
}

/** Max specific premium convertible within bracket before RMD age (uses full qualified pool as ceiling). */
export function computeOptimizedRothPremiumForAdvisorUi(
  client: IntakeClient,
  rothWorksheet: RothWorksheet,
  fullQualifiedBalance: number,
  options?: { minClientAge?: number }
): RothOptimizePremiumUiResult {
  const built = buildRothAdvisorModelParams(client, rothWorksheet, fullQualifiedBalance, options);
  if (!built.ok) return built;
  return computeOptimizedRothPremiumAmount(built.params);
}
