import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type SuccessRow = {
    id: string;
    owner_email: string;
    client: Record<string, never>;
    holdings: never[];
    total_value: number;
  };
  const successRow: SuccessRow = {
    id: "client-id",
    owner_email: "advisor@example.com",
    client: {},
    holdings: [],
    total_value: 0,
  };
  const tableSingleResponse: {
    data: SuccessRow | null;
    error: { code?: string; message?: string } | null;
  } = {
    data: successRow,
    error: null,
  };
  return {
    identity: null as null | { email: string; userId: string | null; provider: "google" | "supabase" },
    insertPayload: null as unknown,
    successRow,
    tableSingleResponse,
  };
});

vi.mock("@/lib/advisor-auth", () => ({
  resolveAdvisorIdentity: vi.fn(async () => mocks.identity),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: [], error: null })),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn((payload: unknown) => {
        mocks.insertPayload = payload;
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({
            data: mocks.successRow,
            error: null,
          })),
        };
      }),
      single: vi.fn(async () => mocks.tableSingleResponse),
      maybeSingle: vi.fn(async () => mocks.tableSingleResponse),
    })),
  })),
}));

describe("client-database route auth", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    mocks.identity = null;
    mocks.insertPayload = null;
    mocks.tableSingleResponse = { data: mocks.successRow, error: null };
  });

  it("rejects unauthenticated reads", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.test/api/client-database"));
    expect(res.status).toBe(401);
  });

  it("uses server-derived owner email for writes", async () => {
    mocks.identity = { email: "advisor@example.com", userId: "user-id", provider: "supabase" };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/client-database", {
        method: "POST",
        body: JSON.stringify({
          ownerEmail: "attacker@example.com",
          client: { firstName: "Jane" },
          holdings: [],
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.insertPayload).toMatchObject({
      owner_email: "advisor@example.com",
      owner_user_id: "user-id",
    });
  });

  it("returns 404 when saved client id is missing or not owned", async () => {
    mocks.identity = { email: "advisor@example.com", userId: null, provider: "google" };
    mocks.tableSingleResponse = { data: null, error: null };

    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/client-database", {
        method: "POST",
        body: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000001",
          client: {},
          holdings: [],
        }),
      })
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });
});
