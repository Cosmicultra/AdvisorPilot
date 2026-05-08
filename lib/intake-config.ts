/**
 * Single source of truth for the client intake wizard (typed + voice).
 * To add/remove/reorder questions, edit INTAKE_STEPS only.
 */

import { canAdvanceRiskIntake } from "@/lib/risk-questionnaire";
import type { RiskIntakeScreen } from "@/lib/risk-questionnaire";
import { RISK_PROFILES } from "@/lib/risk-profiles";

export type RiskIntakeKnown = "unset" | "yes" | "no";

export type IntakeClient = {
  firstName: string;
  lastName: string;
  dob: string;
  age: string;
  /** Current marginal federal tax bracket id: "10" | "12" | "22" | ... */
  federalTaxBracket: string;
  /** AGI from the most recent federal tax return (annual dollars, string for forms). */
  adjustedGrossIncomeAnnual: string;
  retirementAge: string;
  /** Annual after-tax spendable income needed in retirement (dollars, as string for forms). */
  retirementSpendableIncomeAnnual: string;
  /** Household / primary client receiving Social Security (monthly dollars, string for forms). */
  socialSecurityMonthlyClient: string;
  /** Spouse monthly Social Security when married and collecting. */
  socialSecurityMonthlySpouse: string;
  riskProfile: string;
  /** Gate for Question 8: does the client already have a stated risk profile? */
  riskIntakeKnown: RiskIntakeKnown;
  /** Sub-view within Question 8 (typed wizard). */
  riskIntakeScreen: RiskIntakeScreen;
  /** Option index per quiz question id (see RISK_QUIZ_QUESTION_IDS). */
  riskQuizAnswers: Record<string, number>;
  /** Current quiz step index 0..7 while riskIntakeScreen is quiz. */
  riskQuizStepIndex: number;
  /** Tier suggested by the quick assessment (may differ from riskProfile if advisor overrides). */
  riskProfileSuggested: string;
  calibration: string;
  goal: string;
  /** Client's email — used as the *To:* address for Client Snapshot / follow-up (not the advisor's login). */
  advisorEmail: string;
  married: boolean;
  spouseFirstName: string;
  spouseLastName: string;
  spouseDob: string;
  spouseAge: string;
  spouseRetirementAge: string;
  takingSocialSecurity: boolean;
  /** True when this profile was started from a client-side magic-link upload. */
  magicLinkUpload?: boolean;
};

export type { RiskIntakeScreen } from "@/lib/risk-questionnaire";
export { canAdvanceRiskIntake } from "@/lib/risk-questionnaire";
export { RISK_PROFILES, type RiskProfileId } from "@/lib/risk-profiles";

export const CALIBRATION_OPTIONS = ["risk-profile", "age-default", "income-goal", "custom"] as const;

/** Simplified federal marginal brackets for intake + Roth illustration (single filer wording; still user-entered). */
export const FEDERAL_TAX_BRACKET_IDS = ["10", "12", "22", "24", "32", "35", "37"] as const;

export type FederalTaxBracketId = (typeof FEDERAL_TAX_BRACKET_IDS)[number];

export type IntakeStepMeta = {
  id: string;
  eyebrow: string;
  title: string;
  helper: string;
  /** Which IntakeClient keys this step primarily collects */
  fields: (keyof IntakeClient)[];
};

export const INTAKE_STEPS: IntakeStepMeta[] = [
  {
    id: "identity",
    eyebrow: "Question 1",
    title: "Who is this review for?",
    helper:
      "Collect the client's first name, last name, and the email where you'll send the Client Snapshot.",
    fields: ["firstName", "lastName", "advisorEmail", "married", "spouseFirstName", "spouseLastName"],
  },
  {
    id: "age",
    eyebrow: "Question 2",
    title: "How old is the client?",
    helper: "Use date of birth or age. Age helps calibrate the default allocation review. If married, capture the spouse's age or date of birth the same way.",
    fields: ["dob", "age", "spouseDob", "spouseAge"],
  },
  {
    id: "adjustedGrossIncome",
    eyebrow: "Question 3",
    title: "What was your Adjusted Gross Income (AGI) on your most recent tax return?",
    helper:
      "Use the AGI from the client's federal return (Form 1040, line 11 on recent-year returns). For illustrative planning only—not tax advice.",
    fields: ["adjustedGrossIncomeAnnual"],
  },
  {
    id: "taxBracket",
    eyebrow: "Question 4",
    title: "What is your current federal tax bracket?",
    helper: "Use the marginal bracket that best fits the client's ordinary income today (used for illustrative tax math in reports).",
    fields: ["federalTaxBracket"],
  },
  {
    id: "retirement",
    eyebrow: "Question 5",
    title: "When do they expect to retire?",
    helper: "This helps determine whether the portfolio should emphasize growth, protection, income, or a blend. If married, ask for the spouse's expected retirement age too.",
    fields: ["retirementAge", "spouseRetirementAge"],
  },
  {
    id: "retirementIncome",
    eyebrow: "Question 6",
    title: "How much spendable income do you need in retirement annually?",
    helper: "",
    fields: ["retirementSpendableIncomeAnnual"],
  },
  {
    id: "socialSecurity",
    eyebrow: "Question 7",
    title: "Are you taking Social Security?",
    helper: "If the household is not receiving benefits yet, leave amounts blank and continue. If receiving benefits, capture approximate monthly amounts.",
    fields: ["takingSocialSecurity", "socialSecurityMonthlyClient", "socialSecurityMonthlySpouse"],
  },
  {
    id: "risk",
    eyebrow: "Question 8",
    title: "What is their risk profile?",
    helper:
      "First confirm whether they already have a stated profile (IPS, firm questionnaire, or prior onboarding). If yes, pick the matching tier. If not, use the short on-screen assessment—illustrative for discussion, not a substitute for your firm's full risk process. Either path feeds the same calibration engine.",
    fields: ["riskProfile", "riskIntakeKnown", "riskIntakeScreen", "riskQuizAnswers", "riskProfileSuggested"],
  },
  {
    id: "calibration",
    eyebrow: "Question 9",
    title: "How should AdvisorPilot calibrate the review?",
    helper:
      "Stated risk profile is the default fit after Question 8. Age-based default ignores that tier and uses age only. Retirement income goal emphasizes income stability. Custom leaves room for your own model—even if you used the in-app risk assessment, you may still pick age-based or custom here if appropriate.",
    fields: ["calibration"],
  },
  {
    id: "goal",
    eyebrow: "Question 10",
    title: "What is the main client goal?",
    helper: "This helps the script and report sound specific to the client conversation.",
    fields: ["goal"],
  },
];

export const INTAKE_STEP_COUNT = INTAKE_STEPS.length;

/** Full display name for PDFs, emails, and headers. Supports legacy saved rows that only had `name`. */
export function clientDisplayName(c: Partial<IntakeClient> & { name?: string }): string {
  const fn = String(c.firstName ?? "").trim();
  const ln = String(c.lastName ?? "").trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return String((c as { name?: string }).name ?? "").trim();
}

/** Salutation / informal first name. */
export function clientFirstNameSalutation(c: Partial<IntakeClient> & { name?: string }): string {
  const fn = String(c.firstName ?? "").trim();
  if (fn) return fn;
  const full = clientDisplayName(c);
  return full.split(/\s+/)[0] || "there";
}

/** Normalize client JSON from storage (legacy single `name` field). */
function normRiskIntakeKnown(v: unknown): RiskIntakeKnown {
  if (v === "yes" || v === "no") return v;
  return "unset";
}

function normRiskIntakeScreen(v: unknown): RiskIntakeScreen {
  if (v === "known" || v === "quiz" || v === "result" || v === "gate") return v;
  return "gate";
}

function normRiskQuizAnswers(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(val);
    if (Number.isFinite(n) && n >= 0 && Number.isInteger(n)) out[k] = n;
  }
  return out;
}

function normRiskQuizStepIndex(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 7 ? Math.floor(n) : 0;
}

export function normalizeIntakeClient(raw: unknown): IntakeClient {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let firstName = String(r.firstName ?? "");
  let lastName = String(r.lastName ?? "");
  const legacyName = String(r.name ?? "").trim();
  if (!firstName.trim() && !lastName.trim() && legacyName) {
    const parts = legacyName.split(/\s+/).filter(Boolean);
    firstName = parts[0] ?? "";
    lastName = parts.slice(1).join(" ") || "";
  }
  return {
    firstName,
    lastName,
    dob: String(r.dob ?? ""),
    age: String(r.age ?? ""),
    federalTaxBracket: String(r.federalTaxBracket ?? "22"),
    adjustedGrossIncomeAnnual: String(r.adjustedGrossIncomeAnnual ?? ""),
    retirementAge: String(r.retirementAge ?? "67"),
    retirementSpendableIncomeAnnual: String(r.retirementSpendableIncomeAnnual ?? ""),
    socialSecurityMonthlyClient: String(r.socialSecurityMonthlyClient ?? ""),
    socialSecurityMonthlySpouse: String(r.socialSecurityMonthlySpouse ?? ""),
    riskProfile: String(r.riskProfile ?? "moderate-conservative"),
    riskIntakeKnown: normRiskIntakeKnown(r.riskIntakeKnown),
    riskIntakeScreen: normRiskIntakeScreen(r.riskIntakeScreen),
    riskQuizAnswers: normRiskQuizAnswers(r.riskQuizAnswers),
    riskQuizStepIndex: normRiskQuizStepIndex(r.riskQuizStepIndex),
    riskProfileSuggested: String(r.riskProfileSuggested ?? ""),
    calibration: String(r.calibration ?? "risk-profile"),
    goal: String(
      r.goal ?? "Prepare for retirement income while reducing unnecessary downside risk."
    ),
    advisorEmail: String(r.advisorEmail ?? ""),
    married: Boolean(r.married),
    spouseFirstName: String(r.spouseFirstName ?? ""),
    spouseLastName: String(r.spouseLastName ?? ""),
    spouseDob: String(r.spouseDob ?? ""),
    spouseAge: String(r.spouseAge ?? ""),
    spouseRetirementAge: String(r.spouseRetirementAge ?? ""),
    takingSocialSecurity: Boolean(r.takingSocialSecurity),
    magicLinkUpload: Boolean(r.magicLinkUpload),
  };
}

function normRisk(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (RISK_PROFILES.includes(v as (typeof RISK_PROFILES)[number])) return v;
  const map: Record<string, string> = {
    "moderately-conservative": "moderate-conservative",
    "mod-conservative": "moderate-conservative",
    "moderately-aggressive": "moderate-growth",
    growth: "moderate-growth",
  };
  return map[v] ?? null;
}

function normCalibration(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (CALIBRATION_OPTIONS.includes(v as (typeof CALIBRATION_OPTIONS)[number])) return v;
  const map: Record<string, string> = {
    "stated-risk": "risk-profile",
    risk: "risk-profile",
    age: "age-default",
    "default-age": "age-default",
    income: "income-goal",
    "retirement-income": "income-goal",
  };
  return map[v] ?? null;
}

/** Fields changed between two client snapshots (for API responses). */
export function intakeClientDiff(prev: IntakeClient, next: IntakeClient): Partial<IntakeClient> {
  const out: Partial<IntakeClient> = {};
  (Object.keys(next) as (keyof IntakeClient)[]).forEach((k) => {
    if (next[k] !== prev[k]) (out as Record<keyof IntakeClient, IntakeClient[keyof IntakeClient]>)[k] = next[k];
  });
  return out;
}

/** If the model omits structured names, infer first/last from a spoken phrase like "Jane Smith". */
export function boostIdentityFromUtterance(userText: string, patch: Partial<IntakeClient>): void {
  const fn = String(patch.firstName ?? "").trim();
  const ln = String(patch.lastName ?? "").trim();
  if (fn && ln) return;

  const cleaned = userText.trim().replace(/^[,.]\s*|\s*[,.]$/g, "");
  const parts = cleaned.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w));
  if (parts.length >= 2) {
    if (!fn) patch.firstName = parts[0];
    if (!ln) patch.lastName = parts.slice(1).join(" ");
  }
}

/** Merge partial updates from voice; sanitize enums and strip unknown keys. */
export function applyIntakePatch(base: IntakeClient, patch: Partial<Record<keyof IntakeClient | "name", unknown>>): IntakeClient {
  const next = { ...base };
  const record = patch as Record<string, unknown>;

  if (typeof record.name === "string" && record.name.trim()) {
    const parts = record.name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 1 && !next.firstName.trim()) next.firstName = parts[0];
    if (parts.length >= 2 && !next.lastName.trim()) next.lastName = parts.slice(1).join(" ");
  }

  for (const key of Object.keys(patch) as (keyof IntakeClient | "name")[]) {
    if (key === "name") continue;
    const raw = patch[key];
    if (raw === undefined) continue;
    if (key === "riskProfile" && typeof raw === "string") {
      const n = normRisk(raw);
      if (n) next.riskProfile = n;
      continue;
    }
    if (key === "riskProfileSuggested" && typeof raw === "string") {
      const n = normRisk(raw.trim());
      next.riskProfileSuggested = n ?? "";
      continue;
    }
    if (key === "riskIntakeKnown" && typeof raw === "string") {
      const v = raw.trim().toLowerCase();
      if (v === "yes" || v === "no" || v === "unset") next.riskIntakeKnown = v as RiskIntakeKnown;
      continue;
    }
    if (key === "riskIntakeScreen" && typeof raw === "string") {
      const v = raw.trim().toLowerCase();
      if (v === "gate" || v === "known" || v === "quiz" || v === "result") {
        next.riskIntakeScreen = v as RiskIntakeScreen;
      }
      continue;
    }
    if (key === "riskQuizStepIndex" && typeof raw === "number" && Number.isFinite(raw)) {
      next.riskQuizStepIndex = Math.max(0, Math.min(7, Math.floor(raw)));
      continue;
    }
    if (key === "riskQuizAnswers" && raw && typeof raw === "object") {
      const merged = { ...next.riskQuizAnswers, ...normRiskQuizAnswers(raw) };
      next.riskQuizAnswers = merged;
      continue;
    }
    if (key === "federalTaxBracket" && typeof raw === "string") {
      const digits = raw.replace(/%/g, "").trim();
      if (FEDERAL_TAX_BRACKET_IDS.includes(digits as FederalTaxBracketId)) next.federalTaxBracket = digits;
      continue;
    }
    if (key === "calibration" && typeof raw === "string") {
      const n = normCalibration(raw);
      if (n) next.calibration = n;
      continue;
    }
    if (key === "magicLinkUpload" && typeof raw === "boolean") {
      next.magicLinkUpload = raw;
      continue;
    }
    if (key === "married" && typeof raw === "boolean") {
      next.married = raw;
      continue;
    }
    if (key === "takingSocialSecurity" && typeof raw === "boolean") {
      next.takingSocialSecurity = raw;
      continue;
    }
    if (typeof raw === "string") {
      const writable = next as unknown as Record<string, string>;
      writable[key as string] = raw;
    }
  }
  return next;
}

/** Minimum info before leaving a step (typed form uses Continue; voice uses this too). */
function positiveMoneyString(s: string): boolean {
  const n = Number(String(s ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n > 0;
}

/** True when every intake step passes the same checks as the advisor wizard. */
export function isIntakeComplete(c: IntakeClient): boolean {
  for (let i = 0; i < INTAKE_STEP_COUNT; i++) {
    if (!canAdvanceIntakeStep(i, c)) return false;
  }
  return true;
}

/** Step titles that still fail validation (for client magic-link UX). */
export function intakeIncompleteStepTitles(c: IntakeClient): string[] {
  const out: string[] = [];
  for (let i = 0; i < INTAKE_STEP_COUNT; i++) {
    if (!canAdvanceIntakeStep(i, c)) out.push(INTAKE_STEPS[i].title);
  }
  return out;
}

export function canAdvanceIntakeStep(stepIndex: number, c: IntakeClient): boolean {
  switch (stepIndex) {
    case 0: {
      if (!c.firstName.trim() || !c.lastName.trim()) return false;
      if (c.married && (!c.spouseFirstName.trim() || !c.spouseLastName.trim())) return false;
      return true;
    }
    case 1: {
      const clientAgeOk = Boolean((c.dob && c.dob.length > 0) || (c.age && String(c.age).trim().length > 0));
      if (!clientAgeOk) return false;
      if (c.married) {
        const spouseAgeOk = Boolean(
          (c.spouseDob && c.spouseDob.length > 0) || (c.spouseAge && String(c.spouseAge).trim().length > 0)
        );
        if (!spouseAgeOk) return false;
      }
      return true;
    }
    case 2: {
      const n = Number(String(c.adjustedGrossIncomeAnnual ?? "").replace(/[$,]/g, "").trim());
      return Number.isFinite(n) && n > 0;
    }
    case 3:
      return FEDERAL_TAX_BRACKET_IDS.includes(c.federalTaxBracket as FederalTaxBracketId);
    case 4: {
      if (!String(c.retirementAge ?? "").trim().length) return false;
      if (c.married && !String(c.spouseRetirementAge ?? "").trim().length) return false;
      return true;
    }
    case 5: {
      const n = Number(String(c.retirementSpendableIncomeAnnual ?? "").replace(/[$,]/g, "").trim());
      return Number.isFinite(n) && n > 0;
    }
    case 6:
      if (!c.takingSocialSecurity) return true;
      if (!positiveMoneyString(c.socialSecurityMonthlyClient)) return false;
      if (c.married && !positiveMoneyString(c.socialSecurityMonthlySpouse)) return false;
      return true;
    case 7:
      return canAdvanceRiskIntake(c);
    case 8:
      return CALIBRATION_OPTIONS.includes(c.calibration as (typeof CALIBRATION_OPTIONS)[number]);
    case 9:
      return c.goal.trim().length > 0;
    default:
      return false;
  }
}
