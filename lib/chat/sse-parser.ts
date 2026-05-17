/**
 * Pure SSE (Server-Sent Events) wire-protocol parser.
 *
 * Used by the streaming client (lib/chat/orchestrator-client.ts) to turn
 * raw `ReadableStream<Uint8Array>` chunks from `fetch(...).body` into a
 * sequence of typed events. Extracted as a pure function (no React, no
 * fetch, no provider SDKs) so it's unit-testable in isolation.
 *
 * Wire-protocol spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
 * Design rationale + hardening rules: docs/crm/60-chat-orchestrator.md §B.9 + §B.10.
 *
 * ─── Hardening rules ─────────────────────────────────────────────────────────
 *
 * Production SSE pipelines die in the same six ways. Each rule below
 * prevents one. The cost is a handful of bytes of state per stream; the
 * payoff is that a single corrupt chunk doesn't kill the whole chat.
 *
 *   1. `TextDecoder({ fatal: false })`     → tolerate one corrupt byte
 *   2. CRLF normalization                  → tolerate Node's `\r\n` keepalives
 *   3. MAX_BUFFER_BYTES (1 MB) hard cap    → bail before OOM on a runaway stream
 *   4. MAX_EVENT_BYTES (512 KB) drop+log   → one pathological event ≠ kill conversation
 *   5. Permissive field parsing            → tolerate `data:foo` (no space)
 *                                            tolerate unknown event names
 *                                            tolerate non-JSON `data`
 *   6. Comment-line heartbeat detection    → `: heartbeat\n\n` updates `lastEventAt`
 *                                            without dispatching, so the watchdog
 *                                            sees proof-of-life
 *
 * The parser is fed by the streaming client one read() chunk at a time;
 * incomplete events accumulate in `state.buffer` until a `\n\n` boundary
 * arrives.
 */

const MAX_BUFFER_BYTES = 1_048_576; // 1 MB — bail rather than OOM
const MAX_EVENT_BYTES = 524_288; // 512 KB per event — protects against pathological tool results

export interface SseEvent {
  /** The "event:" field; defaults to "message" if absent. */
  event: string;
  /**
   * Parsed JSON from the "data:" field. If parse fails (and `data` is non-empty),
   * the raw string is returned instead — never throws on parse error.
   */
  data: unknown;
  /** The literal data string (for debugging + structured error reporting). */
  rawData: string;
  /** `performance.now()` when the event boundary was observed. Used by the watchdog. */
  receivedAt: number;
}

export interface SseParserState {
  buffer: string;
  textDecoder: TextDecoder;
  /**
   * Updated whenever ANY event OR comment-line heartbeat is observed.
   * The streaming client's inactivity watchdog (§B.12) compares
   * `performance.now() - lastEventAt` against its thresholds.
   */
  lastEventAt: number;
}

export function createSseParserState(): SseParserState {
  return {
    buffer: "",
    // `fatal: false` is non-negotiable. A single mis-routed byte from a misbehaving
    // edge proxy would otherwise throw and end the entire stream mid-message.
    textDecoder: new TextDecoder("utf-8", { fatal: false }),
    lastEventAt: performance.now(),
  };
}

/**
 * Feed one fetch chunk into the parser. Returns zero or more complete events.
 * Updates `state.lastEventAt` whenever an event OR heartbeat is observed.
 *
 * Throws `SseBufferOverflowError` if the internal buffer exceeds
 * MAX_BUFFER_BYTES without finding an event terminator — caller MUST handle
 * (recommended: abort the stream + transition the hook to `error`).
 *
 * Drops single events larger than MAX_EVENT_BYTES with a `console.warn`
 * (NOT a throw) — one bad event shouldn't kill the conversation.
 */
export function feedSseParser(
  state: SseParserState,
  chunk: Uint8Array,
): SseEvent[] {
  state.buffer += state.textDecoder.decode(chunk, { stream: true });

  if (state.buffer.length > MAX_BUFFER_BYTES) {
    throw new SseBufferOverflowError(state.buffer.length);
  }

  // SSE spec allows \r\n, \n, or \r as line terminators. Normalize to \n once
  // per chunk so the rest of the parser only handles LF. Node's `http` module
  // emits \r\n for `res.write(":heartbeat\n")` in some configurations.
  state.buffer = state.buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const events: SseEvent[] = [];
  let sep: number;

  while ((sep = state.buffer.indexOf("\n\n")) >= 0) {
    const block = state.buffer.slice(0, sep);
    state.buffer = state.buffer.slice(sep + 2);

    if (block.length > MAX_EVENT_BYTES) {
      // Single event is enormous — log and drop, don't crash the stream.
      // Still bump lastEventAt so the watchdog knows something arrived.
      console.warn(
        `[sse] oversized event dropped: ${block.length} bytes (cap ${MAX_EVENT_BYTES})`,
      );
      state.lastEventAt = performance.now();
      continue;
    }

    let event = "message";
    let data = "";
    let isHeartbeat = false;

    for (const line of block.split("\n")) {
      if (line === "") continue; // intra-block blank line; safe to ignore
      if (line.startsWith(":")) {
        // Comment line. Spec: ignored by event dispatch. We treat it as a
        // heartbeat signal — bumps lastEventAt but doesn't dispatch.
        isHeartbeat = true;
        continue;
      }
      // Field syntax: "field: value" OR "field:value" (no space). Spec permits both.
      const colon = line.indexOf(":");
      if (colon < 0) continue; // malformed line; ignore
      const field = line.slice(0, colon);
      const value =
        line[colon + 1] === " " ? line.slice(colon + 2) : line.slice(colon + 1);

      if (field === "event") {
        event = value.trim();
      } else if (field === "data") {
        // Multi-line data fields concatenate with \n per spec.
        data += (data ? "\n" : "") + value;
      }
      // Ignore `id:` and `retry:` fields in v1.
    }

    state.lastEventAt = performance.now();

    // Pure heartbeat — bumps lastEventAt but no event to dispatch.
    if (isHeartbeat && data === "") continue;

    // Try JSON-parse the data; fall back to raw string on failure.
    // Never throws — robustness over strictness.
    let parsed: unknown = data;
    if (data) {
      try {
        parsed = JSON.parse(data);
      } catch {
        // Keep raw string — adapter / hook can handle / log.
      }
    }

    events.push({
      event,
      data: parsed,
      rawData: data,
      receivedAt: state.lastEventAt,
    });
  }

  return events;
}

/**
 * Thrown when the parser's internal buffer exceeds {@link MAX_BUFFER_BYTES}
 * without finding an event terminator. Indicates the server is sending
 * non-conformant output OR has hung mid-event.
 *
 * Caller (the streaming client) catches and re-emits as a
 * `ChatStreamError("buffer_overflow")` so the hook can present a graceful
 * recovery banner — see docs/crm/60-chat-orchestrator.md §B.19.
 */
export class SseBufferOverflowError extends Error {
  constructor(public readonly bufferSize: number) {
    super(
      `SSE buffer exceeded ${MAX_BUFFER_BYTES} bytes (current: ${bufferSize}). Connection likely stuck.`,
    );
    this.name = "SseBufferOverflowError";
  }
}

// Re-export the constants so tests + the streaming client can reference the
// canonical values rather than hard-coding them.
export { MAX_BUFFER_BYTES, MAX_EVENT_BYTES };
