/**
 * SSE Route Handler for the chat orchestrator.
 *
 *   POST /api/chat/stream
 *
 * Body:
 *   {
 *     conversationId: string,             // stable per-conversation id
 *     messages: ChatMessage[],            // full history including the current user turn
 *     clientContext?: {
 *       currentClientId?: string | null,  // null when no client in focus
 *       currentRoute?: string | null,     // e.g. "/app/crm/c_a1b2/overview"
 *     },
 *     previousResponseId?: string | null, // OpenAI/xAI Responses API resume hint
 *     requestId?: string,                 // opaque id mirrored in `started` event
 *   }
 *
 * Response: `text/event-stream` per docs/crm/60-chat-orchestrator.md §A.2.
 *
 * ─── What this route does ────────────────────────────────────────────────────
 *
 *   1. Authenticate via `resolveAdvisorIdentity`. 401 short-circuit if no identity.
 *   2. Parse + validate the body. 400 on shape errors (BEFORE opening the stream).
 *   3. Load advisor selection (`resolveAdvisorLlmSelection`) so the chat picks
 *      the advisor's chosen provider + model — same precedence the rest of the
 *      app uses.
 *   4. Open the SSE response. The runner emits events; this handler serializes
 *      each one onto the stream.
 *   5. Start a 15s heartbeat (`: heartbeat\n\n`) so client-side watchdogs +
 *      proxies don't time out the connection during long model thinks.
 *   6. On any error AFTER the stream opens, emit one `error` SSE event and
 *      close the stream cleanly — never throw post-headers (the browser would
 *      see a torn connection).
 *   7. Audit-log the turn on completion (success OR failure path).
 *
 * ─── Why we DON'T preflight Supabase here in v1 ──────────────────────────────
 *
 * The runner accepts pre-fetched context (advisor / client / notes / activity /
 * tasks) so PR 2 can fetch them in parallel with auth + selection lookup.
 * For PR 1 the route ships with `advisor` + `currentView` only — the runner
 * builds a minimal but coherent system prompt. PR 2 adds `lib/llm/chat/preflight.ts`
 * and this route gains four more `Promise.all` entries; nothing else changes.
 */

import {
  resolveAdvisorLlmSelection,
  type ChatMessage,
} from "@/lib/llm";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import {
  runChatOnce,
  ChatRunnerStreamError,
  type RunnerEvent,
} from "@/lib/llm/chat/chat-runner";
import { fetchChatPreflight } from "@/lib/llm/chat/preflight";
import { CHAT_TOOL_REGISTRY } from "@/lib/llm/chat/tools";

// Streaming + Supabase admin client require Node runtime, not edge.
export const runtime = "nodejs";
// Force dynamic — never cache; every request opens a fresh stream.
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 15_000;
const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // Disable proxy buffering — without this, nginx and some CDNs accumulate
  // the body and ship it as one big payload, defeating streaming entirely.
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export async function POST(req: Request): Promise<Response> {
  // ─── 1. Auth ──────────────────────────────────────────────────────────────
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) {
    return jsonError("Sign in to use the chat assistant.", 401);
  }

  // ─── 2. Parse + validate body ─────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const parsed = parseChatRequest(body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  // ─── 3. Load advisor selection (provider + model overrides) ───────────────
  const selection = await resolveAdvisorLlmSelection(identity.email);

  // ─── 4. Build the SSE stream ──────────────────────────────────────────────
  const encoder = new TextEncoder();
  const startedAt = performance.now();

  // Track lightweight outcome info so the `finally` block can audit-log
  // even when an exception unwinds mid-stream.
  let finalText = "";
  let providerResponseId: string | null = null;
  let iterations = 0;
  let toolCallCount = 0;
  let outcomeStatus: "ok" | "error" = "ok";
  let outcomeMessage: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      const writeEvent = (e: RunnerEvent) => {
        if (closed) return;
        const payload = `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      // Heartbeat comment line — bumps the SSE parser's `lastEventAt` without
      // dispatching an event. Matches what `lib/chat/sse-parser.ts` expects.
      const writeHeartbeat = () => {
        if (closed) return;
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      };

      heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

      // Tie the stream lifetime to the request — when the browser aborts (tab
      // close, navigation, hook teardown), `req.signal` fires `abort` and we
      // shut down the heartbeat + close the controller cleanly.
      const onAbort = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // Controller may already be closed/errored; safe to ignore.
        }
      };
      req.signal.addEventListener("abort", onAbort);

      try {
        // Fetch context from Supabase BEFORE we start the model stream.
        // Soft-fails — Supabase outages degrade the prompt rather than
        // breaking the chat. Adds ~50-200ms latency before the first
        // assistant:delta arrives; the `started` + `preflight:start`
        // events have already shipped so the UI shows "Thinking…" during it.
        const preflight = await fetchChatPreflight({
          advisorEmail: identity.email,
          currentClientId: parsed.value.clientContext?.currentClientId ?? null,
          currentRoute: parsed.value.clientContext?.currentRoute ?? null,
          surface: parsed.value.clientContext?.surface ?? null,
          tab: parsed.value.clientContext?.tab ?? null,
          timezone: parsed.value.clientContext?.timezone ?? null,
        });

        const result = await runChatOnce({
          context: {
            conversationId: parsed.value.conversationId,
            advisorEmail: identity.email,
            requestId: parsed.value.requestId,
            currentClientId: parsed.value.clientContext?.currentClientId ?? null,
            currentRoute: parsed.value.clientContext?.currentRoute ?? null,
          },
          messages: parsed.value.messages,
          previousResponseId: parsed.value.previousResponseId ?? null,
          toolRegistry: CHAT_TOOL_REGISTRY,
          preflight,
          streamOptions: { request: req, selection },
          onEvent: writeEvent,
        });
        finalText = result.finalText;
        providerResponseId = result.providerResponseId;
        iterations = result.iterations;
        toolCallCount = result.toolCallCount;
      } catch (err) {
        outcomeStatus = "error";
        // `ChatRunnerStreamError` = adapter emitted `{type:"error"}`.
        // Other errors = misconfig / panic. Both become a single `error` SSE
        // event so the client sees a structured failure rather than a TCP RST.
        outcomeMessage =
          err instanceof ChatRunnerStreamError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        try {
          writeEvent({ event: "error", data: { message: outcomeMessage } });
        } catch {
          // Stream may already be torn down — ignore.
        }
        // Log to server console for ops; the client sees the structured event.
        console.error("[chat/stream] runner failed:", err);
      } finally {
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // Controller may already be closed/errored; safe to ignore.
        }

        // Audit log — best-effort; never blocks the response close.
        const durationMs = Math.round(performance.now() - startedAt);
        void writeAuditEvent({
          ownerEmail: identity.email,
          ownerUserId: identity.userId,
          actorEmail: identity.email,
          action: "chat.turn",
          entityType: "chat_conversation",
          entityId: parsed.value.conversationId,
          metadata: {
            requestId: parsed.value.requestId ?? null,
            status: outcomeStatus,
            durationMs,
            assistantChars: finalText.length,
            iterations,
            toolCallCount,
            providerResponseId,
            errorMessage: outcomeMessage,
            historyMessages: parsed.value.messages.length,
            clientInFocus: !!parsed.value.clientContext?.currentClientId,
          },
        });
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// ─────────────────────────────────────────────────────────────────────────────
// Request validation
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedChatRequest {
  conversationId: string;
  requestId?: string;
  messages: ChatMessage[];
  previousResponseId?: string | null;
  clientContext?: {
    currentClientId?: string | null;
    currentRoute?: string | null;
    surface?: string | null;
    tab?: string | null;
    timezone?: string | null;
  };
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseChatRequest(raw: unknown): ParseResult<ParsedChatRequest> {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const r = raw as Record<string, unknown>;

  const conversationId =
    typeof r.conversationId === "string" ? r.conversationId.trim() : "";
  if (!conversationId) {
    return { ok: false, error: "`conversationId` is required." };
  }

  const messagesRaw = Array.isArray(r.messages) ? r.messages : null;
  if (!messagesRaw || messagesRaw.length === 0) {
    return { ok: false, error: "`messages` must be a non-empty array." };
  }

  const messages: ChatMessage[] = [];
  for (let i = 0; i < messagesRaw.length; i += 1) {
    const m = messagesRaw[i];
    if (!m || typeof m !== "object") {
      return { ok: false, error: `messages[${i}] is not an object.` };
    }
    const role = (m as Record<string, unknown>).role;
    const content = (m as Record<string, unknown>).content;
    if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
      return { ok: false, error: `messages[${i}].role must be user|assistant|system|tool.` };
    }
    if (typeof content !== "string") {
      return { ok: false, error: `messages[${i}].content must be a string.` };
    }
    messages.push({ role, content });
  }

  // The most recent message must be a user turn — otherwise there's nothing
  // for the model to respond to.
  if (messages[messages.length - 1].role !== "user") {
    return {
      ok: false,
      error: "The last message must have role 'user'.",
    };
  }

  const previousResponseId =
    typeof r.previousResponseId === "string"
      ? r.previousResponseId.trim() || null
      : null;

  const requestIdRaw = r.requestId;
  const requestId =
    typeof requestIdRaw === "string" && requestIdRaw.trim()
      ? requestIdRaw.trim()
      : undefined;

  let clientContext: ParsedChatRequest["clientContext"];
  const cc = r.clientContext;
  if (cc && typeof cc === "object" && !Array.isArray(cc)) {
    const c = cc as Record<string, unknown>;
    clientContext = {
      currentClientId:
        typeof c.currentClientId === "string"
          ? c.currentClientId.trim() || null
          : null,
      currentRoute:
        typeof c.currentRoute === "string" ? c.currentRoute.trim() || null : null,
      surface: typeof c.surface === "string" ? c.surface.trim() || null : null,
      tab: typeof c.tab === "string" ? c.tab.trim() || null : null,
      timezone:
        typeof c.timezone === "string" ? c.timezone.trim() || null : null,
    };
  }

  return {
    ok: true,
    value: {
      conversationId,
      requestId,
      messages,
      previousResponseId,
      clientContext,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
