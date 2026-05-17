/**
 * Chat-orchestrator type contracts.
 *
 * This module defines the surface every provider chat adapter implements
 * AND the message / tool / event shapes the runner + UI consume. It is the
 * "narrow waist" between four ecosystems:
 *
 *   - Three provider SDKs (`openai`, `openai`-via-xAI-baseURL, `@google/genai`)
 *     — see lib/llm/chat/{openai,grok,gemini}-chat.ts when those land
 *   - The chat runner (lib/llm/chat/chat-runner.ts)
 *   - The SSE route (app/api/chat/stream/route.ts)
 *   - The hook + widget (lib/chat/use-orchestrator-chat.ts + components/chat/*)
 *
 * Design + rationale live in docs/crm/60-chat-orchestrator.md §B.2 + §B.21.
 *
 * These types intentionally live SEPARATELY from lib/llm/types.ts (the
 * one-shot `LlmAdapter` surface for complete/research/tts/stt). The chat
 * path needs streaming + tools + provider state, which the one-shot surface
 * doesn't model — and we don't want to widen the one-shot surface to fit it.
 */

import type { LlmProvider } from "@/lib/llm";

// ─────────────────────────────────────────────────────────────────────────────
// Messages (the conversation transcript shape the runner accumulates)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One entry in the conversation history fed to the provider adapter.
 *
 * Four roles map directly to what providers expect:
 *   user        — advisor turn
 *   assistant   — model turn (may include `toolCalls` when the model asked to call tools)
 *   system      — system prompt; the runner inlines one per turn via `systemPrompt` on the params,
 *                 NOT through this role — present here only for completeness if a future caller
 *                 needs to inject one (e.g. resume-summary preamble)
 *   tool        — a tool-result message that pairs with prior assistant `toolCalls`
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Present on assistant turns that asked for tool calls. */
  toolCalls?: ChatToolCall[];
  /** Present on tool-role messages carrying results back to the model. */
  toolResults?: ChatToolResult[];
}

/**
 * One tool invocation requested by the model.
 *
 * `id` is the provider-issued call id (OpenAI Responses API: `call_...`;
 * synthesized as `gemini_<ts>_<name>` by the Gemini adapter when absent).
 * The runner keys progress + result events by this id, so it MUST be stable
 * for the lifetime of the call.
 */
export interface ChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Result of executing a tool. Either `result` or `error` is set, never both.
 *
 * The runner appends a {role: "tool", toolResults: [...]} message after each
 * tool-loop iteration to feed results back to the model.
 */
export interface ChatToolResult {
  callId: string;
  result?: unknown;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (the function-call schemas exposed to the model)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider-agnostic tool definition.
 *
 * Each adapter translates this to its own native format:
 *   OpenAI/xAI Responses API: { type: "function", name, description, parameters }
 *   Anthropic:                { name, description, input_schema }   (if added later)
 *   Gemini:                   { tools: [{ functionDeclarations: [{ name, description, parameters }] }] }
 *
 * Tool names may contain `:` in our convention (e.g. "crm:create_task"). Each
 * adapter sanitizes when the provider rejects colons (OpenAI's function-name
 * regex), maintaining a sanitized → original map and translating back when
 * the model invokes the tool.
 */
export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream params + chunks (the adapter contract)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatStreamParams {
  /** Full conversation history (user + assistant + tool roles). */
  messages: ChatMessage[];
  /**
   * Tool definitions available to the model this turn. Empty array in v1
   * (no tools wired yet); the schema field still ships so adapters can
   * unconditionally pass `tools` to their SDKs.
   */
  tools: ChatToolDefinition[];
  /**
   * Pre-built system prompt. The runner constructs this (advisor profile +
   * current client + recent activity + policy + tool index) and the adapter
   * just delivers it to the model. Adapter never composes its own.
   */
  systemPrompt: string;
  /**
   * Stable per-conversation identifier. Adapters key their state caches by
   * this (e.g. the OpenAI/xAI adapter caches `previous_response_id`; the
   * Gemini adapter caches `contextCache.name`).
   */
  sessionId: string;
  /** Resolved model id for this turn (per lib/llm/registry.ts). */
  model: string;
  /**
   * Hint that the runner picked the reasoning-tier model (vs standard).
   * Adapters use this to enable thinking/reasoning knobs natively
   * (OpenAI `reasoning.effort`; Gemini `thinkingConfig.thinkingLevel`).
   */
  isReasoning: boolean;
  /** Current user turn text (for adapter-side quick-chat heuristics). */
  userMessage: string;
  /**
   * Client-supplied previous response id for stateful OpenAI/xAI sessions.
   * When provided, the adapter sends only the NEW message instead of the
   * full history (server-side state). Null for Gemini (no analog).
   */
  previousResponseId?: string | null;
}

/**
 * Discriminated union of every event an adapter emits during a stream.
 *
 * The runner consumes these chunks and re-emits SSE events (see
 * docs/crm/60-chat-orchestrator.md §A.2). Adding a new event type is a
 * three-step coordinated change: add to this union, emit from at least one
 * adapter, handle in chat-runner.ts.
 *
 * Wire-protocol invariants:
 *   - First chunk MAY be `delta` (model emitted text first) OR
 *     `tool_call_done` (model went straight to a tool call).
 *   - Last chunk is ALWAYS `done` on success OR `error` on failure.
 *   - `tool_call_done` may arrive before any `delta` if the model decides
 *     to call tools immediately; the runner buffers either order.
 *   - `response_id` (OpenAI/xAI) arrives EXACTLY ONCE per stream, before
 *     `done` — the adapter pulls it from `response.completed` events.
 *   - `model_switch` is emitted by `provider-factory.ts` when the wrapping
 *     handler upgrades standard → reasoning mid-session.
 */
export type ChatStreamChunk =
  | { type: "delta"; text: string }
  | { type: "tool_call"; toolCall: ChatToolCall }
  | { type: "tool_call_done"; toolCall: ChatToolCall }
  | { type: "response_id"; responseId: string }
  | { type: "model_switch"; model: string }
  | { type: "done" }
  | { type: "error"; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Provider adapter contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single interface every chat provider implements. Provider-specific
 * concerns (Responses API stateful sessions, Anthropic prompt caching,
 * Gemini context caching, thought-signature circulation, name sanitization)
 * live INSIDE the adapter — the runner sees only the chunks above.
 *
 * Each adapter manages its own per-session state map (the runner uses
 * `sessionId` as the key into those maps; the adapter caches what it
 * needs). `clearSession` lets the runner / API surface drop state when
 * a conversation is explicitly reset.
 */
export interface ProviderChatAdapter {
  /** Provider identifier this adapter handles. */
  readonly provider: LlmProvider;
  /**
   * Stream a response with tool-call support. Yields `ChatStreamChunk`s in
   * the order specified above. Never throws — wraps internal errors as
   * `{ type: "error", error }` chunks so the runner can convert them to
   * SSE `error` events cleanly.
   */
  streamResponse(params: ChatStreamParams): AsyncGenerator<ChatStreamChunk>;
  /**
   * Drop any cached per-session state for `sessionId`. Called when the
   * advisor starts a new conversation OR when the provider switches mid-
   * conversation (the cached `previousResponseId` is no longer valid).
   */
  clearSession(sessionId: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors (the runner re-throws ChatStreamError variants from the SSE client;
// adapter errors stay inside the adapter and become `{type:"error"}` chunks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thrown only by the streaming HTTP client (lib/chat/orchestrator-client.ts),
 * NOT by adapters. The hook (lib/chat/use-orchestrator-chat.ts) switches on
 * `.reason` to pick recovery UX per docs/crm/60-chat-orchestrator.md §B.19.
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
  | "stream_invariant";

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
