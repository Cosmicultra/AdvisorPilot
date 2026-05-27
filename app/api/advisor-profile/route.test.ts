import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: null as null | { email: string; userId: string | null; provider: "google" | "supabase" },
  upsertPayload: null as unknown,
  existingRow: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/advisor-auth", () => ({
  resolveAdvisorIdentity: vi.fn(async () => mocks.identity),
}));

vi.mock("@/lib/gmail-connection", () => ({
  isGmailConnected: vi.fn(async () => false),
}));

vi.mock("@/lib/outlook-connection", () => ({
  isOutlookConnected: vi.fn(async () => false),
  getNextAuthAuthProvider: vi.fn(async () => null),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: mocks.existingRow, error: null })),
      upsert: vi.fn((payload: unknown) => {
        mocks.upsertPayload = payload;
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({
            data: {
              owner_email: "advisor@example.com",
              ...(typeof payload === "object" && payload !== null ? payload : {}),
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
    mocks.existingRow = null;
    vi.resetModules();
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
      email_signature: "Regards",
    });
  });
});

describe("advisor-profile POST merge", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    mocks.identity = { email: "advisor@example.com", userId: "user-id", provider: "supabase" };
    mocks.upsertPayload = null;
    mocks.existingRow = {
      owner_email: "advisor@example.com",
      email_signature: "Jane Advisor\nCFP",
      advisor_name: "Jane Advisor",
      llm_provider: "gemini",
      llm_model_overrides: { extraction: "gemini-2.0-flash" },
      default_research_tier: "agentic-research",
      logo_url: "https://cdn.example/logo.png",
    };
    vi.resetModules();
  });

  it("partial LLM save retains email signature and other untouched columns", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/advisor-profile", {
        method: "POST",
        body: JSON.stringify({
          llmProvider: "openai",
          llmModelOverrides: null,
          defaultResearchTier: "deep-research",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.upsertPayload).toMatchObject({
      owner_email: "advisor@example.com",
      email_signature: "Jane Advisor\nCFP",
      advisor_name: "Jane Advisor",
      logo_url: "https://cdn.example/logo.png",
      llm_provider: "openai",
      llm_model_overrides: null,
      default_research_tier: "deep-research",
    });
  });

  it("partial signature save retains LLM preferences", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/advisor-profile", {
        method: "POST",
        body: JSON.stringify({
          emailSignature: "Updated signature",
          advisorName: "Jane Advisor",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.upsertPayload).toMatchObject({
      email_signature: "Updated signature",
      advisor_name: "Jane Advisor",
      llm_provider: "gemini",
      llm_model_overrides: { extraction: "gemini-2.0-flash" },
      default_research_tier: "agentic-research",
    });
  });

  it("explicit llmProvider null clears the stored provider", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("https://app.test/api/advisor-profile", {
        method: "POST",
        body: JSON.stringify({ llmProvider: null }),
      })
    );

    expect(res.status).toBe(200);
    expect(mocks.upsertPayload).toMatchObject({
      llm_provider: null,
      email_signature: "Jane Advisor\nCFP",
    });
  });
});
