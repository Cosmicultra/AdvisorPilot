import { describe, expect, it } from "vitest";
import {
  chatReducer,
  initialChatState,
  newConversationId,
  type ChatHookState,
} from "./chat-reducer";

/**
 * Reducer unit tests.
 *
 * The reducer is the heart of the hook — every SSE event eventually becomes
 * one of these dispatches, and bugs here surface as ghost messages, lost
 * deltas, or stuck states. Coverage:
 *
 *   1. Initial state shape (idle, empty messages, fresh conversationId)
 *   2. USER_MESSAGE appends
 *   3. ASSISTANT_PLACEHOLDER appends with status=streaming + empty toolExecutions
 *   4. APPEND_DELTA concatenates onto the target message only
 *   5. TOOL_CALL pushes onto the assistant's toolExecutions
 *   6. TOOL_RESULT / TOOL_ERROR flip the right tool's status
 *   7. TOOL_PROGRESS updates progress in-place
 *   8. MODEL_SWITCH tags the last assistant message
 *   9. ASSISTANT_DONE sets final status
 *  10. ERROR transitions to error + sets error/errorReason
 *  11. CLEAR rotates conversationId, drops messages, resets state
 *  12. RESUME adopts an existing conversation id + drops messages
 *  13. STATE_TRANSITION enforces valid moves (silently no-ops on invalid)
 *  14. STATE_TRANSITION clears banner when going from error → preflight
 *  15. PROVIDER_RESPONSE_ID / REQUEST_ID update only their respective fields
 */

function freshState(): ChatHookState {
  return initialChatState();
}

const NOW = 1_716_847_200_000; // 2024-05-27T00:00:00Z

describe("initialChatState", () => {
  it("starts in idle with empty messages and a fresh conversationId", () => {
    const s = freshState();
    expect(s.state).toBe("idle");
    expect(s.messages).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.errorReason).toBeNull();
    expect(s.requestId).toBeNull();
    expect(s.providerResponseId).toBeNull();
    expect(s.conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("newConversationId", () => {
  it("generates UUID v4 ids (compatible with the chat_conversations.id PG uuid column)", () => {
    const a = newConversationId();
    const b = newConversationId();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(a).toMatch(uuidRe);
    expect(b).toMatch(uuidRe);
    expect(a).not.toBe(b); // randomness check
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Message manipulation
// ─────────────────────────────────────────────────────────────────────────────

describe("USER_MESSAGE + ASSISTANT_PLACEHOLDER", () => {
  it("appends a user message", () => {
    const s = chatReducer(freshState(), {
      type: "USER_MESSAGE",
      message: { id: "u1", role: "user", text: "Hi", ts: NOW },
    });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toEqual({ id: "u1", role: "user", text: "Hi", ts: NOW });
  });

  it("appends an assistant placeholder with status=streaming + empty toolExecutions", () => {
    const s = chatReducer(freshState(), {
      type: "ASSISTANT_PLACEHOLDER",
      id: "a1",
      ts: NOW,
    });
    expect(s.messages[0]).toEqual({
      id: "a1",
      role: "assistant",
      text: "",
      ts: NOW,
      status: "streaming",
      toolExecutions: [],
    });
  });
});

describe("APPEND_DELTA", () => {
  it("concatenates onto the target assistant message and leaves others alone", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "USER_MESSAGE",
      message: { id: "u1", role: "user", text: "x", ts: NOW },
    });
    s = chatReducer(s, { type: "ASSISTANT_PLACEHOLDER", id: "a1", ts: NOW });
    s = chatReducer(s, { type: "APPEND_DELTA", id: "a1", text: "Hel" });
    s = chatReducer(s, { type: "APPEND_DELTA", id: "a1", text: "lo" });
    expect(s.messages[1].text).toBe("Hello");
    // User msg untouched
    expect(s.messages[0].text).toBe("x");
  });

  it("does nothing when the target id doesn't exist (defensive)", () => {
    const s0 = freshState();
    const s1 = chatReducer(s0, { type: "APPEND_DELTA", id: "missing", text: "X" });
    expect(s1.messages).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool executions
// ─────────────────────────────────────────────────────────────────────────────

describe("TOOL_CALL / TOOL_RESULT / TOOL_ERROR / TOOL_PROGRESS", () => {
  function withAssistantBubble() {
    let s = freshState();
    s = chatReducer(s, { type: "ASSISTANT_PLACEHOLDER", id: "a1", ts: NOW });
    return s;
  }

  it("TOOL_CALL appends to the target message's toolExecutions", () => {
    let s = withAssistantBubble();
    s = chatReducer(s, {
      type: "TOOL_CALL",
      messageId: "a1",
      tool: {
        callId: "c1",
        name: "query_crm",
        args: { op: "list" },
        status: "pending",
        startedAt: NOW,
      },
    });
    expect(s.messages[0].toolExecutions).toHaveLength(1);
    expect(s.messages[0].toolExecutions![0].callId).toBe("c1");
    expect(s.messages[0].toolExecutions![0].status).toBe("pending");
  });

  it("TOOL_RESULT flips status to completed + records result + completedAt", () => {
    let s = withAssistantBubble();
    s = chatReducer(s, {
      type: "TOOL_CALL",
      messageId: "a1",
      tool: {
        callId: "c1",
        name: "query_crm",
        args: {},
        status: "pending",
        startedAt: NOW,
      },
    });
    s = chatReducer(s, {
      type: "TOOL_RESULT",
      messageId: "a1",
      callId: "c1",
      result: { rows: 5 },
    });
    const t = s.messages[0].toolExecutions![0];
    expect(t.status).toBe("completed");
    expect(t.result).toEqual({ rows: 5 });
    expect(t.completedAt).toBeDefined();
  });

  it("TOOL_ERROR flips status to error + records error string", () => {
    let s = withAssistantBubble();
    s = chatReducer(s, {
      type: "TOOL_CALL",
      messageId: "a1",
      tool: {
        callId: "c1",
        name: "query_crm",
        args: {},
        status: "pending",
        startedAt: NOW,
      },
    });
    s = chatReducer(s, {
      type: "TOOL_ERROR",
      messageId: "a1",
      callId: "c1",
      error: "tool not registered",
    });
    const t = s.messages[0].toolExecutions![0];
    expect(t.status).toBe("error");
    expect(t.error).toBe("tool not registered");
  });

  it("TOOL_PROGRESS updates the in-flight tool's progress in-place", () => {
    let s = withAssistantBubble();
    s = chatReducer(s, {
      type: "TOOL_CALL",
      messageId: "a1",
      tool: {
        callId: "c1",
        name: "deep_research",
        args: {},
        status: "pending",
        startedAt: NOW,
      },
    });
    s = chatReducer(s, {
      type: "TOOL_PROGRESS",
      messageId: "a1",
      callId: "c1",
      progress: { progress: 3, total: 10, message: "fetching", phase: "search" },
    });
    expect(s.messages[0].toolExecutions![0].progress).toEqual({
      progress: 3,
      total: 10,
      message: "fetching",
      phase: "search",
    });
    expect(s.messages[0].toolExecutions![0].status).toBe("pending"); // still in-flight
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR 22 — Soft-resume (LOAD_CONVERSATION.pendingResume + DISMISS_RESUME)
// ─────────────────────────────────────────────────────────────────────────────

describe("Soft-resume (LOAD_CONVERSATION + DISMISS_RESUME)", () => {
  it("initial state has pendingResume === null", () => {
    expect(freshState().pendingResume).toBeNull();
  });

  it("LOAD_CONVERSATION carries pendingResume through to state", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "LOAD_CONVERSATION",
      conversationId: "conv_xyz",
      providerResponseId: null,
      messages: [],
      pendingResume: { lastUserMessage: "What's my AUM by stage?" },
      title: null,
    });
    expect(s.pendingResume).toEqual({
      lastUserMessage: "What's my AUM by stage?",
    });
    expect(s.conversationId).toBe("conv_xyz");
  });

  it("LOAD_CONVERSATION with null pendingResume clears any prior CTA", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "LOAD_CONVERSATION",
      conversationId: "conv_1",
      providerResponseId: null,
      messages: [],
      pendingResume: { lastUserMessage: "earlier ask" },
      title: null,
    });
    s = chatReducer(s, {
      type: "LOAD_CONVERSATION",
      conversationId: "conv_2",
      providerResponseId: null,
      messages: [],
      pendingResume: null,
      title: null,
    });
    expect(s.pendingResume).toBeNull();
  });

  it("USER_MESSAGE clears pendingResume (advisor decided to send fresh content OR re-send)", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "LOAD_CONVERSATION",
      conversationId: "c1",
      providerResponseId: null,
      messages: [],
      pendingResume: { lastUserMessage: "earlier" },
      title: null,
    });
    s = chatReducer(s, {
      type: "USER_MESSAGE",
      message: {
        id: "u1",
        role: "user",
        text: "send anew",
        ts: NOW,
      },
    });
    expect(s.pendingResume).toBeNull();
  });

  it("CLEAR rotates conversation id AND clears pendingResume", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "LOAD_CONVERSATION",
      conversationId: "c1",
      providerResponseId: null,
      messages: [],
      pendingResume: { lastUserMessage: "earlier" },
      title: null,
    });
    const beforeId = s.conversationId;
    s = chatReducer(s, { type: "CLEAR" });
    expect(s.pendingResume).toBeNull();
    expect(s.conversationId).not.toBe(beforeId);
  });

  it("DISMISS_RESUME clears the CTA without touching anything else", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "LOAD_CONVERSATION",
      conversationId: "c1",
      providerResponseId: "resp_42",
      messages: [],
      pendingResume: { lastUserMessage: "earlier" },
      title: null,
    });
    const beforeId = s.conversationId;
    const beforeRespId = s.providerResponseId;
    s = chatReducer(s, { type: "DISMISS_RESUME" });
    expect(s.pendingResume).toBeNull();
    expect(s.conversationId).toBe(beforeId);
    expect(s.providerResponseId).toBe(beforeRespId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR 15 — TOOL_PARTIAL (live partial-content streaming)
// ─────────────────────────────────────────────────────────────────────────────

describe("TOOL_PARTIAL", () => {
  function withPendingTool() {
    let s = freshState();
    s = chatReducer(s, { type: "ASSISTANT_PLACEHOLDER", id: "a1", ts: NOW });
    s = chatReducer(s, {
      type: "TOOL_CALL",
      messageId: "a1",
      tool: {
        callId: "call_x",
        name: "generate_report_content",
        args: {},
        status: "pending",
        startedAt: NOW,
      },
    });
    return s;
  }

  it("appends deltaText to partialText (starts undefined, then accumulates)", () => {
    let s = withPendingTool();
    s = chatReducer(s, {
      type: "TOOL_PARTIAL",
      messageId: "a1",
      callId: "call_x",
      deltaText: "# Hello",
    });
    s = chatReducer(s, {
      type: "TOOL_PARTIAL",
      messageId: "a1",
      callId: "call_x",
      deltaText: "\n\nWorld",
    });
    const exec = s.messages[0].toolExecutions?.[0];
    expect(exec?.partialText).toBe("# Hello\n\nWorld");
    expect(exec?.status).toBe("pending");
  });

  it("ignores TOOL_PARTIAL for a non-matching callId", () => {
    let s = withPendingTool();
    s = chatReducer(s, {
      type: "TOOL_PARTIAL",
      messageId: "a1",
      callId: "different_call",
      deltaText: "should be ignored",
    });
    expect(s.messages[0].toolExecutions?.[0].partialText).toBeUndefined();
  });

  it("ignores TOOL_PARTIAL for a non-matching messageId", () => {
    let s = withPendingTool();
    s = chatReducer(s, {
      type: "TOOL_PARTIAL",
      messageId: "different_msg",
      callId: "call_x",
      deltaText: "x",
    });
    expect(s.messages[0].toolExecutions?.[0].partialText).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Model switch + assistant done + ids + error
// ─────────────────────────────────────────────────────────────────────────────

describe("MODEL_SWITCH, ASSISTANT_DONE, PROVIDER_RESPONSE_ID, REQUEST_ID", () => {
  it("MODEL_SWITCH tags only the LAST assistant message", () => {
    let s = freshState();
    s = chatReducer(s, { type: "ASSISTANT_PLACEHOLDER", id: "a1", ts: NOW });
    s = chatReducer(s, {
      type: "USER_MESSAGE",
      message: { id: "u1", role: "user", text: "x", ts: NOW },
    });
    s = chatReducer(s, { type: "ASSISTANT_PLACEHOLDER", id: "a2", ts: NOW });
    s = chatReducer(s, { type: "MODEL_SWITCH", model: "gpt-5.5" });
    expect(s.messages[0].modelOverride).toBeUndefined();
    expect(s.messages[2].modelOverride).toBe("gpt-5.5");
  });

  it("ASSISTANT_DONE sets the target message's status", () => {
    let s = freshState();
    s = chatReducer(s, { type: "ASSISTANT_PLACEHOLDER", id: "a1", ts: NOW });
    s = chatReducer(s, {
      type: "ASSISTANT_DONE",
      id: "a1",
      finalStatus: "complete",
    });
    expect(s.messages[0].status).toBe("complete");
  });

  it("PROVIDER_RESPONSE_ID and REQUEST_ID update only their fields", () => {
    let s = freshState();
    s = chatReducer(s, { type: "PROVIDER_RESPONSE_ID", id: "resp_42" });
    expect(s.providerResponseId).toBe("resp_42");
    s = chatReducer(s, { type: "REQUEST_ID", id: "req_xyz" });
    expect(s.requestId).toBe("req_xyz");
    expect(s.providerResponseId).toBe("resp_42"); // unchanged
  });

  it("ERROR transitions to error + sets banner + reason", () => {
    const s = chatReducer(freshState(), {
      type: "ERROR",
      message: "Rate limited",
      reason: "rate_limited",
    });
    expect(s.state).toBe("error");
    expect(s.error).toBe("Rate limited");
    expect(s.errorReason).toBe("rate_limited");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR + RESUME
// ─────────────────────────────────────────────────────────────────────────────

describe("CLEAR + RESUME", () => {
  it("CLEAR drops messages, generates a NEW conversationId, returns to idle", () => {
    let s = freshState();
    const origConvId = s.conversationId;
    s = chatReducer(s, {
      type: "USER_MESSAGE",
      message: { id: "u1", role: "user", text: "x", ts: NOW },
    });
    s = chatReducer(s, {
      type: "ERROR",
      message: "boom",
      reason: "network",
    });
    s = chatReducer(s, { type: "CLEAR" });
    expect(s.messages).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.errorReason).toBeNull();
    expect(s.state).toBe("idle");
    expect(s.conversationId).not.toBe(origConvId); // rotated
  });

  it("RESUME adopts the given conversationId and previousResponseId", () => {
    const s = chatReducer(freshState(), {
      type: "RESUME",
      conversationId: "c_old_xyz",
      providerResponseId: "resp_99",
    });
    expect(s.conversationId).toBe("c_old_xyz");
    expect(s.providerResponseId).toBe("resp_99");
    expect(s.messages).toEqual([]);
    expect(s.state).toBe("idle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE_TRANSITION guarding
// ─────────────────────────────────────────────────────────────────────────────

describe("STATE_TRANSITION", () => {
  it("allows valid forward transitions", () => {
    let s = freshState();
    s = chatReducer(s, { type: "STATE_TRANSITION", to: "preflight" });
    expect(s.state).toBe("preflight");
    s = chatReducer(s, { type: "STATE_TRANSITION", to: "streaming" });
    expect(s.state).toBe("streaming");
    s = chatReducer(s, { type: "STATE_TRANSITION", to: "idle" });
    expect(s.state).toBe("idle");
  });

  it("silently no-ops invalid transitions (no throw; warns in console)", () => {
    let s = freshState(); // state = "idle"
    // idle → streaming is invalid (must go via preflight first)
    s = chatReducer(s, { type: "STATE_TRANSITION", to: "streaming" });
    expect(s.state).toBe("idle"); // unchanged
  });

  it("clears banner + errorReason on error → preflight (retry path)", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "ERROR",
      message: "Server error 500",
      reason: "server_error",
    });
    expect(s.error).toBe("Server error 500");
    s = chatReducer(s, { type: "STATE_TRANSITION", to: "preflight" });
    expect(s.state).toBe("preflight");
    expect(s.error).toBeNull();
    expect(s.errorReason).toBeNull();
  });

  it("does NOT clear banner on error → idle (ack path keeps last error visible briefly)", () => {
    let s = freshState();
    s = chatReducer(s, {
      type: "ERROR",
      message: "Rate limited",
      reason: "rate_limited",
    });
    s = chatReducer(s, { type: "STATE_TRANSITION", to: "idle" });
    expect(s.state).toBe("idle");
    // Banner retained — the ack path is explicit dismissal via CLEAR.
    expect(s.error).toBe("Rate limited");
  });
});
