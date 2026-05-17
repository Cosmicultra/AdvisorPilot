/**
 * Chat lifecycle state machine.
 *
 * Lives in a separate file from the React hook (`use-orchestrator-chat.ts`)
 * for one reason: it's PURE — no React, no fetch, no SSE. Every transition
 * is testable in isolation, and bugs in the state machine are diagnosable
 * without spinning up a renderer.
 *
 * The state names + valid transitions match the lifecycle diagram in
 * `docs/crm/60-chat-orchestrator.md §B.12 / §B.13`.
 *
 * ─── States ──────────────────────────────────────────────────────────────────
 *
 *   idle             — no active turn; input enabled; canSend = true
 *   preflight        — server is gathering context; input disabled; UI shows "Thinking…"
 *   streaming        — assistant:delta or tool events flowing; UI renders incremental markdown
 *   connection_slow  — amber state (inactivity > HEARTBEAT_WARN_MS, still streaming)
 *   aborting         — user clicked Stop; waiting for fetch unwind; partial text preserved
 *   reconnecting     — watchdog fired (inactivity > HEARTBEAT_FAIL_MS); hook decides next step
 *   error            — terminal failure this turn; input re-enabled; banner shows
 *
 * ─── Invariants ──────────────────────────────────────────────────────────────
 *
 *   - `idle` is the only state in which `send()` is allowed (plus `error`,
 *     which the user can retry from).
 *   - `aborting` only ever transitions to `idle`.
 *   - `streaming` ↔ `connection_slow` is bidirectional — the connection can
 *     recover and the amber banner clears.
 *   - Self-transitions on `streaming` are allowed because the reducer dispatches
 *     `STATE_TRANSITION → streaming` redundantly on the first delta even when
 *     it's already streaming. Keeping this allowed avoids spurious warnings.
 */

export type ChatState =
  | "idle"
  | "preflight"
  | "streaming"
  | "connection_slow"
  | "aborting"
  | "reconnecting"
  | "error";

/**
 * Allowed forward transitions per state. Used by `canTransition()` to gate
 * invalid moves in the reducer (and in tests). The map is exhaustive — every
 * `ChatState` key has an entry; adding a new state forces an update here
 * (which is caught by the exhaustiveness check in `assertExhaustiveState`).
 */
export const VALID_TRANSITIONS: Readonly<Record<ChatState, readonly ChatState[]>> = {
  idle: ["preflight"],
  preflight: ["streaming", "error", "aborting"],
  // Self-transition allowed — the reducer may dispatch STATE_TRANSITION → streaming
  // redundantly when the first delta arrives on an already-streaming turn.
  streaming: [
    "streaming",
    "connection_slow",
    "aborting",
    "reconnecting",
    "error",
    "idle",
  ],
  connection_slow: ["streaming", "reconnecting", "error", "idle", "aborting"],
  aborting: ["idle"],
  reconnecting: ["streaming", "idle", "error"],
  // `preflight` is the "retry" target — error → preflight reuses the same
  // user message via `retry()` in the hook.
  error: ["idle", "preflight"],
};

/** True when a transition `from → to` is allowed per `VALID_TRANSITIONS`. */
export function canTransition(from: ChatState, to: ChatState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived flags (single source of truth for the UI)
// ─────────────────────────────────────────────────────────────────────────────

/** True when the model is actively producing output (or about to). */
export function isStreamingState(s: ChatState): boolean {
  return s === "preflight" || s === "streaming" || s === "connection_slow";
}

/** True when `send()` is allowed — the only states the input button is enabled. */
export function canSendInState(s: ChatState): boolean {
  return s === "idle" || s === "error";
}

/** True when `abort()` should be exposed in the UI. */
export function canAbortInState(s: ChatState): boolean {
  return s === "preflight" || s === "streaming" || s === "connection_slow";
}

/** True when the input MUST stay disabled (the model is mid-turn). */
export function isInputLockedInState(s: ChatState): boolean {
  return (
    s === "preflight" ||
    s === "streaming" ||
    s === "connection_slow" ||
    s === "aborting" ||
    s === "reconnecting"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal — exhaustiveness check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile-time exhaustiveness check. Adding a new ChatState without
 * extending this switch is a TypeScript error — exactly what we want.
 */
export function assertExhaustiveState(s: ChatState): never {
  switch (s) {
    case "idle":
    case "preflight":
    case "streaming":
    case "connection_slow":
    case "aborting":
    case "reconnecting":
    case "error": {
      throw new Error(`assertExhaustiveState called with valid state '${s}'`);
    }
    default: {
      const _exhaust: never = s;
      void _exhaust;
      throw new Error(`Unhandled ChatState: ${String(s)}`);
    }
  }
}
