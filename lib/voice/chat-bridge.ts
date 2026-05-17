/**
 * Voice ↔ Chat bridge.
 *
 * Connects the voice agent's `chat()` tool to the Nova text
 * orchestrator with a queue-and-nudge protocol:
 *
 *   1. Voice tool calls `bridge.enqueueChat(prompt)`.
 *   2. Bridge POSTs to /api/chat/stream with the prompt, reading
 *      the SSE response in the background. Voice tool returns
 *      immediately with `{ queued: true, acknowledgement, queueId }`
 *      so the voice channel keeps flowing — no awkward dead air
 *      while Nova thinks.
 *   3. When the orchestrator's `completed` event arrives, the bridge
 *      stages the full assistant message as a "result" tied to the
 *      queueId.
 *   4. Voice state changes flow through `bridge.notifyVoiceState()`.
 *      When the channel is IDLE (not speaking, not listening, not
 *      currently dispatching a tool call), the bridge drains its
 *      result queue by injecting nudge text via `session.sendText()`.
 *      The voice agent treats the injected text as if the advisor
 *      had said it, so it naturally produces an answer.
 *
 * "Free" definition:
 *   - Voice state ∈ {"listening"} means the channel is open and
 *     waiting for the advisor — safe to inject because the agent
 *     will respond to the inject as the next turn.
 *   - Any other state ("connecting" / "speaking" / "thinking" /
 *     "tool" / "expiring" / "idle" / "disconnected") means inject
 *     would either fail (no session) or step on an active turn.
 *
 * Nudge format:
 *   The bridge injects a single message that looks like advisor
 *   input. We prefix it so the agent knows it's a deferred answer
 *   to a prior question, not a fresh user turn:
 *
 *     "(System: the answer to my earlier question is ready —
 *      please read it aloud to me now. The answer is: <result>)"
 *
 *   Gemini Live treats text injection as user turn content. The
 *   system-prefix language is a prompt convention, not a special
 *   API channel — it just gives the agent the framing it needs
 *   to do the right thing.
 *
 * Persistence:
 *   The bridge intentionally does NOT persist anything itself —
 *   transcripts of the voice conversation (including queued chat
 *   results) flow through the chat reducer's `APPEND_VOICE_TURN`
 *   action, which uses the existing chat persistence layer. The
 *   bridge is a coordination layer only.
 */

import { advisorFetch } from "@/lib/advisor-fetch";
import type { VoiceSessionState } from "./types";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface QueuedResult {
  queueId: string;
  prompt: string;
  text: string;
}

interface PendingRequest {
  queueId: string;
  prompt: string;
  abort: AbortController;
}

interface BridgeOptions {
  /** Called to inject text into the live voice session. Returns false if not flushed. */
  inject: (text: string) => boolean;
  /**
   * Called EXACTLY ONCE per chat() request, after the orchestrator's
   * stream finishes with the final accumulated text.
   *
   * Previously this fired on every `assistant:delta` (intended for live
   * display) — but because the bridge gave each chat() a single
   * queueId and the chat-widget keyed messages by that queueId,
   * per-delta firing produced N React-list rows with the same key and
   * a stream of "Encountered two children with the same key" warnings.
   *
   * Live display of the in-progress orchestrator answer isn't useful
   * for voice anyway — the agent isn't going to read partial tokens
   * aloud. Single emit at the end is the right contract.
   */
  onChatComplete?: (queueId: string, text: string) => void;
  /** Called when a queued chat request fails (network drop, 5xx, etc.). */
  onError?: (queueId: string, error: Error) => void;
  /** Advisor email for the /api/chat/stream payload. */
  advisorEmail: string;
  /** Base default context for the orchestrator (route, client id, timezone). */
  defaultContext?: {
    pathname?: string | null;
    clientId?: string | null;
    timezone?: string | null;
  };
  /** Optional conversation id so the voice-driven chats persist into the same conversation as text. */
  conversationId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Bridge
// ─────────────────────────────────────────────────────────────────────

export class VoiceChatBridge {
  private results: QueuedResult[] = [];
  private pending = new Map<string, PendingRequest>();
  private voiceState: VoiceSessionState = "idle";
  private closed = false;
  private options: BridgeOptions;

  constructor(options: BridgeOptions) {
    this.options = options;
  }

  /**
   * Enqueue a voice-originated chat request. Returns the queueId
   * immediately so the voice tool can hand it back to the agent.
   * The actual SSE stream runs in the background.
   */
  enqueueChat(prompt: string): { queueId: string; acknowledgement: string } {
    if (this.closed) {
      throw new Error("VoiceChatBridge is closed — cannot enqueue new requests.");
    }
    const queueId = `vchat_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const abort = new AbortController();
    this.pending.set(queueId, { queueId, prompt, abort });

    // Pick a brief, varied acknowledgement so the voice agent doesn't
    // sound robotic when chaining multiple chats in a row. The model
    // is told (via tool description) to incorporate this in its
    // response so the advisor hears it immediately.
    const acknowledgement = pickAcknowledgement();

    // Fire-and-forget the actual stream. Errors are surfaced via
    // options.onError; no rethrow so the caller's return-immediately
    // semantics hold.
    void this.runRequest(queueId, prompt, abort.signal);

    return { queueId, acknowledgement };
  }

  /**
   * Voice session reports a state change. The bridge flushes its
   * result queue whenever the channel transitions into a "free" state
   * (the agent is listening and waiting).
   */
  notifyVoiceState(state: VoiceSessionState): void {
    this.voiceState = state;
    this.maybeFlush();
  }

  /**
   * Cancel everything in flight + reject anything queued. Called when
   * voice mode is turned off OR the widget unmounts.
   */
  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      try {
        pending.abort.abort();
      } catch {
        // ignore
      }
    }
    this.pending.clear();
    this.results = [];
  }

  // ───────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────

  private async runRequest(
    queueId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const res = await advisorFetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          context: {
            ...this.options.defaultContext,
            // The orchestrator branches behavior on the surface so it
            // can choose voice-friendly phrasing if it wants to. v3
            // doesn't act on this yet but the field is reserved.
            surface: "voice",
          },
          conversationId: this.options.conversationId ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Orchestrator request failed (${res.status}): ${text.slice(0, 200)}`,
        );
      }

      // Parse SSE inline. We only care about `assistant:delta` (to
      // accumulate text) and `completed` (to know we're done). All
      // other events (tool:*, model:switch, ...) are ignored — the
      // voice agent doesn't need to know about the orchestrator's
      // internal mechanics.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by blank lines (two newlines).
        // Process every complete message in the buffer; keep the
        // trailing partial for the next iteration.
        let sepIdx: number;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const parsed = parseSseEvent(raw);
          if (!parsed) continue;
          if (parsed.event === "assistant:delta") {
            // Accumulate deltas internally but DO NOT notify
            // listeners per-delta — see BridgeOptions.onChatComplete
            // for why (duplicate-key bug history).
            const delta =
              (parsed.data && typeof parsed.data.text === "string"
                ? parsed.data.text
                : "") ?? "";
            assistantText += delta;
          } else if (parsed.event === "completed") {
            // The terminal event — assistantText now holds the full
            // answer. Single emit to the listener, then stage for
            // nudge-flushing into the voice channel.
            this.options.onChatComplete?.(queueId, assistantText);
            this.stageResult({ queueId, prompt, text: assistantText });
            return;
          } else if (parsed.event === "error") {
            const message =
              (parsed.data && typeof parsed.data.message === "string"
                ? parsed.data.message
                : "Orchestrator returned an error.") ?? "";
            throw new Error(message);
          }
        }
      }

      // Stream ended without a `completed` event — treat as an error.
      throw new Error("Orchestrator stream ended unexpectedly (no completed event).");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onError?.(queueId, error);
    } finally {
      this.pending.delete(queueId);
    }
  }

  private stageResult(result: QueuedResult): void {
    if (this.closed) return;
    this.results.push(result);
    this.maybeFlush();
  }

  /**
   * Inject every queued result whose nudge can be safely delivered
   * given the current voice state. "listening" is the only state we
   * inject into — every other state implies an in-flight turn that
   * would be stepped on by an immediate inject.
   */
  private maybeFlush(): void {
    if (this.closed) return;
    if (this.results.length === 0) return;
    if (this.voiceState !== "listening") return;

    // Drain in arrival order. If inject() fails (WS not ready), put
    // the result back at the head and stop — we'll retry on the next
    // state change.
    const next = this.results.shift();
    if (!next) return;

    const nudgeText =
      `(System: my earlier request "${next.prompt}" is complete. ` +
      `Please read the following answer aloud to me as your next ` +
      `turn — concise, plain prose, no preamble. Answer: ${next.text})`;

    const ok = this.options.inject(nudgeText);
    if (!ok) {
      // Put it back; the next state change will retry.
      this.results.unshift(next);
      return;
    }

    // Recurse to drain multiple results back-to-back if voice stays
    // listening — the agent will queue them as multiple user turns
    // and answer each.
    this.maybeFlush();
  }
}

// ─────────────────────────────────────────────────────────────────────
// SSE parsing (local, minimal — we don't need the full sse-parser)
// ─────────────────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: Record<string, unknown> | null;
}

function parseSseEvent(raw: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) {
      event = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6));
    }
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join("\n");
  try {
    const data = JSON.parse(joined) as Record<string, unknown>;
    return { event, data };
  } catch {
    return { event, data: null };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Acknowledgement copy
// ─────────────────────────────────────────────────────────────────────

const ACK_PHRASES = [
  "Got it — looking into that, one second.",
  "Hang on, checking that for you.",
  "Let me pull that up — one moment.",
  "Sure, on it. I'll have an answer shortly.",
  "Working on it — back to you in a sec.",
];

function pickAcknowledgement(): string {
  const idx = Math.floor(Math.random() * ACK_PHRASES.length);
  return ACK_PHRASES[idx];
}
