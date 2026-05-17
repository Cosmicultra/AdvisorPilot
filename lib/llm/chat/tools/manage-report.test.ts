import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub ensurePersonalOrg — same pattern as manage-note / manage-task tests.
vi.mock("@/lib/crm/ensure-personal-org", () => ({
  ensurePersonalOrg: vi.fn(async () => "personal-org-test"),
}));

import { manageReportTool } from "./manage-report";
import type { ChatToolContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `manage_report` tests — focused on what's distinct from manage_note:
 *
 *   1. CREATE — content + title required; ai_generated default; activity_log entry
 *   2. UPDATE preview surfaces contentLengthChange instead of dumping markdown
 *   3. UPDATE confirmed — patches the right fields; archive status sets archived_at
 *   4. Status transitions produce specific activity titles
 *   5. DELETE preview includes a warning about archiving instead
 *   6. Validation — title length cap, content size cap, status/visibility enums
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mock Supabase (builder pattern matching the other test files)
// ─────────────────────────────────────────────────────────────────────────────

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}
interface FromSpy {
  table: string;
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
      const spy: FromSpy = { table };
      fromCalls.push(spy);
      const fixture = tableFixtures[table] ?? { data: null, error: null };
      const resolve = (): TableResult => (typeof fixture === "function" ? fixture() : fixture);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const chainable = (method: string) =>
        (...args: unknown[]) => {
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
        ok: (v: TableResult) => unknown,
        err?: (e: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(ok, err);
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
const REPORT_ID = "44444444-4444-4444-4444-444444444444";

const CTX = (supabase: SupabaseClient): ChatToolContext => ({
  advisorEmail: "jane@firm.com",
  conversationId: "conv_xyz",
  currentClientId: CLIENT_ID,
  supabase,
  request: null,
  selection: null,
  emitPartial: () => undefined,
});

function reportRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: REPORT_ID,
    owner_email: "jane@firm.com",
    owner_user_id: null,
    client_id: CLIENT_ID,
    org_id: "org-1",
    visibility: "private",
    title: "Sample Report",
    content: "# Sample\n\nBody.",
    embedded_media: [],
    icon: "📄",
    color: null,
    status: "draft",
    tags: [],
    source: "ai_generated",
    generated_by_model: null,
    generated_by_provider: null,
    generated_in_conversation_id: "conv_xyz",
    archived_at: null,
    created_at: "2026-05-15T10:00:00+00:00",
    updated_at: "2026-05-15T10:00:00+00:00",
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
// Op gate + validation
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_report — op gate + validation", () => {
  it("rejects unknown operation", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageReportTool.handler({ operation: "list" }, CTX(supabase));
    expect(r.error).toMatch(/Unknown operation/);
  });

  it("create rejects missing title / content", async () => {
    const { supabase } = makeMockSupabase({});
    let r = await manageReportTool.handler(
      { operation: "create", content: "body" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/title/);
    r = await manageReportTool.handler(
      { operation: "create", title: "Title" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/content/);
  });

  it("create rejects oversized content (>200,000 chars)", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageReportTool.handler(
      {
        operation: "create",
        title: "Big",
        content: "x".repeat(200_001),
      },
      CTX(supabase),
    );
    expect(r.error).toMatch(/200000/);
  });

  it("create rejects invalid status enum", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageReportTool.handler(
      { operation: "create", title: "x", content: "y", status: "in_review" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/status/);
  });

  it("create rejects invalid visibility enum", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageReportTool.handler(
      { operation: "create", title: "x", content: "y", visibility: "public" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/visibility/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_report — create", () => {
  it("happy path — inserts with conversation id + writes activity_log", async () => {
    const inserted = reportRow({ title: "Q2 Review", content: "# Q2", status: "draft" });
    const { supabase, rpcCalls, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_clients: { data: { org_id: "org-x" }, error: null },
        advisorpilot_reports: { data: inserted, error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });

    const r = await manageReportTool.handler(
      {
        operation: "create",
        clientId: CLIENT_ID,
        title: "Q2 Review",
        content: "# Q2",
        tags: ["q2", "review"],
      },
      CTX(supabase),
    );

    const out = r.result as { success: boolean; report: { title: string } };
    expect(out.success).toBe(true);
    expect(out.report.title).toBe("Q2 Review");

    // Visibility RPC fired on the parent client.
    expect(rpcCalls).toContainEqual({
      name: "clients_visible_to",
      args: { viewer_email: "jane@firm.com", client_id: CLIENT_ID },
    });

    // Insert payload includes the conversation id for provenance.
    const reportInsert = fromCalls.find((f) => f.table === "advisorpilot_reports");
    expect(reportInsert?.insertPayload).toMatchObject({
      owner_email: "jane@firm.com",
      client_id: CLIENT_ID,
      org_id: "org-x",
      title: "Q2 Review",
      content: "# Q2",
      status: "draft",
      tags: ["q2", "review"],
      source: "ai_generated",
      generated_in_conversation_id: "conv_xyz",
    });

    // Activity log fired with type=document + title "Report created: ..."
    const activity = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect(activity?.insertPayload).toMatchObject({
      type: "document",
      title: "Report created: Q2 Review",
      client_id: CLIENT_ID,
    });
  });

  it("standalone (no clientId) — falls back to personal org; no visibility RPC", async () => {
    const inserted = reportRow({ client_id: null, title: "Standalone" });
    const { supabase, rpcCalls } = makeMockSupabase({
      tables: {
        advisorpilot_reports: { data: inserted, error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
    });

    const r = await manageReportTool.handler(
      { operation: "create", clientId: null, title: "Standalone", content: "body" },
      CTX(supabase),
    );
    const out = r.result as { success: boolean };
    expect(out.success).toBe(true);
    expect(rpcCalls.find((c) => c.name === "clients_visible_to")).toBeUndefined();
  });

  it("rejects when parent client is not visible", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: { clients_visible_to: { data: false, error: null } },
    });
    const r = await manageReportTool.handler(
      { operation: "create", clientId: CLIENT_ID, title: "x", content: "y" },
      CTX(supabase),
    );
    expect(r.error).toBe("Client not found.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE (T3 — preview-then-confirm)
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_report — update", () => {
  it("preview surfaces contentLengthChange instead of dumping the full body", async () => {
    const existing = reportRow({ content: "short" });
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_reports: { data: existing, error: null } },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "update",
        reportId: REPORT_ID,
        content: "much longer body with more sections and detail than the old one",
      },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      reportTitle: string;
      diff: Record<string, unknown>;
      contentLengthChange: { before: number; after: number };
    };
    expect(out.preview).toBe(true);
    expect(out.reportTitle).toBe("Sample Report");
    // content NOT in the diff (it was rerouted to contentLengthChange).
    expect(out.diff.content).toBeUndefined();
    expect(out.contentLengthChange).toEqual({
      before: "short".length,
      after:
        "much longer body with more sections and detail than the old one".length,
    });
  });

  it("preview with title-only change shows title diff + no content delta", async () => {
    const existing = reportRow({ title: "Old title" });
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_reports: { data: existing, error: null } },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      { operation: "update", reportId: REPORT_ID, title: "New title" },
      CTX(supabase),
    );
    const out = r.result as {
      diff: Record<string, { before: unknown; after: unknown }>;
      contentLengthChange?: unknown;
    };
    expect(out.diff.title).toEqual({ before: "Old title", after: "New title" });
    expect(out.contentLengthChange).toBeUndefined();
  });

  it("confirmed status→archived sets archived_at + writes 'Report archived' activity", async () => {
    let callCount = 0;
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_reports: () => {
          callCount += 1;
          return {
            data:
              callCount === 1
                ? reportRow({ status: "draft" })
                : reportRow({ status: "archived", archived_at: "2026-05-16T00:00:00+00:00" }),
            error: null,
          };
        },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "update",
        reportId: REPORT_ID,
        status: "archived",
        _confirmed: true,
      },
      CTX(supabase),
    );
    const out = r.result as { success: boolean; report: { status: string } };
    expect(out.success).toBe(true);
    expect(out.report.status).toBe("archived");

    const update = fromCalls.find(
      (f) => f.table === "advisorpilot_reports" && f.updatePayload !== undefined,
    );
    const payload = update?.updatePayload as Record<string, unknown>;
    expect(payload.status).toBe("archived");
    expect(typeof payload.archived_at).toBe("string");

    const activity = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect((activity?.insertPayload as { title: string }).title).toMatch(/Report archived/);
  });

  it("confirmed status→published writes 'Report published' activity", async () => {
    let callCount = 0;
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_reports: () => {
          callCount += 1;
          return {
            data:
              callCount === 1
                ? reportRow({ status: "draft" })
                : reportRow({ status: "published" }),
            error: null,
          };
        },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    await manageReportTool.handler(
      { operation: "update", reportId: REPORT_ID, status: "published", _confirmed: true },
      CTX(supabase),
    );
    const activity = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect((activity?.insertPayload as { title: string }).title).toMatch(/Report published/);
  });

  it("rejects update with no patch fields", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageReportTool.handler(
      { operation: "update", reportId: REPORT_ID },
      CTX(supabase),
    );
    expect(r.error).toMatch(/at least one of/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (T4)
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_report — delete", () => {
  it("preview includes a 'consider archiving' warning + snapshot", async () => {
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_reports: { data: reportRow({ title: "Doomed" }), error: null } },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      { operation: "delete", reportId: REPORT_ID },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      reportId: string;
      snapshot: { title: string; contentLength: number };
      warning: string;
    };
    expect(out.preview).toBe(true);
    expect(out.snapshot.title).toBe("Doomed");
    expect(out.warning).toMatch(/archived/);

    // No delete fired.
    expect(fromCalls.some((f) => f.didDelete)).toBe(false);
  });

  it("confirmed delete removes the row + writes 'Report deleted' activity", async () => {
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_reports: { data: reportRow({ title: "Gone" }), error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      { operation: "delete", reportId: REPORT_ID, _confirmed: true },
      CTX(supabase),
    );
    const out = r.result as { success: boolean; deleted: boolean };
    expect(out.success).toBe(true);
    expect(out.deleted).toBe(true);

    expect(fromCalls.find((f) => f.didDelete && f.table === "advisorpilot_reports")).toBeDefined();
    const activity = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect((activity?.insertPayload as { title: string }).title).toMatch(/Report deleted: Gone/);
  });

  it("rejects delete on non-visible report", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: { reports_visible_to: { data: false, error: null } },
    });
    const r = await manageReportTool.handler(
      { operation: "delete", reportId: REPORT_ID },
      CTX(supabase),
    );
    expect(r.error).toBe("Report not found.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR 17 — line-level operations + version history
// ─────────────────────────────────────────────────────────────────────────────

describe("manage_report — line-level operations", () => {
  const LINED = reportRow({
    content: "Line 1\nLine 2\nLine 3\nLine 4",
  });

  it("get_lines returns numbered slice + totalLines (no confirmation needed)", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_reports: { data: LINED, error: null } },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "get_lines",
        reportId: REPORT_ID,
        startLine: 2,
        endLine: 3,
      },
      CTX(supabase),
    );
    const out = r.result as {
      reportId: string;
      totalLines: number;
      lines: Array<{ line: number; text: string }>;
    };
    expect(out.totalLines).toBe(4);
    expect(out.lines).toEqual([
      { line: 2, text: "Line 2" },
      { line: 3, text: "Line 3" },
    ]);
  });

  it("insert_lines preview surfaces insertedAtLine + insertedLineCount + nextTotalLines", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_reports: { data: LINED, error: null } },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "insert_lines",
        reportId: REPORT_ID,
        atLine: 2,
        lineContent: "NEW",
      },
      CTX(supabase),
    );
    // withConfirmation spreads the preview shape at the top level under
    // `result`, alongside `preview: true` + `action` + `confirmationRequired`.
    const out = r.result as {
      preview: boolean;
      action: string;
      insertedAtLine: number;
      insertedLineCount: number;
      nextTotalLines: number;
    };
    expect(out.preview).toBe(true);
    expect(out.action).toBe("insert_lines");
    expect(out.insertedAtLine).toBe(2);
    expect(out.insertedLineCount).toBe(1);
    expect(out.nextTotalLines).toBe(5);
  });

  it("insert_lines confirmed applies the edit + writes activity log", async () => {
    let nextContent: string | null = null;
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_reports: () => {
          // First read returns the original. After update fires the row
          // reflects nextContent.
          if (nextContent === null) return { data: LINED, error: null };
          return {
            data: { ...LINED, content: nextContent },
            error: null,
          };
        },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "insert_lines",
        reportId: REPORT_ID,
        atLine: 2,
        lineContent: "NEW",
        _confirmed: true,
      },
      CTX(supabase),
    );
    expect(r.error).toBeUndefined();
    const update = fromCalls.find(
      (f) => f.table === "advisorpilot_reports" && f.updatePayload,
    );
    nextContent = (update?.updatePayload as { content: string } | undefined)?.content ?? null;
    expect(nextContent).toBe("Line 1\nNEW\nLine 2\nLine 3\nLine 4");
    const activity = fromCalls.find((f) => f.table === "advisorpilot_activity_log");
    expect((activity?.insertPayload as { title: string }).title).toMatch(/Report edited/);
  });

  it("replace_lines preview surfaces removedLineCount + insertedLineCount", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_reports: { data: LINED, error: null } },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "replace_lines",
        reportId: REPORT_ID,
        startLine: 2,
        endLine: 3,
        lineContent: "X\nY\nZ",
      },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      removedLineCount: number;
      insertedLineCount: number;
    };
    expect(out.preview).toBe(true);
    expect(out.removedLineCount).toBe(2);
    expect(out.insertedLineCount).toBe(3);
  });

  it("delete_lines preview includes range + removedLineCount", async () => {
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_reports: { data: LINED, error: null } },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "delete_lines",
        reportId: REPORT_ID,
        startLine: 2,
        endLine: 3,
      },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      range: { startLine: number; endLine: number };
      removedLineCount: number;
    };
    expect(out.preview).toBe(true);
    expect(out.range).toEqual({ startLine: 2, endLine: 3 });
    expect(out.removedLineCount).toBe(2);
  });

  it("line op rejects bad UUID up-front", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await manageReportTool.handler(
      {
        operation: "get_lines",
        reportId: "not-a-uuid",
      },
      CTX(supabase),
    );
    expect(r.error).toMatch(/UUID/);
  });
});

describe("manage_report — version history", () => {
  it("list_versions returns the version list sorted newest-first", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_reports: { data: reportRow(), error: null },
        advisorpilot_report_versions: {
          data: [
            {
              id: "v2",
              version_number: 2,
              title: "Title v2",
              edited_by_email: "advisor@firm.com",
              edited_at: "2026-05-15T10:00:00Z",
              content: "body v2",
            },
            {
              id: "v1",
              version_number: 1,
              title: "Title v1",
              edited_by_email: "advisor@firm.com",
              edited_at: "2026-05-14T10:00:00Z",
              content: "body v1",
            },
          ],
          error: null,
        },
      },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      { operation: "list_versions", reportId: REPORT_ID },
      CTX(supabase),
    );
    const out = r.result as {
      reportId: string;
      currentVersion: number;
      versions: Array<{ versionId: string; versionNumber: number; contentLength: number }>;
    };
    expect(out.reportId).toBe(REPORT_ID);
    expect(out.currentVersion).toBe(3); // next snapshot number
    expect(out.versions).toHaveLength(2);
    expect(out.versions[0].versionNumber).toBe(2);
    expect(out.versions[0].contentLength).toBe("body v2".length);
  });

  it("restore_version preview surfaces the target snapshot's version + length + warning", async () => {
    const targetVersion = {
      id: "v_restore",
      report_id: REPORT_ID,
      version_number: 5,
      title: "Old title",
      content: "Old body",
      status: "draft",
      visibility: "private",
      tags: [],
      icon: "📄",
      color: null,
      edited_by_email: "advisor@firm.com",
      edited_at: "2026-04-01T10:00:00Z",
    };
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_reports: { data: reportRow({ content: "Current long body content" }), error: null },
        advisorpilot_report_versions: { data: targetVersion, error: null },
      },
      rpcs: { reports_visible_to: { data: true, error: null } },
    });
    const r = await manageReportTool.handler(
      {
        operation: "restore_version",
        reportId: REPORT_ID,
        versionId: "00000000-0000-0000-0000-000000000099",
      },
      CTX(supabase),
    );
    const out = r.result as {
      preview: boolean;
      restoreTo: { versionNumber: number; contentLength: number };
      currentContentLength: number;
      warning: string;
    };
    expect(out.preview).toBe(true);
    expect(out.restoreTo.versionNumber).toBe(5);
    expect(out.warning).toMatch(/snapshots the CURRENT content/);
  });
});
