import { buildRothConversionModel, type RothConversionModelResult } from "@/lib/roth-conversion-analysis";
import type { IntakeClient } from "@/lib/intake-config";
import { annualSocialSecurityGrossForIllustration, parseClientAgeForIllustration } from "@/lib/roth-inputs";
import { federalBracketIdFromWorksheetPct, normalizeRothWorksheet, type RothWorksheet } from "@/lib/roth-worksheet";

export type RothAdvisorUiModelResult =
  | { ok: true; model: RothConversionModelResult }
  | { ok: false; error: string };

/**
 * Builds the same Roth illustration as {@link app/api/generate-roth-report/route.ts} for advisor UI.
 */
export function buildRothConversionModelForAdvisorUi(
  client: IntakeClient,
  rothWorksheet: RothWorksheet,
  qualifiedIllustrationBalance: number,
  options?: { minClientAge?: number }
): RothAdvisorUiModelResult {
  const minAge = options?.minClientAge ?? 60;
  const age = parseClientAgeForIllustration(client);
  if (age < minAge) {
    return {
      ok: false,
      error: `Roth illustration runs for clients age ${minAge} and older (current age modeled: ${age}).`,
    };
  }
  if (!Number.isFinite(qualifiedIllustrationBalance) || qualifiedIllustrationBalance <= 0) {
    return {
      ok: false,
      error: "Enter a qualified balance for the illustration (choose Yes/No above and a dollar amount).",
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

  const model = buildRothConversionModel({
    totalAccountValue: qualifiedIllustrationBalance,
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
  });

  return { ok: true, model };
}
