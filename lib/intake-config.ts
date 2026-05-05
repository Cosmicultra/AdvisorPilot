/**
 * Single source of truth for the client intake wizard (typed + voice).
 * To add/remove/reorder questions, edit INTAKE_STEPS only.
 */

export type IntakeClient = {
  firstName: string;
  lastName: string;
  dob: string;
  age: string;
  retirementAge: string;
  riskProfile: string;
  calibration: string;
  goal: string;
  /** Client's email — used as the *To:* address for Client Snapshot / follow-up (not the advisor's login). */
  advisorEmail: string;
  /** True when this profile was started from a client-side magic-link upload. */
  magicLinkUpload?: boolean;
};

export const RISK_PROFILES = ["conservative", "moderate-conservative", "moderate", "moderate-growth", "aggressive"] as const;

export const CALIBRATION_OPTIONS = ["risk-profile", "age-default", "income-goal", "custom"] as const;

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
      "Collect the client's first name, last name, and the email where you'll send the Client Snapshot (not your advisor login).",
    fields: ["firstName", "lastName", "advisorEmail"],
  },
  {
    id: "age",
    eyebrow: "Question 2",
    title: "How old is the client?",
    helper: "Use date of birth or age. Age helps calibrate the default allocation review.",
    fields: ["dob", "age"],
  },
  {
    id: "retirement",
    eyebrow: "Question 3",
    title: "When do they expect to retire?",
    helper: "This helps determine whether the portfolio should emphasize growth, protection, income, or a blend.",
    fields: ["retirementAge"],
  },
  {
    id: "risk",
    eyebrow: "Question 4",
    title: "What is their risk profile?",
    helper: "The app will use this as the preferred calibration instead of relying on age alone.",
    fields: ["riskProfile"],
  },
  {
    id: "calibration",
    eyebrow: "Question 5",
    title: "How should AdvisorPilot calibrate the review?",
    helper: "You can use the client risk profile, run an age-based default, or focus on retirement income.",
    fields: ["calibration"],
  },
  {
    id: "goal",
    eyebrow: "Question 6",
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
    retirementAge: String(r.retirementAge ?? "67"),
    riskProfile: String(r.riskProfile ?? "moderate-conservative"),
    calibration: String(r.calibration ?? "risk-profile"),
    goal: String(
      r.goal ?? "Prepare for retirement income while reducing unnecessary downside risk."
    ),
    advisorEmail: String(r.advisorEmail ?? ""),
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
    if (key === "calibration" && typeof raw === "string") {
      const n = normCalibration(raw);
      if (n) next.calibration = n;
      continue;
    }
    if (key === "magicLinkUpload" && typeof raw === "boolean") {
      next.magicLinkUpload = raw;
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
export function canAdvanceIntakeStep(stepIndex: number, c: IntakeClient): boolean {
  switch (stepIndex) {
    case 0:
      return Boolean(c.firstName.trim() && c.lastName.trim());
    case 1:
      return Boolean((c.dob && c.dob.length > 0) || (c.age && String(c.age).trim().length > 0));
    case 2:
      return String(c.retirementAge ?? "").trim().length > 0;
    case 3:
      return RISK_PROFILES.includes(c.riskProfile as (typeof RISK_PROFILES)[number]);
    case 4:
      return CALIBRATION_OPTIONS.includes(c.calibration as (typeof CALIBRATION_OPTIONS)[number]);
    case 5:
      return c.goal.trim().length > 0;
    default:
      return false;
  }
}
