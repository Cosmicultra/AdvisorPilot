import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manageClientTool } from "./manage-client";
import type { ChatToolContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `manage_client` tests — covers the things that differ from
 * manage_note/manage_task:
 *
 *   1. Only `update` is supported; create/delete are rejected with clear errors
 *   2. Ownership gate fires on execute path (visible BUT not owner → rejected)
 *   3. Validation: stage enum, dueDate format, inceptionYear bounds, ytdReturn bounds
 *   4. Preview returns diff with the client's display name
 */

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}
interface FromSpy {
  table: string;
  calls: Array<{ method: string; args: unknown[] }>;
  updatePayload?: unknown;
}
interface MockBundle {
  supabase: SupabaseClient;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  fromCalls: FromSpy[];
}

function makeMockSupabase(fixtures: {
  tables?: Record<string, TableResult>;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const chainable = (method: string) =>
        (...args: unknown[]) => {
          spy.calls.push({ method, args });
          if (method === "update") spy.updatePayload = args[0];
          return builder;
        };
      for (const m of ["select", "eq", "update", "insert"]) builder[m] = chainable(m);
      builder.maybeSingle = () => Promise.resolve(fixture);
      builder.single = () => Promise.resolve(fixture);
      builder.then = (
        ok: (v: TableResult) => unknown,
        err?: (e: unknown) => unknown,
      ) => Promise.resolve(fixture).then(ok, err);
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

const CTX = (supabase: SupabaseClient): ChatToolContext => ({
  advisorEmail: "jane@firm.com",
  conversationId: "conv_1",
  currentClientId: CLIENT_ID,
  supabase,
  request: null,
  selection: null,
  emitPartial: () => undefined,
});

function clientRow(extra: Record<string, unknown> = {}) {
  return {
    id: CLIENT_ID,
    owner_email: "jane@firm.com",
    client: { firstName: "John", lastName: "Smith" },
    holdings: [],
    total_value: 1_000_000,
    stage: "Stable",
    status: "Analyzed",
    tags: [],
    location: null,
    email: null,
    phone: null,
    last_contacted_at: null,
    next_meeting_at: null,
    review_due_at: null,
    owner_initials: "JS",
    household_label: "Smith Household",
    inception_year: 2024,
    ytd_return: 0.05,
    org_id: null,
    visibility: "private",
    owner_user_id: null,
    meeting_notes: null,
    demo_mode: false,
    analysis: null,
    source: null,
    roth_worksheet: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    ...extra,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("manage_client — operation gate", () => {
  it("rejects create", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageClientTool.handler(
      { operation: "create", clientId: CLIENT_ID },
      CTX(supabase),
    );
    expect(r.error).toMatch(/Unknown operation/);
  });

  it("rejects delete", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageClientTool.handler(
      { operation: "delete", clientId: CLIENT_ID },
      CTX(supabase),
    );
    expect(r.error).toMatch(/Unknown operation/);
  });
});

describe("manage_client — update validation", () => {
  it("rejects invalid stage", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageClientTool.handler(
      { operation: "update", clientId: CLIENT_ID, stage: "Hibernating" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/stage/);
  });

  it("rejects inceptionYear out of range", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageClientTool.handler(
      { operation: "update", clientId: CLIENT_ID, inceptionYear: 1800 },
      CTX(supabase),
    );
    expect(r.error).toMatch(/1900 and 2100/);
  });

  it("rejects ytdReturn outside [-1, 5]", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageClientTool.handler(
      { operation: "update", clientId: CLIENT_ID, ytdReturn: 9.5 },
      CTX(supabase),
    );
    expect(r.error).toMatch(/-1 and 5/);
  });

  it("rejects when no patch fields are provided", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageClientTool.handler(
      { operation: "update", clientId: CLIENT_ID },
      CTX(supabase),
    );
    expect(r.error).toMatch(/at least one/);
  });

  it("rejects invalid nextMeetingAt format", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageClientTool.handler(
      { operation: "update", clientId: CLIENT_ID, nextMeetingAt: "next Tuesday" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/ISO datetime/);
  });
});

describe("manage_client — update preview + ownership", () => {
  it("preview includes clientName + diff", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: clientRow(), error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await manageClientTool.handler(
      { operation: "update", clientId: CLIENT_ID, stage: "Review due", tags: ["focus"] },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      action: string;
      clientName: string;
      diff: Record<string, { before: unknown; after: unknown }>;
    };
    expect(out.preview).toBe(true);
    expect(out.action).toBe("update_client");
    expect(out.clientName).toBe("John Smith");
    expect(out.diff.stage).toEqual({ before: "Stable", after: "Review due" });
    expect(out.diff.tags).toEqual({ before: [], after: ["focus"] });
  });

  it("rejects execute when viewer is not the client owner", async () => {
    const otherOwnerRow = clientRow({ owner_email: "other@firm.com" });
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: otherOwnerRow, error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await manageClientTool.handler(
      {
        operation: "update",
        clientId: CLIENT_ID,
        stage: "At risk",
        _confirmed: true,
      },
      CTX(supabase),
    );
    expect(r.error).toMatch(/Only the client's owner/);
  });

  it("confirmed update writes the patch fields to advisorpilot_clients", async () => {
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: clientRow(), error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    await manageClientTool.handler(
      {
        operation: "update",
        clientId: CLIENT_ID,
        stage: "Review due",
        location: "Boulder, CO",
        _confirmed: true,
      },
      CTX(supabase),
    );
    const clientUpdate = fromCalls.find(
      (f) => f.table === "advisorpilot_clients" && f.updatePayload !== undefined,
    );
    expect(clientUpdate?.updatePayload).toEqual({
      stage: "Review due",
      location: "Boulder, CO",
    });
  });
});
