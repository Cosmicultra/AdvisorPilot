import {
  taxableIncomeCeilingForStatedBracket,
  type IllustrationFiling,
} from "@/lib/federal-tax-illustration";
import type { RothConversionModelResult } from "@/lib/roth-conversion-analysis";

export type RothComparisonVisualData = {
  filingLabel: string;
  maxBracketPct: number;
  conversionAmountTotal: number;
  grossIncomeCeiling: number;
  taxableIncomeCeiling: number;

  stayEndingWealth: number;
  rothEndingWealth: number;
  wealthDelta: number;
  wealthDeltaPct: number;

  stayAfterTaxIncome: number;
  rothAfterTaxIncome: number;
  afterTaxIncomeDelta: number;

  stayHeirsLegacy: number;
  rothHeirsLegacy: number;
  heirsLegacyDelta: number;

  stayTaxesAndIrmaa: number;
  rothTaxesAndIrmaa: number;
  stayFederalTaxTotal: number;
  rothFederalTaxTotal: number;

  taxSavings: number;
  irmaaSavings: number;

  stayEffectiveTaxIrmaaRate: number;
  rothEffectiveTaxIrmaaRate: number;
  effectiveRateDeltaPts: number;

  /** Bracket strip positions 0–1 for each nominal rate band end. */
  bracketStrip: { ratePct: number; position: number }[];
  /** 0–1 position of stated bracket ceiling on the strip. */
  stopLinePosition: number;
};

function sumStayFederalTax(model: RothConversionModelResult): number {
  return model.stayTraditional.reduce(
    (sum, row) => sum + row.illustrativeFederalTax + row.illustrativeStateTax,
    0
  );
}

function sumRothConversionTax(model: RothConversionModelResult): number {
  return model.rothConversion.reduce((sum, row) => {
    if (row.rothOnlyPhase) return sum;
    return sum + row.illustrativeTaxOnConversion;
  }, 0);
}

function sumReportIncome(rows: { reportIncomeAnnual: number }[]): number {
  return rows.reduce((sum, row) => sum + row.reportIncomeAnnual, 0);
}

function effectiveTaxIrmaaRate(taxesAndIrmaa: number, afterTaxIncome: number, legacy: number): number {
  const denominator = taxesAndIrmaa + afterTaxIncome + legacy;
  if (denominator <= 0) return 0;
  return (taxesAndIrmaa / denominator) * 100;
}

const BRACKET_RATES = [10, 12, 22, 24, 32, 35, 37] as const;

function buildBracketStrip(filing: IllustrationFiling, statedBracketId: string): {
  bracketStrip: { ratePct: number; position: number }[];
  stopLinePosition: number;
} {
  const stopTaxable = taxableIncomeCeilingForStatedBracket(statedBracketId, filing);
  const finiteCeiling = Number.isFinite(stopTaxable)
    ? stopTaxable
    : taxableIncomeCeilingForStatedBracket("35", filing);
  const visualScaleMax = finiteCeiling * 1.25;

  const bracketIds = ["10", "12", "22", "24", "32", "35", "37"] as const;
  const bracketStrip = BRACKET_RATES.map((ratePct, i) => {
    const ceiling = taxableIncomeCeilingForStatedBracket(bracketIds[i]!, filing);
    const position =
      visualScaleMax > 0 && Number.isFinite(ceiling)
        ? Math.min(1, ceiling / visualScaleMax)
        : 1;
    return { ratePct, position };
  });
  const stopLinePosition =
    visualScaleMax > 0 && Number.isFinite(stopTaxable)
      ? Math.min(1, stopTaxable / visualScaleMax)
      : 1;
  return { bracketStrip, stopLinePosition };
}

/**
 * Maps an existing Roth conversion model into chart-ready comparison metrics.
 * Illustrative only — no new simulation logic.
 */
export function buildRothComparisonVisualData(model: RothConversionModelResult): RothComparisonVisualData {
  const stayRows = model.stayTraditional;
  const rothRows = model.rothConversion;
  const st = model.stayTraditionalTotals;
  const rt = model.rothConversionTotals;

  const stayLast = stayRows.length ? stayRows[stayRows.length - 1]! : null;
  const stayEndingWealth = stayLast?.endBalance ?? 0;
  const rothEndingWealth = rt.endingTotalRothBalance;

  const stayFederalTaxTotal = sumStayFederalTax(model);
  const rothFederalTaxTotal = sumRothConversionTax(model);

  const stayIncomeGross = sumReportIncome(stayRows);
  const rothIncomeGross = sumReportIncome(rothRows);

  const stayAfterTaxIncome = Math.max(0, stayIncomeGross - stayFederalTaxTotal);
  const rothAfterTaxIncome = Math.max(0, rothIncomeGross - rothFederalTaxTotal);

  const stayHeirsLegacy = stayEndingWealth;
  const rothHeirsLegacy = rothEndingWealth;

  const stayTaxesAndIrmaa = stayFederalTaxTotal + st.totalIrmaaPaid;
  const rothTaxesAndIrmaa = rothFederalTaxTotal + rt.totalIrmaaPaid;

  const wealthDelta = rothEndingWealth - stayEndingWealth;
  const wealthDeltaPct = stayEndingWealth > 0 ? (wealthDelta / stayEndingWealth) * 100 : 0;

  const taxSavings = stayFederalTaxTotal - rothFederalTaxTotal;
  const irmaaSavings = st.totalIrmaaPaid - rt.totalIrmaaPaid;

  const stayEffectiveTaxIrmaaRate = effectiveTaxIrmaaRate(
    stayTaxesAndIrmaa,
    stayAfterTaxIncome,
    stayHeirsLegacy,
  );
  const rothEffectiveTaxIrmaaRate = effectiveTaxIrmaaRate(
    rothTaxesAndIrmaa,
    rothAfterTaxIncome,
    rothHeirsLegacy,
  );

  const filing: IllustrationFiling = model.marriedFilingJointly ? "married" : "single";
  const taxableIncomeCeiling = taxableIncomeCeilingForStatedBracket(model.federalBracketId, filing);
  const grossIncomeCeiling = taxableIncomeCeiling + model.standardDeductionAnnual;
  const { bracketStrip, stopLinePosition } = buildBracketStrip(filing, model.federalBracketId);

  return {
    filingLabel: model.marriedFilingJointly ? "Married filing jointly" : "Single",
    maxBracketPct: model.marginalRateNominalPct,
    conversionAmountTotal: rt.totalGrossConversion,
    grossIncomeCeiling,
    taxableIncomeCeiling,

    stayEndingWealth,
    rothEndingWealth,
    wealthDelta,
    wealthDeltaPct,

    stayAfterTaxIncome,
    rothAfterTaxIncome,
    afterTaxIncomeDelta: rothAfterTaxIncome - stayAfterTaxIncome,

    stayHeirsLegacy,
    rothHeirsLegacy,
    heirsLegacyDelta: rothHeirsLegacy - stayHeirsLegacy,

    stayTaxesAndIrmaa,
    rothTaxesAndIrmaa,
    stayFederalTaxTotal,
    rothFederalTaxTotal,

    taxSavings,
    irmaaSavings,

    stayEffectiveTaxIrmaaRate,
    rothEffectiveTaxIrmaaRate,
    effectiveRateDeltaPts: stayEffectiveTaxIrmaaRate - rothEffectiveTaxIrmaaRate,

    bracketStrip,
    stopLinePosition,
  };
}
