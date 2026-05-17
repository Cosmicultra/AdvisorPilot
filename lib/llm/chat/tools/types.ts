/**
 * Chat-orchestrator tool contracts.
 *
 * Three shapes:
 *
 *   - `ChatTool`         — registry entry: name + description + JSON-Schema params + handler
 *   - `ChatToolContext`  — what every handler receives: advisor identity + session + Supabase
 *   - `ChatToolHandlerResult` — what every handler returns: `result` OR `error` (never both)
 *
 * Distinct from `ChatToolDefinition` in `lib/llm/chat/types.ts` — that's the
 * SHAPE we hand to the model (no handler reference). The runner derives the
 * definitions array from the registry; it never passes the handler to the
 * model.
 *
 * Design rationale: docs/crm/70-orchestrator-tools.md §2 + §3 + the
 * `ChatTool` placeholder reserved in 60-§B.21.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdvisorLlmSelection } from "../../types";
import type { ChatToolDefinition } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Tool result + handler signatures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a tool handler returns. `result` and `error` are mutually exclusive —
 * the runner converts this into a `ChatToolResult` (see lib/llm/chat/types.ts)
 * and threads it back to the model as a tool-role message on the next
 * iteration of the tool loop.
 *
 * `result` MUST be JSON-serializable. Tools that need to return large blobs
 * (e.g. a 50 KB intake JSONB) should consider returning a summary + a
 * `_link` field the model can follow with another tool call rather than
 * dumping the whole thing into the response.
 */
export interface ChatToolHandlerResult {
  /** Set on success — passed through to the model as `result`. */
  result?: unknown;
  /** Set on failure — passed through to the model as `error`. */
  error?: string;
}

/**
 * Everything a tool handler receives. The runner builds this once per
 * advisor turn and passes the same object to every tool call in that turn
 * (so handlers can cache lookups across calls if useful — though most don't).
 */
export interface ChatToolContext {
  /** Lower-cased advisor email — viewer for every visibility RPC. */
  advisorEmail: string;
  /** Stable per-conversation id (also the adapter's sessionId). */
  conversationId: string;
  /** Currently focused client id from the request; null if no client in scope. */
  currentClientId: string | null;
  /** Service-role Supabase client. Use with the *_visible_to RPCs — RLS is bypassed by design. */
  supabase: SupabaseClient;
  /**
   * The original chat-stream Request. Carried through so `run_*` tools can
   * synthesize in-process invocations of existing API route handlers with
   * the advisor's original auth headers (NextAuth cookies + Supabase Bearer).
   *
   * Null in test environments that don't wire a request; the `run_*` tools
   * gracefully error out when this is missing rather than crashing.
   */
  request: Request | null;
  /**
   * Advisor's resolved LLM selection (provider + per-pass model overrides).
   *
   * Threaded through so tools that themselves invoke the LLM (e.g.
   * `generate_report_content`) can pass the SAME selection to their
   * internal `streamChat()` call rather than re-resolving from the
   * database on every tool invocation. Null when the runner couldn't
   * resolve a selection (test environments, or advisors with no
   * profile row).
   */
  selection: AdvisorLlmSelection | null;
  /**
   * Optional partial-result emitter for long-running tools.
   *
   * Tool handlers that produce content INCREMENTALLY (most notably
   * `generate_report_content`, which streams the report markdown
   * from a nested LLM call) can call `emitPartial({ deltaText })`
   * on every chunk. The chat-runner translates each call into a
   * `tool:result_partial` SSE event so the chat UI can render the
   * content live instead of waiting for the tool's terminal result.
   *
   * Optional — handlers without streaming semantics (every read/write
   * tool) simply don't call it. The runner provides a no-op shim when
   * partials aren't relevant.
   *
   * v1 carries only `deltaText` (additive markdown). Future
   * structured-partial shapes (e.g. {chartProgress}) can extend the
   * payload without breaking existing handlers.
   */
  emitPartial: (partial: { deltaText: string }) => void;
}

/**
 * One tool entry in the registry. The registry is a `Map<name, ChatTool>` so
 * the runner can dispatch by name in O(1). Adding a new tool = pushing a new
 * entry into `CHAT_TOOL_REGISTRY` in `lib/llm/chat/tools/index.ts`.
 *
 * Important: `name` MUST match what the model emits in `tool_call_done`
 * chunks. Provider adapters sanitize `:` → `_` on the wire (OpenAI rejects
 * colons in function names) and translate back when the model invokes the
 * tool — so use the canonical name with colons here if you want a namespace
 * (e.g. `query_crm`, NOT `query_crm:list`).
 */
export interface ChatTool {
  /** Canonical name shown to the model. No spaces; colons OK (adapters sanitize). */
  name: string;
  /**
   * Description the model reads when deciding whether to invoke this tool.
   * Write it for the model — say WHAT it does, WHEN to use it, and CALL
   * OUT any safety constraints (visibility, side effects). One paragraph
   * is plenty; longer descriptions just consume input tokens.
   */
  description: string;
  /** JSON-Schema-shaped parameters — matches `ChatToolDefinition.parameters`. */
  parameters: ChatToolDefinition["parameters"];
  /**
   * Handler invoked when the model calls this tool. NEVER throws — return
   * an `error` string instead. The runner wraps unhandled throws in a
   * generic "Tool '<name>' failed" error to keep the loop stable.
   */
  handler: (
    args: Record<string, unknown>,
    ctx: ChatToolContext,
  ) => Promise<ChatToolHandlerResult>;
}

/**
 * Tool registry — `Map<name, ChatTool>`. Used by the runner for dispatch and
 * by `chatToolDefinitionsFromRegistry()` to derive the JSON-Schema array we
 * hand to the model each turn.
 *
 * Map (not plain object) so iteration is insertion-ordered and `.size` /
 * `.get` / `.has` are first-class.
 */
export type ChatToolRegistry = Map<string, ChatTool>;
