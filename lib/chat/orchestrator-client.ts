/**
 * Client-side streaming wrapper for `POST /api/chat/stream`.
 *
 * Lives in the browser only. Takes care of:
 *
 *   - Authenticated POST via `advisorFetch` (NextAuth cookies + Supabase Bearer
 *     auto-refresh on 401 — same auth as every other AdvisorPilot client call).
 *   - HTTP status → typed `ChatStreamError` mapping (the hook switches on
 *     `.reason` for recovery UX).
 *   - Reading the SSE stream via `response.body.getReader()` + feeding the
 *     pure parser from `lib/chat/sse-parser.ts`.
 *   - Wire-protocol invariant tracking — throws `stream_invariant` when the
 *     stream ends without a terminal `completed` or `error` event.
 *
 * Intentionally minimal. No retries, no auto-reconnect, no state — those
 * policies live in `lib/chat/use-orchestrator-chat.ts` so they're testable
 * independently of the network code. The hook owns the AbortController; this
 * function just accepts the signal and propagates it to `fetch`.
 *
 * Design + rationale: docs/crm/60-chat-orchestrator.md §B.11 + §B.12.
 */

import { advisorFetch } from "@/lib/advisor-fetch";
import {
  createSseParserState,
  feedSseParser,
  SseBufferOverflowError,
  type SseEvent,
  type SseParserState,
} from "./sse-parser";
import { ChatStreamError } from "./chat-message-types";

// ─────────────────────────────────────────────────────────────────────────────
// Request types — matches `app/api/chat/stream/route.ts:parseChatRequest`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conversation history shape the route accepts. Mirrors `ChatMessage` from
 * `lib/llm/chat/types.ts` (the server-side wire shape) — NOT the UI's
 * `ChatMessage` (which has id / ts / status / etc.). The hook does the
 * translation from UI list → wire history before calling here.
 */
export interface ChatStreamWireMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface ChatStreamClientContext {
  /** Current page route, e.g. `/app/crm/c_a1b2/overview`. */
  currentRoute?: string | null;
  /** Currently focused client id, or null when none. */
  currentClientId?: string | null;
  /** Logical surface for the prompt's `<current_view>` block. */
  surface?: string | null;
  /** Optional sub-tab within the surface. */
  tab?: string | null;
  /** IANA timezone for the system-prompt date footer. */
  timezone?: string | null;
}

export interface OpenChatStreamOptions {
  /**
   * Full conversation history including the current user turn. The route
   * validates that the last message has `role: "user"` (otherwise there's
   * nothing for the model to respond to) and returns 400 before opening
   * the SSE stream.
   */
  messages: ChatStreamWireMessage[];
  /** Stable per-conversation id. The route uses this as the adapter sessionId. */
  conversationId: string;
  /** Optional opaque id mirrored back in the `started` SSE event. */
  requestId?: string;
  /** OpenAI/xAI Responses API resume hint. Null when starting fresh. */
  previousResponseId?: string | null;
  /** Page / client / surface context for the system prompt. */
  clientContext?: ChatStreamClientContext;
  /** REQUIRED — caller owns the AbortController. The hook aborts on Stop / unmount. */
  signal: AbortSignal;
  /** Called for every SSE event (deltas, tool events, terminal events). */
  onEvent: (e: SseEvent) => void;
  /**
   * Called when ANY event OR heartbeat arrives. Used by the hook's watchdog
   * to reset its inactivity timer. The SSE parser already bumps its own
   * `lastEventAt`, but the hook can't reach into the parser state from its
   * tick callback without coupling; this callback is the bridge.
   */
  onHeartbeat?: () => void;
  /**
   * Optional injection point — only the tests use this to swap in a stubbed
   * fetch implementation that doesn't go to the network. Production callers
   * omit it and the function uses `advisorFetch`.
   */
  fetchImpl?: typeof advisorFetch;
  /** Optional override of the endpoint path — tests only. */
  endpointPath?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open an SSE stream against the chat orchestrator and deliver each parsed
 * event via `onEvent`. Resolves cleanly when the server emits a terminal
 * event (`completed` or `error`); rejects with a `ChatStreamError` for
 * every failure mode listed in `ChatStreamErrorReason`.
 *
 * The function NEVER throws synchronously — even body-validation failures
 * (which the route returns as 400 JSON) go through the same typed error
 * path so the hook only ever has one try/catch shape to handle.
 */
export async function openChatStream(opts: OpenChatStreamOptions): Promise<void> {
  const fetcher = opts.fetchImpl ?? advisorFetch;
  const endpoint = opts.endpointPath ?? "/api/chat/stream";

  // ─── 1. POST the request, mapping transport failures to typed errors ────
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        conversationId: opts.conversationId,
        messages: opts.messages,
        requestId: opts.requestId,
        previousResponseId: opts.previousResponseId ?? null,
        clientContext: opts.clientContext,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    // Abort before the response headers arrived — the browser throws an
    // AbortError synchronously from the fetch promise.
    if ((err as Error).name === "AbortError") {
      throw new ChatStreamError("stream_aborted", "Cancelled by user");
    }
    throw new ChatStreamError(
      "network",
      (err as Error).message || "Network request failed",
    );
  }

  const requestId = response.headers.get("X-Request-Id") ?? undefined;

  // ─── 2. HTTP status → typed reason mapping ──────────────────────────────
  if (response.status === 401) {
    throw new ChatStreamError(
      "unauthorized",
      "Session expired — please sign in again.",
      requestId,
      401,
    );
  }
  if (response.status === 403) {
    throw new ChatStreamError(
      "forbidden",
      "You don't have access to this conversation.",
      requestId,
      403,
    );
  }
  if (response.status === 429) {
    throw new ChatStreamError(
      "rate_limited",
      "Too many requests — try again in a moment.",
      requestId,
      429,
    );
  }
  if (response.status === 400) {
    // 400 means the route's body validator rejected the payload. Surface the
    // server's error text so the hook can show it in the banner; without it
    // the user gets a generic "something went wrong" that's hard to debug.
    let detail = "Bad request";
    try {
      const j = (await response.json()) as { error?: unknown };
      if (typeof j.error === "string" && j.error.trim()) detail = j.error.trim();
    } catch {
      // ignore JSON parse failures
    }
    throw new ChatStreamError("bad_request", detail, requestId, 400);
  }
  if (response.status >= 500) {
    throw new ChatStreamError(
      "server_error",
      `Server error ${response.status}`,
      requestId,
      response.status,
    );
  }
  if (!response.ok) {
    throw new ChatStreamError(
      "server_error",
      `HTTP ${response.status}`,
      requestId,
      response.status,
    );
  }
  if (!response.body) {
    // Some browsers / fetch polyfills return `null` for response.body when
    // the response is empty — defensive against that.
    throw new ChatStreamError(
      "no_body",
      "Stream response had no body",
      requestId,
    );
  }

  // ─── 3. Read + parse the SSE stream ─────────────────────────────────────
  const reader = response.body.getReader();
  const parserState: SseParserState = createSseParserState();
  let sawTerminal = false;

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        // Differentiate "user clicked Stop / hook unmounted" from "network
        // dropped". The `signal.aborted` flag is the only reliable hint.
        if (opts.signal.aborted) {
          throw new ChatStreamError(
            "stream_aborted",
            "Cancelled by user",
            requestId,
          );
        }
        throw new ChatStreamError(
          "network",
          `Stream read failed: ${(err as Error).message}`,
          requestId,
        );
      }
      if (chunk.done) break;

      let events: SseEvent[];
      try {
        events = feedSseParser(parserState, chunk.value);
      } catch (err) {
        if (err instanceof SseBufferOverflowError) {
          throw new ChatStreamError(
            "buffer_overflow",
            err.message,
            requestId,
          );
        }
        // Unknown parser exception — rethrow as a network error so the hook
        // shows a generic recovery banner instead of crashing.
        throw new ChatStreamError(
          "network",
          `SSE parse failed: ${(err as Error).message}`,
          requestId,
        );
      }

      for (const ev of events) {
        // Bump the watchdog whenever ANY event or heartbeat lands. The parser
        // already updates its own `lastEventAt` on comment-only heartbeats,
        // but the hook's setInterval watchdog doesn't have parserState in
        // scope, so this callback is what tells it "we're still alive".
        opts.onHeartbeat?.();
        if (ev.event === "completed" || ev.event === "error") {
          sawTerminal = true;
        }
        opts.onEvent(ev);
      }
    }
  } finally {
    // Always release the lock — without this, the stream stays half-open
    // and the next `fetch` against the same endpoint can hang waiting on
    // the previous reader.
    try {
      reader.releaseLock();
    } catch {
      // Lock may already be released on abort; ignore.
    }
  }

  // ─── 4. Wire-protocol invariant ─────────────────────────────────────────
  // The route handler MUST emit either `completed` (success) or `error`
  // (failure) before closing the stream. If we hit EOF without one of
  // those, something killed the connection mid-flight (proxy, CDN, mobile
  // carrier) — the hook treats this as a recoverable error with a "Try
  // again" banner.
  if (!sawTerminal) {
    throw new ChatStreamError(
      "stream_invariant",
      "Stream ended without a completed or error event",
      requestId,
    );
  }
}
