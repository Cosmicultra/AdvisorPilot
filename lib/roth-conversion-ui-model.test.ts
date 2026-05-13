import { describe, expect, it } from "vitest";
import type { IntakeClient } from "@/lib/intake-config";
import { buildRothConversionModelForAdvisorUi } from "./roth-conversion-ui-model";
import { emptyRothWorksheet } from "./roth-worksheet";

const intakeFixture = (): IntakeClient => ({
  firstName: "",
  lastName: "",
  dob: "",
  age: "65",
  federalTaxBracket: "22",
  adjustedGrossIncomeAnnual: "",
  retirementAge: "67",
  retirementSpendableIncomeAnnual: "80000",
  socialSecurityMonthlyClient: "",
  socialSecurityMonthlySpouse: "",
  riskProfile: "moderate-conservative",
  riskIntakeKnown: "unset",
  riskIntakeScreen: "gate",
  riskQuizAnswers: {},
  riskQuizStepIndex: 0,
  riskProfileSuggested: "",
  calibration: "risk-profile",
  goal: "",
  advisorEmail: "",
  married: false,
  spouseFirstName: "",
  spouseLastName: "",
  spouseDob: "",
  spouseAge: "",
  spouseRetirementAge: "",
  takingSocialSecurity: false,
});

describe("buildRothConversionModelForAdvisorUi", () => {
  it("mirrors PDF route inputs: age, need, and qualified balance", () => {
    const client = intakeFixture();

    const ws = {
      ...emptyRothWorksheet(),
      useEntireQualifiedBalance: true,
      qualifiedAssetValue: "500000",
      useFixedIndexContract: false as const,
      fic: { ...emptyRothWorksheet().fic, maxTaxRatePct: "22" },
    };

    const out = buildRothConversionModelForAdvisorUi(client, ws, 500_000);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model.startingBalance).toBe(500_000);
    expect(out.model.stayTraditional[0]?.age).toBe(65);
    expect(out.model.rothConversionTotals.totalGrossConversion).toBeGreaterThan(0);
  });

  it("rejects when retirement income is blank", () => {
    const client = intakeFixture();
    client.retirementSpendableIncomeAnnual = "";
    const out = buildRothConversionModelForAdvisorUi(client, emptyRothWorksheet(), 500_000);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/retirement spendable income/i);
  });
});
