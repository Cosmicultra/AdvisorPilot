"use client";

/**
 * React hook for the chat orchestrator widget.
 *
 * Thin shell over three pure modules:
 *   - `chat-reducer.ts`   — state mutations, fully unit-tested
 *   - `chat-state-machine.ts` — valid transition gates
 *   - `orchestrator-client.ts` — SSE stream + typed errors
 *
 * Side effects this hook owns:
 *   1. AbortController per turn — aborts on Stop, error, unmount.
 *   2. setInterval watchdog — checks SSE inactivity every 5 s (§B.12).
 *   3. SSE event → action routing — single switch in `routeEvent()`.
 *
 * Out-of-scope for v1 (deferred to PR 3):
 *   - `useVisibilityResumeCheck` (tab-backgrounded resume logic)
 *   - Conversation history persistence (loads / saves to Supabase)
 *   - Cross-tab BroadcastChannel coordination
 *
 * Design + rationale: docs/crm/60-chat-orchestrator.md §B.13.
 */

import { useCallback, useEffect, useReducer, useRef } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { ChatMessage } from "./chat-message-types";
import { ChatStreamError } from "./chat-message-types";
import {
  chatReducer,
  initialChatState,
  type ChatAction,
  type ChatHookState,
} from "./chat-reducer";
import {
  canAbortInState,
  canSendInState,
  isInputLockedInState,
  isStreamingState,
} from "./chat-state-machine";
import type {
  ChatStreamClientContext,
  ChatStreamWireMessage,
} from "./orchestrator-client";
import { openChatStream } from "./orchestrator-client";
import {
  createSseParserState,
  type SseEvent,
  type SseParserState,
} from "./sse-parser";

// ─────────────────────────────────────────────────────────────────────────────
// Watchdog tunables — match the server's 15s heartbeat plus headroom.
// Mobile carrier proxies (T-Mobile especially) routinely kill idle HTTPS
// connections at ~45s. A 30s fail cap fails-fast with 15s of recovery time.
// ─────────────────────────────────────────────────────────────────────────────

const WATCHDOG_INTERVAL_MS = 5_000;
const HEARTBEAT_WARN_MS = 20_000;
const HEARTBEAT_FAIL_MS = 30_000;
/** History turns we ship to the server — caps prompt size on long sessions. */
const HISTORY_TURNS_CAP = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface UseOrchestratorChatOptions {
  /** Pulled from the auth context — used purely for the placeholder id prefix and (future) memory keys. */
  advisorEmail: string;
  /**
   * Default client / route context applied to every `send()` call. The
   * caller (typically `GlobalChatLauncher`) reads this from `useChatLocation`
   * and passes it in; `send()` accepts a per-call override too.
   */
  defaultContext?: ChatStreamClientContext;
}

export interface UseOrchestratorChatReturn extends Pick<ChatHookState, "messages" | "state" | "error" | "errorReason" | "conversationId" | "conversationTitle" | "providerResponseId" | "requestId"> {
  isStreaming: boolean;
  canSend: boolean;
  canAbort: boolean;
  inputLocked: boolean;
  send: (text: string, ctx?: ChatStreamClientContext) => Promise<void>;
  abort: () => void;
  retry: () => void;
  clear: () => void;
  resume: (conversationId: string, providerResponseId: string | null) => void;
  /**
   * Hard-load a persisted conversation: GETs /api/chat/conversations/[id],
   * adopts its id + provider response id, and replaces the message history
   * with the server's record. Used by the history sidebar.
   *
   * Returns a discriminated result so the caller can surface inline errors
   * (e.g. "Conversation not found." after the advisor deleted it in
   * another tab and clicked a stale sidebar row).
   */
  openConversation: (
    conversationId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Soft-resume CTA payload (PR 22). Set when openConversation loaded
   * a conversation whose previous stream died mid-flight; the widget
   * renders a "Continue this chat?" prompt. Cleared by sending a new
   * message OR calling `dismissResume()`.
   */
  pendingResume: { lastUserMessage: string } | null;
  /** Accept the resume CTA — re-send the last user message via the live stream. */
  continueResume: () => void;
  /** Dismiss the resume CTA without sending. */
  dismissResume: () => void;
  /**
   * Append a completed voice turn (user or assistant) to the message
   * list. Used by the voice integration inside <ChatWidget /> to mirror
   * Gemini Live transcripts into the same chat history the text
   * orchestrator writes to.
   *
   * Caller is responsible for:
   *   - a unique id (e.g. `voice_u_<ts>` / `voice_a_<ts>`)
   *   - timestamp (epoch ms)
   *   - role ("user" or "assistant")
   *   - text (the spoken content, transcribed)
   *   - optional `toolExecutions` (used by voice tool-call rendering)
   *
   * Does NOT trigger the orchestrator. Does NOT touch the chat state
   * machine. Pure list-append.
   */
  appendVoiceTurn: (message: ChatMessage) => void;
  /**
   * Flip a voice ToolExecution from pending → completed (or → error)
   * with the handler's return value. Wraps the existing TOOL_RESULT /
   * TOOL_ERROR reducer actions so voice tool cards behave identically
   * to text chat tool cards once they're in the message list.
   *
   * The corresponding tool execution must already exist on a message
   * with the given `messageId` (typically appended via
   * `appendVoiceTurn` with a `toolExecutions: [{status: 'pending'}]`
   * payload immediately before the tool fires).
   */
  updateVoiceToolResult: (
    messageId: string,
    callId: string,
    result: unknown,
    error?: string,
  ) => void;
}

export function useOrchestratorChat(
  opts: UseOrchestratorChatOptions,
): UseOrchestratorChatReturn {
  const [hs, dispatch] = useReducer(chatReducer, undefined, initialChatState);

  const abortRef = useRef<AbortController | null>(null);
  // Parser state is per-turn — created in send(), inactive otherwise.
  const parserStateRef = useRef<SseParserState | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Last user message snapshot for `retry()`.
  const lastUserRef = useRef<{
    text: string;
    ctx?: ChatStreamClientContext;
  } | null>(null);

  // ─── Cleanup on unmount — never leak intervals or pending fetches ──────
  useEffect(() => {
    return () => {
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current);
        watchdogRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const send = useCallback(
    async (text: string, ctxOverride?: ChatStreamClientContext) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!canSendInState(hs.state)) return; // ignore double-send

      const ts = Date.now();
      const userId = `u_${ts}_${Math.random().toString(36).slice(2, 7)}`;
      const assistantId = `a_${ts}_${Math.random().toString(36).slice(2, 7)}`;
      const ctx = { ...opts.defaultContext, ...ctxOverride };

      // Append the user's bubble immediately so the UI feels responsive
      // (TTFB on the server can be 200-800ms during preflight).
      dispatch({
        type: "USER_MESSAGE",
        message: { id: userId, role: "user", text: trimmed, ts },
      });
      dispatch({ type: "ASSISTANT_PLACEHOLDER", id: assistantId, ts });
      dispatch({ type: "STATE_TRANSITION", to: "preflight" });

      lastUserRef.current = { text: trimmed, ctx: ctxOverride };

      const ac = new AbortController();
      abortRef.current = ac;
      const parserState = createSseParserState();
      parserStateRef.current = parserState;

      // ─── Watchdog tick — see §B.12. Compares now vs. parser's lastEventAt.
      // Promotes streaming → connection_slow at 20s, then fails the stream
      // at 30s by aborting the fetch (which triggers `stream_aborted`).
      let warned = false;
      watchdogRef.current = setInterval(() => {
        if (!parserStateRef.current) return;
        const idle = performance.now() - parserStateRef.current.lastEventAt;
        if (idle > HEARTBEAT_FAIL_MS) {
          // Hard timeout — abort and let the catch block route to error.
          // We transition to "reconnecting" first so the UI can show a
          // distinct banner; the catch block then transitions to "error".
          ac.abort();
          dispatch({ type: "STATE_TRANSITION", to: "reconnecting" });
        } else if (idle > HEARTBEAT_WARN_MS && !warned) {
          warned = true;
          dispatch({ type: "STATE_TRANSITION", to: "connection_slow" });
        } else if (idle <= HEARTBEAT_WARN_MS && warned) {
          // Recovered — fall back to streaming.
          warned = false;
          dispatch({ type: "STATE_TRANSITION", to: "streaming" });
        }
      }, WATCHDOG_INTERVAL_MS);

      // Build the wire history. Drop UI-only fields and keep the last N turns
      // to bound prompt size. Tool messages are server-side concerns; the
      // UI doesn't track them in `hs.messages`, so we only emit user + assistant.
      const allWireMessages: ChatStreamWireMessage[] = [
        ...hs.messages.map<ChatStreamWireMessage>((m) => ({
          role: m.role,
          content: m.text,
        })),
        { role: "user", content: trimmed },
      ];
      const wireMessages = allWireMessages.slice(-HISTORY_TURNS_CAP);

      try {
        await openChatStream({
          conversationId: hs.conversationId,
          messages: wireMessages,
          previousResponseId: hs.providerResponseId,
          clientContext: ctx,
          signal: ac.signal,
          onEvent: (ev) => routeEvent(ev, assistantId, dispatch),
          onHeartbeat: () => {
            // parser already bumped lastEventAt; this is a hook point for
            // future telemetry (e.g. heartbeat-count metric).
          },
        });
        // Clean return — the `completed` event already fired ASSISTANT_DONE.
      } catch (err) {
        const ce = err as ChatStreamError;
        const isAbort = ce.reason === "stream_aborted";
        const isInvariant = ce.reason === "stream_invariant";
        const finalStatus = isAbort
          ? "aborted"
          : isInvariant
            ? "incomplete"
            : "error";
        dispatch({
          type: "ASSISTANT_DONE",
          id: assistantId,
          finalStatus,
        });
        if (ce.requestId) {
          dispatch({ type: "REQUEST_ID", id: ce.requestId });
        }
        if (isAbort) {
          // User-initiated stop — back to idle, no banner.
          dispatch({ type: "STATE_TRANSITION", to: "idle" });
        } else {
          dispatch({
            type: "ERROR",
            message: friendlyError(ce),
            reason: ce.reason ?? "unknown",
          });
        }
      } finally {
        stopWatchdog();
        if (abortRef.current === ac) {
          abortRef.current = null;
        }
        parserStateRef.current = null;
      }
    },
    [hs.state, hs.messages, hs.conversationId, hs.providerResponseId, opts.defaultContext, stopWatchdog],
  );

  const abort = useCallback(() => {
    if (!canAbortInState(hs.state)) return;
    dispatch({ type: "STATE_TRANSITION", to: "aborting" });
    abortRef.current?.abort();
  }, [hs.state]);

  const retry = useCallback(() => {
    const last = lastUserRef.current;
    if (!last) return;
    void send(last.text, last.ctx);
  }, [send]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    stopWatchdog();
    dispatch({ type: "CLEAR" });
  }, [stopWatchdog]);

  const resume = useCallback(
    (conversationId: string, providerResponseId: string | null) => {
      abortRef.current?.abort();
      stopWatchdog();
      dispatch({
        type: "RESUME",
        conversationId,
        providerResponseId,
      });
    },
    [stopWatchdog],
  );

  const openConversation = useCallback(
    async (
      conversationId: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      abortRef.current?.abort();
      stopWatchdog();
      try {
        const res = await advisorFetch(
          `/api/chat/conversations/${conversationId}`,
          { cache: "no-store" },
        );
        if (res.status === 404) {
          return { ok: false, error: "Conversation not found." };
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return {
            ok: false,
            error: typeof body?.error === "string" ? body.error : `Failed (${res.status})`,
          };
        }
        const body = (await res.json()) as { conversation?: PersistedConversation };
        if (!body.conversation) {
          return { ok: false, error: "Malformed response." };
        }
        // PR 22 — soft-resume detection. When the loaded conversation
        // ends with a user message that has no following assistant
        // (the prior stream died mid-flight, e.g. network drop), set
        // pendingResume so the widget can render a "Continue this chat?"
        // CTA. The advisor can dismiss (DISMISS_RESUME) or accept
        // (calls send() with the last user text).
        const incomplete = isConversationIncomplete(body.conversation.messages);
        let pendingResume: { lastUserMessage: string } | null = null;
        if (incomplete) {
          // Find the last user message text to seed the CTA + retry.
          for (let i = body.conversation.messages.length - 1; i >= 0; i -= 1) {
            const r = body.conversation.messages[i];
            if (r.role === "user") {
              pendingResume = { lastUserMessage: r.content };
              break;
            }
          }
        }
        dispatch({
          type: "LOAD_CONVERSATION",
          conversationId: body.conversation.id,
          providerResponseId: body.conversation.lastProviderResponseId ?? null,
          messages: persistedToUiMessages(body.conversation.messages),
          pendingResume,
          title: body.conversation.displayTitle ?? body.conversation.title ?? null,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to load conversation.",
        };
      }
    },
    [stopWatchdog],
  );

  const continueResume = useCallback(() => {
    if (!hs.pendingResume) return;
    // Clear the CTA + re-issue the saved user message via the normal
    // send path. The reducer's USER_MESSAGE handler ALSO clears
    // pendingResume defensively, so we don't dispatch DISMISS_RESUME here
    // (would be redundant).
    void send(hs.pendingResume.lastUserMessage);
  }, [hs.pendingResume, send]);

  const dismissResume = useCallback(() => {
    dispatch({ type: "DISMISS_RESUME" });
  }, []);

  // Voice-driven turns flow in via a separate reducer action so they
  // don't interact with the streaming state machine. The chat hook
  // stays "idle" while voice is on; this method simply slots a
  // finished transcript into the message list.
  const appendVoiceTurn = useCallback((message: ChatMessage) => {
    dispatch({ type: "APPEND_VOICE_TURN", message });
  }, []);

  // Update a voice tool's status after it resolves. Re-uses the
  // existing TOOL_RESULT / TOOL_ERROR actions — same reducer paths
  // text-chat tools take, which means the existing <ChatToolStack>
  // renderer handles voice tool cards without any branching.
  const updateVoiceToolResult = useCallback(
    (messageId: string, callId: string, result: unknown, error?: string) => {
      if (error) {
        dispatch({ type: "TOOL_ERROR", messageId, callId, error });
      } else {
        dispatch({ type: "TOOL_RESULT", messageId, callId, result });
      }
    },
    [],
  );

  return {
    messages: hs.messages,
    state: hs.state,
    error: hs.error,
    errorReason: hs.errorReason,
    conversationId: hs.conversationId,
    conversationTitle: hs.conversationTitle,
    providerResponseId: hs.providerResponseId,
    requestId: hs.requestId,
    isStreaming: isStreamingState(hs.state),
    canSend: canSendInState(hs.state),
    canAbort: canAbortInState(hs.state),
    inputLocked: isInputLockedInState(hs.state),
    send,
    abort,
    retry,
    clear,
    resume,
    openConversation,
    pendingResume: hs.pendingResume,
    continueResume,
    dismissResume,
    appendVoiceTurn,
    updateVoiceToolResult,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted-message → UI message mapping (used by openConversation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape returned by GET /api/chat/conversations/[id] — kept inline (not
 * re-exported from persistence.ts) so this hook doesn't pull a server-
 * only module into the client bundle.
 */
interface PersistedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface PersistedToolResult {
  callId: string;
  result?: unknown;
  error?: string;
}

interface PersistedMessage {
  id: string;
  conversationId: string;
  ordinal: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls: PersistedToolCall[] | null;
  toolResults: PersistedToolResult[] | null;
  providerResponseId: string | null;
  createdAt: string;
}

interface PersistedConversation {
  id: string;
  /** Raw title (may be null when auto-title hasn't landed yet). */
  title?: string | null;
  /** Server's resolved display title ("Untitled chat" fallback). */
  displayTitle?: string | null;
  lastProviderResponseId: string | null;
  messages: PersistedMessage[];
}

/**
 * Translate the server-side `ChatMessageRecord[]` into the UI's
 * `ChatMessage[]`. Key transformations:
 *
 *   - Tool-role messages don't become bubbles — their `tool_results`
 *     attach to the PRIOR assistant message's `toolExecutions[]` so the
 *     sidebar replay matches the live chat's grouping.
 *   - User + assistant messages each map to one bubble. Empty assistant
 *     content (turn ended after a tool call with no follow-up text) is
 *     preserved so the user can see the tool result alone.
 *   - `system` messages are skipped — they're emitted server-side only
 *     for context; not shown to the advisor.
 *   - Each bubble is marked `status: "complete"` for assistant messages
 *     EXCEPT when the conversation ends with a user message that has no
 *     following assistant — in that case the conversation was
 *     interrupted (stream died mid-flight) and we want the soft-resume
 *     CTA to surface (see `isConversationIncomplete`).
 */
export function isConversationIncomplete(records: PersistedMessage[]): boolean {
  // Walk back from the end skipping `system` rows. The LAST
  // user-or-assistant message determines the state.
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r.role === "system") continue;
    return r.role === "user";
  }
  return false;
}

function persistedToUiMessages(records: PersistedMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const rec of records) {
    if (rec.role === "system") continue;
    if (rec.role === "tool") {
      // Attach tool_results to the prior assistant message's
      // toolExecutions[] by callId. Skip silently if no prior assistant
      // bubble exists (shouldn't happen for well-formed persisted data).
      const last = out[out.length - 1];
      if (!last || last.role !== "assistant") continue;
      const results = rec.toolResults ?? [];
      const updatedExecs = (last.toolExecutions ?? []).map((exec) => {
        const match = results.find((r) => r.callId === exec.callId);
        if (!match) return exec;
        if (match.error !== undefined) {
          return {
            ...exec,
            status: "error" as const,
            error: match.error,
            completedAt: Date.parse(rec.createdAt) || exec.startedAt,
          };
        }
        return {
          ...exec,
          status: "completed" as const,
          result: match.result,
          completedAt: Date.parse(rec.createdAt) || exec.startedAt,
        };
      });
      out[out.length - 1] = { ...last, toolExecutions: updatedExecs };
      continue;
    }
    const ts = Date.parse(rec.createdAt) || Date.now();
    const message: ChatMessage = {
      id: rec.id,
      role: rec.role,
      text: rec.content,
      ts,
      status: rec.role === "assistant" ? "complete" : undefined,
    };
    if (rec.role === "assistant" && rec.toolCalls && rec.toolCalls.length > 0) {
      message.toolExecutions = rec.toolCalls.map((call) => ({
        callId: call.id,
        name: call.name,
        args: call.args,
        status: "pending" as const,
        startedAt: ts,
      }));
    }
    out.push(message);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event routing — the ONLY place SSE event names become reducer actions.
// 25 lines. Critical detail: transition to `streaming` on the FIRST delta or
// tool:call, NOT on `preflight:complete` — keeps the "Thinking…" indicator
// up until the model actually produces something.
// ─────────────────────────────────────────────────────────────────────────────

function routeEvent(
  ev: SseEvent,
  assistantId: string,
  dispatch: React.Dispatch<ChatAction>,
): void {
  const data = (ev.data ?? {}) as Record<string, unknown>;

  switch (ev.event) {
    case "started": {
      const requestId = typeof data.requestId === "string" ? data.requestId : null;
      dispatch({ type: "REQUEST_ID", id: requestId });
      return;
    }
    case "preflight:start":
    case "preflight:complete": {
      // Already in `preflight` from send(); no action needed beyond visibility
      // to the UI via `state`. Future: capture preflight stats from
      // preflight:complete.data for an analytics ribbon.
      return;
    }
    case "assistant:delta": {
      const text = typeof data.text === "string" ? data.text : "";
      if (!text) return;
      // First-delta state transition — moves us out of preflight.
      dispatch({ type: "STATE_TRANSITION", to: "streaming" });
      dispatch({ type: "APPEND_DELTA", id: assistantId, text });
      return;
    }
    case "tool:call": {
      const callId = typeof data.callId === "string" ? data.callId : "";
      const name = typeof data.name === "string" ? data.name : "";
      if (!callId || !name) return;
      dispatch({ type: "STATE_TRANSITION", to: "streaming" });
      dispatch({
        type: "TOOL_CALL",
        messageId: assistantId,
        tool: {
          callId,
          name,
          args:
            data.args && typeof data.args === "object"
              ? (data.args as Record<string, unknown>)
              : {},
          status: "pending",
          startedAt: Date.now(),
        },
      });
      return;
    }
    case "tool:progress": {
      const callId = typeof data.callId === "string" ? data.callId : "";
      if (!callId) return;
      dispatch({
        type: "TOOL_PROGRESS",
        messageId: assistantId,
        callId,
        progress: {
          progress: typeof data.progress === "number" ? data.progress : 0,
          total: typeof data.total === "number" ? data.total : 0,
          message: typeof data.message === "string" ? data.message : "",
          phase: typeof data.phase === "string" ? data.phase : undefined,
        },
      });
      return;
    }
    case "tool:result_partial": {
      // Live partial-content delta from a streaming tool (e.g.
      // generate_report_content). Append to the tool execution's
      // `partialText` buffer so the chat UI can render the in-flight
      // markdown live inside the tool card.
      const callId = typeof data.callId === "string" ? data.callId : "";
      const deltaText = typeof data.deltaText === "string" ? data.deltaText : "";
      if (!callId || !deltaText) return;
      dispatch({
        type: "TOOL_PARTIAL",
        messageId: assistantId,
        callId,
        deltaText,
      });
      return;
    }
    case "tool:result": {
      const callId = typeof data.callId === "string" ? data.callId : "";
      if (!callId) return;
      dispatch({
        type: "TOOL_RESULT",
        messageId: assistantId,
        callId,
        result: data.result,
      });
      return;
    }
    case "tool:error": {
      const callId = typeof data.callId === "string" ? data.callId : "";
      const error = typeof data.error === "string" ? data.error : "Tool failed";
      if (!callId) return;
      dispatch({
        type: "TOOL_ERROR",
        messageId: assistantId,
        callId,
        error,
      });
      return;
    }
    case "model:switch": {
      const model = typeof data.model === "string" ? data.model : "";
      if (!model) return;
      dispatch({ type: "MODEL_SWITCH", model });
      return;
    }
    case "completed": {
      const providerResponseId =
        typeof data.providerResponseId === "string" ? data.providerResponseId : null;
      if (providerResponseId) {
        dispatch({ type: "PROVIDER_RESPONSE_ID", id: providerResponseId });
      }
      dispatch({
        type: "ASSISTANT_DONE",
        id: assistantId,
        finalStatus: "complete",
      });
      dispatch({ type: "STATE_TRANSITION", to: "idle" });
      return;
    }
    case "error": {
      const message = typeof data.message === "string" ? data.message : "Stream failed";
      // The catch block in send() handles the actual transition + UI; this
      // path just ensures the assistant placeholder gets marked errored if
      // we somehow miss the catch (defensive — never observed in practice).
      dispatch({
        type: "ASSISTANT_DONE",
        id: assistantId,
        finalStatus: "error",
      });
      dispatch({ type: "ERROR", message, reason: "server_emitted" });
      return;
    }
    // Reserved / unknown events — log in dev, ignore in production.
    default: {
      if (typeof console !== "undefined" && process?.env?.NODE_ENV !== "production") {
        console.debug(`[chat] ignoring unknown SSE event '${ev.event}'`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error → user-facing copy. Mirrors §B.19 failure-mode matrix.
// ─────────────────────────────────────────────────────────────────────────────

function friendlyError(err: ChatStreamError): string {
  switch (err.reason) {
    case "unauthorized":
      return "Your session expired. Please sign in again.";
    case "forbidden":
      return "You don't have access to this conversation.";
    case "rate_limited":
      return "Too many requests. Take a breath and try again in a moment.";
    case "bad_request":
      return err.message; // pass through the route's specific message
    case "server_error":
      return "Nova is having trouble. Try again in a moment.";
    case "no_body":
      return "The server returned an empty response. Try again.";
    case "buffer_overflow":
      return "The response was too large for the connection. Please retry.";
    case "stream_invariant":
      return "The connection ended before Nova finished. Tap Retry to continue.";
    case "network":
      return "Network issue — check your connection and try again.";
    case "stream_aborted":
      return "Cancelled.";
    default:
      return err.message || "Something went wrong.";
  }
}
