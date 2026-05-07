import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tokenRow: null as null | {
    id: string;
    advisor_user_id: string | null;
    advisor_owner_email: string;
    expires_at: string;
    upload_count: number;
    max_upload_count: number;
    revoked_at: string | null;
  },
}));

vi.mock("@/lib/extract-statement-holdings", () => ({
  extractHoldingsFromFileBuffer: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: mocks.tokenRow, error: null })),
    })),
  })),
}));

describe("client-upload ingest route", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    mocks.tokenRow = null;
  });

  it("rejects invalid upload tokens before extraction", async () => {
    const { POST } = await import("./route");
    const form = new FormData();
    form.set("token", "bad-token");
    form.set("file", new File(["fake"], "statement.pdf", { type: "application/pdf" }));

    const res = await POST(
      new Request("https://app.test/api/client-upload/ingest", {
        method: "POST",
        body: form,
      })
    );

    expect(res.status).toBe(404);
  });

  it("rejects expired upload tokens before extraction", async () => {
    mocks.tokenRow = {
      id: "token-id",
      advisor_user_id: "advisor-user-id",
      advisor_owner_email: "advisor@example.com",
      expires_at: "2020-01-01T00:00:00.000Z",
      upload_count: 0,
      max_upload_count: 25,
      revoked_at: null,
    };
    const { POST } = await import("./route");
    const form = new FormData();
    form.set("token", "expired-token");
    form.set("file", new File(["fake"], "statement.pdf", { type: "application/pdf" }));

    const res = await POST(
      new Request("https://app.test/api/client-upload/ingest", {
        method: "POST",
        body: form,
      })
    );

    expect(res.status).toBe(410);
  });
});
