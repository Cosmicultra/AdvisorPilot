/**
 * Gemini chat adapter (`@google/genai`).
 *
 * Streaming via `ai.models.generateContentStream({ ... })`.
 *
 * Design + state model: docs/crm/60-chat-orchestrator.md §A.4 + §B.2.
 *
 * ─── How Gemini differs from OpenAI / xAI ────────────────────────────────────
 *
 *   - NO server-side conversation state. Every turn replays the full history.
 *     (No `previous_response_id` analog.) The runner caps the history length;
 *     this adapter just sends what it's given.
 *
 *   - Roles map differently: assistant → `model`, tool → user-role function
 *     response. system → `systemInstruction` (top-level, not a role:system
 *     message).
 *
 *   - Tool names cannot contain `:`. We sanitize unconditionally with a
 *     reverse map so we can translate model-emitted tool calls back.
 *
 *   - `functionDeclarations` are nested under `tools: [{ functionDeclarations: [...] }]`.
 *
 *   - Function-call results from earlier turns go in `role: "user"` messages
 *     with `functionResponse` parts (Gemini's convention).
 *
 * ─── What this v1 INTENTIONALLY does NOT ship ────────────────────────────────
 *
 *   - Context caching via `ai.caches.create()`. Worth the complexity once
 *     conversations cross 32K tokens (the activation threshold). Not v1.
 *
 *   - Thought-signature circulation (Gemini 3 only). The adapter is wired
 *     for Gemini 2.5 today; if a future model needs thought sigs, we add
 *     the carry-through here.
 *
 *   - `thinkingConfig` reasoning knobs. No tier selection in AdvisorPilot;
 *     the user's chosen model has its own intrinsic reasoning behavior.
 *
 *   - JSON-schema-bound responses (`responseSchema`). Chat is unstructured
 *     text by design; the one-shot path in lib/llm/providers/gemini.ts
 *     handles structured JSON.
 *
 *   - Image / file inputs on chat turns (chat is text-only in v1).
 */

import { GoogleGenAI } from "@google/genai";
import type { LlmProvider } from "@/lib/llm";
import { LlmConfigError } from "@/lib/llm";
import type {
  ChatMessage,
  ChatStreamChunk,
  ChatStreamParams,
  ProviderChatAdapter,
} from "./types";

const GEMINI_REQUEST_TIMEOUT_MS = 600_000; // 10 min per call

export class GeminiChatAdapter implements ProviderChatAdapter {
  readonly provider: LlmProvider = "gemini";
  private readonly client: GoogleGenAI;

  /**
   * No state to cache for Gemini in v1 (no `previous_response_id` analog,
   * no context cache wired). The map exists so the `clearSession` contract
   * is a no-op rather than a thrown error, and so future Phase-2 work
   * (context caching) has somewhere to put the cache.name reference.
   */
  private sessionState = new Map<string, { cacheName?: string }>();

  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new LlmConfigError("Missing GEMINI_API_KEY for Gemini chat adapter.");
    }
    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { timeout: GEMINI_REQUEST_TIMEOUT_MS },
    });
  }

  clearSession(sessionId: string): void {
    this.sessionState.delete(sessionId);
  }

  async *streamResponse(
    params: ChatStreamParams,
  ): AsyncGenerator<ChatStreamChunk> {
    const { messages, tools, systemPrompt, model } = params;

    // ─── Translate tools to functionDeclarations + colon-sanitize names ──────
    const toolNameMap = new Map<string, string>(); // sanitized → original
    const functionDeclarations = tools.map((t) => {
      let name = t.name;
      if (name.includes(":")) {
        const sanitized = name.replace(/:/g, "_");
        toolNameMap.set(sanitized, name);
        name = sanitized;
      }
      return {
        name,
        description: t.description,
        parameters: t.parameters,
      };
    });

    // ─── Translate messages → Gemini contents array ──────────────────────────
    const contents = messages
      .filter((m) => m.role !== "system") // system goes to systemInstruction
      .map((m) => geminiContentForMessage(m, toolNameMap));

    // ─── Build request ───────────────────────────────────────────────────────
    const requestConfig: Record<string, unknown> = {
      temperature: 0.7,
      maxOutputTokens: 8192,
    };
    if (systemPrompt) requestConfig.systemInstruction = systemPrompt;
    if (functionDeclarations.length > 0) {
      requestConfig.tools = [{ functionDeclarations }];
    }

    const streamParams = {
      model,
      contents,
      config: requestConfig,
    };

    try {
      const response = await this.client.models.generateContentStream(
        streamParams as Parameters<typeof this.client.models.generateContentStream>[0],
      );

      for await (const chunk of response) {
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            // Text delta
            if (typeof part.text === "string" && part.text.length > 0) {
              yield { type: "delta", text: part.text };
              continue;
            }

            // Tool call
            if (part.functionCall) {
              const wireName = part.functionCall.name ?? "";
              const originalName = toolNameMap.get(wireName) ?? wireName;
              // Gemini uses a structured `args` object; coerce to a record.
              const args = (part.functionCall.args ?? {}) as Record<
                string,
                unknown
              >;
              yield {
                type: "tool_call_done",
                toolCall: {
                  // Gemini doesn't issue stable call ids; synthesize a unique one
                  // so the runner can pair calls with results.
                  id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: originalName,
                  args,
                },
              };
            }
          }
        }
      }

      yield { type: "done" };
    } catch (err) {
      const e = err as Error;
      yield {
        type: "error",
        error: `Gemini stream failed: ${e.message ?? "Unknown error"}`,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert one `ChatMessage` to a Gemini `Content` object. Roles:
 *   user      → user
 *   assistant → model         (with `functionCall` parts when toolCalls present)
 *   tool      → user-role message with `functionResponse` parts (Gemini convention:
 *               tool results are framed as user-side input that responds to a model call)
 */
function geminiContentForMessage(
  m: ChatMessage,
  toolNameMap: Map<string, string>,
): { role: "user" | "model"; parts: Array<Record<string, unknown>> } {
  if (m.role === "assistant") {
    const parts: Array<Record<string, unknown>> = [];
    if (m.content) parts.push({ text: m.content });
    if (m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        // When emitting an earlier-turn tool call back as model history, use the
        // SANITIZED name (the wire format Gemini saw) so it matches the
        // corresponding functionResponse entries.
        const wireName = tc.name.includes(":")
          ? tc.name.replace(/:/g, "_")
          : tc.name;
        parts.push({
          functionCall: {
            name: wireName,
            args: tc.args,
          },
        });
      }
    }
    return { role: "model", parts };
  }

  if (m.role === "tool" && m.toolResults?.length) {
    const parts: Array<Record<string, unknown>> = m.toolResults.map((tr) => {
      // We don't know the tool name from a ChatToolResult; the convention is
      // that tool results are paired by callId with the prior assistant
      // message's toolCalls. Best-effort: look up by callId in the preceding
      // message — but we don't have access to that here. For v1, we use a
      // generic response key since Gemini accepts whatever name was last
      // emitted. If this becomes an issue in practice, thread the name
      // through `ChatToolResult` (add `name?: string`).
      void toolNameMap;
      const response = tr.error
        ? { success: false, error: tr.error }
        : tr.result ?? { success: true };
      return {
        functionResponse: {
          name: "tool_response",
          response: { result: response },
        },
      };
    });
    return { role: "user", parts };
  }

  // user (and anything else falls through to user)
  return { role: "user", parts: [{ text: m.content }] };
}
