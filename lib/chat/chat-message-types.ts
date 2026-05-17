/**
 * UI-side chat data types.
 *
 * DIFFERENT from `lib/llm/chat/types.ts` — that file's `ChatMessage` is the
 * SERVER's wire-protocol message shape (`{role, content, toolCalls?, toolResults?}`),
 * fed into the model. This file's `ChatMessage` is the BROWSER's display shape,
 * tracked in the React hook's state with id / timestamp / incremental status.
 *
 * The two shapes intentionally don't share a name — the orchestrator route
 * does the translation (UI list → adapter-ready history) so the hook doesn't
 * have to model server-side concerns like tool-result roles.
 *
 * Wire-protocol error class also lives here so the hook can `instanceof` it
 * from a single import path, without dragging in the LLM types barrel.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Message + tool-execution shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Status of an assistant message bubble in the UI.
 *
 *   streaming    — deltas still arriving
 *   complete     — `completed` event received; final
 *   aborted      — user clicked Stop (partial text preserved)
 *   incomplete   — stream ended without a terminal event (rare; usually a
 *                  proxy / middlebox killed the connection mid-flight)
 *   error        — turn failed; banner shown alongside the partial text
 */
export type ChatMessageStatus =
  | "streaming"
  | "complete"
  | "aborted"
  | "incomplete"
  | "error";

/**
 * One tool execution from the model's perspective. The hook accumulates
 * deltas / progress on the in-flight call and flips status on result/error.
 *
 * `result` and `error` are mutually exclusive — `status: "completed"` means
 * the tool returned a value; `status: "error"` means it threw.
 */
export interface ToolExecution {
  callId: string;
  name: string;
  /** The args the model invoked the tool with. */
  args: Record<string, unknown>;
  status: "pending" | "completed" | "error";
  /** Set on `tool:result` SSE event. */
  result?: unknown;
  /** Set on `tool:error` SSE event. */
  error?: string;
  /** Set on `tool:progress` SSE event (long-running tools). */
  progress?: {
    progress: number;
    total: number;
    message: string;
    phase?: string;
  };
  /**
   * Accumulated partial text from `tool:result_partial` events. Tools
   * that produce content incrementally (e.g. generate_report_content
   * streaming the report markdown from a nested LLM call) populate
   * this in real time. The chat UI renders it inside the tool card
   * with the same <StreamingMarkdown> the chat bubble uses, so the
   * advisor sees the report being written live.
   *
   * Reset to undefined when the tool errors or the partial stream is
   * superseded by the final `result`.
   */
  partialText?: string;
  /** Epoch ms — set when the call was first observed. */
  startedAt: number;
  /** Epoch ms — set on result/error. */
  completedAt?: number;
}

/**
 * One message in the UI list. The hook only ever appends user messages and
 * assistant messages; tool calls are nested under the assistant message that
 * triggered them (one assistant message can carry many tool executions across
 * loop iterations).
 *
 * Field `text` is the cumulative rendered text — for assistant messages it
 * grows as `assistant:delta` events arrive.
 */
export interface ChatMessage {
  /** Client-generated id, e.g. `u_1716847200000_a4f`. Stable across re-renders. */
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Epoch ms when the message was created (user) or first delta arrived (assistant). */
  ts: number;
  /** Only meaningful for assistant messages; ignored for user. */
  status?: ChatMessageStatus;
  /** Tool executions the assistant called during this message. */
  toolExecutions?: ToolExecution[];
  /**
   * Set when a `model:switch` event arrives mid-turn — UI shows a "switched
   * to X" indicator alongside the message. Reserved vocabulary in v1 (no
   * adapter emits this; AdvisorPilot uses one model per provider).
   */
  modelOverride?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming error class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reasons the streaming client can fail. The hook switches on this to pick
 * the right recovery UX (banner copy, whether to expose Retry, etc.) —
 * see `docs/crm/60-chat-orchestrator.md §B.19` failure-mode matrix.
 */
export type ChatStreamErrorReason =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "stream_aborted"
  | "buffer_overflow"
  | "no_body"
  | "network"
  | "stream_invariant"
  | "bad_request";

/**
 * Thrown by `openChatStream()` for ALL transport-layer failures. The hook
 * catches and routes via `.reason`. `httpStatus` is the underlying HTTP
 * code when applicable (401 / 403 / 429 / 5xx); undefined for transport
 * errors that never produced a response (network drop, abort, etc.).
 */
export class ChatStreamError extends Error {
  constructor(
    public readonly reason: ChatStreamErrorReason,
    message: string,
    public readonly requestId?: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ChatStreamError";
  }
}
