import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: null as null | { email: string; userId: string | null; provider: "google" | "supabase" },
  upsertPayload: null as unknown,
}));

vi.mock("@/lib/advisor-auth", () => ({
  resolveAdvisorIdentity: vi.fn(async () => mocks.identity),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      upsert: vi.fn((payload: unknown) => {
        mocks.upsertPayload = payload;
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({
            data: {
              owner_email: "advisor@example.com",
              email_signature: "Regards",
            },
            error: null,
          })),
        };
      }),
    })),
  })),
}));

describe("advisor-profile route auth", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    mocks.identity = null;
    mocks.upsertPayload = null;
  });

  it("rejects unauthenticated profile reads", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("https://app.test/api/advisor-profile"));
    expect(res.status).toBe(401);
  });

  it("cannot write another advisor profile from body ownerEmail", async () => {
    mocks.identity = { email: "advisor@example.com", userId: "user-id", provider: "supabase" };
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/advisor-profile", {
        method: "POST",
        body: JSON.stringify({
          ownerEmail: "attacker@example.com",
          emailSignature: "Regards",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.upsertPayload).toMatchObject({
      owner_email: "advisor@example.com",
      owner_user_id: "user-id",
    });
  });
});
