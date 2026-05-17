/**
 * Chat provider factory.
 *
 * Routes the runner's `ProviderChatAdapter` calls to the right provider
 * implementation based on the resolved `LlmProvider` from
 * `lib/llm/registry.ts:resolveProvider()`. Adapters are constructed lazily
 * on first use and cached per-provider for the lifetime of the Node process.
 *
 * ─── What this v1 INTENTIONALLY does NOT do ──────────────────────────────────
 *
 * The earlier design (docs/crm/60-chat-orchestrator.md §B.3) sketched a
 * `MultiProviderHandler` with two model tiers (standard + reasoning) and
 * an auto-upgrade on first tool call. **AdvisorPilot uses ONE model per
 * provider** — the advisor picks it via the Settings drawer (model-catalog
 * "chat" row) and the registry resolves it. There is no tier selection.
 *
 * So this factory has no `selectModel`, no `sessionHasUsedTools` tracking,
 * no `model_switch` chunk emission. It is intentionally just a dispatch
 * table: provider → cached adapter instance.
 *
 * The `model_switch` event type stays reserved in the `ChatStreamChunk`
 * union (lib/llm/chat/types.ts) and the SSE event vocabulary
 * (docs/crm/60-chat-orchestrator.md §A.2) so future tier-aware providers
 * can emit it without redeploying the client — but no v1 code path does.
 */

import type { LlmProvider } from "@/lib/llm";
import type { ProviderChatAdapter } from "./types";
import { OpenAIChatAdapter } from "./openai-chat";
import { GeminiChatAdapter } from "./gemini-chat";

// ─────────────────────────────────────────────────────────────────────────────
// Adapter cache
// ─────────────────────────────────────────────────────────────────────────────
//
// Adapters are stateful (each one holds per-session response-id maps,
// SDK client singletons, etc.) so we cache one per provider.
// `clearProviderAdapterCache()` exists for tests; production code never
// invokes it.

const cache = new Map<LlmProvider, ProviderChatAdapter>();

/**
 * Get (or lazily construct) the chat adapter for `provider`.
 *
 * Throws `LlmConfigError` from the underlying adapter if the provider's
 * API key is missing — caller (the chat-runner / route handler) should
 * surface that as a 500 with a clear "missing API key" message.
 */
export function getChatAdapter(provider: LlmProvider): ProviderChatAdapter {
  const cached = cache.get(provider);
  if (cached) return cached;

  const adapter = constructAdapter(provider);
  cache.set(provider, adapter);
  return adapter;
}

function constructAdapter(provider: LlmProvider): ProviderChatAdapter {
  switch (provider) {
    case "openai":
    case "grok":
      // One adapter class handles both — they share the OpenAI SDK with just
      // a baseURL swap; the class internally tracks which flavor it is.
      return new OpenAIChatAdapter(provider);
    case "gemini":
      return new GeminiChatAdapter();
    default: {
      // Exhaustiveness check — adding a new LlmProvider must touch this switch.
      const _exhaust: never = provider;
      void _exhaust;
      throw new Error(`getChatAdapter: unknown provider '${String(provider)}'`);
    }
  }
}

/** Test-only: drops the cache so tests with mocked env vars get fresh adapters. */
export function clearChatAdapterCache(): void {
  // Best-effort cleanup of per-session state before dropping the adapter.
  // Adapters' clearSession is keyed by sessionId; since the cache doesn't
  // track sessions, we just drop the adapter and let GC reclaim the maps.
  cache.clear();
}
