import { describe, expect, it } from "vitest";
import {
  canAbortInState,
  canSendInState,
  canTransition,
  isInputLockedInState,
  isStreamingState,
  VALID_TRANSITIONS,
  type ChatState,
} from "./chat-state-machine";

/**
 * State-machine unit tests.
 *
 * Coverage:
 *   1. Every state in `VALID_TRANSITIONS` has an entry.
 *   2. The forward lifecycle (idle → preflight → streaming → idle) is allowed.
 *   3. `aborting` is a sink — only `idle` can follow.
 *   4. `error` allows retry via `preflight` AND acknowledge via `idle`.
 *   5. `connection_slow` recovers to `streaming`.
 *   6. Derived flags (canSend, canAbort, isStreaming, inputLocked) are
 *      consistent with the lifecycle (e.g. canSend is true in exactly two
 *      states; canAbort is true in exactly three).
 *   7. No state transitions to itself EXCEPT `streaming` (intentional).
 */

const ALL_STATES: ChatState[] = [
  "idle",
  "preflight",
  "streaming",
  "connection_slow",
  "aborting",
  "reconnecting",
  "error",
];

describe("VALID_TRANSITIONS — completeness", () => {
  it("has an entry for every state", () => {
    for (const s of ALL_STATES) {
      expect(VALID_TRANSITIONS[s]).toBeDefined();
      expect(Array.isArray(VALID_TRANSITIONS[s])).toBe(true);
    }
  });

  it("transition targets are all valid states", () => {
    for (const from of ALL_STATES) {
      for (const to of VALID_TRANSITIONS[from]) {
        expect(ALL_STATES).toContain(to);
      }
    }
  });
});

describe("canTransition — happy path lifecycle", () => {
  it("allows idle → preflight → streaming → idle", () => {
    expect(canTransition("idle", "preflight")).toBe(true);
    expect(canTransition("preflight", "streaming")).toBe(true);
    expect(canTransition("streaming", "idle")).toBe(true);
  });

  it("allows preflight → error (preflight-time failure)", () => {
    expect(canTransition("preflight", "error")).toBe(true);
  });

  it("allows preflight → aborting (user cancels during preflight)", () => {
    expect(canTransition("preflight", "aborting")).toBe(true);
  });

  it("allows streaming ↔ connection_slow recovery", () => {
    expect(canTransition("streaming", "connection_slow")).toBe(true);
    expect(canTransition("connection_slow", "streaming")).toBe(true);
  });

  it("allows streaming → streaming (self-transition for first-delta upgrade from preflight)", () => {
    // The reducer dispatches STATE_TRANSITION → streaming even when already
    // streaming; allowing the self-transition avoids spurious console warnings.
    expect(canTransition("streaming", "streaming")).toBe(true);
  });
});

describe("canTransition — guards", () => {
  it("forbids idle → streaming (must go via preflight first)", () => {
    expect(canTransition("idle", "streaming")).toBe(false);
  });

  it("forbids idle → error (errors only arise mid-turn)", () => {
    expect(canTransition("idle", "error")).toBe(false);
  });

  it("aborting only transitions to idle (sink state)", () => {
    expect(canTransition("aborting", "idle")).toBe(true);
    expect(canTransition("aborting", "streaming")).toBe(false);
    expect(canTransition("aborting", "preflight")).toBe(false);
    expect(canTransition("aborting", "error")).toBe(false);
    expect(canTransition("aborting", "aborting")).toBe(false);
  });

  it("error → preflight (retry) and error → idle (ack) are both allowed", () => {
    expect(canTransition("error", "preflight")).toBe(true);
    expect(canTransition("error", "idle")).toBe(true);
  });

  it("error → streaming is forbidden (must retry through preflight)", () => {
    expect(canTransition("error", "streaming")).toBe(false);
  });

  it("reconnecting → streaming/idle/error allowed; anything else forbidden", () => {
    expect(canTransition("reconnecting", "streaming")).toBe(true);
    expect(canTransition("reconnecting", "idle")).toBe(true);
    expect(canTransition("reconnecting", "error")).toBe(true);
    expect(canTransition("reconnecting", "preflight")).toBe(false);
    expect(canTransition("reconnecting", "connection_slow")).toBe(false);
  });

  it("no state except streaming self-loops", () => {
    for (const s of ALL_STATES) {
      if (s === "streaming") continue;
      expect(canTransition(s, s)).toBe(false);
    }
  });
});

describe("derived flags", () => {
  it("isStreamingState true for preflight | streaming | connection_slow only", () => {
    expect(isStreamingState("preflight")).toBe(true);
    expect(isStreamingState("streaming")).toBe(true);
    expect(isStreamingState("connection_slow")).toBe(true);
    expect(isStreamingState("idle")).toBe(false);
    expect(isStreamingState("aborting")).toBe(false);
    expect(isStreamingState("reconnecting")).toBe(false);
    expect(isStreamingState("error")).toBe(false);
  });

  it("canSendInState true for idle | error only", () => {
    expect(canSendInState("idle")).toBe(true);
    expect(canSendInState("error")).toBe(true);
    for (const s of ALL_STATES) {
      if (s === "idle" || s === "error") continue;
      expect(canSendInState(s)).toBe(false);
    }
  });

  it("canAbortInState true for preflight | streaming | connection_slow only", () => {
    expect(canAbortInState("preflight")).toBe(true);
    expect(canAbortInState("streaming")).toBe(true);
    expect(canAbortInState("connection_slow")).toBe(true);
    for (const s of ALL_STATES) {
      if (s === "preflight" || s === "streaming" || s === "connection_slow") continue;
      expect(canAbortInState(s)).toBe(false);
    }
  });

  it("inputLocked true for every state except idle | error", () => {
    expect(isInputLockedInState("idle")).toBe(false);
    expect(isInputLockedInState("error")).toBe(false);
    for (const s of ALL_STATES) {
      if (s === "idle" || s === "error") continue;
      expect(isInputLockedInState(s)).toBe(true);
    }
  });
});
