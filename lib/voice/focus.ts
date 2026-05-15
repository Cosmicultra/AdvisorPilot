/**
 * Build the per-call "Focus" snapshot delivered to the voice agent via
 * `get_context`. Single source of truth for what the agent is allowed to
 * "see" about the advisor's current screen + active client.
 *
 * Privacy rule: this is the ONLY function that turns React state into agent-
 * visible JSON. It redacts PII the advisor doesn't need spoken aloud:
 *   - account numbers → "****1234" partials only when the source string is
 *     already partial; otherwise the field is omitted.
 *   - email addresses → never included; only first name + last initial.
 *   - DOB → omitted (age is fine).
 *   - SSN → never present in our data model; defensive-omitted anyway.
 */

import type { AppStep, FocusPayload, FocusSnapshot } from "./types";

export interface VoiceAppState {
  step: AppStep;
  intakeStep: number;
  activeReviewId: string | null;
  clientFirstName?: string | null;
  clientLastName?: string | null;
  clientAge?: number | null;
  clientRiskProfile?: string | null;
  holdingsCount: number;
  totalValue?: number | null;
  incomeReadinessScore?: number | null;
  redFlagCount?: number | null;
  recentClientCount: number;
  savedReviewCount: number;
}

const INTAKE_STEP_TITLES = [
  "Who is this review for",
  "Client age",
  "AGI on most recent return",
  "Federal tax bracket",
  "Expected retirement age",
  "Annual spendable income in retirement",
  "Social Security",
  "Risk profile",
  "Calibration model",
  "Client goal statement",
];

function clientLabel(state: VoiceAppState): string {
  const first = (state.clientFirstName ?? "").trim();
  const lastInitial = (state.clientLastName ?? "").trim().charAt(0);
  if (first && lastInitial) return `${first} ${lastInitial}.`;
  if (first) return first;
  return "a new client";
}

export function focusDescription(state: VoiceAppState): string {
  const who = clientLabel(state);
  switch (state.step) {
    case "intake": {
      const title = INTAKE_STEP_TITLES[state.intakeStep] ?? "intake";
      return `Intake step ${state.intakeStep + 1} of 10 (${title}) for ${who}.`;
    }
    case "upload":
      return `Statement upload screen for ${who}.`;
    case "confirm":
      return `Confirming ${state.holdingsCount} extracted holdings for ${who}.`;
    case "analysis": {
      const score = state.incomeReadinessScore ?? "n/a";
      const flags = state.redFlagCount ?? 0;
      return `Portfolio analysis for ${who} — income readiness ${score}, ${state.holdingsCount} holdings, ${flags} red flag${flags === 1 ? "" : "s"}.`;
    }
    case "meeting":
      return `Meeting guide / talking points for ${who}.`;
    case "fia":
      return `Fixed Income Annuity calculator for ${who}.`;
    case "roth":
      return `Roth conversion worksheet for ${who}.`;
    case "retIncome":
      return `Retirement income projection for ${who}.`;
    case "report":
      return `PDF report generation for ${who}.`;
    case "saved":
      return `Saved clients screen (${state.savedReviewCount} clients).`;
    default:
      return `AdvisorPilot — current screen.`;
  }
}

export function focusPayload(state: VoiceAppState): FocusPayload {
  const snapshot: FocusSnapshot = {
    step: state.step,
    intakeStep: state.intakeStep,
    activeReviewId: state.activeReviewId,
    clientFirstName: state.clientFirstName ?? null,
    clientAge: state.clientAge ?? null,
    clientRiskProfile: state.clientRiskProfile ?? null,
    holdingsCount: state.holdingsCount,
    totalValue: state.totalValue ?? null,
    incomeReadinessScore: state.incomeReadinessScore ?? null,
    redFlagCount: state.redFlagCount ?? null,
    recentClientCount: state.recentClientCount,
    savedReviewCount: state.savedReviewCount,
  };
  return {
    description: focusDescription(state),
    snapshot,
  };
}
