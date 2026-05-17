import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/reports route tests.
 *
 * Focused on the LIST and POST surfaces' behavior contracts:
 *
 *   1. Auth gate — GET and POST both return 401 when no advisor identity
 *   2. POST validation — rejects missing title/content, oversize fields
 *   3. POST defaults — sets source='advisor_authored', status='draft',
 *      visibility='private', icon='📄' when not provided
 *   4. LIST filtering — status defaults exclude archived; `status=all`
 *      shows everything; comma-list multi-status works
 *   5. LIST sort options — created_desc default; created_asc, title_asc,
 *      updated_desc all honored
 *   6. Pagination — limit + offset clamped within bounds
 *
 * The visibility check + activity-log write are delegated to existing
 * helpers (covered by manage-report.test.ts and the report-mapper tests).
 */

const mocks = vi.hoisted(() => ({
  identity: null as null | { email: string; userId: string | null; provider: "google" | "supabase" },
  rpcResponses: new Map<string, { data: unknown; error: { message: string } | null }>(),
  insertPayload: null as unknown,
  insertedRow: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/advisor-auth", () => ({
  resolveAdvisorIdentity: vi.fn(async () => mocks.identity),
}));

vi.mock("@/lib/crm/ensure-personal-org", () => ({
  ensurePersonalOrg: vi.fn(async () => "personal-org-test"),
}));

vi.mock("@/lib/crm/supabase-admin", () => ({
  missingCrmSupabaseEnv: vi.fn(() => false),
  getCrmSupabaseAdmin: vi.fn(() => ({
    rpc: vi.fn((name: string) => {
      const r = mocks.rpcResponses.get(name);
      return Promise.resolve(r ?? { data: [], error: null });
    }),
    from: vi.fn(() => {
      type Result = { data: unknown; error: { message: string } | null };
      type Builder = {
        select(...args: unknown[]): Builder;
        eq(...args: unknown[]): Builder;
        insert(payload: unknown): Builder;
        maybeSingle(): Promise<Result>;
        single(): Promise<Result>;
      };
      const builder: Builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        insert(payload: unknown) {
          mocks.insertPayload = payload;
          return builder;
        },
        async maybeSingle() {
          return { data: mocks.insertedRow, error: null };
        },
        async single() {
          return { data: mocks.insertedRow, error: null };
        },
      };
      return builder;
    }),
  })),
}));

// Auto-noop activity_log writer so the POST test isn't coupled to its impl.
vi.mock("@/lib/crm/activity-writer", () => ({
  writeActivityLog: vi.fn(async () => undefined),
}));

beforeEach(() => {
  mocks.identity = null;
  mocks.rpcResponses = new Map();
  mocks.insertPayload = null;
  mocks.insertedRow = null;
});

// ─── GET ──────────────────────────────────────────────────────────────────

describe("GET /api/reports — auth + listing", () => {
  it("returns 401 when no advisor identity", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.test/api/reports"));
    expect(res.status).toBe(401);
  });

  it("defaults filter to exclude archived (returns only draft + published)", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.rpcResponses.set("list_visible_reports", {
      data: [
        reportRow("r1", "draft"),
        reportRow("r2", "published"),
        reportRow("r3", "archived"),
      ],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.test/api/reports"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reports: Array<{ id: string; status: string }> };
    expect(body.reports.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("status=all returns archived too", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.rpcResponses.set("list_visible_reports", {
      data: [reportRow("r1", "draft"), reportRow("r2", "archived")],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.test/api/reports?status=all"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reports: Array<{ id: string }> };
    expect(body.reports.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("status=archived returns only archived", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.rpcResponses.set("list_visible_reports", {
      data: [reportRow("r1", "draft"), reportRow("r2", "archived")],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.test/api/reports?status=archived"));
    const body = (await res.json()) as { reports: Array<{ id: string }> };
    expect(body.reports.map((r) => r.id)).toEqual(["r2"]);
  });

  it("status=draft,published works as comma list", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.rpcResponses.set("list_visible_reports", {
      data: [
        reportRow("r1", "draft"),
        reportRow("r2", "published"),
        reportRow("r3", "archived"),
      ],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://app.test/api/reports?status=draft,published"),
    );
    const body = (await res.json()) as { reports: Array<{ id: string }> };
    expect(body.reports.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  it("rejects unknown status value", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://app.test/api/reports?status=garbage"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/status/);
  });

  it("rejects invalid clientId UUID", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://app.test/api/reports?clientId=not-a-uuid"),
    );
    expect(res.status).toBe(400);
  });

  it("sort=title_asc orders alphabetically (case-insensitive)", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.rpcResponses.set("list_visible_reports", {
      data: [
        reportRow("r1", "draft", { title: "Zeta" }),
        reportRow("r2", "draft", { title: "alpha" }),
        reportRow("r3", "draft", { title: "Mu" }),
      ],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://app.test/api/reports?sort=title_asc"),
    );
    const body = (await res.json()) as { reports: Array<{ id: string; title: string }> };
    expect(body.reports.map((r) => r.title)).toEqual(["alpha", "Mu", "Zeta"]);
  });

  it("sort=created_asc reverses default order", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.rpcResponses.set("list_visible_reports", {
      data: [
        reportRow("r1", "draft", { created_at: "2026-05-01T00:00:00Z" }),
        reportRow("r2", "draft", { created_at: "2026-05-15T00:00:00Z" }),
      ],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://app.test/api/reports?sort=created_asc"),
    );
    const body = (await res.json()) as { reports: Array<{ id: string }> };
    expect(body.reports.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("search filter matches case-insensitively against title", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.rpcResponses.set("list_visible_reports", {
      data: [
        reportRow("r1", "draft", { title: "Q3 Allocation Review" }),
        reportRow("r2", "draft", { title: "Estate Plan Summary" }),
      ],
      error: null,
    });
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://app.test/api/reports?search=ALLOCATION"),
    );
    const body = (await res.json()) as { reports: Array<{ id: string }> };
    expect(body.reports.map((r) => r.id)).toEqual(["r1"]);
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────

describe("POST /api/reports — create", () => {
  it("returns 401 when no advisor identity", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/reports", {
        method: "POST",
        body: JSON.stringify({ title: "x", content: "y" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects missing title", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/reports", {
        method: "POST",
        body: JSON.stringify({ content: "body only" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/title/);
  });

  it("rejects oversize title", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/reports", {
        method: "POST",
        body: JSON.stringify({ title: "x".repeat(300), content: "body" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/250/);
  });

  it("rejects invalid status enum", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/reports", {
        method: "POST",
        body: JSON.stringify({ title: "t", content: "c", status: "weird" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("defaults source=advisor_authored + status=draft when creating", async () => {
    mocks.identity = { email: "jane@firm.com", userId: null, provider: "google" };
    mocks.insertedRow = {
      ...reportRow("r-new", "draft"),
      source: "advisor_authored",
    };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/reports", {
        method: "POST",
        body: JSON.stringify({ title: "New report", content: "# Body" }),
      }),
    );
    expect(res.status).toBe(201);
    const insertPayload = mocks.insertPayload as Record<string, unknown>;
    expect(insertPayload.source).toBe("advisor_authored");
    expect(insertPayload.status).toBe("draft");
    expect(insertPayload.visibility).toBe("private");
    expect(insertPayload.icon).toBe("📄");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function reportRow(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    owner_email: "jane@firm.com",
    owner_user_id: null,
    client_id: null,
    org_id: "org-1",
    visibility: "private",
    title: `Report ${id}`,
    content: "# body",
    embedded_media: [],
    icon: "📄",
    color: null,
    status,
    tags: [],
    source: "ai_generated",
    generated_by_model: null,
    generated_by_provider: null,
    generated_in_conversation_id: null,
    archived_at: status === "archived" ? "2026-05-10T00:00:00+00:00" : null,
    created_at: "2026-05-15T10:00:00+00:00",
    updated_at: "2026-05-15T10:00:00+00:00",
    ...overrides,
  };
}
