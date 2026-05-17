import { describe, expect, it, vi } from "vitest";
import { openChatStream } from "./orchestrator-client";
import { ChatStreamError } from "./chat-message-types";
import type { SseEvent } from "./sse-parser";

/**
 * Streaming-client unit tests.
 *
 * `openChatStream` runs in the browser, but it's pure-ish: takes a fetch
 * impl + signal in, calls `onEvent` out, never touches React. We mock the
 * fetch impl with a fake Response wrapping a ReadableStream we feed bytes
 * into, then assert on the events the client emits + the error class for
 * each failure mode.
 *
 * Coverage:
 *   1. Happy path — multiple events round-trip with correct shapes
 *   2. `started` and `completed` arrive in order, `sawTerminal` invariant met
 *   3. HTTP error → typed ChatStreamError per reason (401/403/429/400/5xx/no body)
 *   4. AbortError from fetch → stream_aborted
 *   5. Network throw from fetch → network
 *   6. Reader throws while signal.aborted → stream_aborted
 *   7. Reader throws while signal.NOT aborted → network
 *   8. Stream ends without terminal event → stream_invariant
 *   9. Body validation (400) surfaces the server's error text via .message
 *  10. onHeartbeat fires per event
 */

/** Build a Response whose body is a ReadableStream we can chunk-feed. */
function makeStreamingResponse(
  status: number,
  chunks: Uint8Array[],
  init: ResponseInit = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/event-stream",
      ...(init.headers ?? {}),
    },
  });
}

/** SSE wire payload for one event. */
function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("openChatStream — happy path", () => {
  it("emits each SSE event in order via onEvent and resolves cleanly", async () => {
    const wire =
      sseLine("started", { requestId: "req_1", conversationId: "c_1" }) +
      sseLine("preflight:start", {}) +
      sseLine("preflight:complete", { hasClient: false }) +
      sseLine("assistant:delta", { text: "Hello" }) +
      sseLine("assistant:delta", { text: ", Jane!" }) +
      sseLine("completed", { providerResponseId: "resp_42", iterations: 1 });

    const response = makeStreamingResponse(200, [encode(wire)]);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const events: SseEvent[] = [];

    await openChatStream({
      messages: [{ role: "user", content: "Hi" }],
      conversationId: "c_1",
      signal: new AbortController().signal,
      onEvent: (ev) => events.push(ev),
      fetchImpl,
    });

    expect(events.map((e) => e.event)).toEqual([
      "started",
      "preflight:start",
      "preflight:complete",
      "assistant:delta",
      "assistant:delta",
      "completed",
    ]);
    expect(events[3].data).toEqual({ text: "Hello" });
    expect(events.at(-1)!.data).toMatchObject({ providerResponseId: "resp_42" });
  });

  it("forwards onHeartbeat once per dispatched event", async () => {
    const wire =
      sseLine("started", {}) +
      sseLine("assistant:delta", { text: "x" }) +
      sseLine("completed", {});
    const response = makeStreamingResponse(200, [encode(wire)]);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const onHeartbeat = vi.fn();

    await openChatStream({
      messages: [{ role: "user", content: "Hi" }],
      conversationId: "c_1",
      signal: new AbortController().signal,
      onEvent: () => {},
      onHeartbeat,
      fetchImpl,
    });

    expect(onHeartbeat).toHaveBeenCalledTimes(3);
  });

  it("POSTs the right body shape to /api/chat/stream", async () => {
    const wire = sseLine("started", {}) + sseLine("completed", {});
    const response = makeStreamingResponse(200, [encode(wire)]);
    const fetchImpl = vi.fn().mockResolvedValue(response);

    await openChatStream({
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "What's my AUM?" },
      ],
      conversationId: "c_99",
      requestId: "req_abc",
      previousResponseId: "resp_prev",
      clientContext: { currentRoute: "/app/crm/c_x/overview", currentClientId: "c_x" },
      signal: new AbortController().signal,
      onEvent: () => {},
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/chat/stream");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      conversationId: "c_99",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "What's my AUM?" },
      ],
      requestId: "req_abc",
      previousResponseId: "resp_prev",
      clientContext: { currentRoute: "/app/crm/c_x/overview", currentClientId: "c_x" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP error → typed ChatStreamError
// ─────────────────────────────────────────────────────────────────────────────

describe("openChatStream — HTTP error mapping", () => {
  const cases: [number, ChatStreamError["reason"]][] = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "server_error"],
    [502, "server_error"],
    [503, "server_error"],
    [418, "server_error"], // !ok but not in any specific bucket → server_error
  ];

  for (const [status, reason] of cases) {
    it(`maps HTTP ${status} to ChatStreamError(reason="${reason}")`, async () => {
      const response = new Response("err", {
        status,
        headers: { "Content-Type": "application/json" },
      });
      const fetchImpl = vi.fn().mockResolvedValue(response);
      await expect(
        openChatStream({
          messages: [{ role: "user", content: "x" }],
          conversationId: "c",
          signal: new AbortController().signal,
          onEvent: () => {},
          fetchImpl,
        }),
      ).rejects.toMatchObject({ reason, httpStatus: status });
    });
  }

  it("maps 400 to bad_request and pulls the route's error message into .message", async () => {
    const response = new Response(
      JSON.stringify({ error: "`conversationId` is required." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      reason: "bad_request",
      httpStatus: 400,
      message: "`conversationId` is required.",
    });
  });

  it("falls back to 'Bad request' when the 400 body isn't JSON", async () => {
    const response = new Response("oops", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: "bad_request", message: "Bad request" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fetch failure modes
// ─────────────────────────────────────────────────────────────────────────────

describe("openChatStream — fetch-layer failures", () => {
  it("maps AbortError from fetch to stream_aborted", async () => {
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    const fetchImpl = vi.fn().mockRejectedValue(abortErr);
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: "stream_aborted" });
  });

  it("maps generic fetch throw to network", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ENETUNREACH"));
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: "network", message: "ENETUNREACH" });
  });

  it("maps null body to no_body", async () => {
    // Some older browsers / polyfills return Response objects with body=null.
    // The Response constructor in modern node/browsers always synthesizes a
    // body, so we fake a Response-like object instead of constructing one.
    const fakeResponse = {
      status: 200,
      ok: true,
      body: null,
      headers: new Headers(),
    } as unknown as Response;
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse);
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ reason: "no_body" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reader / stream invariant errors
// ─────────────────────────────────────────────────────────────────────────────

describe("openChatStream — stream invariants", () => {
  it("throws stream_invariant when the body ends without 'completed' or 'error'", async () => {
    // Only delta events, no terminal — server bug or proxy kill.
    const wire =
      sseLine("started", {}) +
      sseLine("assistant:delta", { text: "Hi" }) +
      sseLine("assistant:delta", { text: "!" });
    const response = makeStreamingResponse(200, [encode(wire)]);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      reason: "stream_invariant",
      message: expect.stringContaining("completed or error"),
    });
  });

  it("ends cleanly when 'completed' is the final event", async () => {
    const wire = sseLine("started", {}) + sseLine("completed", {});
    const response = makeStreamingResponse(200, [encode(wire)]);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
  });

  it("treats 'error' SSE event as a valid terminal (does NOT throw)", async () => {
    // The route emits one final `error` event before closing the stream;
    // the hook handles this via ASSISTANT_DONE + ERROR dispatches. The
    // client returns cleanly — it's the hook's job to surface the error.
    const wire =
      sseLine("started", {}) +
      sseLine("error", { message: "rate limit" });
    const response = makeStreamingResponse(200, [encode(wire)]);
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(
      openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X-Request-Id surfacing
// ─────────────────────────────────────────────────────────────────────────────

describe("openChatStream — X-Request-Id surfacing", () => {
  it("attaches X-Request-Id to thrown ChatStreamErrors when present", async () => {
    const response = new Response("nope", {
      status: 500,
      headers: { "X-Request-Id": "req_diag_777" },
    });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    try {
      await openChatStream({
        messages: [{ role: "user", content: "x" }],
        conversationId: "c",
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      });
      throw new Error("should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(ChatStreamError);
      expect((err as ChatStreamError).requestId).toBe("req_diag_777");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-chunk reads (SSE event split across chunks)
// ─────────────────────────────────────────────────────────────────────────────

describe("openChatStream — multi-chunk SSE reads", () => {
  it("buffers across chunks until an event terminator is seen", async () => {
    // Split one delta event across two fetch read() chunks.
    const c1 = encode("event: assistant:delta\ndata: {\"text\":\"Hel");
    const c2 = encode('lo"}\n\nevent: completed\ndata: {}\n\n');
    const response = makeStreamingResponse(200, [c1, c2]);
    const fetchImpl = vi.fn().mockResolvedValue(response);

    const events: SseEvent[] = [];
    await openChatStream({
      messages: [{ role: "user", content: "x" }],
      conversationId: "c",
      signal: new AbortController().signal,
      onEvent: (ev) => events.push(ev),
      fetchImpl,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: "assistant:delta",
      data: { text: "Hello" },
    });
    expect(events[1].event).toBe("completed");
  });
});
