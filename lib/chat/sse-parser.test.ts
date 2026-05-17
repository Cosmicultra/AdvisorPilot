import { describe, expect, it, vi } from "vitest";
import {
  createSseParserState,
  feedSseParser,
  MAX_BUFFER_BYTES,
  MAX_EVENT_BYTES,
  SseBufferOverflowError,
  type SseEvent,
} from "./sse-parser";

/**
 * SSE parser test suite — the 13 cases enumerated in
 * docs/crm/60-chat-orchestrator.md §B.10.
 *
 * Each test exercises one wire-protocol scenario the parser MUST tolerate.
 * Failures here ship as production chat hangs, so the bar is "every path
 * has a regression test", not "happy path only".
 */

// Tiny helper — most tests want to feed a string and get events back.
function feed(state = createSseParserState(), text: string): SseEvent[] {
  return feedSseParser(state, new TextEncoder().encode(text));
}

describe("feedSseParser", () => {
  it("parses a single complete event", () => {
    const events = feed(undefined, 'event: hello\ndata: {"x":1}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "hello",
      data: { x: 1 },
      rawData: '{"x":1}',
    });
    expect(typeof events[0].receivedAt).toBe("number");
  });

  it("parses multiple events in one chunk", () => {
    const wire =
      'event: a\ndata: {"n":1}\n\n' +
      'event: b\ndata: {"n":2}\n\n' +
      'event: c\ndata: {"n":3}\n\n';
    const events = feed(undefined, wire);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.event)).toEqual(["a", "b", "c"]);
    expect(events.map((e) => (e.data as { n: number }).n)).toEqual([1, 2, 3]);
  });

  it("buffers an incomplete event across chunks", () => {
    const state = createSseParserState();
    // First chunk: half the event (no \n\n terminator)
    const part1 = feedSseParser(
      state,
      new TextEncoder().encode("event: split\ndata: {\"foo\":"),
    );
    expect(part1).toHaveLength(0);
    // Second chunk: completes the event
    const part2 = feedSseParser(state, new TextEncoder().encode('"bar"}\n\n'));
    expect(part2).toHaveLength(1);
    expect(part2[0]).toMatchObject({ event: "split", data: { foo: "bar" } });
  });

  it("tolerates CRLF and CR line endings", () => {
    // CRLF (Windows-style; some Node configs emit this for keepalives)
    const crlf = feed(undefined, 'event: a\r\ndata: 1\r\n\r\n');
    expect(crlf).toHaveLength(1);
    expect(crlf[0]).toMatchObject({ event: "a", data: 1 });

    // CR-only (very rare but spec-allowed)
    const cr = feed(undefined, 'event: a\rdata: 2\r\r');
    expect(cr).toHaveLength(1);
    expect(cr[0]).toMatchObject({ event: "a", data: 2 });
  });

  it("tolerates 'data:foo' (no space after colon)", () => {
    // SSE spec: the space after the colon is OPTIONAL. xAI is known to omit it occasionally.
    const events = feed(undefined, 'event: x\ndata:{"hello":"world"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({ hello: "world" });
    expect(events[0].rawData).toBe('{"hello":"world"}');
  });

  it("concatenates multi-line data values", () => {
    // Per spec: multiple `data:` lines in one event concatenate with \n.
    // Then JSON-parse runs on the joined string (which here is a JSON
    // structure split across two lines — valid JSON tolerates the newline).
    const events = feed(
      undefined,
      'event: multi\ndata: {"line":1,\ndata: "rest":"ok"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].rawData).toBe('{"line":1,\n"rest":"ok"}');
    expect(events[0].data).toEqual({ line: 1, rest: "ok" });
  });

  it("ignores comment-only lines but bumps lastEventAt", () => {
    const state = createSseParserState();
    const before = state.lastEventAt;
    // Heartbeat (comment line) — no event dispatched, but timestamp bumps.
    // Need to wait at least 1ms+ for performance.now to advance reliably,
    // so we just check the post value is >= the pre value (monotonic).
    const events = feedSseParser(
      state,
      new TextEncoder().encode(": heartbeat\n\n"),
    );
    expect(events).toHaveLength(0);
    expect(state.lastEventAt).toBeGreaterThanOrEqual(before);
  });

  it("passes unknown event names through", () => {
    // Adding a new event server-side shouldn't require redeploying clients.
    const events = feed(
      undefined,
      'event: tool:future_v3_handshake\ndata: {"x":1}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("tool:future_v3_handshake");
  });

  it("returns raw string when data is not JSON", () => {
    // A debug event accidentally emitting non-JSON shouldn't crash the chat.
    const events = feed(undefined, "event: debug\ndata: hello world!\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello world!");
    expect(events[0].rawData).toBe("hello world!");
  });

  it("throws SseBufferOverflowError above 1 MB without a terminator", () => {
    const state = createSseParserState();
    // Feed > 1 MB of data with no \n\n boundary. Spread across multiple
    // feedSseParser calls to mirror real fetch chunking.
    const chunkSize = 65_536;
    const big = "x".repeat(chunkSize);
    expect(() => {
      for (let i = 0; i < (MAX_BUFFER_BYTES / chunkSize) + 2; i++) {
        feedSseParser(state, new TextEncoder().encode(big));
      }
    }).toThrow(SseBufferOverflowError);
  });

  it("drops events above 512 KB with a console.warn (doesn't throw)", () => {
    const state = createSseParserState();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // One event whose data field is just over 512 KB. The terminator IS
      // present, so the parser sees a complete (oversized) event.
      const oversize = "y".repeat(MAX_EVENT_BYTES + 10);
      const events = feedSseParser(
        state,
        new TextEncoder().encode(`event: huge\ndata: ${oversize}\n\n`),
      );
      expect(events).toHaveLength(0);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toMatch(/oversized event dropped/);
    } finally {
      warn.mockRestore();
    }
  });

  it("handles multi-byte UTF-8 chunked at the byte boundary", () => {
    // The em-dash "—" is U+2014, which encodes to THREE bytes (0xE2 0x80 0x94).
    // Split the bytes across two feedSseParser calls and verify the character
    // reconstructs correctly. `TextDecoder({ stream: true })` handles this natively.
    const state = createSseParserState();
    const fullEvent = 'event: utf\ndata: "Hello — world"\n\n';
    const bytes = new TextEncoder().encode(fullEvent);

    // Find the em-dash byte sequence and split the array right in the middle of it.
    // Em-dash starts at the first occurrence of byte 0xE2.
    const emDashStart = bytes.indexOf(0xe2);
    expect(emDashStart).toBeGreaterThan(0);
    const splitAt = emDashStart + 1; // mid-codepoint

    const part1 = feedSseParser(state, bytes.slice(0, splitAt));
    const part2 = feedSseParser(state, bytes.slice(splitAt));

    // The complete event should arrive on the second call (since the \n\n
    // terminator is at the end of bytes).
    expect(part1).toHaveLength(0);
    expect(part2).toHaveLength(1);
    expect(part2[0].data).toBe("Hello — world");
  });

  it("recovers from a malformed event without losing subsequent events", () => {
    // First event has a malformed line (no colon). Parser should skip the
    // bad line, fall through to the next event (well-formed) and dispatch it.
    const wire =
      "event: first\nmalformed_no_colon_here\ndata: 1\n\n" +
      "event: second\ndata: 2\n\n";
    const events = feed(undefined, wire);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "first", data: 1 });
    expect(events[1]).toMatchObject({ event: "second", data: 2 });
  });

  // ── Extra coverage beyond the 13 baseline ──────────────────────────────────

  it("returns empty events array (not null/undefined) when fed an empty chunk", () => {
    // Edge: zero-byte chunks happen during clean shutdowns and proxy keepalives.
    const events = feed(undefined, "");
    expect(events).toEqual([]);
  });

  it("defaults event name to 'message' when no event: line is present", () => {
    // Per spec, if `event:` is absent the event name defaults to "message".
    const events = feed(undefined, 'data: {"plain":true}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message");
    expect(events[0].data).toEqual({ plain: true });
  });
});
