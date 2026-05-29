import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveChatContext, streamChat } from "./stream-chat";
import { clearChatAdapterCache } from "./provider-factory";
import type {
  ChatStreamChunk,
  ChatStreamParams,
  ProviderChatAdapter,
} from "./types";
import type { LlmProvider } from "../types";

/**
 * Tests for the chat-streaming facade — the chat-path equivalent of
 * `lib/llm/index.ts:complete()`.
 *
 * Coverage:
 *   1. Resolution precedence matches the existing pattern
 *      (header > selection > env > hardcoded), via `resolveChatContext`.
 *   2. `streamChat` passes every chunk through unchanged.
 *   3. `streamChat` resolves the model PER REQUEST (advisor selection wins
 *      over env, etc.).
 *   4. `streamChat` forwards an adapter error chunk without throwing.
 *   5. `streamChat` rethrows + logs when the adapter constructor throws
 *      (e.g. missing API key).
 *
 * The factory cache is monkey-patched per test so we don't need real API
 * keys to exercise the facade. We DO call `clearChatAdapterCache()` in
 * teardown so we don't leak the mock into other suites.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Ensure resolveChatContext + provider-factory have API keys to work
  // with (the factory throws LlmConfigError without them). Tests that
  // need the missing-key branch unset explicitly.
  process.env.OPENAI_API_KEY = "sk-test-openai";
  process.env.XAI_API_KEY = "xai-test";
  process.env.GEMINI_API_KEY = "gemini-test";
  clearChatAdapterCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearChatAdapterCache();
});

describe("resolveChatContext", () => {
  it("uses the hardcoded default (gemini/gemini-2.5-flash) when no overrides are set", () => {
    delete process.env.ADVISORPILOT_DEFAULT_LLM_PROVIDER;
    delete process.env.LLM_GEMINI_CHAT_MODEL;
    const { ctx } = resolveChatContext();
    expect(ctx.provider).toBe("gemini");
    expect(ctx.model).toBe("gemini-2.5-flash");
    expect(ctx.pass).toBe("chat");
  });

  it("env override LLM_GEMINI_CHAT_MODEL beats the hardcoded default", () => {
    process.env.LLM_GEMINI_CHAT_MODEL = "gemini-3-flash-preview";
    const { ctx } = resolveChatContext();
    expect(ctx.model).toBe("gemini-3-flash-preview");
  });

  it("env override ADVISORPILOT_DEFAULT_LLM_PROVIDER switches the provider", () => {
    process.env.ADVISORPILOT_DEFAULT_LLM_PROVIDER = "gemini";
    const { ctx } = resolveChatContext();
    expect(ctx.provider).toBe("gemini");
    expect(ctx.model).toBe("gemini-2.5-flash"); // hardcoded gemini chat default
  });

  it("advisor selection beats env overrides", () => {
    process.env.LLM_OPENAI_CHAT_MODEL = "gpt-4o-mini-env";
    const { ctx } = resolveChatContext({
      selection: { provider: "grok", models: { chat: "grok-4.3-latest" } },
    });
    expect(ctx.provider).toBe("grok");
    expect(ctx.model).toBe("grok-4.3-latest");
  });

  it("request header beats advisor selection", () => {
    // x-llm-provider beats selection.provider; x-llm-model-chat beats selection.models.chat.
    const request = new Request("http://localhost/chat/stream", {
      headers: {
        "x-llm-provider": "gemini",
        "x-llm-model-chat": "gemini-2.5-pro",
      },
    });
    const { ctx } = resolveChatContext({
      request,
      selection: { provider: "grok", models: { chat: "grok-4.3" } },
    });
    expect(ctx.provider).toBe("gemini");
    expect(ctx.model).toBe("gemini-2.5-pro");
  });

  it("providerOverride beats everything (for testing/preview tooling)", () => {
    const request = new Request("http://localhost/x", {
      headers: { "x-llm-provider": "gemini" },
    });
    const { ctx } = resolveChatContext({
      request,
      providerOverride: "grok",
      selection: { provider: "openai" },
    });
    expect(ctx.provider).toBe("grok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// streamChat — passthrough behavior with a mocked adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a stub adapter that emits a fixed sequence of chunks. The mock
 * captures the ChatStreamParams it received so tests can assert on what
 * the facade forwarded.
 */
function stubAdapter(
  provider: LlmProvider,
  chunks: ChatStreamChunk[],
): ProviderChatAdapter & { lastParams: ChatStreamParams | null } {
  const stub = {
    provider,
    lastParams: null as ChatStreamParams | null,
    clearSession() {},
    async *streamResponse(params: ChatStreamParams) {
      stub.lastParams = params;
      for (const c of chunks) yield c;
    },
  };
  return stub;
}

describe("streamChat passthrough + resolution", () => {
  it("forwards every chunk in adapter order", async () => {
    const stub = stubAdapter("openai", [
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "response_id", responseId: "resp_123" },
      { type: "done" },
    ]);
    vi.spyOn(
      await import("./provider-factory"),
      "getChatAdapter",
    ).mockReturnValue(stub);

    const out: ChatStreamChunk[] = [];
    for await (const chunk of streamChat({
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
      systemPrompt: "be helpful",
      sessionId: "session-xyz",
      userMessage: "Hi",
    })) {
      out.push(chunk);
    }

    expect(out).toHaveLength(4);
    expect(out.map((c) => c.type)).toEqual([
      "delta",
      "delta",
      "response_id",
      "done",
    ]);
    expect((out[0] as { text: string }).text).toBe("Hel");
  });

  it("resolves model via selection and forwards it to the adapter", async () => {
    const stub = stubAdapter("grok", [{ type: "done" }]);
    vi.spyOn(
      await import("./provider-factory"),
      "getChatAdapter",
    ).mockReturnValue(stub);

    for await (const _ of streamChat(
      {
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
        systemPrompt: "",
        sessionId: "s",
        userMessage: "Hi",
      },
      {
        selection: { provider: "grok", models: { chat: "grok-4.3-latest" } },
      },
    )) {
      void _;
    }

    expect(stub.lastParams).not.toBeNull();
    expect(stub.lastParams!.model).toBe("grok-4.3-latest");
    expect(stub.lastParams!.sessionId).toBe("s");
    expect(stub.lastParams!.isReasoning).toBe(false); // no tier switching
  });

  it("forwards an adapter error chunk without throwing", async () => {
    // The adapter contract says errors arrive as `{type:"error"}` chunks,
    // not exceptions. The facade must pass that through and complete the
    // generator normally so callers can render an error event in the UI.
    const stub = stubAdapter("openai", [
      { type: "delta", text: "partial" },
      { type: "error", error: "rate limit" },
    ]);
    vi.spyOn(
      await import("./provider-factory"),
      "getChatAdapter",
    ).mockReturnValue(stub);

    const out: ChatStreamChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of streamChat({
          messages: [{ role: "user", content: "x" }],
          tools: [],
          systemPrompt: "",
          sessionId: "s",
          userMessage: "x",
        })) {
          out.push(chunk);
        }
      })(),
    ).resolves.toBeUndefined();
    expect(out.at(-1)).toEqual({ type: "error", error: "rate limit" });
  });

  it("rethrows when the adapter constructor throws (LlmConfigError → caller)", async () => {
    // Make `getChatAdapter` throw the same way it would when a provider's
    // API key is missing. The facade catches, logs, and re-throws so the
    // route handler can convert to a 500.
    vi.spyOn(
      await import("./provider-factory"),
      "getChatAdapter",
    ).mockImplementation(() => {
      throw new Error("Missing GEMINI_API_KEY for Gemini chat adapter.");
    });

    await expect(
      (async () => {
        for await (const _ of streamChat(
          {
            messages: [{ role: "user", content: "x" }],
            tools: [],
            systemPrompt: "",
            sessionId: "s",
            userMessage: "x",
          },
          { providerOverride: "gemini" },
        )) {
          void _;
        }
      })(),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
