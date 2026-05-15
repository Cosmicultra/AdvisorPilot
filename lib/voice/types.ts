/**
 * Shared types for the voice agent client surface.
 */

export type AppStep =
  | "intake"
  | "upload"
  | "confirm"
  | "analysis"
  | "meeting"
  | "fia"
  | "roth"
  | "retIncome"
  | "report"
  | "saved";

export interface FocusSnapshot {
  step: AppStep;
  intakeStep: number;
  activeReviewId: string | null;
  clientFirstName: string | null;
  clientAge: number | null;
  clientRiskProfile: string | null;
  holdingsCount: number;
  totalValue: number | null;
  incomeReadinessScore: number | null;
  redFlagCount: number | null;
  recentClientCount: number;
  savedReviewCount: number;
}

export interface FocusPayload {
  description: string;
  snapshot: FocusSnapshot;
}

export type VoiceSessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "tool"
  | "expiring"
  | "disconnected";

export interface VoiceToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface VoiceToolResponse {
  id: string;
  name: string;
  response: unknown;
}
