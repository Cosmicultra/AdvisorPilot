/**
 * Chat orchestration runner.
 *
 * Drives a single advisor turn end-to-end:
 *   1. Preflight  — gather context, emit `preflight:start` / `preflight:complete`
 *   2. System prompt — build via `buildChatSystemPrompt` (pure)
 *   3. Tool loop  — stream from provider; if the model issued tool calls,
 *                   execute them and re-stream; repeat until text-only or
 *                   `MAX_TOOL_LOOPS` is hit
 *   4. Persist    — write per-turn metadata to the chat log (deferred to PR 3)
 *
 * SSE events emitted via the `onEvent` callback follow the wire protocol in
 * `docs/crm/60-chat-orchestrator.md §A.2`. The route handler (the only
 * caller) just serializes each event onto a `ReadableStream` controller.
 *
 * v1 scope (this slice):
 *   - Preflight is data-only — no Supabase fetches in this PR. The runner
 *     accepts pre-fetched profile/client/notes/activity/tasks via
 *     `ChatRunnerOptions.preflight` and forwards them straight to the prompt
 *     builder. PR 2 wires `lib/llm/chat/preflight.ts` (Supabase + visibility
 *     model) that the route handler runs and passes in.
 *
 *   - Tool loop degenerates to one iteration because `tools: []` is wired —
 *     the model never asks for a tool, so `pending.length === 0` and the
 *     loop exits. The loop scaffolding stays in place so PR 4 (tools)
 *     activates it without restructuring this file.
 *
 *   - Tool execution itself is stubbed — if a tool call somehow lands
 *     (e.g. the model hallucinates a function), the runner emits
 *     `tool:error` and breaks the loop rather than crashing.
 *
 * Design + rationale: `docs/crm/60-chat-orchestrator.md §B.4`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendTurn,
  appendUserMessage,
  upsertConversation,
} from "@/lib/chat/persistence";
import { getCrmSupabaseAdmin, missingCrmSupabaseEnv } from "@/lib/crm/supabase-admin";
import { streamChat, type StreamChatOptions } from "./stream-chat";
import {
  buildChatSystemPrompt,
  type BuildChatSystemPromptInput,
} from "./system-prompt";
import { chatToolDefinitionsFromRegistry } from "./tools";
import type { ChatTool, ChatToolContext, ChatToolRegistry } from "./tools/types";
import type {
  ChatMessage,
  ChatStreamChunk,
  ChatToolCall,
  ChatToolResult,
} from "./types";
import type { LlmContext } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Persistence support — best-effort + non-blocking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the Supabase client used for chat-orchestrator persistence.
 * Falls back to `null` when env isn't configured (tests, local dev
 * without Supabase) — the runner just skips persistence in that case
 * instead of blowing up.
 */
function resolvePersistenceClient(
  injected?: SupabaseClient | null,
): SupabaseClient | null {
  if (injected !== undefined) return injected;
  if (missingCrmSupabaseEnv()) return null;
  return getCrmSupabaseAdmin();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The chat runner's view of the request, separate from the route handler's
 * concerns (auth, body parsing, SSE wiring). Everything the runner needs to
 * emit a coherent system prompt + stream a turn lives here.
 */
export interface ChatRunnerContext {
  /** Stable per-conversation id (also used as the adapter's sessionId). */
  conversationId: string;
  /** Lower-cased advisor email. */
  advisorEmail: string;
  /** Optional opaque request id; mirrored into the `started` event. */
  requestId?: string;
  /** Currently focused client id, or null if the advisor opened chat with no client in scope. */
  currentClientId?: string | null;
  /** Current page route, e.g. `/app/crm/c_a1b2/overview`. */
  currentRoute?: string | null;
}

/**
 * Pre-fetched context the route handler passes to the runner. v1 only
 * uses `advisor` + `view`; PR 2 starts populating the client-scoped fields.
 */
export type ChatRunnerPreflight = Pick<
  BuildChatSystemPromptInput,
  "advisor" | "currentView" | "currentClient" | "pinnedNotes" | "recentActivity" | "openTasks"
>;

/**
 * SSE event the route handler serializes onto the wire. Stays generic — the
 * runner doesn't know `text/event-stream`. The route handler converts each
 * `{ event, data }` pair into `event: <name>\ndata: <json>\n\n`.
 */
export interface RunnerEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface ChatRunnerOptions {
  context: ChatRunnerContext;
  /**
   * Full conversation history including the current user turn. The runner
   * doesn't mutate this — each tool-loop iteration appends to its own copy.
   */
  messages: ChatMessage[];
  /**
   * Pre-fetched preflight data. The route handler runs the fetches (so they
   * can be parallelized with auth + selection lookup) and passes the result
   * straight through to the runner.
   */
  preflight: ChatRunnerPreflight;
  /**
   * Client-supplied OpenAI/xAI Responses API `previous_response_id`.
   * Optional — the adapter also keeps its own per-session cache; this is
   * only useful for cross-process resume (e.g. the advisor reloads the page
   * mid-conversation and the client sends back the last id it remembers).
   */
  previousResponseId?: string | null;
  /**
   * Tool registry exposed to the model this turn. When provided, the runner:
   *   - Derives the JSON-Schema `tools[]` array from the registry and passes
   *     it to streamChat so the model knows what's callable.
   *   - Dispatches `tool_call_done` chunks by name through the registry and
   *     executes the handler. Successful results emit `tool:result` SSE
   *     events; failures emit `tool:error`.
   *   - Appends `{role: 'assistant', toolCalls: [...]}` + `{role: 'tool',
   *     toolResults: [...]}` messages to the in-loop history so the next
   *     iteration's model call sees its own prior call and the result.
   *
   * When omitted (or empty), the loop short-circuits after the first
   * iteration — the model never sees a `tools[]` array, so it can't ask
   * for a tool. Useful for environments without Supabase configured.
   */
  toolRegistry?: ChatToolRegistry;
  /**
   * Test-only: inject a stub Supabase client used as the tool handlers'
   * context. Production callers omit this and the runner uses
   * `getCrmSupabaseAdmin()`.
   */
  supabaseImpl?: SupabaseClient;
  /**
   * Test-only: inject a stub Supabase client used for chat-orchestrator
   * persistence (conversations + messages tables). Pass `null` to
   * EXPLICITLY disable persistence in tests; omit to use the same
   * resolver production uses (`getCrmSupabaseAdmin()` when env is
   * configured, else null + skip).
   */
  persistenceImpl?: SupabaseClient | null;
  /**
   * SSE event sink. The route handler serializes each emission to the
   * stream controller. Synchronous so back-pressure is the controller's
   * problem, not the runner's.
   */
  onEvent: (e: RunnerEvent) => void;
  /**
   * Forwarded to `streamChat()` so the same advisor selection + request
   * headers (e.g. `x-llm-provider`, `x-llm-model-chat`) apply.
   */
  streamOptions?: StreamChatOptions;
  /** Wall-clock for the date footer; injected for tests. Defaults to `new Date()`. */
  now?: Date;
}

export interface ChatRunnerResult {
  /** Concatenated assistant text emitted during the turn. */
  finalText: string;
  /** Provider + model + pass that actually served this turn. */
  llmContext: LlmContext;
  /** Number of provider stream iterations (1 in v1 since no tools). */
  iterations: number;
  /** Tool calls the model issued across all iterations (always 0 in v1). */
  toolCallCount: number;
  /** Latest provider response id observed (OpenAI/xAI only). */
  providerResponseId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard cap on provider→tools→provider iterations within a single turn.
 * Env-tunable via `LLM_CHAT_MAX_TOOL_LOOPS` for emergency throttling.
 */
const DEFAULT_MAX_TOOL_LOOPS = 12;

function resolveMaxToolLoops(): number {
  const raw = process.env.LLM_CHAT_MAX_TOOL_LOOPS?.trim();
  if (!raw) return DEFAULT_MAX_TOOL_LOOPS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_TOOL_LOOPS;
  return Math.min(n, 50); // safety: never let an env typo set it absurdly high
}

// ─────────────────────────────────────────────────────────────────────────────
// Public runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run one advisor turn. Emits SSE events via `onEvent`, returns a summary on
 * success or throws on a stream-level failure (the route handler catches and
 * emits one final `error` event before closing the SSE stream).
 *
 * On normal completion, the runner emits a terminal `completed` event with
 * the provider response id (if any) — this is what the client uses to mark
 * the assistant message as final and unblock the input.
 */
export async function runChatOnce(
  opts: ChatRunnerOptions,
): Promise<ChatRunnerResult> {
  const {
    context,
    messages,
    preflight,
    previousResponseId,
    toolRegistry,
    supabaseImpl,
    persistenceImpl,
    onEvent,
    streamOptions,
    now,
  } = opts;

  const maxToolLoops = resolveMaxToolLoops();
  const tools = toolRegistry ? chatToolDefinitionsFromRegistry(toolRegistry) : [];
  // Resolve the Supabase client used for tool handlers ONCE per turn so
  // every tool call within the loop shares the same connection pool.
  // Lazy — we only build it if we actually have tools registered AND env
  // is configured. Otherwise stays null and any tool call short-circuits
  // to an error.
  const supabaseForTools: SupabaseClient | null =
    toolRegistry && toolRegistry.size > 0
      ? supabaseImpl ?? (missingCrmSupabaseEnv() ? null : getCrmSupabaseAdmin())
      : null;

  // 1. Frame the stream — the client transitions from `connecting` → `streaming`
  //    on `started`, so emit this before any other work to keep TTFB low.
  onEvent({
    event: "started",
    data: {
      requestId: context.requestId ?? null,
      conversationId: context.conversationId,
    },
  });

  // 1a. Conversation + user-message persistence (best-effort, in serial
  //     to make sure the user message lands AFTER the conversation row
  //     exists). Both calls are awaited but errors don't block the turn
  //     — chat keeps working even if persistence is unhealthy.
  //
  //     The user message is persisted UPFRONT (PR 22) so it survives
  //     stream death (network drop / browser crash / process kill). The
  //     ordinal it lands at is captured + threaded into appendTurn so
  //     the assistant message sequences correctly without re-inserting
  //     the user row.
  const persistenceClient = resolvePersistenceClient(persistenceImpl);
  let userMessageOrdinal: number | undefined;
  // We grab the last user message BEFORE the stream starts so we can
  // persist it now AND log it on completion.
  const lastUserMessage = findLastUserMessage([...messages]);
  if (persistenceClient) {
    const upsert = await upsertConversation(persistenceClient, {
      conversationId: context.conversationId,
      ownerEmail: context.advisorEmail,
      lastClientId: context.currentClientId ?? null,
      lastRoute: context.currentRoute ?? null,
    });
    if (!upsert.ok) {
      console.warn("[chat:persistence] upsertConversation failed:", upsert.error);
    } else if (lastUserMessage) {
      const userInsert = await appendUserMessage(persistenceClient, {
        conversationId: context.conversationId,
        userText: lastUserMessage,
      });
      if (!userInsert.ok) {
        console.warn("[chat:persistence] appendUserMessage failed:", userInsert.error);
      } else {
        userMessageOrdinal = userInsert.ordinal;
      }
    }
  }

  // 2. Preflight — v1 has nothing async to do (the route handler pre-fetches),
  //    but we still emit the boundary events so the client UI can render
  //    "thinking…" → "preparing…" transitions and PR 2 just slots Supabase
  //    fetches in here without changing the wire protocol.
  onEvent({ event: "preflight:start", data: {} });
  // Surface available tools to the system prompt — a behavioral nudge.
  // The full schemas already go through ChatStreamParams.tools; this
  // <tools> block in the prompt makes sure the model knows the surface
  // is callable when deciding how to answer.
  const promptTools = toolRegistry
    ? Array.from(toolRegistry.values()).map((t) => ({
        name: t.name,
        description: t.description,
      }))
    : undefined;
  const systemPrompt = buildChatSystemPrompt({
    ...preflight,
    tools: promptTools,
    now,
  });
  onEvent({
    event: "preflight:complete",
    data: {
      hasClient: !!preflight.currentClient,
      pinnedNoteCount: preflight.pinnedNotes?.length ?? 0,
      activityCount: preflight.recentActivity?.length ?? 0,
      openTaskCount: preflight.openTasks?.length ?? 0,
      systemPromptChars: systemPrompt.length,
    },
  });

  // 3. Tool loop — single iteration in v1 (degenerates because tools=[]).
  const turnMessages: ChatMessage[] = [...messages];
  // lastUserMessage was already captured above for the early-persist
  // step. Reuse the same value so the adapter sees the exact text the
  // DB row contains.
  let iterations = 0;
  let toolCallCount = 0;
  let finalText = "";
  let providerResponseId: string | null = null;
  let llmContext: LlmContext | null = null;
  /**
   * Per-iteration record of tool calls + results. Persistence inserts one
   * `assistant`-role + one `tool`-role message per iteration that issued
   * tools, mirroring exactly what the live chat showed. Iterations
   * without tool calls don't contribute a row pair here.
   */
  const persistedIterations: Array<{
    toolCalls: ChatToolCall[];
    toolResults: ChatToolResult[];
  }> = [];

  while (iterations < maxToolLoops) {
    iterations += 1;
    const pendingToolCalls: ChatToolCall[] = [];
    let turnText = "";

    for await (const chunk of streamChat(
      {
        messages: turnMessages,
        tools,
        systemPrompt,
        sessionId: context.conversationId,
        userMessage: lastUserMessage,
        // Only forward the client's resume hint on the very first iteration —
        // subsequent loop turns chain off the adapter's internal cache, not
        // the original stale id.
        previousResponseId: iterations === 1 ? (previousResponseId ?? null) : null,
      },
      streamOptions,
    )) {
      handleChunk(chunk, {
        onEvent,
        onDelta: (text) => {
          turnText += text;
        },
        onToolCall: (call) => {
          pendingToolCalls.push(call);
          toolCallCount += 1;
        },
        onResponseId: (id) => {
          providerResponseId = id;
        },
        onContextSeen: (ctx) => {
          if (!llmContext) llmContext = ctx;
        },
      });
    }

    finalText += turnText;

    if (pendingToolCalls.length === 0) {
      // Model finished without asking for a tool — exit the loop.
      break;
    }

    // ── Tool execution ──────────────────────────────────────────────────────
    // Dispatch each pending call by name through the registry; collect
    // results into a ChatToolResult[] that we append as a tool-role
    // message so the next iteration's stream sees the outputs.
    const toolResults: ChatToolResult[] = [];

    // Build the per-turn context once; every handler in this iteration
    // gets the same object (so future handlers that want to cache lookups
    // across calls in the same turn can do so via WeakMap on ctx).
    //
    // The `request` field carries the chat-stream's original Request so
    // run_* tools can synthesize in-process invocations of existing API
    // route handlers with the advisor's auth (NextAuth cookies + Supabase
    // Bearer). When streamOptions.request is missing (tests), the tools
    // gracefully error.
    // Note: `emitPartial` is built per-call below (closes over `call.id`
    // so the runner can stamp the right callId on the SSE event).
    const baseToolCtx: Omit<ChatToolContext, "supabase" | "emitPartial"> = {
      advisorEmail: context.advisorEmail,
      conversationId: context.conversationId,
      currentClientId: context.currentClientId ?? null,
      request: streamOptions?.request ?? null,
      selection: streamOptions?.selection ?? null,
    };

    for (const call of pendingToolCalls) {
      const tool: ChatTool | undefined = toolRegistry?.get(call.name);
      const startedAt = performance.now();

      if (!tool) {
        const errMsg = toolRegistry
          ? `Tool '${call.name}' is not registered.`
          : `Tools are not configured for this chat. The model unexpectedly requested '${call.name}'.`;
        onEvent({
          event: "tool:error",
          data: {
            callId: call.id,
            name: call.name,
            error: errMsg,
          },
        });
        toolResults.push({ callId: call.id, error: errMsg });
        continue;
      }

      if (!supabaseForTools) {
        // Tool exists but Supabase isn't configured — degrade gracefully.
        const errMsg =
          "The database isn't reachable from this environment, so this tool can't run right now.";
        onEvent({
          event: "tool:error",
          data: { callId: call.id, name: call.name, error: errMsg },
        });
        toolResults.push({ callId: call.id, error: errMsg });
        continue;
      }

      try {
        // Per-call partial emitter — bridges the tool handler's
        // streaming output to the chat SSE wire. The runner stamps the
        // current callId + name so the client can route partials to
        // the right tool execution / message bubble. Handlers without
        // streaming output simply never call it.
        const emitPartial = (partial: { deltaText: string }) => {
          if (!partial?.deltaText) return;
          onEvent({
            event: "tool:result_partial",
            data: {
              callId: call.id,
              name: call.name,
              deltaText: partial.deltaText,
            },
          });
        };

        const handlerResult = await tool.handler(call.args, {
          ...baseToolCtx,
          supabase: supabaseForTools,
          emitPartial,
        });
        const durationMs = Math.round(performance.now() - startedAt);

        if (handlerResult.error !== undefined) {
          onEvent({
            event: "tool:error",
            data: {
              callId: call.id,
              name: call.name,
              error: handlerResult.error,
              durationMs,
            },
          });
          toolResults.push({ callId: call.id, error: handlerResult.error });
        } else {
          onEvent({
            event: "tool:result",
            data: {
              callId: call.id,
              name: call.name,
              result: handlerResult.result ?? null,
              durationMs,
            },
          });
          toolResults.push({ callId: call.id, result: handlerResult.result });
        }
      } catch (err) {
        // Handlers MUST NOT throw, but guard anyway — a single bad tool
        // shouldn't crash the whole turn. Emit the structured error and
        // continue the loop so the model gets a chance to recover.
        const errMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Math.round(performance.now() - startedAt);
        onEvent({
          event: "tool:error",
          data: {
            callId: call.id,
            name: call.name,
            error: `Tool '${call.name}' threw: ${errMsg}`,
            durationMs,
          },
        });
        toolResults.push({
          callId: call.id,
          error: `Tool '${call.name}' threw: ${errMsg}`,
        });
      }
    }

    // Snapshot the iteration for persistence — we keep BOTH the calls
    // and their corresponding results together so the sidebar replays
    // the same <ChatToolStack> grouping the live chat showed.
    persistedIterations.push({
      toolCalls: [...pendingToolCalls],
      toolResults: [...toolResults],
    });

    // Append the assistant turn (with its tool calls) AND the tool-role
    // message carrying the results back. The adapters know how to translate
    // this pair into the provider's native function_call / function_call_output
    // shape (see openai-chat.ts / gemini-chat.ts).
    turnMessages.push({
      role: "assistant",
      content: turnText,
      toolCalls: pendingToolCalls,
    });
    turnMessages.push({
      role: "tool",
      content: "",
      toolResults,
    });
    // Loop to the next iteration — model now sees its prior call + the result.
  }

  // 4. Persistence — write the user + assistant pair (and any intermediate
  //    tool-role messages) to the conversation log. Best-effort, fire-and-
  //    forget: if it fails the chat continues uninterrupted. The advisor's
  //    in-tab state is the source of truth until the next reload.
  //
  //    We start it BEFORE the `completed` event so the row is durable by
  //    the time the client unlocks the input and the advisor might
  //    refresh the page. The fire-and-forget shape means we don't block
  //    `completed` on the DB round-trip though.
  if (persistenceClient && lastUserMessage) {
    void appendTurn(persistenceClient, {
      conversationId: context.conversationId,
      ownerEmail: context.advisorEmail,
      userText: lastUserMessage,
      assistantText: finalText,
      iterations: persistedIterations,
      providerResponseId,
      // Snapshot via a local — TS narrows the closure-mutated `llmContext`
      // to `null` after the loop, so we widen it back here. The cast is
      // safe: the chunk handler assigned to it on every first stream chunk.
      provider: (llmContext as LlmContext | null)?.provider ?? null,
      model: (llmContext as LlmContext | null)?.model ?? null,
      lastRoute: context.currentRoute ?? null,
      lastClientId: context.currentClientId ?? null,
      // PR 22 — the user msg was persisted up-front via
      // `appendUserMessage`. Pass its ordinal so appendTurn skips
      // re-inserting it and sequences the assistant + tool-role rows
      // starting at userMessageOrdinal + 1.
      userMessageOrdinal,
    }).then((result) => {
      if (!result.ok) {
        console.warn("[chat:persistence] appendTurn failed:", result.error);
      }
    });
  }

  // 5. Terminal event — the client uses this to mark the assistant message
  //    as final, persist the user/assistant pair, and unblock the input.
  onEvent({
    event: "completed",
    data: {
      providerResponseId,
      iterations,
      toolCallCount,
      finalTextChars: finalText.length,
    },
  });

  // The `llmContext` is populated inside `handleChunk` from the first
  // streamChat invocation — we can't currently recover it from streamChat
  // (the facade doesn't expose it). For now we synthesize a minimal context
  // from what we know if no chunks emitted one (defensive — never null in
  // practice because adapters always emit at least one event).
  return {
    finalText,
    llmContext: llmContext ?? { provider: "openai", pass: "chat", model: "unknown" },
    iterations,
    toolCallCount,
    providerResponseId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal — chunk handling
// ─────────────────────────────────────────────────────────────────────────────

interface ChunkHandlers {
  onEvent: (e: RunnerEvent) => void;
  onDelta: (text: string) => void;
  onToolCall: (call: ChatToolCall) => void;
  onResponseId: (id: string) => void;
  onContextSeen: (ctx: LlmContext) => void;
}

function handleChunk(chunk: ChatStreamChunk, handlers: ChunkHandlers): void {
  switch (chunk.type) {
    case "delta": {
      handlers.onDelta(chunk.text);
      handlers.onEvent({
        event: "assistant:delta",
        data: { text: chunk.text },
      });
      return;
    }
    case "tool_call_done": {
      handlers.onToolCall(chunk.toolCall);
      handlers.onEvent({
        event: "tool:call",
        data: {
          callId: chunk.toolCall.id,
          name: chunk.toolCall.name,
          args: chunk.toolCall.args,
        },
      });
      return;
    }
    case "tool_call": {
      // `tool_call` (incremental) is reserved by the chunk union but no
      // adapter emits it today — adapters emit `tool_call_done` once the
      // call's arguments fully arrived. We ignore incremental chunks to
      // keep the wire protocol stable; if a future adapter wants per-arg
      // streaming, add a `tool:progress` mapping here.
      return;
    }
    case "response_id": {
      handlers.onResponseId(chunk.responseId);
      // Don't push to the wire — the `completed` event carries the final id.
      return;
    }
    case "model_switch": {
      // Reserved event — no v1 adapter emits this; we pass through for
      // forward-compat with tier-aware providers (§A.2).
      handlers.onEvent({
        event: "model:switch",
        data: { model: chunk.model },
      });
      return;
    }
    case "done": {
      // The runner emits its own terminal `completed` event after the loop
      // exits; the adapter's `done` is just an end-of-iteration marker.
      return;
    }
    case "error": {
      // Adapter-level error chunks become stream-level errors. We throw
      // here so the route handler catches and emits ONE `error` event,
      // rather than the runner emitting `error` plus `completed`.
      throw new ChatRunnerStreamError(chunk.error);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers + errors
// ─────────────────────────────────────────────────────────────────────────────

function findLastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

/**
 * Thrown by the runner when an adapter emits an `{type:"error"}` chunk.
 * The route handler catches this specifically, emits one final `error`
 * SSE event with `{message}`, and closes the stream cleanly. Other
 * unhandled throws bubble up as 500s before the SSE response starts.
 */
export class ChatRunnerStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatRunnerStreamError";
  }
}
