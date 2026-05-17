import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmConfigError } from "@/lib/llm";
import { clearChatAdapterCache, getChatAdapter } from "./provider-factory";
import { OpenAIChatAdapter } from "./openai-chat";
import { GeminiChatAdapter } from "./gemini-chat";

/**
 * Structural tests for the chat provider factory.
 *
 * These tests don't make network calls — they verify:
 *   1. Factory dispatches to the right concrete adapter for each provider
 *   2. Same provider returns the same cached instance across calls
 *   3. clearChatAdapterCache produces a fresh instance
 *   4. Each adapter validates its API-key env var at construction (throws LlmConfigError)
 *   5. The OpenAI/xAI adapter exposes the correct `provider` property
 *      for each `LlmProvider` it accepts (the factory passes through;
 *      the runner reads `provider` to decide things like response-id caching)
 *
 * Streaming smoke tests (5-token round-trip per provider) require live API
 * keys; those run separately under `npm run test:integration` (out of scope
 * for v1 of this PR).
 */

// Stash env vars so each test can manipulate them in isolation.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  clearChatAdapterCache();
  // Start each test with all keys present so construction succeeds; tests
  // that exercise the missing-key branch unset the relevant var explicitly.
  process.env.OPENAI_API_KEY = "sk-test-openai";
  process.env.XAI_API_KEY = "xai-test";
  process.env.GEMINI_API_KEY = "gemini-test";
});

afterEach(() => {
  // Restore the original env so we don't leak test fixtures into other suites.
  process.env = { ...ORIGINAL_ENV };
  clearChatAdapterCache();
});

describe("getChatAdapter dispatch", () => {
  it("returns an OpenAIChatAdapter for provider='openai' with provider tag 'openai'", () => {
    const adapter = getChatAdapter("openai");
    expect(adapter).toBeInstanceOf(OpenAIChatAdapter);
    expect(adapter.provider).toBe("openai");
  });

  it("returns an OpenAIChatAdapter for provider='grok' with provider tag 'grok'", () => {
    // Same class, different internal flavor — the LlmProvider tag stays 'grok'
    // so downstream code (registry, capability matrix) doesn't have to translate.
    const adapter = getChatAdapter("grok");
    expect(adapter).toBeInstanceOf(OpenAIChatAdapter);
    expect(adapter.provider).toBe("grok");
  });

  it("returns a GeminiChatAdapter for provider='gemini'", () => {
    const adapter = getChatAdapter("gemini");
    expect(adapter).toBeInstanceOf(GeminiChatAdapter);
    expect(adapter.provider).toBe("gemini");
  });

  it("returns the SAME instance on repeated calls for the same provider (cached)", () => {
    const a = getChatAdapter("openai");
    const b = getChatAdapter("openai");
    expect(a).toBe(b);
  });

  it("returns DIFFERENT instances for OpenAI vs Grok (separate per-flavor caches)", () => {
    // Both go through OpenAIChatAdapter, but they need independent SDK clients
    // (different baseURL + API key) and independent per-session state maps.
    const openai = getChatAdapter("openai");
    const grok = getChatAdapter("grok");
    expect(openai).not.toBe(grok);
    expect(openai.provider).toBe("openai");
    expect(grok.provider).toBe("grok");
  });

  it("clearChatAdapterCache produces a fresh instance on next get", () => {
    const before = getChatAdapter("openai");
    clearChatAdapterCache();
    const after = getChatAdapter("openai");
    expect(after).not.toBe(before);
  });
});

describe("env-var validation at construction", () => {
  it("throws LlmConfigError when OPENAI_API_KEY is missing", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => getChatAdapter("openai")).toThrow(LlmConfigError);
    expect(() => getChatAdapter("openai")).toThrow(/OPENAI_API_KEY/);
  });

  it("throws LlmConfigError when XAI_API_KEY is missing", () => {
    delete process.env.XAI_API_KEY;
    expect(() => getChatAdapter("grok")).toThrow(LlmConfigError);
    expect(() => getChatAdapter("grok")).toThrow(/XAI_API_KEY/);
  });

  it("throws LlmConfigError when GEMINI_API_KEY is missing", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => getChatAdapter("gemini")).toThrow(LlmConfigError);
    expect(() => getChatAdapter("gemini")).toThrow(/GEMINI_API_KEY/);
  });

  it("OpenAI adapter does NOT require XAI_API_KEY (independence check)", () => {
    delete process.env.XAI_API_KEY;
    expect(() => getChatAdapter("openai")).not.toThrow();
  });

  it("Gemini adapter does NOT require OPENAI_API_KEY (independence check)", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => getChatAdapter("gemini")).not.toThrow();
  });
});

describe("clearSession lifecycle", () => {
  it("calling clearSession on an adapter is a no-op when no state exists", () => {
    const adapter = getChatAdapter("openai");
    expect(() => adapter.clearSession("never-seen-id")).not.toThrow();
  });

  it("OpenAI adapter returns null from getSessionResponseId for an unknown session", () => {
    const adapter = getChatAdapter("openai") as OpenAIChatAdapter;
    expect(adapter.getSessionResponseId("nope")).toBeNull();
  });
});
