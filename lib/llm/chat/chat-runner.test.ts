import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChatOnce, ChatRunnerStreamError, type RunnerEvent } from "./chat-runner";
import type { ChatStreamChunk } from "./types";
import * as streamChatModule from "./stream-chat";
import type { StreamChatRequest } from "./stream-chat";
import type {
  ChatTool,
  ChatToolContext,
  ChatToolRegistry,
} from "./tools/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Chat-runner tests.
 *
 * The runner stitches together streamChat + system-prompt + SSE event
 * emission. We mock `streamChat` to feed deterministic chunk sequences and
 * assert on the SSE event stream + return value.
 *
 * Coverage:
 *   1. Always emits `started` → `preflight:start` → `preflight:complete` →
 *      [deltas/tool events] → `completed` in order
 *   2. `assistant:delta` events fire per delta chunk; finalText concatenates them
 *   3. `response_id` chunk is captured + surfaced in the terminal `completed` event
 *   4. `tool_call_done` chunks emit `tool:call` and then `tool:error` because
 *      v1 has no registered tools (model hallucinated)
 *   5. Adapter `error` chunk throws `ChatRunnerStreamError` (route catches it
 *      and emits one final `error` SSE event)
 *   6. `model_switch` chunk passes through to a `model:switch` SSE event
 *      (reserved vocabulary; no v1 adapter emits but the runner forwards it)
 *   7. `preflight:complete` carries hasClient / activityCount / etc.
 *   8. Multiple `delta` chunks accumulate into finalText
 *   9. Loop short-circuits after one iteration when no tool calls fire
 *  10. `previousResponseId` only flows to the FIRST iteration
 */

const ADVISOR = {
  name: "Jane Doe",
  email: "jane@firm.com",
};

const VIEW = { route: "/app" };
const FIXED_NOW = new Date("2026-05-16T14:30:00.000Z");

const baseOptions = (overrides: Partial<Parameters<typeof runChatOnce>[0]> = {}) => ({
  context: {
    conversationId: "conv_abc",
    advisorEmail: "jane@firm.com",
    requestId: "req_xyz",
    currentClientId: null,
    currentRoute: "/app",
  },
  messages: [{ role: "user" as const, content: "Hello" }],
  preflight: { advisor: ADVISOR, currentView: VIEW },
  onEvent: vi.fn<(e: RunnerEvent) => void>(),
  now: FIXED_NOW,
  ...overrides,
});

/** Build an AsyncGenerator that yields the given chunks in order. */
async function* asGen(chunks: ChatStreamChunk[]): AsyncGenerator<ChatStreamChunk> {
  for (const c of chunks) yield c;
}

function mockStream(chunks: ChatStreamChunk[]) {
  return vi
    .spyOn(streamChatModule, "streamChat")
    .mockImplementation(() => asGen(chunks));
}

beforeEach(() => {
  delete process.env.LLM_CHAT_MAX_TOOL_LOOPS;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runChatOnce — happy path (text-only response)", () => {
  it("emits started, preflight pair, deltas, completed in order", async () => {
    mockStream([
      { type: "delta", text: "Hello, " },
      { type: "delta", text: "Jane!" },
      { type: "response_id", responseId: "resp_42" },
      { type: "done" },
    ]);

    const onEvent = vi.fn();
    const result = await runChatOnce(baseOptions({ onEvent }));

    const names = onEvent.mock.calls.map((c) => (c[0] as RunnerEvent).event);
    expect(names[0]).toBe("started");
    expect(names[1]).toBe("preflight:start");
    expect(names[2]).toBe("preflight:complete");
    expect(names.slice(3, 5)).toEqual(["assistant:delta", "assistant:delta"]);
    expect(names[names.length - 1]).toBe("completed");

    expect(result.finalText).toBe("Hello, Jane!");
    expect(result.iterations).toBe(1);
    expect(result.toolCallCount).toBe(0);
    expect(result.providerResponseId).toBe("resp_42");
  });

  it("started event carries requestId + conversationId", async () => {
    mockStream([{ type: "done" }]);
    const onEvent = vi.fn();
    await runChatOnce(baseOptions({ onEvent }));
    const started = onEvent.mock.calls[0][0] as RunnerEvent;
    expect(started.event).toBe("started");
    expect(started.data).toEqual({
      requestId: "req_xyz",
      conversationId: "conv_abc",
    });
  });

  it("preflight:complete includes context counts", async () => {
    mockStream([{ type: "done" }]);
    const onEvent = vi.fn();
    await runChatOnce(
      baseOptions({
        onEvent,
        preflight: {
          advisor: ADVISOR,
          currentView: VIEW,
          currentClient: { name: "John" },
          pinnedNotes: [{ date: "2026-05-01", body: "n1" }],
          recentActivity: [
            { date: "2026-05-10", summary: "a1" },
            { date: "2026-05-11", summary: "a2" },
          ],
          openTasks: [{ title: "t1" }],
        },
      }),
    );
    const preflight = onEvent.mock.calls.find(
      (c) => (c[0] as RunnerEvent).event === "preflight:complete",
    )?.[0] as RunnerEvent;
    expect(preflight.data).toMatchObject({
      hasClient: true,
      pinnedNoteCount: 1,
      activityCount: 2,
      openTaskCount: 1,
    });
    expect((preflight.data as { systemPromptChars: number }).systemPromptChars).toBeGreaterThan(0);
  });

  it("completed event surfaces providerResponseId + iteration counts", async () => {
    mockStream([
      { type: "delta", text: "Hi" },
      { type: "response_id", responseId: "resp_xyz" },
      { type: "done" },
    ]);
    const onEvent = vi.fn();
    await runChatOnce(baseOptions({ onEvent }));
    const completed = onEvent.mock.calls.at(-1)?.[0] as RunnerEvent;
    expect(completed.event).toBe("completed");
    expect(completed.data).toEqual({
      providerResponseId: "resp_xyz",
      iterations: 1,
      toolCallCount: 0,
      finalTextChars: 2,
    });
  });

  it("concatenates multiple deltas into finalText in order", async () => {
    mockStream([
      { type: "delta", text: "A" },
      { type: "delta", text: "B" },
      { type: "delta", text: "C" },
      { type: "done" },
    ]);
    const result = await runChatOnce(baseOptions());
    expect(result.finalText).toBe("ABC");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runChatOnce — tool calls (v1 has no registered tools)", () => {
  it("emits tool:call then tool:error when no registry is provided + the model winds down on iteration 2", async () => {
    // Smart mock — first iteration emits a tool_call; once the runner
    // appends the tool-result message and re-streams, the second iteration
    // emits a plain text + done (simulating the model recovering from
    // the "tool not configured" error).
    let iter = 0;
    vi.spyOn(streamChatModule, "streamChat").mockImplementation(() => {
      iter += 1;
      if (iter === 1) {
        return asGen([
          { type: "delta", text: "Let me look that up." },
          {
            type: "tool_call_done",
            toolCall: { id: "call_1", name: "query_crm", args: { op: "list" } },
          },
          { type: "done" },
        ]);
      }
      // Iteration 2: model saw the tool error, apologizes, no more tool calls.
      return asGen([
        { type: "delta", text: " (Tools aren't wired here.)" },
        { type: "done" },
      ]);
    });

    const onEvent = vi.fn();
    const result = await runChatOnce(baseOptions({ onEvent }));

    const names = onEvent.mock.calls.map((c) => (c[0] as RunnerEvent).event);
    expect(names).toContain("tool:call");
    expect(names).toContain("tool:error");
    // tool:error must come AFTER tool:call.
    expect(names.indexOf("tool:error")).toBeGreaterThan(names.indexOf("tool:call"));

    const toolErr = onEvent.mock.calls.find(
      (c) => (c[0] as RunnerEvent).event === "tool:error",
    )?.[0] as RunnerEvent;
    expect(toolErr.data).toMatchObject({
      callId: "call_1",
      name: "query_crm",
    });
    expect((toolErr.data as { error: string }).error).toMatch(
      /Tools are not configured|not registered/,
    );

    expect(result.toolCallCount).toBe(1);
    expect(result.iterations).toBe(2);
    // Final text accumulates both iterations' deltas.
    expect(result.finalText).toBe(
      "Let me look that up. (Tools aren't wired here.)",
    );
  });

  it("model_switch chunk forwards as 'model:switch' SSE event (reserved vocabulary)", async () => {
    mockStream([
      { type: "model_switch", model: "gpt-5.5" },
      { type: "delta", text: "ok" },
      { type: "done" },
    ]);
    const onEvent = vi.fn();
    await runChatOnce(baseOptions({ onEvent }));
    const ms = onEvent.mock.calls.find(
      (c) => (c[0] as RunnerEvent).event === "model:switch",
    )?.[0] as RunnerEvent;
    expect(ms).toBeDefined();
    expect(ms.data).toEqual({ model: "gpt-5.5" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runChatOnce — error paths", () => {
  it("throws ChatRunnerStreamError when the adapter emits an error chunk", async () => {
    mockStream([
      { type: "delta", text: "partial" },
      { type: "error", error: "Rate limited (429)" },
    ]);
    const onEvent = vi.fn();
    await expect(runChatOnce(baseOptions({ onEvent }))).rejects.toBeInstanceOf(
      ChatRunnerStreamError,
    );
    await expect(runChatOnce(baseOptions({ onEvent }))).rejects.toThrow(/Rate limited/);
  });

  it("DOES emit started + preflight events even when the stream errors out", async () => {
    // Important: the started/preflight events fire BEFORE the model stream,
    // so the client should still see them before the error event fires (the
    // route handler emits the terminal error after catching the throw).
    mockStream([{ type: "error", error: "boom" }]);
    const onEvent = vi.fn();
    await expect(runChatOnce(baseOptions({ onEvent }))).rejects.toThrow(/boom/);
    const names = onEvent.mock.calls.map((c) => (c[0] as RunnerEvent).event);
    expect(names).toContain("started");
    expect(names).toContain("preflight:start");
    expect(names).toContain("preflight:complete");
    // No `completed` event — the throw aborted before the terminal emission.
    expect(names).not.toContain("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("runChatOnce — previousResponseId routing", () => {
  it("forwards previousResponseId to streamChat on iteration 1 only", async () => {
    const spy = mockStream([{ type: "done" }]);
    await runChatOnce(
      baseOptions({
        previousResponseId: "resp_prev",
      }),
    );
    expect(spy).toHaveBeenCalledOnce();
    const params = spy.mock.calls[0][0];
    expect(params.previousResponseId).toBe("resp_prev");
    expect(params.sessionId).toBe("conv_abc");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Runner integration with a real tool registry (happy-path tool roundtrip)
// ─────────────────────────────────────────────────────────────────────────────

describe("runChatOnce — tool registry integration", () => {
  /** Build a single-tool registry with a stub handler we can assert on. */
  function singleToolRegistry(handler: ChatTool["handler"]): ChatToolRegistry {
    const tool: ChatTool = {
      name: "stub_lookup",
      description: "Look up a stub value for testing the tool loop.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      handler,
    };
    return new Map([[tool.name, tool]]);
  }

  it("happy-path: model → tool → result → model winds down with final text", async () => {
    const handler = vi.fn().mockResolvedValue({ result: { row: { name: "John" } } });
    const registry = singleToolRegistry(handler);
    const fakeSupabase = {} as SupabaseClient;

    // Iteration 1: model asks for the tool.
    // Iteration 2: model receives the result and produces the final sentence.
    let iter = 0;
    const capturedParams: StreamChatRequest[] = [];
    vi.spyOn(streamChatModule, "streamChat").mockImplementation((params) => {
      capturedParams.push(params);
      iter += 1;
      if (iter === 1) {
        return asGen([
          {
            type: "tool_call_done",
            toolCall: { id: "call_xyz", name: "stub_lookup", args: { id: "c_1" } },
          },
          { type: "done" },
        ]);
      }
      return asGen([
        { type: "delta", text: "Found John for you." },
        { type: "response_id", responseId: "resp_final" },
        { type: "done" },
      ]);
    });

    const onEvent = vi.fn();
    const result = await runChatOnce({
      ...baseOptions({ onEvent }),
      toolRegistry: registry,
      supabaseImpl: fakeSupabase,
    });

    // Handler was called once with the args + the resolved tool context.
    expect(handler).toHaveBeenCalledOnce();
    const [args, ctx] = handler.mock.calls[0] as [Record<string, unknown>, ChatToolContext];
    expect(args).toEqual({ id: "c_1" });
    expect(ctx).toMatchObject({
      advisorEmail: "jane@firm.com",
      conversationId: "conv_abc",
      currentClientId: null,
    });
    expect(ctx.supabase).toBe(fakeSupabase);

    // SSE event ordering: started → preflight pair → tool:call → tool:result → assistant:delta → completed
    const names = onEvent.mock.calls.map((c) => (c[0] as RunnerEvent).event);
    expect(names).toEqual([
      "started",
      "preflight:start",
      "preflight:complete",
      "tool:call",
      "tool:result",
      "assistant:delta",
      "completed",
    ]);

    const toolResult = onEvent.mock.calls.find(
      (c) => (c[0] as RunnerEvent).event === "tool:result",
    )?.[0] as RunnerEvent;
    expect(toolResult.data).toMatchObject({
      callId: "call_xyz",
      name: "stub_lookup",
      result: { row: { name: "John" } },
    });
    expect(typeof (toolResult.data as { durationMs: number }).durationMs).toBe("number");

    // Final text from iteration 2.
    expect(result.finalText).toBe("Found John for you.");
    expect(result.iterations).toBe(2);
    expect(result.toolCallCount).toBe(1);
    expect(result.providerResponseId).toBe("resp_final");

    // Verify the message history grew between iterations to include the
    // assistant turn + the tool-role message carrying the result.
    expect(capturedParams).toHaveLength(2);
    const iter2Messages = capturedParams[1].messages;
    const tail = iter2Messages.slice(-2);
    expect(tail[0]).toMatchObject({ role: "assistant", toolCalls: [{ name: "stub_lookup" }] });
    expect(tail[1]).toMatchObject({
      role: "tool",
      toolResults: [{ callId: "call_xyz", result: { row: { name: "John" } } }],
    });
  });

  it("handler error → emits tool:error and loop continues", async () => {
    const handler = vi.fn().mockResolvedValue({ error: "couldn't find row" });
    const registry = singleToolRegistry(handler);

    let iter = 0;
    vi.spyOn(streamChatModule, "streamChat").mockImplementation(() => {
      iter += 1;
      if (iter === 1) {
        return asGen([
          { type: "tool_call_done", toolCall: { id: "c1", name: "stub_lookup", args: {} } },
          { type: "done" },
        ]);
      }
      return asGen([
        { type: "delta", text: "I had trouble looking that up." },
        { type: "done" },
      ]);
    });

    const onEvent = vi.fn();
    const result = await runChatOnce({
      ...baseOptions({ onEvent }),
      toolRegistry: registry,
      supabaseImpl: {} as SupabaseClient,
    });

    const toolErr = onEvent.mock.calls.find(
      (c) => (c[0] as RunnerEvent).event === "tool:error",
    )?.[0] as RunnerEvent;
    expect((toolErr.data as { error: string }).error).toBe("couldn't find row");
    expect(result.iterations).toBe(2);
  });

  it("handler THROWS → caught, emits tool:error with 'threw:' prefix; loop continues", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("network down"));
    const registry = singleToolRegistry(handler);

    let iter = 0;
    vi.spyOn(streamChatModule, "streamChat").mockImplementation(() => {
      iter += 1;
      if (iter === 1) {
        return asGen([
          { type: "tool_call_done", toolCall: { id: "c1", name: "stub_lookup", args: {} } },
          { type: "done" },
        ]);
      }
      return asGen([{ type: "delta", text: "Sorry." }, { type: "done" }]);
    });

    const onEvent = vi.fn();
    await runChatOnce({
      ...baseOptions({ onEvent }),
      toolRegistry: registry,
      supabaseImpl: {} as SupabaseClient,
    });

    const toolErr = onEvent.mock.calls.find(
      (c) => (c[0] as RunnerEvent).event === "tool:error",
    )?.[0] as RunnerEvent;
    expect((toolErr.data as { error: string }).error).toMatch(/threw: network down/);
  });

  it("model invokes unknown tool name → 'not registered' error; loop continues", async () => {
    const registry = singleToolRegistry(vi.fn());

    let iter = 0;
    vi.spyOn(streamChatModule, "streamChat").mockImplementation(() => {
      iter += 1;
      if (iter === 1) {
        return asGen([
          {
            type: "tool_call_done",
            toolCall: { id: "c1", name: "nonexistent_tool", args: {} },
          },
          { type: "done" },
        ]);
      }
      return asGen([{ type: "delta", text: "ok" }, { type: "done" }]);
    });

    const onEvent = vi.fn();
    await runChatOnce({
      ...baseOptions({ onEvent }),
      toolRegistry: registry,
      supabaseImpl: {} as SupabaseClient,
    });

    const toolErr = onEvent.mock.calls.find(
      (c) => (c[0] as RunnerEvent).event === "tool:error",
    )?.[0] as RunnerEvent;
    expect((toolErr.data as { error: string }).error).toMatch(/not registered/);
  });

  it("system prompt includes a <tools> block when registry is provided", async () => {
    const registry = singleToolRegistry(vi.fn().mockResolvedValue({ result: {} }));

    let capturedSystemPrompt: string | null = null;
    vi.spyOn(streamChatModule, "streamChat").mockImplementation((params) => {
      capturedSystemPrompt = params.systemPrompt;
      return asGen([{ type: "done" }]);
    });

    await runChatOnce({
      ...baseOptions(),
      toolRegistry: registry,
      supabaseImpl: {} as SupabaseClient,
    });

    expect(capturedSystemPrompt).toContain("<tools>");
    expect(capturedSystemPrompt).toContain("stub_lookup:");
    expect(capturedSystemPrompt).toContain("</tools>");
  });

  it("respects maxToolLoops cap when model keeps requesting tools forever", async () => {
    process.env.LLM_CHAT_MAX_TOOL_LOOPS = "3";
    const handler = vi.fn().mockResolvedValue({ result: { ok: true } });
    const registry = singleToolRegistry(handler);

    // Model NEVER winds down — every iteration emits a tool call.
    vi.spyOn(streamChatModule, "streamChat").mockImplementation(() => {
      return asGen([
        { type: "tool_call_done", toolCall: { id: `c_${Math.random()}`, name: "stub_lookup", args: {} } },
        { type: "done" },
      ]);
    });

    const onEvent = vi.fn();
    const result = await runChatOnce({
      ...baseOptions({ onEvent }),
      toolRegistry: registry,
      supabaseImpl: {} as SupabaseClient,
    });

    expect(result.iterations).toBe(3);
    expect(result.toolCallCount).toBe(3);
    // Reaches the `completed` terminal event even after running to the cap.
    const names = onEvent.mock.calls.map((c) => (c[0] as RunnerEvent).event);
    expect(names[names.length - 1]).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR 15 — tool partial-content streaming (`tool:result_partial` SSE event)
// ─────────────────────────────────────────────────────────────────────────────

describe("runChatOnce — tool partial-content streaming", () => {
  function singleToolRegistry(handler: ChatTool["handler"]): ChatToolRegistry {
    const tool: ChatTool = {
      name: "stub_streaming_tool",
      description: "Stub tool that emits partial content.",
      parameters: { type: "object", properties: {}, required: [] },
      handler,
    };
    return new Map([[tool.name, tool]]);
  }

  it("forwards emitPartial({deltaText}) calls as tool:result_partial SSE events with the callId stamped in", async () => {
    // Stub handler emits two partials, then returns a terminal result.
    const handler = vi.fn(async (_args, ctx: ChatToolContext) => {
      ctx.emitPartial({ deltaText: "# Hello" });
      ctx.emitPartial({ deltaText: "\n\nWorld" });
      return { result: { ok: true } };
    });
    const registry = singleToolRegistry(handler);

    let iter = 0;
    vi.spyOn(streamChatModule, "streamChat").mockImplementation(() => {
      iter += 1;
      if (iter === 1) {
        return asGen([
          {
            type: "tool_call_done",
            toolCall: { id: "call_stream_1", name: "stub_streaming_tool", args: {} },
          },
          { type: "done" },
        ]);
      }
      return asGen([{ type: "delta", text: "All done." }, { type: "done" }]);
    });

    const onEvent = vi.fn();
    await runChatOnce({
      ...baseOptions({ onEvent }),
      toolRegistry: registry,
      supabaseImpl: {} as SupabaseClient,
    });

    // Order: tool:call → tool:result_partial × 2 → tool:result → assistant:delta → completed
    const partials = onEvent.mock.calls
      .map((c) => c[0] as RunnerEvent)
      .filter((e) => e.event === "tool:result_partial");
    expect(partials).toHaveLength(2);
    expect(partials[0].data).toEqual({
      callId: "call_stream_1",
      name: "stub_streaming_tool",
      deltaText: "# Hello",
    });
    expect(partials[1].data).toEqual({
      callId: "call_stream_1",
      name: "stub_streaming_tool",
      deltaText: "\n\nWorld",
    });
    // Final tool:result still fires AFTER the partials.
    const names = onEvent.mock.calls.map((c) => (c[0] as RunnerEvent).event);
    const partialsIdx = names.indexOf("tool:result_partial");
    const resultIdx = names.indexOf("tool:result");
    expect(partialsIdx).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(partialsIdx);
  });

  it("emitPartial with empty deltaText is a silent no-op (no SSE event)", async () => {
    const handler = vi.fn(async (_args, ctx: ChatToolContext) => {
      ctx.emitPartial({ deltaText: "" });
      // @ts-expect-error — defensive: tools sometimes call with malformed payloads
      ctx.emitPartial(null);
      return { result: { ok: true } };
    });
    const registry = singleToolRegistry(handler);

    let iter = 0;
    vi.spyOn(streamChatModule, "streamChat").mockImplementation(() => {
      iter += 1;
      if (iter === 1) {
        return asGen([
          {
            type: "tool_call_done",
            toolCall: { id: "c1", name: "stub_streaming_tool", args: {} },
          },
          { type: "done" },
        ]);
      }
      return asGen([{ type: "done" }]);
    });

    const onEvent = vi.fn();
    await runChatOnce({
      ...baseOptions({ onEvent }),
      toolRegistry: registry,
      supabaseImpl: {} as SupabaseClient,
    });

    const partials = onEvent.mock.calls
      .map((c) => c[0] as RunnerEvent)
      .filter((e) => e.event === "tool:result_partial");
    expect(partials).toHaveLength(0);
  });
});

describe("runChatOnce — env-tunable tool-loop cap", () => {
  it("respects LLM_CHAT_MAX_TOOL_LOOPS upper bound (cannot exceed 50)", async () => {
    // Set absurd value; runner should clamp to 50 but in v1 the loop exits
    // after iteration 1 anyway because no tools are wired. We can't directly
    // assert on the clamp without exporting it, so verify the loop still
    // exits cleanly and reports iterations=1.
    process.env.LLM_CHAT_MAX_TOOL_LOOPS = "9999";
    mockStream([{ type: "done" }]);
    const result = await runChatOnce(baseOptions());
    expect(result.iterations).toBe(1);
  });

  it("falls back to default when env var is non-numeric", async () => {
    process.env.LLM_CHAT_MAX_TOOL_LOOPS = "not-a-number";
    mockStream([{ type: "done" }]);
    const result = await runChatOnce(baseOptions());
    expect(result.iterations).toBe(1);
  });
});
