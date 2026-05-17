import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — same pattern as manage-report.test.ts (stub ensurePersonalOrg) +
// stub streamChat so we can assert what the tool feeds the author model and
// control its output deterministically.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/crm/ensure-personal-org", () => ({
  ensurePersonalOrg: vi.fn(async () => "personal-org-test"),
}));

import * as streamChatModule from "../stream-chat";
import { generateReportContentTool } from "./generate-report-content";
import type { ChatToolContext } from "./types";
import type { ChatStreamChunk } from "../types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `generate_report_content` tests.
 *
 * The tool stitches together: arg validation → optional client snapshot
 * → report-author LLM call → DB insert → activity log. Tests cover each
 * seam plus the unusual cases (clientId not visible, empty author output,
 * oversized output, advisor selection threading).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Supabase mock builder (mirrors manage-report.test.ts so tests look similar)
// ─────────────────────────────────────────────────────────────────────────────

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

interface FromSpy {
  table: string;
  insertPayload?: Record<string, unknown>;
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
          if (method === "insert") spy.insertPayload = args[0] as Record<string, unknown>;
          return builder;
        };
      for (const m of ["select", "eq", "in", "order", "limit", "insert", "update", "delete"]) {
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

function CTX(supabase: SupabaseClient, overrides: Partial<ChatToolContext> = {}): ChatToolContext {
  return {
    advisorEmail: "jane@firm.com",
    conversationId: "conv_xyz",
    currentClientId: CLIENT_ID,
    supabase,
    request: null,
    selection: null,
    emitPartial: () => undefined,
    ...overrides,
  };
}

function clientSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIENT_ID,
    owner_email: "jane@firm.com",
    client: { full_name: "Jane Doe", age: 62, primary_goal: "Retirement income" },
    holdings: [{ ticker: "VOO", market_value: 450000 }],
    analysis: null,
    total_value: 1_250_000,
    ...overrides,
  };
}

function clientOrgRow(orgId: string | null = "org-from-client") {
  return { org_id: orgId };
}

function insertedReportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    owner_email: "jane@firm.com",
    owner_user_id: null,
    client_id: CLIENT_ID,
    org_id: "personal-org-test",
    visibility: "private",
    title: "Sample Report",
    content: "# Sample Report\n\nBody text.",
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
    created_at: "2026-05-16T19:00:00+00:00",
    updated_at: "2026-05-16T19:00:00+00:00",
    ...overrides,
  };
}

/**
 * Build an async generator yielding ChatStreamChunks. Used to stub the
 * streamChat module so the tool sees deterministic author output.
 */
async function* asGen(chunks: ChatStreamChunk[]): AsyncGenerator<ChatStreamChunk> {
  for (const c of chunks) yield c;
}

function mockAuthor(chunks: ChatStreamChunk[]) {
  return vi
    .spyOn(streamChatModule, "streamChat")
    .mockImplementation(() => asGen(chunks));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("generate_report_content — argument validation", () => {
  const { supabase } = makeMockSupabase({});

  it("requires title / reportType / prompt", async () => {
    const r = await generateReportContentTool.handler(
      { reportType: "general", prompt: "Compose a report." },
      CTX(supabase),
    );
    expect(r.error).toMatch(/title/);
  });

  it("rejects unknown reportType", async () => {
    const r = await generateReportContentTool.handler(
      { title: "X", reportType: "nope", prompt: "Compose." },
      CTX(supabase),
    );
    expect(r.error).toMatch(/reportType/);
  });

  it("caps title length", async () => {
    const r = await generateReportContentTool.handler(
      { title: "T".repeat(300), reportType: "general", prompt: "Compose." },
      CTX(supabase),
    );
    expect(r.error).toMatch(/250 characters/);
  });

  it("caps prompt length at 50,000 chars and points the caller at manage_report.create for raw content", async () => {
    const r = await generateReportContentTool.handler(
      { title: "T", reportType: "general", prompt: "x".repeat(60_000) },
      CTX(supabase),
    );
    expect(r.error).toMatch(/50000 characters/);
    // Guides the model toward the right tool for raw-content delivery
    // so it doesn't just retry against the same wrong tool.
    expect(r.error).toMatch(/manage_report\.create/);
  });

  it("rejects non-UUID clientId", async () => {
    const r = await generateReportContentTool.handler(
      { title: "T", reportType: "general", prompt: "Compose.", clientId: "not-a-uuid" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/UUID/);
  });

  it("rejects more than MAX_OUTLINE_SECTIONS section hints", async () => {
    const sections = Array.from({ length: 20 }, (_, i) => `Section ${i}`);
    const r = await generateReportContentTool.handler(
      { title: "T", reportType: "general", prompt: "Compose.", sections },
      CTX(supabase),
    );
    expect(r.error).toMatch(/at most 12/);
  });

  it("rejects invalid visibility", async () => {
    const r = await generateReportContentTool.handler(
      {
        title: "T",
        reportType: "general",
        prompt: "Compose.",
        visibility: "world",
      },
      CTX(supabase),
    );
    expect(r.error).toMatch(/visibility/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Standalone (no client) — happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("generate_report_content — standalone report happy path", () => {
  it("calls streamChat with no tools + a derived sessionId, then persists + returns metadata", async () => {
    const authorSpy = mockAuthor([
      { type: "delta", text: "# Title\n\n" },
      { type: "delta", text: "Body text " },
      { type: "delta", text: "with bullets." },
      { type: "done" },
    ]);

    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        // No client_id → no clients query. Only the reports insert hits the DB.
        advisorpilot_reports: { data: insertedReportRow(), error: null },
        // activity_log write — succeed silently.
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: {},
    });

    const result = await generateReportContentTool.handler(
      {
        title: "Sample Report",
        reportType: "general",
        prompt: "Quick standalone summary.",
      },
      CTX(supabase),
    );

    // 1. Author was invoked once.
    expect(authorSpy).toHaveBeenCalledOnce();
    const [params, options] = authorSpy.mock.calls[0];
    expect(params.tools).toEqual([]);
    expect(params.sessionId).toMatch(/^report:conv_xyz:/);
    expect(params.sessionId).not.toBe("conv_xyz"); // distinct from chat session
    expect(params.previousResponseId).toBeNull();
    expect(typeof params.systemPrompt).toBe("string");
    expect(params.systemPrompt).toContain("<role>");
    // selection: null → streamChat receives `selection: undefined` (env fallback).
    expect(options?.selection).toBeUndefined();

    // 2. Report row was inserted into advisorpilot_reports.
    const reportsInsert = fromCalls.find((c) => c.table === "advisorpilot_reports");
    expect(reportsInsert?.insertPayload).toBeDefined();
    expect(reportsInsert?.insertPayload?.title).toBe("Sample Report");
    expect(reportsInsert?.insertPayload?.status).toBe("draft");
    expect(reportsInsert?.insertPayload?.source).toBe("ai_generated");
    expect(reportsInsert?.insertPayload?.content).toBe("# Title\n\nBody text with bullets.");
    expect(reportsInsert?.insertPayload?.generated_in_conversation_id).toBe("conv_xyz");
    expect(reportsInsert?.insertPayload?.client_id).toBeNull();

    // 3. Activity log entry written.
    const activityWrite = fromCalls.find((c) => c.table === "advisorpilot_activity_log");
    expect(activityWrite).toBeDefined();

    // 4. Return shape.
    expect(result.result).toMatchObject({
      success: true,
      reportId: REPORT_ID,
      title: "Sample Report",
      status: "draft",
      contentLength: "# Title\n\nBody text with bullets.".length,
    });
    expect((result.result as { contentPreview: string }).contentPreview).toContain("# Title");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// With clientId — visibility + snapshot grounding
// ─────────────────────────────────────────────────────────────────────────────

describe("generate_report_content — clientId path", () => {
  it("returns 'Client not found.' when the visibility RPC denies access", async () => {
    mockAuthor([{ type: "delta", text: "should not be reached" }, { type: "done" }]);
    const { supabase } = makeMockSupabase({
      rpcs: { clients_visible_to: { data: false, error: null } },
    });

    const result = await generateReportContentTool.handler(
      {
        title: "Q3",
        reportType: "allocation",
        prompt: "Compose review.",
        clientId: CLIENT_ID,
      },
      CTX(supabase),
    );
    expect(result.error).toMatch(/Client not found/);
  });

  it("threads client name + total_aum into the system prompt and uses client org_id", async () => {
    const authorSpy = mockAuthor([
      { type: "delta", text: "# Q3 Review\nBody." },
      { type: "done" },
    ]);

    // First call to advisorpilot_clients = run-helpers' snapshot.
    // Second call = fetchClientOrgId. Both hit the same table; we resolve
    // with the same row for simplicity (snapshot has total_value; org id reads org_id).
    const clientRow = { ...clientSnapshotRow(), ...clientOrgRow("org-from-client") };
    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_clients: { data: clientRow, error: null },
        advisorpilot_reports: { data: insertedReportRow({ org_id: "org-from-client" }), error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });

    const result = await generateReportContentTool.handler(
      {
        title: "Q3 Review",
        reportType: "allocation",
        prompt: "Summarize allocation.",
        clientId: CLIENT_ID,
      },
      CTX(supabase),
    );

    expect(result.error).toBeUndefined();

    // Inspect the system prompt fed to the author.
    const [params] = authorSpy.mock.calls[0];
    expect(params.systemPrompt).toContain("<client>");
    expect(params.systemPrompt).toContain("name: Jane Doe");
    expect(params.systemPrompt).toContain("total_aum_usd: 1250000.00");
    // Intake summary line — should mention age + goal.
    expect(params.systemPrompt).toMatch(/age 62/);
    expect(params.systemPrompt).toMatch(/primary goal: Retirement income/);

    // The org_id on the inserted report should come from the client, not the personal org.
    const insert = fromCalls.find((c) => c.table === "advisorpilot_reports");
    expect(insert?.insertPayload?.org_id).toBe("org-from-client");
    expect(insert?.insertPayload?.client_id).toBe(CLIENT_ID);
  });

  it("falls back to personal-org when the client row has no org_id", async () => {
    mockAuthor([{ type: "delta", text: "# X\nbody" }, { type: "done" }]);

    const { supabase, fromCalls } = makeMockSupabase({
      tables: {
        advisorpilot_clients: { data: { ...clientSnapshotRow(), org_id: null }, error: null },
        advisorpilot_reports: { data: insertedReportRow({ org_id: "personal-org-test" }), error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });

    await generateReportContentTool.handler(
      {
        title: "X",
        reportType: "general",
        prompt: "Compose.",
        clientId: CLIENT_ID,
      },
      CTX(supabase),
    );

    const insert = fromCalls.find((c) => c.table === "advisorpilot_reports");
    expect(insert?.insertPayload?.org_id).toBe("personal-org-test");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Author output failure modes
// ─────────────────────────────────────────────────────────────────────────────

describe("generate_report_content — author output failure modes", () => {
  it("returns an error when the author streams an error chunk", async () => {
    mockAuthor([{ type: "error", error: "Rate limited (429)" }]);

    const { supabase } = makeMockSupabase({});

    const result = await generateReportContentTool.handler(
      { title: "T", reportType: "general", prompt: "Compose." },
      CTX(supabase),
    );

    expect(result.error).toMatch(/Rate limited/);
  });

  it("returns an error when the author returns empty content", async () => {
    mockAuthor([{ type: "done" }]);

    const { supabase } = makeMockSupabase({});

    const result = await generateReportContentTool.handler(
      { title: "T", reportType: "general", prompt: "Compose." },
      CTX(supabase),
    );

    expect(result.error).toMatch(/empty content/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Advisor selection threading
// ─────────────────────────────────────────────────────────────────────────────

describe("generate_report_content — advisor selection threading", () => {
  it("forwards ctx.selection to the inner streamChat call", async () => {
    const authorSpy = mockAuthor([
      { type: "delta", text: "# X\nbody" },
      { type: "done" },
    ]);

    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_reports: { data: insertedReportRow(), error: null },
        advisorpilot_activity_log: { data: null, error: null },
      },
    });

    await generateReportContentTool.handler(
      { title: "T", reportType: "general", prompt: "Compose." },
      CTX(supabase, {
        selection: {
          provider: "gemini",
          models: { chat: "gemini-2.5-pro" },
        },
      }),
    );

    const [, options] = authorSpy.mock.calls[0];
    expect(options?.selection).toEqual({
      provider: "gemini",
      models: { chat: "gemini-2.5-pro" },
    });
  });
});
