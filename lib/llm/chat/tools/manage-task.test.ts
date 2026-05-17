import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub ensurePersonalOrg — it builds its own service-role client at runtime
// and we don't want network reach-through during unit tests. The chat tool's
// ctx.supabase is what we mock; this stub returns a fake org id whenever the
// fallback fires (clientId=null path).
vi.mock("@/lib/crm/ensure-personal-org", () => ({
  ensurePersonalOrg: vi.fn(async () => "personal-org-test"),
}));

import { manageTaskTool } from "./manage-task";
import type { ChatToolContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `manage_task` tests — focused on what's distinct from manage_note:
 *
 *   1. CREATE with clientId=null (personal/global task) — skips visibility RPC
 *   2. UPDATE status transition → activity_log title reflects the transition
 *      ("Task completed", "Task reopened", etc.)
 *   3. COMPLETE — sugar for update(status:'done'); preview-then-confirm
 *   4. COMPLETE on already-completed task returns an error
 *   5. Validation — dueDate format, priority enum, status enum
 *
 * Shape-level coverage (insert payload, delete behavior) is identical to
 * manage-note and tested there; we only repeat the distinctive behaviors.
 */

// Same builder-pattern mock as manage-note.test.ts. Duplicated here so each
// test file is self-contained (cheaper than extracting to a shared util).

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
  tables?: Record<string, TableResult | (() => TableResult)>;
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
      const resolve = (): TableResult => (typeof fixture === "function" ? fixture() : fixture);

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
      for (const m of ["select", "eq", "in", "order", "limit", "insert", "update", "upsert", "delete"]) {
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
const TASK_ID = "33333333-3333-3333-3333-333333333333";

const CTX = (supabase: SupabaseClient): ChatToolContext => ({
  advisorEmail: "jane@firm.com",
  conversationId: "conv_1",
  currentClientId: CLIENT_ID,
  supabase,
  request: null,
  selection: null,
  emitPartial: () => undefined,
});

function taskRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    owner_email: "jane@firm.com",
    owner_user_id: null,
    client_id: CLIENT_ID,
    org_id: "org-1",
    visibility: "private",
    title: "Default task",
    description: null,
    due_date: null,
    due_time: null,
    priority: "Medium",
    status: "open",
    completed_at: null,
    reminder_at: null,
    tags: [],
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE — personal/global task path (no clientId)
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_task — create", () => {
  it("clientId=null path skips clients_visible_to RPC", async () => {
    const { supabase, rpcCalls } = makeMockSupabase({
      tables: {
        advisorpilot_tasks: {
          data: taskRow({ client_id: null, title: "Personal todo", priority: "High" }),
          error: null,
        },
        advisorpilot_activity_log: { data: null, error: null },
      },
    });
    const r = await manageTaskTool.handler(
      {
        operation: "create",
        clientId: null,
        title: "Personal todo",
        priority: "High",
      },
      CTX(supabase),
    );
    const out = r.result as { success: boolean; task: { title: string; priority: string } };
    expect(out.success).toBe(true);
    expect(out.task.title).toBe("Personal todo");
    expect(out.task.priority).toBe("High");
    // Visibility RPC is skipped when clientId is null.
    expect(rpcCalls.find((c) => c.name === "clients_visible_to")).toBeUndefined();
  });

  it("rejects invalid dueDate format", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageTaskTool.handler(
      {
        operation: "create",
        title: "x",
        dueDate: "tomorrow",
      },
      CTX(supabase),
    );
    expect(r.error).toMatch(/YYYY-MM-DD/);
  });

  it("rejects unknown priority", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageTaskTool.handler(
      { operation: "create", title: "x", priority: "Critical" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/priority/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE — preview then confirm
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_task — complete (preview-then-confirm)", () => {
  it("preview shows currentStatus + willTransitionTo without writing", async () => {
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_tasks: { data: taskRow({ status: "open", title: "Send IPS" }), error: null } },
      rpcs: { tasks_visible_to: { data: true, error: null } },
    });
    const r = await manageTaskTool.handler(
      { operation: "complete", taskId: TASK_ID },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      action: string;
      snapshot: { currentStatus: string; willTransitionTo: string; title: string };
    };
    expect(out.preview).toBe(true);
    expect(out.action).toBe("complete_task");
    expect(out.snapshot).toEqual({
      title: "Send IPS",
      currentStatus: "open",
      willTransitionTo: "done",
    });
    // No write happened.
    expect(fromCalls.find((f) => f.updatePayload !== undefined)).toBeUndefined();
  });

  it("rejects complete on already-done task", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_tasks: { data: taskRow({ status: "done" }), error: null } },
      rpcs: { tasks_visible_to: { data: true, error: null } },
    });
    const r = await manageTaskTool.handler(
      { operation: "complete", taskId: TASK_ID },
      CTX(supabase),
    );
    expect(r.error).toBe("Task is already completed.");
  });

  it("confirmed complete writes status='done' + completed_at + 'Task completed' activity title", async () => {
    let callCount = 0;
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_tasks: () => {
          callCount += 1;
          return {
            data:
              callCount === 1
                ? taskRow({ status: "open", title: "Send IPS" })
                : taskRow({ status: "done", title: "Send IPS", completed_at: "2026-05-16T00:00:00Z" }),
            error: null,
          };
        },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { tasks_visible_to: { data: true, error: null } },
    });
    const r = await manageTaskTool.handler(
      { operation: "complete", taskId: TASK_ID, _confirmed: true },
      CTX(supabase),
    );
    const out = r.result as {
      success: boolean;
      task: { status: string; completedAt: string };
      statusTransition: { from: string; to: string };
    };
    expect(out.success).toBe(true);
    expect(out.task.status).toBe("done");
    expect(out.statusTransition).toEqual({ from: "open", to: "done" });

    const taskUpdate = fromCalls.find(
      (f) => f.table === "advisorpilot_tasks" && f.updatePayload !== undefined,
    );
    expect(taskUpdate?.updatePayload).toMatchObject({
      status: "done",
    });
    // completed_at is set to "now" — just check it's present and ISO-shaped.
    expect((taskUpdate?.updatePayload as { completed_at: string }).completed_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    // Activity log title uses the "Task completed" wording.
    const activity = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect((activity?.insertPayload as { title: string }).title).toMatch(/Task completed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — status-transition activity title
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_task — update status transitions", () => {
  it("status open → cancelled writes 'Task cancelled' to activity_log", async () => {
    let callCount = 0;
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_tasks: () => {
          callCount += 1;
          return {
            data:
              callCount === 1
                ? taskRow({ status: "open", title: "Old task" })
                : taskRow({ status: "cancelled", title: "Old task" }),
            error: null,
          };
        },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { tasks_visible_to: { data: true, error: null } },
    });
    await manageTaskTool.handler(
      { operation: "update", taskId: TASK_ID, status: "cancelled", _confirmed: true },
      CTX(supabase),
    );
    const activity = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect((activity?.insertPayload as { title: string }).title).toMatch(/Task cancelled/);
  });
});
