import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: null as null | { email: string; userId: string | null; provider: "google" | "supabase" },
  insertPayloads: [] as unknown[],
}));

vi.mock("@/lib/advisor-auth", () => ({
  resolveAdvisorIdentity: vi.fn(async () => mocks.identity),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn((payload: unknown) => {
        mocks.insertPayloads.push(payload);
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({
            data: { id: "token-id", expires_at: "2030-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z" },
            error: null,
          })),
        };
      }),
    })),
  })),
}));

describe("client-upload-token route", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    mocks.identity = null;
    mocks.insertPayloads = [];
  });

  it("requires an authenticated advisor", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("https://app.test/api/client-upload-token", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("binds token ownership to server-derived advisor identity", async () => {
    mocks.identity = { email: "advisor@example.com", userId: "user-id", provider: "supabase" };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/client-upload-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 3 }),
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.insertPayloads[0]).toMatchObject({
      advisor_owner_email: "advisor@example.com",
      advisor_user_id: "user-id",
      upload_count: 0,
    });
    expect(mocks.insertPayloads[1]).toMatchObject({
      action: "upload_token.created",
      owner_email: "advisor@example.com",
    });
  });
});
