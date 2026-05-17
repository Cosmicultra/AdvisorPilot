/**
 * Single-turn streaming chat facade.
 *
 * This is the chat-path equivalent of `lib/llm/index.ts:complete()` — it
 * follows the exact same resolution + capability-gate + logging pipeline so
 * routes that use chat look structurally identical to routes that use
 * one-shot completion / research / tts / stt.
 *
 * ─── How route handlers consume this ─────────────────────────────────────────
 *
 *   import {
 *     resolveAdvisorLlmSelection,
 *     streamChat,
 *     type ChatMessage,
 *   } from "@/lib/llm";
 *   import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
 *
 *   export async function POST(req: Request) {
 *     const identity = await resolveAdvisorIdentity(req);
 *     if (!identity) return new Response("Unauthorized", { status: 401 });
 *     const selection = await resolveAdvisorLlmSelection(identity.email);
 *
 *     const generator = streamChat(
 *       { messages, tools: [], systemPrompt, sessionId, userMessage },
 *       { request: req, selection },
 *     );
 *
 *     // SSE wiring lives in app/api/chat/stream/route.ts (next slice);
 *     // for now: for await (const chunk of generator) { ... }
 *   }
 *
 * ─── What this facade adds on top of the raw adapter ─────────────────────────
 *
 *   1. Provider + model resolution via `resolveLlmContext("chat", ...)` —
 *      same precedence as every other LLM call: header → advisor profile →
 *      env → hardcoded default.
 *
 *   2. Capability gate via `effectiveProviderForPass()` — currently a no-op
 *      for chat (all three providers are `level: "native"` per
 *      lib/llm/capabilities.ts), but the pipeline stays in place so if a
 *      future provider lacks chat support we get free fallback to OpenAI.
 *
 *   3. One `[llm]` structured log line per turn (provider + model + duration
 *      + advisor masked). Tool-call events from inside the stream are NOT
 *      logged here — that's the chat-runner's job (next slice), which emits
 *      one log line per tool invocation.
 *
 *   4. Error handling — any throw from inside the adapter generator is
 *      logged and re-thrown. The adapter itself converts SDK errors to
 *      `{ type: "error" }` chunks (it never throws synchronously into the
 *      generator), so the only way this facade hits the catch block is a
 *      registry / capability misconfiguration. The caller (chat-runner)
 *      converts that to an SSE `error` event.
 *
 * Design rationale: docs/crm/60-chat-orchestrator.md §A.4 + §B.3.
 */

import {
  advisorEmailHint,
  llmDebug,
  logLlmCall,
} from "../observability";
import { effectiveProviderForPass } from "../capabilities";
import { resolveLlmContext } from "../registry";
import type {
  AdvisorLlmSelection,
  LlmContext,
  LlmProvider,
} from "../types";
import { getChatAdapter } from "./provider-factory";
import type {
  ChatMessage,
  ChatStreamChunk,
  ChatToolDefinition,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Public facade
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamChatRequest {
  /** Full conversation history (user + assistant + tool roles). */
  messages: ChatMessage[];
  /**
   * Tool definitions for this turn. Empty in v1 (no tools wired yet); the
   * runner will populate this in PR 4.
   */
  tools: ChatToolDefinition[];
  /**
   * Pre-built system prompt (advisor profile, current client context, policy,
   * tool index). Owned by the chat-runner; this facade just forwards it.
   */
  systemPrompt: string;
  /** Stable per-conversation id — adapters use it for state caching. */
  sessionId: string;
  /** Current user turn text (the most recent user message's content). */
  userMessage: string;
  /**
   * Client-supplied previous response id (OpenAI/xAI Responses API stateful
   * resume). Optional — the adapter also falls back to its own per-session
   * cache. Provide it only when resuming an OpenAI/xAI session that was
   * started in a different process.
   */
  previousResponseId?: string | null;
}

export interface StreamChatOptions {
  /** Used by `registry.ts` for header-based overrides (`x-llm-provider`, `x-llm-model-chat`). */
  request?: Request;
  /** Force a specific provider (testing / preview tooling). */
  providerOverride?: LlmProvider;
  /**
   * Per-advisor selection from `advisorpilot_advisor_profiles` via
   * `resolveAdvisorLlmSelection()`. When omitted, falls through to
   * env / hardcoded defaults.
   */
  selection?: AdvisorLlmSelection;
}

/**
 * Stream one assistant turn. Yields `ChatStreamChunk`s in the order
 * specified by lib/llm/chat/types.ts.
 *
 * Returns the resolved `LlmContext` on the underlying generator's
 * `.return()` value via a closure — callers needing the final ctx (e.g.
 * to set a response-header diagnostic) can read it from the returned
 * helper instead of the generator itself; see `streamChatWithContext`.
 */
export async function* streamChat(
  req: StreamChatRequest,
  options: StreamChatOptions = {},
): AsyncGenerator<ChatStreamChunk> {
  const { ctx } = resolveChatContext(options);

  // Mirror the `complete()` / `research()` pipeline exactly.
  const advisor = advisorEmailHint(options.request, undefined);
  const start = performance.now();

  // Track structural outcome metadata for the log line. We collect totals
  // across the entire stream so the single `[llm]` log entry includes
  // useful agentic info (delta count, whether tools fired, whether an
  // error chunk was emitted) without changing the existing log shape.
  let deltaChunks = 0;
  let totalDeltaChars = 0;
  let toolCallsEmitted = 0;
  let lastError: string | undefined;
  let responseId: string | undefined;

  try {
    const adapter = getChatAdapter(ctx.provider);
    for await (const chunk of adapter.streamResponse({
      messages: req.messages,
      tools: req.tools,
      systemPrompt: req.systemPrompt,
      sessionId: req.sessionId,
      model: ctx.model,
      // Tier hint — AdvisorPilot uses one model per provider, so `false` is
      // the only value the factory ever produces. The flag stays in the
      // adapter contract for forward compat with tier-aware providers.
      isReasoning: false,
      userMessage: req.userMessage,
      previousResponseId: req.previousResponseId ?? null,
    })) {
      // Capture light metadata for the log line; pass everything through.
      if (chunk.type === "delta") {
        deltaChunks += 1;
        totalDeltaChars += chunk.text.length;
      } else if (chunk.type === "tool_call_done") {
        toolCallsEmitted += 1;
      } else if (chunk.type === "response_id") {
        responseId = chunk.responseId;
      } else if (chunk.type === "error") {
        lastError = chunk.error;
      }
      yield chunk;
    }
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      error: lastError,
      extra: {
        chat_session: req.sessionId,
        chat_history_msgs: req.messages.length,
        chat_tools_available: req.tools.length,
        chat_delta_chunks: deltaChunks,
        chat_delta_chars: totalDeltaChars,
        chat_tool_calls: toolCallsEmitted,
        ...(responseId ? { chat_response_id: responseId } : {}),
      },
    });
  } catch (err) {
    logLlmCall({
      ctx,
      durationMs: performance.now() - start,
      advisorEmail: advisor,
      error: err instanceof Error ? err.message : String(err),
      extra: {
        chat_session: req.sessionId,
        chat_history_msgs: req.messages.length,
      },
    });
    throw err;
  }
}

/**
 * Convenience: synchronously resolve the chat `LlmContext` without
 * starting a stream. Used by the SSE route handler to return the resolved
 * provider/model in a response header so the UI can show "Powered by
 * <model>" without waiting for the first chunk.
 */
export function resolveChatContext(options: StreamChatOptions = {}): {
  ctx: LlmContext;
} {
  const ctxResolved = resolveLlmContext("chat", {
    request: options.request,
    providerOverride: options.providerOverride,
    selection: options.selection,
  });
  const effective = effectiveProviderForPass(ctxResolved.provider, "chat");
  const ctx = effective.fellBack
    ? resolveLlmContext("chat", {
        ...options,
        providerOverride: effective.provider,
      })
    : ctxResolved;
  if (effective.fellBack) {
    llmDebug(
      `chat fallback ${ctxResolved.provider} → ${effective.provider} (${effective.reason ?? ""})`,
      { sessionId: undefined },
    );
  }
  return { ctx };
}
