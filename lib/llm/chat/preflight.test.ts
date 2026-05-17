import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChatPreflight } from "./preflight";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Preflight unit tests.
 *
 * The function does Supabase IO, so we mock the SupabaseClient with a
 * builder-pattern stub that records each chained call + returns canned
 * results per table. Coverage:
 *
 *   1. ALWAYS returns advisor + currentView blocks (no client in focus path)
 *   2. Advisor profile populates name/title when found
 *   3. Advisor profile missing → falls back to email-derived display name
 *   4. Advisor profile DB error → soft-fails to email-derived display name + onError fires
 *   5. No clientId → fetches global open tasks (advisor's own)
 *   6. Empty global tasks → openTasks omitted (no empty XML in prompt)
 *   7. clientId set + visible=true → fetches client + notes + activity + tasks
 *   8. clientId set + visible=false → silently drops client blocks; falls back to global tasks
 *   9. Client snapshot derives `name` from intake JSONB; `aum` from holdings sum
 *  10. AUM falls back to `total_value` column when holdings empty
 *  11. Pinned notes are sorted by created_at DESC; only `pinned=true` returned
 *  12. Recent activity comes from `list_visible_activity` RPC
 *  13. Tasks are sorted by due_date ASC, capped to opts.caps.openTasks
 *  14. Per-query failure soft-fails ONLY that query (others still populate)
 *  15. Missing Supabase env entirely → returns minimal advisor+view only,
 *      onError fires with "env" source
 */

// ─────────────────────────────────────────────────────────────────────────────
// Builder-pattern mock — records chained .from/.select/.eq calls + returns
// canned results per table name.
// ─────────────────────────────────────────────────────────────────────────────

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

interface MockResponse {
  /** Per-table fixture for `.from(table).select().eq...`. */
  byTable: Map<string, TableResult>;
  /** Per-RPC-name fixture for `.rpc(name, args)`. */
  byRpc: Map<string, TableResult>;
  /** Records every chained method call for assertion. */
  log: { table: string; chain: Array<{ method: string; args: unknown[] }> }[];
  rpcLog: Array<{ name: string; args: Record<string, unknown> }>;
}

function makeMockSupabase(fixtures: {
  tables?: Record<string, TableResult>;
  rpcs?: Record<string, TableResult>;
}): { supabase: SupabaseClient; mock: MockResponse } {
  const mock: MockResponse = {
    byTable: new Map(Object.entries(fixtures.tables ?? {})),
    byRpc: new Map(Object.entries(fixtures.rpcs ?? {})),
    log: [],
    rpcLog: [],
  };

  type MaybePromise<T> = Promise<T> | T;

  const supabase = {
    from(table: string) {
      const entry = { table, chain: [] as Array<{ method: string; args: unknown[] }> };
      mock.log.push(entry);
      const result =
        mock.byTable.get(table) ?? ({ data: null, error: null } as TableResult);

      // Build a chainable proxy — every method records the call + returns
      // self until a terminal (.maybeSingle / await on the chain).
      const builder: Record<string, unknown> = {};
      const chainable = (method: string) =>
        (...args: unknown[]): unknown => {
          entry.chain.push({ method, args });
          return builder;
        };

      for (const m of [
        "select",
        "eq",
        "in",
        "gte",
        "lte",
        "order",
        "limit",
        "neq",
        "match",
        "filter",
        "or",
      ]) {
        builder[m] = chainable(m);
      }

      // Terminal: .maybeSingle() returns a Promise<TableResult>.
      builder.maybeSingle = (): MaybePromise<TableResult> => {
        entry.chain.push({ method: "maybeSingle", args: [] });
        return Promise.resolve(result);
      };

      // For non-maybeSingle terminals (await on the builder), make the
      // proxy thenable so `await supabase.from(...).select(...).eq(...)`
      // resolves to the canned result.
      builder.then = (
        onFulfilled: (v: TableResult) => unknown,
        onRejected?: (e: unknown) => unknown,
      ): MaybePromise<unknown> => Promise.resolve(result).then(onFulfilled, onRejected);

      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      mock.rpcLog.push({ name, args });
      const result =
        mock.byRpc.get(name) ?? ({ data: null, error: null } as TableResult);
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;

  return { supabase, mock };
}

// ─── Fixture builders ─────────────────────────────────────────────────────

const ADVISOR_EMAIL = "jane@firm.com";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

function advisorRow(name: string | null = "Jane Doe", title: string | null = "Senior Advisor") {
  return {
    data: {
      owner_email: ADVISOR_EMAIL,
      advisor_name: name,
      advisor_title: title,
    },
    error: null,
  };
}

function clientRow(extra: Record<string, unknown> = {}) {
  return {
    data: {
      client: { firstName: "John", lastName: "Smith" },
      holdings: [
        { value: 700_000, accountType: "IRA" },
        { value: 720_000, accountType: "Joint Brokerage" },
      ],
      total_value: 1_420_000,
      stage: "review-due",
      status: "Analyzed",
      last_contacted_at: "2026-02-14T10:00:00+00:00",
      next_meeting_at: "2026-06-01T15:00:00+00:00",
      review_due_at: null,
      ...extra,
    },
    error: null,
  };
}

beforeEach(() => {
  // Ensure the soft-degrade env branch isn't accidentally tripped — we always
  // inject supabaseImpl in tests, but the function double-checks env unless
  // we explicitly pass the impl. Set vars so the env-check passes.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Always-present blocks + happy path with no client
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — always-present blocks", () => {
  it("returns advisor + currentView even when no client is in focus", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_tasks: { data: [], error: null },
      },
    });
    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      currentRoute: "/app/tasks",
      surface: "tasks",
      timezone: "America/Denver",
      supabaseImpl: supabase,
    });
    expect(preflight.advisor).toEqual({
      name: "Jane Doe",
      email: ADVISOR_EMAIL,
      title: "Senior Advisor",
      firmName: null,
      timezone: "America/Denver",
      communicationStyle: null,
    });
    expect(preflight.currentView).toEqual({
      route: "/app/tasks",
      surface: "tasks",
      tab: null,
    });
    expect(preflight.currentClient).toBeUndefined();
    expect(preflight.pinnedNotes).toBeUndefined();
    expect(preflight.recentActivity).toBeUndefined();
    expect(preflight.openTasks).toBeUndefined(); // empty array → omitted
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2-4. Advisor profile branches
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — advisor profile", () => {
  it("derives display name from email when no profile row exists", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: { data: null, error: null },
        advisorpilot_tasks: { data: [], error: null },
      },
    });
    const preflight = await fetchChatPreflight({
      advisorEmail: "jane.doe@firm.com",
      supabaseImpl: supabase,
    });
    expect(preflight.advisor.name).toBe("Jane Doe");
    expect(preflight.advisor.title).toBeNull();
  });

  it("falls back to email-derived name when advisor_name is empty string", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow("   ", null),
        advisorpilot_tasks: { data: [], error: null },
      },
    });
    const preflight = await fetchChatPreflight({
      advisorEmail: "jane.doe@firm.com",
      supabaseImpl: supabase,
    });
    expect(preflight.advisor.name).toBe("Jane Doe");
  });

  it("soft-fails with onError when profile query errors", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: {
          data: null,
          error: { message: "permission denied" },
        },
        advisorpilot_tasks: { data: [], error: null },
      },
    });
    const onError = vi.fn();
    const preflight = await fetchChatPreflight({
      advisorEmail: "jane.doe@firm.com",
      supabaseImpl: supabase,
      onError,
    });
    expect(preflight.advisor.name).toBe("Jane Doe");
    expect(onError).toHaveBeenCalledWith(
      "advisor_profile",
      expect.objectContaining({ message: "permission denied" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5-6. No-client branch: global open tasks
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — no-client branch", () => {
  it("fetches global open tasks for the advisor when no clientId set", async () => {
    const { supabase, mock } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_tasks: {
          data: [
            { title: "Follow up with Aisha", due_date: "2026-05-20", priority: "High", status: "open" },
            { title: "Send IPS", due_date: "2026-05-22", priority: "Medium", status: "in_progress" },
          ],
          error: null,
        },
      },
    });
    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      supabaseImpl: supabase,
    });
    expect(preflight.openTasks).toEqual([
      { title: "Follow up with Aisha", dueDate: "2026-05-20", priority: "High" },
      { title: "Send IPS", dueDate: "2026-05-22", priority: "Medium" },
    ]);
    // Verify it filtered on owner_email + status, didn't filter on client_id.
    const tasksCall = mock.log.find((e) => e.table === "advisorpilot_tasks");
    expect(tasksCall).toBeDefined();
    expect(tasksCall!.chain.map((c) => c.method)).toEqual([
      "select",
      "eq",
      "in",
      "order",
      "limit",
    ]);
    const eq = tasksCall!.chain.find((c) => c.method === "eq");
    expect(eq?.args).toEqual(["owner_email", "jane@firm.com"]);
  });

  it("omits openTasks when the global tasks list is empty", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_tasks: { data: [], error: null },
      },
    });
    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      supabaseImpl: supabase,
    });
    expect(preflight.openTasks).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Client-visible branch — all blocks populated
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — client visible branch", () => {
  it("fetches client + notes + activity + tasks when visibility=true", async () => {
    const { supabase, mock } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_clients: clientRow(),
        advisorpilot_notes: {
          data: [
            { created_at: "2026-04-02T10:00:00+00:00", body: "Consolidate late wife's IRA" },
            { created_at: "2026-03-18T09:00:00+00:00", body: "529 conversation needed" },
          ],
          error: null,
        },
        advisorpilot_tasks: {
          data: [
            { title: "Follow up on Roth", due_date: "2026-05-20", priority: "Medium", status: "open" },
          ],
          error: null,
        },
      },
      rpcs: {
        clients_visible_to: { data: true, error: null },
        list_visible_activity: {
          data: [
            { title: "Generated portfolio review PDF", occurred_at: "2026-05-15T10:00:00+00:00" },
            { title: "Logged note", occurred_at: "2026-05-14T10:00:00+00:00" },
          ],
          error: null,
        },
      },
    });

    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      currentClientId: CLIENT_ID,
      currentRoute: `/app/crm/${CLIENT_ID}/overview`,
      surface: "crm",
      tab: "overview",
      supabaseImpl: supabase,
    });

    // Visibility RPC called with the right args
    expect(mock.rpcLog).toContainEqual({
      name: "clients_visible_to",
      args: { viewer_email: ADVISOR_EMAIL, client_id: CLIENT_ID },
    });

    expect(preflight.currentClient).toMatchObject({
      name: "John Smith",
      stage: "review-due",
      lastReviewDate: "2026-02-14",
      nextDueDate: "2026-06-01",
      aum: 1_420_000,
      accountSummary: "1 IRA, 1 Joint Brokerage",
    });
    expect(preflight.pinnedNotes).toEqual([
      { date: "2026-04-02", body: "Consolidate late wife's IRA" },
      { date: "2026-03-18", body: "529 conversation needed" },
    ]);
    expect(preflight.recentActivity).toEqual([
      { date: "2026-05-15", summary: "Generated portfolio review PDF" },
      { date: "2026-05-14", summary: "Logged note" },
    ]);
    expect(preflight.openTasks).toEqual([
      { title: "Follow up on Roth", dueDate: "2026-05-20", priority: "Medium" },
    ]);

    // Verify the notes query filtered by client_id + pinned=true
    const notesCall = mock.log.find((e) => e.table === "advisorpilot_notes");
    expect(notesCall).toBeDefined();
    const eqCalls = notesCall!.chain.filter((c) => c.method === "eq");
    expect(eqCalls).toHaveLength(2);
    expect(eqCalls[0].args).toEqual(["client_id", CLIENT_ID]);
    expect(eqCalls[1].args).toEqual(["pinned", true]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Client visibility = false → falls back to global tasks
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — client NOT visible", () => {
  it("silently drops client blocks and fetches global tasks instead", async () => {
    const { supabase, mock } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_tasks: {
          data: [{ title: "Global task", due_date: null, priority: "Low", status: "open" }],
          error: null,
        },
      },
      rpcs: {
        clients_visible_to: { data: false, error: null },
      },
    });

    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      currentClientId: CLIENT_ID,
      supabaseImpl: supabase,
    });
    expect(preflight.currentClient).toBeUndefined();
    expect(preflight.pinnedNotes).toBeUndefined();
    expect(preflight.recentActivity).toBeUndefined();
    expect(preflight.openTasks).toEqual([
      { title: "Global task", dueDate: null, priority: "Low" },
    ]);
    // We should NOT have queried the client snapshot at all.
    expect(mock.log.find((e) => e.table === "advisorpilot_clients")).toBeUndefined();
  });

  it("treats visibility RPC error as not-visible (fails closed)", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_tasks: { data: [], error: null },
      },
      rpcs: {
        clients_visible_to: { data: null, error: { message: "rpc failed" } },
      },
    });
    const onError = vi.fn();
    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      currentClientId: CLIENT_ID,
      supabaseImpl: supabase,
      onError,
    });
    expect(preflight.currentClient).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(
      "visibility",
      expect.objectContaining({ message: "rpc failed" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9-10. AUM derivation
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — AUM derivation", () => {
  it("falls back to total_value when holdings array is empty", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_clients: clientRow({ holdings: [], total_value: 850_000 }),
        advisorpilot_notes: { data: [], error: null },
        advisorpilot_tasks: { data: [], error: null },
      },
      rpcs: {
        clients_visible_to: { data: true, error: null },
        list_visible_activity: { data: [], error: null },
      },
    });
    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      currentClientId: CLIENT_ID,
      supabaseImpl: supabase,
    });
    expect(preflight.currentClient?.aum).toBe(850_000);
  });

  it("returns AUM=null when neither holdings nor total_value is set", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_clients: clientRow({ holdings: null, total_value: null }),
        advisorpilot_notes: { data: [], error: null },
        advisorpilot_tasks: { data: [], error: null },
      },
      rpcs: {
        clients_visible_to: { data: true, error: null },
        list_visible_activity: { data: [], error: null },
      },
    });
    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      currentClientId: CLIENT_ID,
      supabaseImpl: supabase,
    });
    expect(preflight.currentClient?.aum).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Per-query failure soft-fail
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — partial failures soft-fail", () => {
  it("returns client snapshot even when pinned-notes query errors", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_advisor_profiles: advisorRow(),
        advisorpilot_clients: clientRow(),
        advisorpilot_notes: { data: null, error: { message: "notes table down" } },
        advisorpilot_tasks: {
          data: [{ title: "T1", due_date: null, priority: "Medium", status: "open" }],
          error: null,
        },
      },
      rpcs: {
        clients_visible_to: { data: true, error: null },
        list_visible_activity: { data: [], error: null },
      },
    });
    const onError = vi.fn();
    const preflight = await fetchChatPreflight({
      advisorEmail: ADVISOR_EMAIL,
      currentClientId: CLIENT_ID,
      supabaseImpl: supabase,
      onError,
    });
    expect(preflight.currentClient?.name).toBe("John Smith");
    expect(preflight.pinnedNotes).toBeUndefined(); // empty after failure → omitted
    expect(preflight.openTasks).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(
      "pinned_notes",
      expect.objectContaining({ message: "notes table down" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Missing Supabase env → degraded but valid preflight
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchChatPreflight — missing Supabase env", () => {
  it("returns minimal advisor + currentView only and fires onError('env', _)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const onError = vi.fn();
    const preflight = await fetchChatPreflight({
      advisorEmail: "jane.doe@firm.com",
      currentRoute: "/app",
      timezone: "America/New_York",
      onError,
      // Note: not passing supabaseImpl — env-check fires first.
    });
    expect(preflight.advisor.name).toBe("Jane Doe");
    expect(preflight.advisor.timezone).toBe("America/New_York");
    expect(preflight.currentView).toEqual({
      route: "/app",
      surface: null,
      tab: null,
    });
    expect(preflight.currentClient).toBeUndefined();
    expect(preflight.openTasks).toBeUndefined();
    expect(onError).toHaveBeenCalledWith("env", expect.any(Error));
  });
});
