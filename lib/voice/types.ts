/**
 * Shared types for the voice agent client surface.
 *
 * Voice v3: rewritten for route-based focus (CRM URLs) instead of
 * legacy wizard steps.
 */

import type { VoiceLocation } from "./focus";

export interface FocusSnapshot {
  /** Raw pathname — useful when the model wants to reason about deep links. */
  pathname: string;
  /** Coarse location class — matches the destinations the navigate tool accepts. */
  location: VoiceLocation;
  /** Tab segment on a client detail page (overview/workflow/notes/...) or null. */
  clientTab: string | null;
  activeClientId: string | null;
  activeClientName: string | null;
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
