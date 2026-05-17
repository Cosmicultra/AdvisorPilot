import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub ensurePersonalOrg — it builds its own service-role client at runtime
// and we don't want network reach-through during unit tests. The chat tool's
// ctx.supabase is what we mock here; this stub returns a fake org id for the
// fallback path (client row has no org_id).
vi.mock("@/lib/crm/ensure-personal-org", () => ({
  ensurePersonalOrg: vi.fn(async () => "personal-org-test"),
}));

import { manageNoteTool } from "./manage-note";
import type { ChatToolContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `manage_note` tests.
 *
 * Covers the three operations and the T2/T3/T4 confirmation flow:
 *
 *   1. CREATE (T2) — direct execute; visibility gate; org_id inheritance;
 *                    activity_log + bumpLastContactedAt side effects
 *   2. UPDATE (T3) — preview then confirm; only changed fields surface in diff
 *   3. DELETE (T4) — preview returns snapshot; confirm deletes + writes activity_log
 *   4. Validation — UUID checks, body length, missing fields
 *
 * Supabase is mocked with a builder-pattern stub (same as preflight/query-crm tests).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Stub Supabase
// ─────────────────────────────────────────────────────────────────────────────

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

interface FromSpy {
  table: string;
  calls: Array<{ method: string; args: unknown[] }>;
  insertPayload?: unknown;
  updatePayload?: unknown;
  didDelete?: boolean;
}

interface MockBundle {
  supabase: SupabaseClient;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  fromCalls: FromSpy[];
}

function makeMockSupabase(fixtures: {
  tables?: Record<string, TableResult | ((spy: FromSpy) => TableResult)>;
  rpcs?: Record<string, TableResult>;
}): MockBundle {
  const byRpc = new Map(Object.entries(fixtures.rpcs ?? {}));
  const tableFixtures = fixtures.tables ?? {};
  const rpcCalls: MockBundle["rpcCalls"] = [];
  const fromCalls: FromSpy[] = [];

  const supabase = {
    from(table: string) {
      const spy: FromSpy = { table, calls: [] };
      fromCalls.push(spy);

      const fixture = tableFixtures[table] ?? { data: null, error: null };
      const resolve = (): TableResult =>
        typeof fixture === "function" ? fixture(spy) : fixture;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const chainable = (method: string) =>
        (...args: unknown[]) => {
          spy.calls.push({ method, args });
          if (method === "insert" || method === "upsert") spy.insertPayload = args[0];
          if (method === "update") spy.updatePayload = args[0];
          if (method === "delete") spy.didDelete = true;
          return builder;
        };
      for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "upsert", "delete"]) {
        builder[m] = chainable(m);
      }
      builder.maybeSingle = () => Promise.resolve(resolve());
      builder.single = () => Promise.resolve(resolve());
      builder.then = (
        onFulfilled: (v: TableResult) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      const result = byRpc.get(name) ?? ({ data: null, error: null } as TableResult);
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;

  return { supabase, rpcCalls, fromCalls };
}

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";
const NOTE_ID = "22222222-2222-2222-2222-222222222222";

const CTX = (supabase: SupabaseClient): ChatToolContext => ({
  advisorEmail: "jane@firm.com",
  conversationId: "conv_1",
  currentClientId: CLIENT_ID,
  supabase,
  request: null,
  selection: null,
  emitPartial: () => undefined,
});

function noteRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: NOTE_ID,
    owner_email: "jane@firm.com",
    owner_user_id: null,
    client_id: CLIENT_ID,
    org_id: "org-1",
    visibility: "private",
    author_email: "jane@firm.com",
    body: "Original body",
    tags: [],
    pinned: false,
    source: "manual",
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    ...overrides,
  };
}

beforeEach(() => {
  // ensurePersonalOrg now lazy-inits; ensure env is set so it doesn't throw
  // when CREATE has to fall back to the personal-org path.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Operation gate
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_note — operation gate", () => {
  it("rejects unknown operation", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageNoteTool.handler({ operation: "destroy" }, CTX(supabase));
    expect(r.error).toMatch(/Unknown operation/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE (T2 — no confirmation)
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_note — create", () => {
  it("happy path: visibility check + insert + activity_log + bumpLastContactedAt", async () => {
    const inserted = noteRow({ body: "New note body", pinned: true });
    const { supabase, rpcCalls, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_clients: { data: { org_id: "org-x" }, error: null },
        advisorpilot_notes: { data: inserted, error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: {
        clients_visible_to: { data: true, error: null },
      },
    });

    const r = await manageNoteTool.handler(
      {
        operation: "create",
        clientId: CLIENT_ID,
        body: "New note body",
        pinned: true,
        tags: ["follow-up"],
      },
      CTX(supabase),
    );

    const out = r.result as { success: boolean; note: { body: string; pinned: boolean } };
    expect(out.success).toBe(true);
    expect(out.note.body).toBe("New note body");
    expect(out.note.pinned).toBe(true);

    // Visibility check ran on the parent client.
    expect(rpcCalls).toContainEqual({
      name: "clients_visible_to",
      args: { viewer_email: "jane@firm.com", client_id: CLIENT_ID },
    });

    // Note inserted with the right payload.
    const noteInsert = fromCalls.find((f) => f.table === "advisorpilot_notes");
    expect(noteInsert?.insertPayload).toMatchObject({
      owner_email: "jane@firm.com",
      client_id: CLIENT_ID,
      org_id: "org-x",
      body: "New note body",
      pinned: true,
      tags: ["follow-up"],
      source: "manual",
    });

    // Activity log entry written.
    const activityInsert = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect(activityInsert?.insertPayload).toMatchObject({
      type: "note",
      title: "Note logged",
      client_id: CLIENT_ID,
    });

    // last_contacted_at bumped on the client row.
    const clientUpdate = fromCalls.find(
      (f) => f.table === "advisorpilot_clients" && f.updatePayload !== undefined,
    );
    expect(clientUpdate?.updatePayload).toHaveProperty("last_contacted_at");
  });

  it("rejects when parent client is not visible", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: { clients_visible_to: { data: false, error: null } },
    });
    const r = await manageNoteTool.handler(
      { operation: "create", clientId: CLIENT_ID, body: "x" },
      CTX(supabase),
    );
    expect(r.error).toBe("Client not found.");
  });

  it("rejects empty body", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageNoteTool.handler(
      { operation: "create", clientId: CLIENT_ID, body: "   " },
      CTX(supabase),
    );
    expect(r.error).toMatch(/`body` cannot be empty/);
  });

  it("rejects missing clientId", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageNoteTool.handler(
      { operation: "create", body: "no client" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/clientId.*UUID/i);
  });

  it("rejects invalid source enum", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageNoteTool.handler(
      { operation: "create", clientId: CLIENT_ID, body: "x", source: "snail_mail" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/source/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE (T3 — preview then confirm)
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_note — update", () => {
  it("first call (no _confirmed) returns preview with diff; does NOT write", async () => {
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_notes: { data: noteRow({ body: "old", pinned: false }), error: null } },
      rpcs: { notes_visible_to: { data: true, error: null } },
    });

    const r = await manageNoteTool.handler(
      { operation: "update", noteId: NOTE_ID, body: "new", pinned: true },
      CTX(supabase),
    );

    const out = r.result as {
      preview: boolean;
      action: string;
      confirmationRequired: boolean;
      noteId: string;
      diff: Record<string, { before: unknown; after: unknown }>;
    };
    expect(out.preview).toBe(true);
    expect(out.action).toBe("update_note");
    expect(out.confirmationRequired).toBe(true);
    expect(out.noteId).toBe(NOTE_ID);
    expect(out.diff).toEqual({
      body: { before: "old", after: "new" },
      pinned: { before: false, after: true },
    });

    // No update was performed.
    expect(fromCalls.find((f) => f.updatePayload !== undefined)).toBeUndefined();
  });

  it("second call (_confirmed:true) writes + emits activity_log", async () => {
    const beforeRow = noteRow({ body: "old", pinned: false });
    const afterRow = noteRow({ body: "new", pinned: true });
    // The mock returns the same fixture for both maybeSingle and single — for
    // this test that's fine because update() then .single() returns it.
    let callCount = 0;
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_notes: (() => () => {
          // First read is the existing row; subsequent is the post-update row.
          callCount += 1;
          return { data: callCount === 1 ? beforeRow : afterRow, error: null };
        })(),
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { notes_visible_to: { data: true, error: null } },
    });

    const r = await manageNoteTool.handler(
      {
        operation: "update",
        noteId: NOTE_ID,
        body: "new",
        pinned: true,
        _confirmed: true,
      },
      CTX(supabase),
    );

    const out = r.result as {
      success: boolean;
      action: string;
      note: { body: string; pinned: boolean };
      changedFields: string[];
    };
    expect(out.success).toBe(true);
    expect(out.action).toBe("update_note");
    expect(out.note.body).toBe("new");
    expect(out.note.pinned).toBe(true);
    expect(out.changedFields.sort()).toEqual(["body", "pinned"]);

    // Update was performed with the right patch payload.
    const noteUpdate = fromCalls.find(
      (f) => f.table === "advisorpilot_notes" && f.updatePayload !== undefined,
    );
    expect(noteUpdate?.updatePayload).toEqual({ body: "new", pinned: true });

    // Activity log entry written.
    const activityInsert = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect(activityInsert?.insertPayload).toBeDefined();
  });

  it("rejects when no patch fields are supplied", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageNoteTool.handler(
      { operation: "update", noteId: NOTE_ID },
      CTX(supabase),
    );
    expect(r.error).toMatch(/at least one/);
  });

  it("rejects update on non-visible note (404 path)", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: { notes_visible_to: { data: false, error: null } },
    });
    const r = await manageNoteTool.handler(
      { operation: "update", noteId: NOTE_ID, pinned: true },
      CTX(supabase),
    );
    expect(r.error).toBe("Note not found.");
  });

  it("no-op update returns a clear error during preview", async () => {
    const sameRow = noteRow({ body: "same", pinned: true });
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_notes: { data: sameRow, error: null } },
      rpcs: { notes_visible_to: { data: true, error: null } },
    });
    const r = await manageNoteTool.handler(
      { operation: "update", noteId: NOTE_ID, body: "same", pinned: true },
      CTX(supabase),
    );
    expect(r.error).toMatch(/No-op update/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (T4 — preview then confirm)
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_note — delete", () => {
  it("preview returns snapshot + clientId without deleting", async () => {
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_notes: { data: noteRow({ body: "Some content" }), error: null } },
      rpcs: { notes_visible_to: { data: true, error: null } },
    });
    const r = await manageNoteTool.handler(
      { operation: "delete", noteId: NOTE_ID },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      action: string;
      noteId: string;
      snapshot: { clientId: string; body: string };
    };
    expect(out.preview).toBe(true);
    expect(out.action).toBe("delete_note");
    expect(out.snapshot.clientId).toBe(CLIENT_ID);
    expect(out.snapshot.body).toBe("Some content");
    // No delete performed.
    expect(fromCalls.some((f) => f.didDelete)).toBe(false);
  });

  it("confirmed call performs delete + writes activity_log", async () => {
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_notes: { data: noteRow({ body: "ContentToDelete" }), error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { notes_visible_to: { data: true, error: null } },
    });
    const r = await manageNoteTool.handler(
      { operation: "delete", noteId: NOTE_ID, _confirmed: true },
      CTX(supabase),
    );
    const out = r.result as { success: boolean; deleted: boolean; noteId: string };
    expect(out.success).toBe(true);
    expect(out.deleted).toBe(true);
    expect(out.noteId).toBe(NOTE_ID);

    // Delete was performed.
    const noteDelete = fromCalls.find(
      (f) => f.table === "advisorpilot_notes" && f.didDelete,
    );
    expect(noteDelete).toBeDefined();

    // Activity log written.
    const activityInsert = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect(activityInsert?.insertPayload).toMatchObject({
      type: "note",
      title: "Note deleted",
    });
  });

  it("rejects delete on non-visible note (404 path)", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: { notes_visible_to: { data: false, error: null } },
    });
    const r = await manageNoteTool.handler(
      { operation: "delete", noteId: NOTE_ID },
      CTX(supabase),
    );
    expect(r.error).toBe("Note not found.");
  });

  it("rejects missing noteId", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageNoteTool.handler(
      { operation: "delete" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/noteId/);
  });
});
