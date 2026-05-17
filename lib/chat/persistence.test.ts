import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_TITLE_MAX_LENGTH,
  appendTurn,
  appendUserMessage,
  deriveTitleFromFirstMessage,
  listConversations,
  patchConversation,
  upsertConversation,
} from "./persistence";

/**
 * Tests for the chat-orchestrator persistence helpers.
 *
 * The reducer-style helpers + auto-title derivation are pure; the
 * upsert / appendTurn / list / get paths drive a stubbed Supabase
 * client so we can assert (a) the right SQL/RPC calls go out and (b)
 * the right shapes come back.
 *
 * Coverage:
 *   1. deriveTitleFromFirstMessage — empty, sentence cut, length cap
 *   2. upsertConversation — onConflict / payload shape / error path
 *   3. appendTurn — ordinal sequencing, auto-title on first turn,
 *      iteration → tool-role messages, header update payload
 *   4. listConversations — RPC dispatch + archive filter + limit/offset
 */

// ─── deriveTitleFromFirstMessage ──────────────────────────────────────────

describe("deriveTitleFromFirstMessage", () => {
  it("returns null for empty / whitespace-only input", () => {
    expect(deriveTitleFromFirstMessage("")).toBeNull();
    expect(deriveTitleFromFirstMessage("   \n  \t  ")).toBeNull();
  });

  it("cuts at first sentence-ending punctuation when present", () => {
    expect(
      deriveTitleFromFirstMessage("Show me the AUM by stage. Also include client counts."),
    ).toBe("Show me the AUM by stage.");
  });

  it("truncates with ellipsis at the length cap", () => {
    const long = "a".repeat(AUTO_TITLE_MAX_LENGTH + 50);
    const out = deriveTitleFromFirstMessage(long);
    expect(out).toBeDefined();
    expect((out as string).length).toBe(AUTO_TITLE_MAX_LENGTH + 1); // + ellipsis
    expect((out as string).endsWith("…")).toBe(true);
  });

  it("collapses internal whitespace to single spaces", () => {
    expect(deriveTitleFromFirstMessage("   line1\n\n  line2\t\tline3  ")).toBe(
      "line1 line2 line3",
    );
  });
});

// ─── Supabase mock builder (shared) ───────────────────────────────────────

interface Result {
  data: unknown;
  error: { message: string } | null;
}

interface MockBundle {
  supabase: SupabaseClient;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  upserts: Array<{ table: string; payload: unknown; options?: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<{ table: string; payload: unknown; eq: { col: string; val: unknown } }>;
}

function makeMockSupabase(fixtures: {
  tables?: Record<string, Result | (() => Result)>;
  rpcs?: Record<string, Result>;
}): MockBundle {
  const byTable = fixtures.tables ?? {};
  const byRpc = new Map(Object.entries(fixtures.rpcs ?? {}));
  const rpcCalls: MockBundle["rpcCalls"] = [];
  const upserts: MockBundle["upserts"] = [];
  const inserts: MockBundle["inserts"] = [];
  const updates: MockBundle["updates"] = [];

  const supabase = {
    from(table: string) {
      const fixture = byTable[table] ?? { data: null, error: null };
      const resolve = (): Result => (typeof fixture === "function" ? fixture() : fixture);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      let eqCol: string | undefined;
      let eqVal: unknown;
      let lastUpdatePayload: unknown;

      /**
       * Capture an update payload to the `updates` log when the query
       * actually resolves. Called from EVERY terminal method (single,
       * maybeSingle, then) so the mock doesn't drop captures based on
       * which method the caller chose.
       */
      const flushUpdate = () => {
        if (lastUpdatePayload !== undefined && eqCol !== undefined) {
          updates.push({
            table,
            payload: lastUpdatePayload,
            eq: { col: eqCol, val: eqVal },
          });
          // Reset so a subsequent terminal call on the same builder
          // doesn't double-log.
          lastUpdatePayload = undefined;
        }
      };

      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => {
        eqCol = col;
        eqVal = val;
        return builder;
      };
      builder.order = () => builder;
      builder.upsert = (payload: unknown, options?: unknown) => {
        upserts.push({ table, payload, options });
        return builder;
      };
      builder.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        return builder;
      };
      builder.update = (payload: unknown) => {
        lastUpdatePayload = payload;
        return builder;
      };
      builder.delete = () => builder;
      builder.maybeSingle = async () => {
        flushUpdate();
        return resolve();
      };
      builder.single = async () => {
        flushUpdate();
        return resolve();
      };
      builder.then = (
        ok: (v: Result) => unknown,
        err?: (e: unknown) => unknown,
      ) => {
        flushUpdate();
        return Promise.resolve(resolve()).then(ok, err);
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const result = byRpc.get(name) ?? { data: [], error: null };
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;

  return { supabase, rpcCalls, upserts, inserts, updates };
}

// ─── upsertConversation ──────────────────────────────────────────────────

describe("upsertConversation", () => {
  it("issues an upsert with onConflict=id and lower-cases the email", async () => {
    const { supabase, upserts } = makeMockSupabase({
      tables: { advisorpilot_chat_conversations: { data: null, error: null } },
    });
    const out = await upsertConversation(supabase, {
      conversationId: "c_1",
      ownerEmail: "Advisor@Firm.COM",
      lastClientId: "client-uuid",
      lastRoute: "/app/crm/c_1/overview",
    });
    expect(out).toEqual({ ok: true, id: "c_1" });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe("advisorpilot_chat_conversations");
    expect(upserts[0].payload).toMatchObject({
      id: "c_1",
      owner_email: "advisor@firm.com",
      last_client_id: "client-uuid",
      last_route: "/app/crm/c_1/overview",
    });
    expect(upserts[0].options).toEqual({ onConflict: "id", ignoreDuplicates: false });
  });

  it("surfaces Supabase errors via the discriminated result", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_chat_conversations: { data: null, error: { message: "boom" } } },
    });
    const out = await upsertConversation(supabase, {
      conversationId: "c_1",
      ownerEmail: "a@b",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("boom");
  });
});

// ─── appendTurn ──────────────────────────────────────────────────────────

describe("appendTurn", () => {
  it("inserts user + assistant in sequential ordinals starting from message_count+1", async () => {
    // Conversation already has 4 messages → ordinals 5 + 6.
    const { supabase, inserts, updates } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: () => ({
          data: { message_count: 4, turn_count: 2, title: "Existing title" },
          error: null,
        }),
        advisorpilot_chat_messages: { data: null, error: null },
      },
    });
    const out = await appendTurn(supabase, {
      conversationId: "c_1",
      ownerEmail: "advisor@firm.com",
      userText: "Hello",
      assistantText: "Hi there",
      providerResponseId: "resp_123",
      provider: "openai",
      model: "gpt-4o",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");

    // Two messages inserted in one batch with ordinals 5, 6.
    const messageInserts = inserts.filter((i) => i.table === "advisorpilot_chat_messages");
    expect(messageInserts).toHaveLength(1);
    const payload = messageInserts[0].payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ role: "user", content: "Hello", ordinal: 5 });
    expect(payload[1]).toMatchObject({
      role: "assistant",
      content: "Hi there",
      ordinal: 6,
      provider_response_id: "resp_123",
    });

    // Header update bumps counters + sets provider/model + bumps turn_count.
    const headerUpdate = updates.find((u) => u.table === "advisorpilot_chat_conversations");
    expect(headerUpdate?.payload).toMatchObject({
      message_count: 6,
      turn_count: 3,
      last_provider_response_id: "resp_123",
      last_provider: "openai",
      last_model: "gpt-4o",
    });
  });

  it("derives a title from the first user message on a brand-new conversation", async () => {
    const { supabase, updates } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: () => ({
          data: { message_count: 0, turn_count: 0, title: null },
          error: null,
        }),
        advisorpilot_chat_messages: { data: null, error: null },
      },
    });
    const out = await appendTurn(supabase, {
      conversationId: "c_1",
      ownerEmail: "advisor@firm.com",
      userText: "Show me my AUM by stage. Then break out the laggards.",
      assistantText: "Sure, here you go…",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.nextTitle).toBe("Show me my AUM by stage.");

    const headerUpdate = updates.find((u) => u.table === "advisorpilot_chat_conversations");
    expect(headerUpdate?.payload).toMatchObject({ title: "Show me my AUM by stage." });
  });

  it("does NOT overwrite the existing title on subsequent turns", async () => {
    const { supabase, updates } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: () => ({
          data: { message_count: 2, turn_count: 1, title: "Renamed by advisor" },
          error: null,
        }),
        advisorpilot_chat_messages: { data: null, error: null },
      },
    });
    const out = await appendTurn(supabase, {
      conversationId: "c_1",
      ownerEmail: "a@b",
      userText: "Another message",
      assistantText: "Another reply",
    });
    expect(out.ok).toBe(true);
    const headerUpdate = updates.find((u) => u.table === "advisorpilot_chat_conversations");
    // Header update should NOT have a title key.
    expect((headerUpdate?.payload as Record<string, unknown>).title).toBeUndefined();
  });

  it("emits assistant+tool message pairs per iteration with tool_calls + tool_results", async () => {
    const { supabase, inserts } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: () => ({
          data: { message_count: 0, turn_count: 0, title: null },
          error: null,
        }),
        advisorpilot_chat_messages: { data: null, error: null },
      },
    });
    const out = await appendTurn(supabase, {
      conversationId: "c_1",
      ownerEmail: "a@b",
      userText: "Look that up",
      assistantText: "Here's what I found.",
      iterations: [
        {
          toolCalls: [
            { id: "call_1", name: "query_crm", args: { op: "list" } },
          ],
          toolResults: [{ callId: "call_1", result: { count: 5 } }],
        },
      ],
    });
    expect(out.ok).toBe(true);
    const payload = (inserts.find((i) => i.table === "advisorpilot_chat_messages")?.payload ??
      []) as Array<Record<string, unknown>>;
    // user (1) → assistant-with-tool-calls (2) → tool-role (3) → final assistant (4)
    expect(payload).toHaveLength(4);
    expect(payload[0]).toMatchObject({ role: "user", ordinal: 1 });
    expect(payload[1]).toMatchObject({ role: "assistant", ordinal: 2 });
    expect((payload[1] as { tool_calls: unknown[] }).tool_calls).toHaveLength(1);
    expect(payload[2]).toMatchObject({ role: "tool", ordinal: 3 });
    expect((payload[2] as { tool_results: unknown[] }).tool_results).toHaveLength(1);
    expect(payload[3]).toMatchObject({ role: "assistant", ordinal: 4, content: "Here's what I found." });
  });
});

// ─── listConversations ────────────────────────────────────────────────────

describe("listConversations", () => {
  it("dispatches to list_visible_chat_conversations RPC + filters out archived by default", async () => {
    const { supabase, rpcCalls } = makeMockSupabase({
      rpcs: {
        list_visible_chat_conversations: {
          data: [
            {
              id: "c1",
              owner_email: "a@b",
              owner_user_id: null,
              title: "Active",
              last_client_id: null,
              last_route: null,
              last_provider: null,
              last_model: null,
              last_provider_response_id: null,
              message_count: 4,
              turn_count: 2,
              is_archived: false,
              archived_at: null,
              created_at: "2026-05-01T00:00:00Z",
              updated_at: "2026-05-01T00:00:00Z",
              last_message_at: "2026-05-01T00:00:00Z",
            },
            {
              id: "c2",
              owner_email: "a@b",
              owner_user_id: null,
              title: "Old archived",
              last_client_id: null,
              last_route: null,
              last_provider: null,
              last_model: null,
              last_provider_response_id: null,
              message_count: 10,
              turn_count: 5,
              is_archived: true,
              archived_at: "2026-04-01T00:00:00Z",
              created_at: "2026-04-01T00:00:00Z",
              updated_at: "2026-04-01T00:00:00Z",
              last_message_at: "2026-04-01T00:00:00Z",
            },
          ],
          error: null,
        },
      },
    });
    const out = await listConversations(supabase, { ownerEmail: "a@b" });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(rpcCalls.map((c) => c.name)).toEqual(["list_visible_chat_conversations"]);
    expect(out.conversations.map((c) => c.id)).toEqual(["c1"]); // archived filtered out
  });

  it("respects includeArchived + limit + offset", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      owner_email: "a@b",
      owner_user_id: null,
      title: `c${i}`,
      last_client_id: null,
      last_route: null,
      last_provider: null,
      last_model: null,
      last_provider_response_id: null,
      message_count: 1,
      turn_count: 1,
      is_archived: false,
      archived_at: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
      last_message_at: `2026-05-0${i + 1}T00:00:00Z`,
    }));
    const { supabase } = makeMockSupabase({
      rpcs: { list_visible_chat_conversations: { data: rows, error: null } },
    });
    const out = await listConversations(supabase, {
      ownerEmail: "a@b",
      includeArchived: true,
      limit: 2,
      offset: 1,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.conversations.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});

// ─── listConversations — PR 21 server-side FTS search ────────────────────

describe("listConversations — search arg (PR 21 FTS)", () => {
  function row(id: string, title: string) {
    return {
      id,
      owner_email: "a@b",
      owner_user_id: null,
      title,
      last_client_id: null,
      last_route: null,
      last_provider: null,
      last_model: null,
      last_provider_response_id: null,
      message_count: 1,
      turn_count: 1,
      is_archived: false,
      archived_at: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
      last_message_at: "2026-05-01T00:00:00Z",
    };
  }

  it("skips the FTS RPC for queries shorter than the min length", async () => {
    const { supabase, rpcCalls } = makeMockSupabase({
      rpcs: {
        list_visible_chat_conversations: {
          data: [row("c1", "Roth review"), row("c2", "Q3 allocation")],
          error: null,
        },
      },
    });
    const out = await listConversations(supabase, {
      ownerEmail: "a@b",
      search: "Q", // too short — passes through
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    // Returns ALL rows — no client-side title filtering happens in
    // listConversations (the sidebar does that itself for short queries).
    expect(out.conversations.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    // Only the list RPC was called; search RPC never fired.
    expect(rpcCalls.map((c) => c.name)).toEqual(["list_visible_chat_conversations"]);
  });

  it("dispatches to search_chat_conversations RPC for queries >=3 chars + intersects with visible set", async () => {
    const { supabase, rpcCalls } = makeMockSupabase({
      rpcs: {
        list_visible_chat_conversations: {
          data: [
            row("c1", "Roth review"),
            row("c2", "Q3 allocation"),
            row("c3", "Estate planning"),
          ],
          error: null,
        },
        search_chat_conversations: {
          data: [{ conversation_id: "c1" }, { conversation_id: "c3" }],
          error: null,
        },
      },
    });
    const out = await listConversations(supabase, {
      ownerEmail: "a@b",
      search: "  retirement  ", // trimmed; 10 chars
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    // Only the IDs returned by the FTS RPC survive.
    expect(out.conversations.map((c) => c.id).sort()).toEqual(["c1", "c3"]);

    // Search RPC was called with the TRIMMED query + a sensible limit.
    const searchCall = rpcCalls.find((c) => c.name === "search_chat_conversations");
    expect(searchCall?.args).toMatchObject({
      viewer_email: "a@b",
      query: "retirement",
    });
    expect(typeof searchCall?.args.lim).toBe("number");
  });

  it("returns empty when FTS returns no matches (no client-side fallback)", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: {
        list_visible_chat_conversations: {
          data: [row("c1", "Roth review")],
          error: null,
        },
        search_chat_conversations: { data: [], error: null },
      },
    });
    const out = await listConversations(supabase, {
      ownerEmail: "a@b",
      search: "nothingmatches",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.conversations).toEqual([]);
  });

  it("propagates FTS RPC errors as a discriminated failure", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: {
        list_visible_chat_conversations: { data: [row("c1", "x")], error: null },
        search_chat_conversations: {
          data: null,
          error: { message: "search RPC blew up" },
        },
      },
    });
    const out = await listConversations(supabase, {
      ownerEmail: "a@b",
      search: "boom",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error");
    expect(out.error).toMatch(/search RPC blew up/);
  });
});

// ─── patchConversation — PR 19 pin support ────────────────────────────────

describe("patchConversation — isPinned (PR 19)", () => {
  function fixtureRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "c_1",
      owner_email: "advisor@firm.com",
      owner_user_id: null,
      title: "Renamed",
      last_client_id: null,
      last_route: null,
      last_provider: null,
      last_model: null,
      last_provider_response_id: null,
      message_count: 4,
      turn_count: 2,
      is_archived: false,
      archived_at: null,
      is_pinned: true,
      pinned_at: "2026-05-16T08:00:00Z",
      created_at: "2026-05-15T10:00:00Z",
      updated_at: "2026-05-16T08:00:00Z",
      last_message_at: "2026-05-16T08:00:00Z",
      ...overrides,
    };
  }

  it("sets is_pinned + pinned_at when pinning; clears pinned_at when unpinning", async () => {
    const { supabase, updates } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: { data: fixtureRow(), error: null },
      },
      rpcs: { chat_conversation_visible_to: { data: true, error: null } },
    });
    const pin = await patchConversation(supabase, {
      conversationId: "c_1",
      ownerEmail: "advisor@firm.com",
      isPinned: true,
    });
    expect(pin.ok).toBe(true);
    const pinUpdate = updates.find(
      (u) => u.table === "advisorpilot_chat_conversations",
    );
    const pinPayload = pinUpdate?.payload as Record<string, unknown>;
    expect(pinPayload.is_pinned).toBe(true);
    expect(typeof pinPayload.pinned_at).toBe("string");

    // Reset capture + run unpin.
    updates.length = 0;
    const unpin = await patchConversation(supabase, {
      conversationId: "c_1",
      ownerEmail: "advisor@firm.com",
      isPinned: false,
    });
    expect(unpin.ok).toBe(true);
    const unpinUpdate = updates.find(
      (u) => u.table === "advisorpilot_chat_conversations",
    );
    const unpinPayload = unpinUpdate?.payload as Record<string, unknown>;
    expect(unpinPayload.is_pinned).toBe(false);
    expect(unpinPayload.pinned_at).toBeNull();
  });

  it("returned ChatConversationSummary carries isPinned + pinnedAt", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: { data: fixtureRow(), error: null },
      },
      rpcs: { chat_conversation_visible_to: { data: true, error: null } },
    });
    const out = await patchConversation(supabase, {
      conversationId: "c_1",
      ownerEmail: "advisor@firm.com",
      isPinned: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.conversation.isPinned).toBe(true);
    expect(out.conversation.pinnedAt).toBe("2026-05-16T08:00:00Z");
  });

  it("rejects when no field is provided + error mentions all accepted fields", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_chat_conversations: { data: fixtureRow(), error: null } },
      rpcs: { chat_conversation_visible_to: { data: true, error: null } },
    });
    const out = await patchConversation(supabase, {
      conversationId: "c_1",
      ownerEmail: "advisor@firm.com",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error");
    expect(out.error).toMatch(/title.*isArchived.*isPinned/);
  });
});

// ─── appendUserMessage — PR 22 soft-resume foundation ─────────────────────

describe("appendUserMessage (PR 22)", () => {
  it("inserts user msg at message_count + 1 and bumps message_count + last_message_at", async () => {
    const { supabase, inserts, updates } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: () => ({
          data: { message_count: 4 },
          error: null,
        }),
        advisorpilot_chat_messages: { data: null, error: null },
      },
    });
    const out = await appendUserMessage(supabase, {
      conversationId: "c_1",
      userText: "Continue this thought.",
    });
    expect(out).toEqual({ ok: true, ordinal: 5 });

    // Message row landed at ordinal 5.
    const insert = inserts.find((i) => i.table === "advisorpilot_chat_messages");
    expect(insert?.payload).toMatchObject({
      conversation_id: "c_1",
      role: "user",
      ordinal: 5,
      content: "Continue this thought.",
    });

    // Header bumped message_count + last_message_at; turn_count NOT
    // incremented (turn is only "complete" after appendTurn runs).
    const headerUpdate = updates.find(
      (u) => u.table === "advisorpilot_chat_conversations",
    );
    expect(headerUpdate?.payload).toMatchObject({ message_count: 5 });
    expect(typeof (headerUpdate?.payload as { last_message_at: string }).last_message_at).toBe("string");
    expect((headerUpdate?.payload as { turn_count?: number }).turn_count).toBeUndefined();
  });

  it("returns 'Conversation not found.' when the conversation row is missing", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_chat_conversations: { data: null, error: null } },
    });
    const out = await appendUserMessage(supabase, {
      conversationId: "c_1",
      userText: "hello",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("Conversation not found.");
  });
});

describe("appendTurn — PR 22 userMessageOrdinal path", () => {
  it("SKIPS re-inserting the user message when userMessageOrdinal is provided", async () => {
    // Simulate state AFTER appendUserMessage already ran: message_count = 1.
    const { supabase, inserts } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: () => ({
          data: { message_count: 1, turn_count: 0, title: null },
          error: null,
        }),
        advisorpilot_chat_messages: { data: null, error: null },
      },
    });
    const out = await appendTurn(supabase, {
      conversationId: "c_1",
      ownerEmail: "a@b",
      userText: "what's my AUM",
      assistantText: "Your AUM is $42M.",
      userMessageOrdinal: 1,
    });
    expect(out.ok).toBe(true);

    const payload = (inserts.find((i) => i.table === "advisorpilot_chat_messages")?.payload ??
      []) as Array<Record<string, unknown>>;
    // ONLY the assistant message should have been inserted — at
    // ordinal 2 (one after the early-persisted user msg).
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      role: "assistant",
      ordinal: 2,
      content: "Your AUM is $42M.",
    });
  });

  it("auto-derives title on first turn when userMessageOrdinal === 1 (user msg already persisted at ordinal 1)", async () => {
    const { supabase, updates } = makeMockSupabase({
      tables: {
        advisorpilot_chat_conversations: () => ({
          data: { message_count: 1, turn_count: 0, title: null },
          error: null,
        }),
        advisorpilot_chat_messages: { data: null, error: null },
      },
    });
    const out = await appendTurn(supabase, {
      conversationId: "c_1",
      ownerEmail: "a@b",
      userText: "Show me Q3 AUM by stage. Compare last quarter.",
      assistantText: "Sure…",
      userMessageOrdinal: 1,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(out.nextTitle).toBe("Show me Q3 AUM by stage.");

    const headerUpdate = updates.find(
      (u) => u.table === "advisorpilot_chat_conversations",
    );
    expect(headerUpdate?.payload).toMatchObject({
      title: "Show me Q3 AUM by stage.",
      turn_count: 1,
    });
  });
});
