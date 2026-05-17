/**
 * Pure reducer for the chat hook (`use-orchestrator-chat.ts`).
 *
 * Extracted into its own file so every action / state-transition pair is
 * unit-testable without touching React. The hook is then a thin shell over
 * `chatReducer` + side effects (fetch, watchdog, abort).
 *
 * Action discriminated union mirrors the dispatch calls in the hook +
 * `routeEvent()` (the function that maps SSE events to dispatches).
 */

import type { ChatMessage, ChatMessageStatus, ToolExecution } from "./chat-message-types";
import type { ChatState } from "./chat-state-machine";
import { canTransition } from "./chat-state-machine";

// ─────────────────────────────────────────────────────────────────────────────
// State shape
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatHookState {
  messages: ChatMessage[];
  state: ChatState;
  /** Human-readable error message for the banner; null when no error. */
  error: string | null;
  /** Programmatic error reason (`ChatStreamError.reason`) — drives retry decisions. */
  errorReason: string | null;
  /** `X-Request-Id` from the active stream — surfaced in error banners for support. */
  requestId: string | null;
  /** Stable per-conversation id. Used by the adapter for session state. */
  conversationId: string;
  /** OpenAI/xAI Responses API `previous_response_id` — populated on the terminal `completed` event. */
  providerResponseId: string | null;
  /**
   * Soft-resume CTA payload (PR 22). Populated when openConversation
   * loads a conversation whose last message is user-role with no
   * following assistant — i.e. the previous stream died mid-flight and
   * the assistant never replied. The widget renders a "Continue this
   * chat?" prompt; clicking it calls `send(lastUserMessage)`.
   *
   * Cleared on the next successful USER_MESSAGE / CLEAR / LOAD_CONVERSATION
   * with a complete conversation.
   */
  pendingResume: { lastUserMessage: string } | null;
  /**
   * Active conversation title — populated by LOAD_CONVERSATION when the
   * sidebar opens a persisted chat. Null for fresh conversations until
   * the server's auto-title lands (which the client doesn't currently
   * fetch back, so it stays null in the live conversation until reload).
   * Drives the header subtitle (PR 23).
   */
  conversationTitle: string | null;
}

/**
 * Generate a fresh conversation id.
 *
 * Returns a real UUID v4 (e.g. `aabbccdd-eeff-...`) so the value can be
 * inserted directly into `advisorpilot_chat_conversations.id` (Postgres
 * `uuid` column). The previous shortcode format (`c_<ts>_<rand>`) made
 * persistence silently fail with `invalid input syntax for type uuid`.
 *
 * Falls back to a hand-rolled v4 only when `crypto.randomUUID` isn't
 * available (very old browsers; vanishingly rare in production). The
 * fallback uses `crypto.getRandomValues` for the random bytes — never
 * `Math.random` — so the entropy is real.
 */
export function newConversationId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  // RFC-4122 v4 fallback using crypto.getRandomValues.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) hex.push(bytes[i].toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export function initialChatState(): ChatHookState {
  return {
    messages: [],
    state: "idle",
    error: null,
    errorReason: null,
    requestId: null,
    conversationId: newConversationId(),
    providerResponseId: null,
    pendingResume: null,
    conversationTitle: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export type ChatAction =
  | { type: "USER_MESSAGE"; message: ChatMessage }
  | { type: "ASSISTANT_PLACEHOLDER"; id: string; ts: number }
  | { type: "STATE_TRANSITION"; to: ChatState }
  | { type: "APPEND_DELTA"; id: string; text: string }
  | { type: "TOOL_CALL"; messageId: string; tool: ToolExecution }
  | { type: "TOOL_RESULT"; messageId: string; callId: string; result: unknown }
  | { type: "TOOL_ERROR"; messageId: string; callId: string; error: string }
  | {
      /** Append a delta to a tool execution's partialText buffer. */
      type: "TOOL_PARTIAL";
      messageId: string;
      callId: string;
      deltaText: string;
    }
  | {
      type: "TOOL_PROGRESS";
      messageId: string;
      callId: string;
      progress: {
        progress: number;
        total: number;
        message: string;
        phase?: string;
      };
    }
  | { type: "MODEL_SWITCH"; model: string }
  | { type: "ASSISTANT_DONE"; id: string; finalStatus: ChatMessageStatus }
  | { type: "PROVIDER_RESPONSE_ID"; id: string }
  | { type: "REQUEST_ID"; id: string | null }
  | { type: "ERROR"; message: string; reason: string }
  | { type: "CLEAR" }
  | {
      type: "RESUME";
      conversationId: string;
      providerResponseId: string | null;
    }
  | {
      /**
       * Hard-load a persisted conversation: replace the working state
       * with the conversation's id + restored message history +
       * adapter-resume id. Used by the sidebar "click to open" flow.
       *
       * Distinct from RESUME (which keeps messages empty for soft-resume
       * of an interrupted stream) — LOAD_CONVERSATION reads the full
       * server-side history and renders it in the chat panel.
       *
       * When `pendingResume` is set, the widget shows a "Continue this
       * chat?" CTA — that surfaces when the loaded conversation ended
       * with a user message that has no following assistant (PR 22).
       */
      type: "LOAD_CONVERSATION";
      conversationId: string;
      providerResponseId: string | null;
      messages: ChatMessage[];
      pendingResume: { lastUserMessage: string } | null;
      /** Persisted display title — surfaces in the header (PR 23). */
      title: string | null;
    }
  | {
      /** Dismiss the soft-resume CTA without sending (PR 22). */
      type: "DISMISS_RESUME";
    }
  | {
      /**
       * Append a completed voice turn (user OR assistant) to the
       * message list. Used by the voice integration in <ChatWidget />
       * to mirror Gemini Live transcripts into the same chat history
       * the text orchestrator writes to. The state machine is NOT
       * driven by voice — the chat hook stays in `idle` while voice
       * runs, so this action just slots a finished message into the
       * list without touching `state` / `requestId` / `error`.
       *
       * Status is forced to `complete` for assistant voice turns —
       * they're never partial by the time they get appended (we wait
       * for the Live API's turn-complete event).
       */
      type: "APPEND_VOICE_TURN";
      message: ChatMessage;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────────────────────────

export function chatReducer(state: ChatHookState, action: ChatAction): ChatHookState {
  switch (action.type) {
    case "STATE_TRANSITION": {
      // Silently no-op invalid transitions — better than throwing from a
      // hook (which would unmount the widget). The dev console warning
      // makes the bug visible without breaking the user's session.
      if (!canTransition(state.state, action.to)) {
        if (typeof console !== "undefined") {
          console.warn(
            `[chat] invalid transition: ${state.state} → ${action.to}`,
          );
        }
        return state;
      }
      // Clear error banner when we successfully start a new turn from `error`.
      if (state.state === "error" && action.to === "preflight") {
        return { ...state, state: action.to, error: null, errorReason: null };
      }
      return { ...state, state: action.to };
    }

    case "USER_MESSAGE":
      // Sending a new message clears any pending soft-resume CTA — the
      // CTA's whole purpose was to nudge the advisor into resending,
      // and now they're either resending OR sending something new.
      return {
        ...state,
        messages: [...state.messages, action.message],
        pendingResume: null,
      };

    case "ASSISTANT_PLACEHOLDER":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: "assistant",
            text: "",
            ts: action.ts,
            status: "streaming",
            toolExecutions: [],
          },
        ],
      };

    case "APPEND_DELTA":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, text: m.text + action.text } : m,
        ),
      };

    case "TOOL_CALL":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                toolExecutions: [...(m.toolExecutions ?? []), action.tool],
              }
            : m,
        ),
      };

    case "TOOL_RESULT":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                toolExecutions: (m.toolExecutions ?? []).map((t) =>
                  t.callId === action.callId
                    ? {
                        ...t,
                        status: "completed",
                        result: action.result,
                        completedAt: Date.now(),
                      }
                    : t,
                ),
              }
            : m,
        ),
      };

    case "TOOL_ERROR":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                toolExecutions: (m.toolExecutions ?? []).map((t) =>
                  t.callId === action.callId
                    ? {
                        ...t,
                        status: "error",
                        error: action.error,
                        completedAt: Date.now(),
                      }
                    : t,
                ),
              }
            : m,
        ),
      };

    case "TOOL_PARTIAL":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                toolExecutions: (m.toolExecutions ?? []).map((t) =>
                  t.callId === action.callId
                    ? {
                        ...t,
                        partialText: (t.partialText ?? "") + action.deltaText,
                      }
                    : t,
                ),
              }
            : m,
        ),
      };

    case "TOOL_PROGRESS":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                toolExecutions: (m.toolExecutions ?? []).map((t) =>
                  t.callId === action.callId
                    ? { ...t, progress: action.progress }
                    : t,
                ),
              }
            : m,
        ),
      };

    case "MODEL_SWITCH":
      // Tag the latest assistant message with the new model. Reserved
      // vocabulary in v1 — no adapter emits this; AdvisorPilot uses ONE
      // model per provider — but the reducer is wired so future tier-aware
      // providers can flip this without a hook rewrite.
      return {
        ...state,
        messages: state.messages.map((m, i) =>
          i === state.messages.length - 1 && m.role === "assistant"
            ? { ...m, modelOverride: action.model }
            : m,
        ),
      };

    case "ASSISTANT_DONE":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id ? { ...m, status: action.finalStatus } : m,
        ),
      };

    case "PROVIDER_RESPONSE_ID":
      return { ...state, providerResponseId: action.id };

    case "REQUEST_ID":
      return { ...state, requestId: action.id };

    case "ERROR":
      return {
        ...state,
        error: action.message,
        errorReason: action.reason,
        state: "error",
      };

    case "CLEAR":
      // Fresh conversation id — server treats it as a brand-new session
      // (no `previous_response_id` to chain off).
      return {
        ...state,
        messages: [],
        error: null,
        errorReason: null,
        conversationId: newConversationId(),
        providerResponseId: null,
        requestId: null,
        state: "idle",
        pendingResume: null,
        conversationTitle: null,
      };

    case "RESUME":
      // Adopt an existing conversation id + previous response id (e.g. user
      // navigated back to a conversation from history). We DON'T restore
      // messages here — those load via a separate fetch.
      return {
        ...state,
        messages: [],
        conversationId: action.conversationId,
        providerResponseId: action.providerResponseId,
        error: null,
        errorReason: null,
        requestId: null,
        state: "idle",
      };

    case "LOAD_CONVERSATION":
      // Hard-replace working state with a persisted conversation. Used
      // when the advisor clicks an entry in the history sidebar. The
      // restored messages are already in `ChatMessage` shape (mapped
      // server-side from `ChatMessageRecord`).
      return {
        ...state,
        messages: action.messages,
        conversationId: action.conversationId,
        providerResponseId: action.providerResponseId,
        error: null,
        errorReason: null,
        requestId: null,
        state: "idle",
        pendingResume: action.pendingResume,
        conversationTitle: action.title,
      };

    case "DISMISS_RESUME":
      return { ...state, pendingResume: null };

    case "APPEND_VOICE_TURN":
      // Voice turns slot in alongside text turns — same id/timestamp
      // contract. We don't touch `state`, `requestId`, or `error`
      // because the chat state machine isn't driving voice. The
      // calling code (ChatWidget's voice plumbing) is responsible for
      // ensuring the message id is unique within the conversation
      // and that assistant turns have status:"complete".
      return { ...state, messages: [...state.messages, action.message] };
  }
}
