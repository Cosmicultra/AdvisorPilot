import { describe, expect, it } from "vitest";
import {
  applyIntakePatch,
  boostIdentityFromUtterance,
  canAdvanceIntakeStep,
  normalizeIntakeClient,
  type IntakeClient,
} from "./intake-config";

function client(overrides: Partial<IntakeClient> = {}): IntakeClient {
  return normalizeIntakeClient({
    firstName: "Jane",
    lastName: "Smith",
    age: "62",
    adjustedGrossIncomeAnnual: "165000",
    federalTaxBracket: "22",
    retirementAge: "67",
    retirementSpendableIncomeAnnual: "85000",
    riskProfile: "moderate",
    calibration: "risk-profile",
    goal: "Retirement income",
    ...overrides,
  });
}

describe("intake-config", () => {
  it("normalizes legacy full-name client records", () => {
    expect(normalizeIntakeClient({ name: "Jane Smith" })).toMatchObject({
      firstName: "Jane",
      lastName: "Smith",
    });
  });

  it("sanitizes voice patches to allowed enum values", () => {
    const patched = applyIntakePatch(client(), {
      riskProfile: "moderately-aggressive",
      calibration: "retirement income",
      federalTaxBracket: "24%",
    });

    expect(patched.riskProfile).toBe("moderate-growth");
    expect(patched.calibration).toBe("income-goal");
    expect(patched.federalTaxBracket).toBe("24");
  });

  it("boosts first and last name from a simple utterance", () => {
    const patch: Partial<IntakeClient> = {};
    boostIdentityFromUtterance("Jane Smith", patch);
    expect(patch).toMatchObject({ firstName: "Jane", lastName: "Smith" });
  });

  it("blocks married identity step until spouse name is present", () => {
    expect(canAdvanceIntakeStep(0, client({ married: true }))).toBe(false);
    expect(
      canAdvanceIntakeStep(
        0,
        client({ married: true, spouseFirstName: "Alex", spouseLastName: "Smith" })
      )
    ).toBe(true);
  });

  it("requires Social Security amounts only when taking benefits", () => {
    expect(canAdvanceIntakeStep(6, client({ takingSocialSecurity: false }))).toBe(true);
    expect(canAdvanceIntakeStep(6, client({ takingSocialSecurity: true }))).toBe(false);
    expect(canAdvanceIntakeStep(6, client({ takingSocialSecurity: true, socialSecurityMonthlyClient: "2400" }))).toBe(true);
  });

  it("Question 8: blocks Continue on gate and quiz; allows on known/result with valid tier", () => {
    expect(canAdvanceIntakeStep(7, client({}))).toBe(false);
    expect(
      canAdvanceIntakeStep(
        7,
        client({ riskIntakeScreen: "known", riskProfile: "moderate" })
      )
    ).toBe(true);
    expect(canAdvanceIntakeStep(7, client({ riskIntakeScreen: "quiz", riskProfile: "moderate" }))).toBe(
      false
    );
    expect(
      canAdvanceIntakeStep(
        7,
        client({ riskIntakeScreen: "result", riskProfile: "moderate-conservative" })
      )
    ).toBe(true);
  });

  it("normalizes persistedAdvisorUi for reopening saved advisor sessions", () => {
    expect(
      normalizeIntakeClient({
        firstName: "A",
        persistedAdvisorUi: { rothLiveAnalysisOpen: true },
      }).persistedAdvisorUi
    ).toEqual({ rothLiveAnalysisOpen: true });
    expect(
      normalizeIntakeClient({
        firstName: "A",
        persistedAdvisorUi: { rothLiveAnalysisOpen: false },
      }).persistedAdvisorUi
    ).toEqual({ rothLiveAnalysisOpen: false });
    expect(normalizeIntakeClient({ firstName: "A", persistedAdvisorUi: {} }).persistedAdvisorUi).toBeUndefined();
  });
});
