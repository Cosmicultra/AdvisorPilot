/**
 * OpenAI + xAI chat adapter (Responses API streaming).
 *
 * One adapter handles BOTH providers because xAI exposes a
 * Responses-API-compatible surface on `https://api.x.ai/v1` — only the base
 * URL and API key differ. We instantiate this adapter twice (once for each
 * provider) inside the factory.
 *
 * Design + state model: docs/crm/60-chat-orchestrator.md §A.4 + §B.2.
 *
 * ─── What this v1 ships ──────────────────────────────────────────────────────
 *
 *   - Streaming `responses.create({ stream: true })` with `store: true`
 *   - Server-side conversation state via `previous_response_id`
 *   - Tool-name colon sanitization (OpenAI rejects ':' in function names; xAI tolerates it)
 *   - Provider-switch safety: cached previousResponseId is discarded when the
 *     cached entry came from a DIFFERENT provider (e.g. advisor switched from
 *     OpenAI → xAI mid-conversation; the OpenAI response id is invalid on xAI)
 *   - Per-call timeout: 10 min OpenAI default; 60 min xAI (matches Control Tower)
 *   - Errors converted to `{ type: "error", error }` chunks (never throws to runner)
 *
 * ─── What this v1 INTENTIONALLY does NOT ship ────────────────────────────────
 *
 *   - Empty-stream retries (5-retry exponential backoff). Control Tower added
 *     this after seeing it in prod. We add it if AdvisorPilot sees the same.
 *   - Snapshot-error diagnostic re-POST for opaque xAI errors. Same reason.
 *   - grok-4.20 schema sanitization (we use grok-4.3 only; no grammar limits).
 *   - ADO / Composio tool filtering (those tools don't exist in AdvisorPilot).
 *   - Image / file inputs on tool calls (chat is text-only; one-shot path
 *     in lib/llm/providers/openai.ts handles attachments separately).
 */

import OpenAI from "openai";
import type { LlmProvider } from "@/lib/llm";
import { LlmConfigError } from "@/lib/llm";
import type {
  ChatStreamChunk,
  ChatStreamParams,
  ChatToolCall,
  ProviderChatAdapter,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Timeouts (per-call, not session-wide)
// ─────────────────────────────────────────────────────────────────────────────

/** OpenAI per-call request timeout (10 min). */
const OPENAI_REQUEST_TIMEOUT_MS = 600_000;

/**
 * xAI per-call timeout (60 min). xAI's reasoning surface can spend a long
 * time in thinking before emitting the first streamed token; xAI's docs
 * explicitly recommend longer timeouts for those flows.
 */
const XAI_REQUEST_TIMEOUT_MS = 3_600_000;

const PROVIDER_BASE_URL: Record<"openai" | "xai", string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal flavor — the `LlmProvider` union calls xAI `"grok"`, but inside
 * this adapter we use `"xai"` because that's what the SDK base URL maps to
 * (xAI's product is called Grok; their API surface is "xai"). The factory
 * translates `LlmProvider="grok"` → flavor `"xai"`.
 */
type OpenAiFlavor = "openai" | "xai";

export class OpenAIChatAdapter implements ProviderChatAdapter {
  readonly provider: LlmProvider;
  private readonly flavor: OpenAiFlavor;
  private readonly client: OpenAI;

  /** sessionId → previously-issued OpenAI response id (for stateful resume). */
  private sessionResponseIds = new Map<string, string>();
  /**
   * sessionId → provider that issued the cached response id. When this
   * doesn't match the active provider (advisor switched mid-conversation),
   * we discard the stored id rather than fail with a 400.
   */
  private sessionResponseProvider = new Map<string, OpenAiFlavor>();

  constructor(provider: LlmProvider) {
    if (provider !== "openai" && provider !== "grok") {
      throw new Error(
        `OpenAIChatAdapter only supports 'openai' and 'grok'; got '${provider}'`,
      );
    }
    this.provider = provider;
    this.flavor = provider === "grok" ? "xai" : "openai";

    const apiKey =
      this.flavor === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new LlmConfigError(
        `Missing ${this.flavor === "openai" ? "OPENAI_API_KEY" : "XAI_API_KEY"} for chat adapter.`,
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: PROVIDER_BASE_URL[this.flavor],
      timeout:
        this.flavor === "xai"
          ? XAI_REQUEST_TIMEOUT_MS
          : OPENAI_REQUEST_TIMEOUT_MS,
    });
  }

  clearSession(sessionId: string): void {
    this.sessionResponseIds.delete(sessionId);
    this.sessionResponseProvider.delete(sessionId);
  }

  /** Exposed for the chat-runner / future stateful-resume integration. */
  getSessionResponseId(sessionId: string): string | null {
    return this.sessionResponseIds.get(sessionId) ?? null;
  }

  async *streamResponse(
    params: ChatStreamParams,
  ): AsyncGenerator<ChatStreamChunk> {
    const {
      messages,
      tools,
      systemPrompt,
      sessionId,
      model,
      previousResponseId: clientPrevId,
    } = params;

    // ─── Resolve effective previous_response_id with provider-switch safety ──
    const cachedId = sessionId ? this.sessionResponseIds.get(sessionId) : null;
    const cachedFlavor = sessionId
      ? this.sessionResponseProvider.get(sessionId)
      : null;
    const candidateId = clientPrevId ?? cachedId ?? null;

    let effectivePrevId: string | null = null;
    if (candidateId) {
      // The cached id is only valid if it came from THIS provider.
      // Mid-conversation switches discard it (the new provider has no record of it).
      if (!cachedFlavor || cachedFlavor === this.flavor) {
        effectivePrevId = candidateId;
      } else {
        // Provider switched — drop stale state silently.
        if (sessionId) {
          this.sessionResponseIds.delete(sessionId);
          this.sessionResponseProvider.delete(sessionId);
        }
      }
    }

    // ─── Translate tool definitions to Responses API "function" shape ────────
    // OpenAI rejects ':' in function names (regex /^[a-zA-Z0-9_-]{1,64}$/);
    // xAI is permissive. We sanitize unconditionally and keep a reverse map
    // so we translate back when the model issues a tool call.
    const toolNameMap = new Map<string, string>(); // sanitized → original
    const formattedTools = tools.length
      ? tools.map((t) => {
          let name = t.name;
          if (this.flavor === "openai" && name.includes(":")) {
            const sanitized = name.replace(/:/g, "_");
            toolNameMap.set(sanitized, name);
            name = sanitized;
          }
          return {
            type: "function" as const,
            name,
            description: t.description,
            parameters: t.parameters,
          };
        })
      : undefined;

    // ─── Build the `input` array per Responses API semantics ─────────────────
    // STATEFUL: server has full history; we only send the new user turn + any
    // tool-result outputs from the current iteration.
    // NEW SESSION: we send the system prompt + every message in order.
    const input: Array<Record<string, unknown>> = [];
    if (effectivePrevId) {
      const lastUser = [...messages]
        .reverse()
        .find((m) => m.role === "user");
      if (lastUser) input.push({ role: "user", content: lastUser.content });
      for (const m of messages) {
        if (m.role !== "tool" || !m.toolResults) continue;
        for (const tr of m.toolResults) {
          input.push({
            type: "function_call_output",
            call_id: tr.callId,
            output: serializeToolOutput(tr.result, tr.error),
          });
        }
      }
    } else {
      if (systemPrompt) input.push({ role: "system", content: systemPrompt });
      for (const m of messages) {
        if (m.role === "system") continue; // already injected above
        if (m.role === "user") {
          input.push({ role: "user", content: m.content });
        } else if (m.role === "assistant") {
          if (m.content) input.push({ role: "assistant", content: m.content });
          if (m.toolCalls?.length) {
            for (const tc of m.toolCalls) {
              const wireName =
                this.flavor === "openai" && tc.name.includes(":")
                  ? tc.name.replace(/:/g, "_")
                  : tc.name;
              input.push({
                type: "function_call",
                call_id: tc.id,
                name: wireName,
                arguments:
                  typeof tc.args === "string"
                    ? tc.args
                    : JSON.stringify(tc.args),
              });
            }
          }
        } else if (m.role === "tool" && m.toolResults) {
          for (const tr of m.toolResults) {
            input.push({
              type: "function_call_output",
              call_id: tr.callId,
              output: serializeToolOutput(tr.result, tr.error),
            });
          }
        }
      }
    }

    // ─── Execute the streaming request ───────────────────────────────────────
    const requestParams = {
      model,
      input,
      tools: formattedTools,
      previous_response_id: effectivePrevId ?? undefined,
      // No reasoning knobs here — single-model selection per provider (no tiers).
      // Temperature 0.7 is the OpenAI Responses API default; explicit for clarity.
      temperature: 0.7,
      // Generous output budget; provider returns final assistant text + any tool calls.
      max_output_tokens: 8192,
      store: true,
    };

    let lastResponseId: string | null = null;
    let hasToolCalls = false;
    const currentToolCalls: Record<number, ToolCallAccumulator> = {};
    const emittedCallIds = new Set<string>();

    try {
      const stream = (await (
        this.client as unknown as {
          responses: {
            create: (
              p: typeof requestParams & { stream: true },
              o?: { timeout?: number },
            ) => Promise<AsyncIterable<ResponsesStreamEvent>>;
          };
        }
      ).responses.create({ ...requestParams, stream: true })) as AsyncIterable<ResponsesStreamEvent>;

      for await (const event of stream) {
        // xAI surfaces in-band SSE error events with structured payloads; rethrow.
        if ((event as { type?: string }).type === "error") {
          const e = event as { message?: string; code?: string };
          yield {
            type: "error",
            error: `${e.message ?? "Provider stream error"}${e.code ? ` (code=${e.code})` : ""}`,
          };
          return;
        }

        // Text deltas — the bulk of the stream.
        if (
          event.type === "response.output_text.delta" &&
          typeof event.delta === "string"
        ) {
          yield { type: "delta", text: event.delta };
          continue;
        }

        // Tool-call argument-accumulation deltas. We build per-output-index
        // accumulators and flush on the `done` event.
        if (event.type === "response.function_call_arguments.delta") {
          const idx = (event.output_index as number | undefined) ?? 0;
          if (!currentToolCalls[idx]) {
            currentToolCalls[idx] = {
              callId:
                (event.call_id as string | undefined) ??
                `call_${Date.now()}_${idx}`,
              name: (event.name as string | undefined) ?? "",
              arguments: "",
            };
          }
          if (event.name) currentToolCalls[idx].name = String(event.name);
          if (event.delta) currentToolCalls[idx].arguments += String(event.delta);
          continue;
        }

        if (event.type === "response.function_call_arguments.done") {
          const idx = (event.output_index as number | undefined) ?? 0;
          const acc = currentToolCalls[idx];
          if (acc?.name && !emittedCallIds.has(acc.callId)) {
            emittedCallIds.add(acc.callId);
            hasToolCalls = true;
            yield {
              type: "tool_call_done",
              toolCall: toEmittedToolCall(acc, toolNameMap),
            };
          }
          delete currentToolCalls[idx];
          continue;
        }

        // Response completed — capture response id and any tool calls that
        // arrived in the final payload without prior delta events.
        if (event.type === "response.completed") {
          lastResponseId =
            ((event as { response?: { id?: string } }).response?.id as
              | string
              | undefined) ?? null;
          const output = (
            event as { response?: { output?: Array<Record<string, unknown>> } }
          ).response?.output;
          if (Array.isArray(output)) {
            for (const item of output) {
              if (
                item.type === "function_call" &&
                typeof item.call_id === "string" &&
                !emittedCallIds.has(item.call_id)
              ) {
                emittedCallIds.add(item.call_id);
                hasToolCalls = true;
                let parsedArgs: Record<string, unknown> = {};
                try {
                  const raw = item.arguments;
                  if (typeof raw === "string" && raw.trim()) {
                    parsedArgs = JSON.parse(raw) as Record<string, unknown>;
                  }
                } catch {
                  // Keep empty object; downstream tool executor will error
                  // gracefully if it needs an arg that's missing.
                }
                const sanitizedName = String(item.name ?? "");
                const originalName =
                  toolNameMap.get(sanitizedName) ?? sanitizedName;
                yield {
                  type: "tool_call_done",
                  toolCall: {
                    id: item.call_id,
                    name: originalName,
                    args: parsedArgs,
                  },
                };
              }
            }
          }
          continue;
        }
      }

      // Persist the response id so the next turn can resume statefully.
      if (lastResponseId && sessionId) {
        this.sessionResponseIds.set(sessionId, lastResponseId);
        this.sessionResponseProvider.set(sessionId, this.flavor);
        yield { type: "response_id", responseId: lastResponseId };
      }

      yield { type: "done" };
    } catch (err) {
      // Suppress unused-variable warning on `hasToolCalls`; future iteration
      // logic (graceful wind-down) will read this. Keeping it explicit.
      void hasToolCalls;

      const e = err as Error & { status?: number };
      const detail = e.status ? ` (HTTP ${e.status})` : "";
      yield {
        type: "error",
        error: `${this.flavor === "xai" ? "xAI" : "OpenAI"} stream failed${detail}: ${e.message ?? "Unknown error"}`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCallAccumulator {
  callId: string;
  name: string;
  arguments: string;
}

/**
 * Subset of OpenAI Responses-API streaming event shapes we consume.
 *
 * Typed `unknown`-friendly because the SDK's event types are huge unions and
 * we only care about three event kinds — typing the full union would couple
 * us to a specific SDK minor. This stays loose; the runtime type check is
 * the `event.type ===` switch above.
 */
interface ResponsesStreamEvent {
  type: string;
  delta?: string;
  call_id?: string;
  name?: string;
  output_index?: number;
  [k: string]: unknown;
}

function toEmittedToolCall(
  acc: ToolCallAccumulator,
  nameMap: Map<string, string>,
): ChatToolCall {
  let parsedArgs: Record<string, unknown> = {};
  try {
    if (acc.arguments.trim()) {
      parsedArgs = JSON.parse(acc.arguments) as Record<string, unknown>;
    }
  } catch {
    // Keep empty; tool executor returns a structured error the model can recover from.
  }
  const originalName = nameMap.get(acc.name) ?? acc.name;
  return { id: acc.callId, name: originalName, args: parsedArgs };
}

/**
 * Convert a tool result + optional error into the string the Responses API
 * expects for `function_call_output`. Empty results are replaced with a
 * structured success placeholder so the model doesn't see literal `null`.
 */
function serializeToolOutput(result: unknown, error: string | undefined): string {
  if (error) {
    return JSON.stringify({ success: false, error });
  }
  let output =
    typeof result === "string" ? result : JSON.stringify(result ?? null);
  if (!output || output === "{}" || output === "[]" || output === "null") {
    output = JSON.stringify({ success: true, message: "Tool executed successfully" });
  }
  return output;
}
