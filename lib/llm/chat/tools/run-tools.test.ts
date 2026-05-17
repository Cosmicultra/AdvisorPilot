import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest hoists vi.mock calls to the top of the file, so top-level mock
// vars aren't yet initialized when the factories run. vi.hoisted() lifts
// these declarations into the same hoisted scope so the mocks can see them.
const mocks = vi.hoisted(() => ({
  generateAnalysisPOST: vi.fn(),
  feeAnalysisPOST: vi.fn(),
  enrichHoldingsPOST: vi.fn(),
  startDeepResearchJob: vi.fn(),
}));

vi.mock("@/app/api/generate-analysis/route", () => ({ POST: mocks.generateAnalysisPOST }));
vi.mock("@/app/api/fee-analysis/route", () => ({ POST: mocks.feeAnalysisPOST }));
vi.mock("@/app/api/enrich-holdings/route", () => ({ POST: mocks.enrichHoldingsPOST }));
vi.mock("@/lib/llm/deep-research-jobs", () => ({
  startDeepResearchJob: mocks.startDeepResearchJob,
}));
// resolveAdvisorLlmSelection is used by run-deep-research; stub to a minimal value.
vi.mock("@/lib/llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/llm")>("@/lib/llm");
  return {
    ...actual,
    resolveAdvisorLlmSelection: vi.fn(async () => ({})),
  };
});

// Aliases so the test body reads naturally.
const mockGenerateAnalysisPOST = mocks.generateAnalysisPOST;
const mockFeeAnalysisPOST = mocks.feeAnalysisPOST;
const mockEnrichHoldingsPOST = mocks.enrichHoldingsPOST;
const mockStartDeepResearchJob = mocks.startDeepResearchJob;

import { runAnalysisTool } from "./run-analysis";
import { runDeepResearchTool } from "./run-deep-research";
import { runEnrichHoldingsTool } from "./run-enrich-holdings";
import { runFeeAnalysisTool } from "./run-fee-analysis";
import type { ChatToolContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `run_*` tool tests.
 *
 * Coverage per tool:
 *   - Operation gate / arg validation (UUID, required fields)
 *   - Missing ctx.request → error (the three tools that wrap routes)
 *   - Visibility miss → {notFound: true}
 *   - Empty holdings → clear error
 *   - Happy path: route handler called with the right body shape;
 *     result wrapped + persisted (where applicable)
 *
 * Doesn't exercise the route handlers' own logic (that's tested separately);
 * we only verify that the tools build the right inputs and surface the right
 * outputs.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

interface FromSpy {
  table: string;
  updatePayload?: unknown;
}

interface MockBundle {
  supabase: SupabaseClient;
  fromCalls: FromSpy[];
}

function makeMockSupabase(fixtures: {
  tables?: Record<string, TableResult>;
  rpcs?: Record<string, TableResult>;
}): MockBundle {
  const byTable = new Map(Object.entries(fixtures.tables ?? {}));
  const byRpc = new Map(Object.entries(fixtures.rpcs ?? {}));
  const fromCalls: FromSpy[] = [];
  const supabase = {
    from(table: string) {
      const spy: FromSpy = { table };
      fromCalls.push(spy);
      const result = byTable.get(table) ?? ({ data: null, error: null } as TableResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const chainable = (method: string) =>
        (...args: unknown[]) => {
          if (method === "update") spy.updatePayload = args[0];
          return builder;
        };
      for (const m of ["select", "eq", "update"]) builder[m] = chainable(m);
      builder.maybeSingle = () => Promise.resolve(result);
      // For .update().eq() chains the test ignores the returned promise,
      // so .then is the terminal — same { data, error } resolution.
      builder.then = (
        ok: (v: TableResult) => unknown,
        err?: (e: unknown) => unknown,
      ) => Promise.resolve(result).then(ok, err);
      return builder;
    },
    rpc(name: string) {
      const result = byRpc.get(name) ?? ({ data: null, error: null } as TableResult);
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;
  return { supabase, fromCalls };
}

const makeRequest = () =>
  new Request("https://example.com/api/chat/stream", {
    method: "POST",
    headers: { cookie: "ap.session=abc", authorization: "Bearer JWT" },
  });

function CTX(opts: { supabase: SupabaseClient; request: Request | null }): ChatToolContext {
  return {
    advisorEmail: "jane@firm.com",
    conversationId: "conv_1",
    currentClientId: CLIENT_ID,
    supabase: opts.supabase,
    request: opts.request,
    selection: null,
    emitPartial: () => undefined,
  };
}

function clientSnapshotRow(extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: CLIENT_ID,
    owner_email: "jane@firm.com",
    client: { firstName: "John", lastName: "Smith" },
    holdings: [
      {
        accountNumber: "1234",
        value: 100_000,
        assetClass: "ETF",
        suggested: "SPY",
        rawName: "SPDR S&P 500",
        enrichmentResolvedTicker: "SPY",
      },
    ],
    analysis: null,
    total_value: 100_000,
    ...extra,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  mockGenerateAnalysisPOST.mockReset();
  mockFeeAnalysisPOST.mockReset();
  mockEnrichHoldingsPOST.mockReset();
  mockStartDeepResearchJob.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// run_analysis
// ─────────────────────────────────────────────────────────────────────────────

describe("run_analysis", () => {
  it("rejects missing ctx.request", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await runAnalysisTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: null }),
    );
    expect(r.error).toMatch(/original chat-stream Request/);
  });

  it("rejects missing/invalid clientId", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await runAnalysisTool.handler(
      { clientId: "not-a-uuid" },
      CTX({ supabase, request: makeRequest() }),
    );
    expect(r.error).toMatch(/UUID/);
  });

  it("returns {notFound: true} when client is not visible", async () => {
    const { supabase } = makeMockSupabase({
      rpcs: { clients_visible_to: { data: false, error: null } },
    });
    const r = await runAnalysisTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: makeRequest() }),
    );
    expect(r.result).toEqual({ notFound: true });
  });

  it("rejects clients with no holdings", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_clients: { data: clientSnapshotRow({ holdings: [] }), error: null },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runAnalysisTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: makeRequest() }),
    );
    expect(r.error).toMatch(/no holdings on file/);
  });

  it("happy path: invokes generate-analysis, persists, returns summary", async () => {
    mockGenerateAnalysisPOST.mockResolvedValue(
      new Response(
        JSON.stringify({
          analysis: {
            synopsis: "Balanced portfolio with adequate diversification.",
            redFlags: ["concentrated US large-cap"],
            recommendations: ["consider international exposure"],
            talkingPoints: ["fee drag", "tax efficiency"],
            overlapInsights: [],
            objectionHandling: ["client concerned about fees"],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: clientSnapshotRow(), error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runAnalysisTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: makeRequest() }),
    );

    expect(mockGenerateAnalysisPOST).toHaveBeenCalledOnce();
    // Verify the body shape sent to the route.
    const req = mockGenerateAnalysisPOST.mock.calls[0][0] as Request;
    const body = await req.json();
    expect(body.client).toEqual({ firstName: "John", lastName: "Smith" });
    expect(body.holdings).toHaveLength(1);
    expect(body.totalValue).toBe(100_000);
    expect(Array.isArray(body.allocation)).toBe(true);

    const out = r.result as {
      persisted: boolean;
      summary: { synopsisSnippet: string; redFlagCount: number };
    };
    expect(out.persisted).toBe(true);
    expect(out.summary.synopsisSnippet).toMatch(/Balanced portfolio/);
    expect(out.summary.redFlagCount).toBe(1);

    // Verify a persist (update) was performed.
    const update = fromCalls.find(
      (c) => c.table === "advisorpilot_clients" && c.updatePayload !== undefined,
    );
    expect(update?.updatePayload).toHaveProperty("analysis");
  });

  it("persist:false skips the write", async () => {
    mockGenerateAnalysisPOST.mockResolvedValue(
      new Response(JSON.stringify({ analysis: { synopsis: "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: clientSnapshotRow(), error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runAnalysisTool.handler(
      { clientId: CLIENT_ID, persist: false },
      CTX({ supabase, request: makeRequest() }),
    );
    const out = r.result as { persisted: boolean };
    expect(out.persisted).toBe(false);
    expect(
      fromCalls.find(
        (c) => c.table === "advisorpilot_clients" && c.updatePayload !== undefined,
      ),
    ).toBeUndefined();
  });

  it("surfaces route error when generate-analysis fails", async () => {
    mockGenerateAnalysisPOST.mockResolvedValue(
      new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500 }),
    );
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: clientSnapshotRow(), error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runAnalysisTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: makeRequest() }),
    );
    expect(r.error).toMatch(/Missing OPENAI_API_KEY/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run_fee_analysis
// ─────────────────────────────────────────────────────────────────────────────

describe("run_fee_analysis", () => {
  it("rejects invalid advisorFeeAnnual", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await runFeeAnalysisTool.handler(
      { clientId: CLIENT_ID, advisorFeeAnnual: 0.5 },
      CTX({ supabase, request: makeRequest() }),
    );
    expect(r.error).toMatch(/0\.2/);
  });

  it("happy path: builds accounts payload + invokes route + returns result", async () => {
    mockFeeAnalysisPOST.mockResolvedValue(
      new Response(
        JSON.stringify({
          disclaimer: "Illustrative.",
          portfolioValue: 100_000,
          totalEstimatedFundFeesDollars: 300,
          weightedFundExpensePctOfPortfolio: 0.003,
          accounts: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { supabase } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: clientSnapshotRow(), error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runFeeAnalysisTool.handler(
      { clientId: CLIENT_ID, advisorFeeAnnual: 0.01 },
      CTX({ supabase, request: makeRequest() }),
    );

    expect(mockFeeAnalysisPOST).toHaveBeenCalledOnce();
    const req = mockFeeAnalysisPOST.mock.calls[0][0] as Request;
    const body = await req.json();
    expect(body.advisorFeeAnnual).toBe(0.01);
    expect(body.totalValue).toBe(100_000);
    expect(Array.isArray(body.accounts)).toBe(true);
    expect(body.accounts[0].fundRows[0].ticker).toBe("SPY");

    const out = r.result as { advisorFeeAnnual: number; portfolioValue: number };
    expect(out.advisorFeeAnnual).toBe(0.01);
    expect(out.portfolioValue).toBe(100_000);
  });

  it("rejects when no holdings have value", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_clients: {
          data: clientSnapshotRow({
            holdings: [{ accountNumber: "1234", value: 0, suggested: "X" }],
          }),
          error: null,
        },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runFeeAnalysisTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: makeRequest() }),
    );
    expect(r.error).toMatch(/No fund rows with values/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run_enrich_holdings
// ─────────────────────────────────────────────────────────────────────────────

describe("run_enrich_holdings", () => {
  it("happy path: invokes route + persists + returns diff summary", async () => {
    mockEnrichHoldingsPOST.mockResolvedValue(
      new Response(
        JSON.stringify({
          holdings: [
            {
              accountNumber: "1234",
              value: 100_000,
              suggested: "SPY",
              rawName: "SPDR S&P 500",
              enrichmentResolvedTicker: "SPY",
              enrichmentResolvedName: "SPDR S&P 500 ETF Trust",
              enrichmentMappedAssetClass: "US Equity",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { supabase, fromCalls } = makeMockSupabase({
      tables: { advisorpilot_clients: { data: clientSnapshotRow(), error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runEnrichHoldingsTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: makeRequest() }),
    );

    expect(mockEnrichHoldingsPOST).toHaveBeenCalledOnce();
    const out = r.result as {
      persisted: boolean;
      holdingCount: number;
      changedCount: number;
      sampleChanges: Array<unknown>;
    };
    expect(out.persisted).toBe(true);
    expect(out.holdingCount).toBe(1);
    // Name + asset class changed; ticker stayed same — so changedCount=1.
    expect(out.changedCount).toBe(1);
    expect(out.sampleChanges).toHaveLength(1);

    const update = fromCalls.find(
      (c) => c.table === "advisorpilot_clients" && c.updatePayload !== undefined,
    );
    expect(update?.updatePayload).toHaveProperty("holdings");
  });

  it("rejects when client has no holdings", async () => {
    const { supabase } = makeMockSupabase({
      tables: {
        advisorpilot_clients: { data: clientSnapshotRow({ holdings: [] }), error: null },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await runEnrichHoldingsTool.handler(
      { clientId: CLIENT_ID },
      CTX({ supabase, request: makeRequest() }),
    );
    expect(r.error).toMatch(/no holdings to enrich/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run_deep_research
// ─────────────────────────────────────────────────────────────────────────────

describe("run_deep_research", () => {
  it("does NOT require ctx.request (calls lib function directly)", async () => {
    mockStartDeepResearchJob.mockResolvedValue({ id: "job-1", status: "queued" });
    const { supabase } = makeMockSupabase({});
    const r = await runDeepResearchTool.handler(
      { user: "What's the consensus on 60/40 in 2026?" },
      CTX({ supabase, request: null }),
    );
    expect(r.error).toBeUndefined();
    const out = r.result as { jobId: string; status: string };
    expect(out.jobId).toBe("job-1");
    expect(out.status).toBe("queued");
  });

  it("rejects missing/empty user", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await runDeepResearchTool.handler(
      { user: "   " },
      CTX({ supabase, request: null }),
    );
    expect(r.error).toMatch(/required/);
  });

  it("forwards optional knobs to startDeepResearchJob", async () => {
    mockStartDeepResearchJob.mockResolvedValue({ id: "job-2", status: "queued" });
    const { supabase } = makeMockSupabase({});
    await runDeepResearchTool.handler(
      {
        user: "research question",
        knownUrls: ["https://example.com"],
        allowedDomains: ["sec.gov", "morningstar.com"],
        includeSocialSignals: true,
        maxAgenticSteps: 8,
      },
      CTX({ supabase, request: null }),
    );
    expect(mockStartDeepResearchJob).toHaveBeenCalledOnce();
    const callArgs = mockStartDeepResearchJob.mock.calls[0][0] as {
      ownerEmail: string;
      request: {
        user: string;
        knownUrls?: string[];
        allowedDomains?: string[];
        includeSocialSignals?: boolean;
        maxAgenticSteps?: number;
      };
    };
    expect(callArgs.ownerEmail).toBe("jane@firm.com");
    expect(callArgs.request.user).toBe("research question");
    expect(callArgs.request.knownUrls).toEqual(["https://example.com"]);
    expect(callArgs.request.allowedDomains).toEqual(["sec.gov", "morningstar.com"]);
    expect(callArgs.request.includeSocialSignals).toBe(true);
    expect(callArgs.request.maxAgenticSteps).toBe(8);
  });

  it("clamps maxAgenticSteps into [1, 30]", async () => {
    mockStartDeepResearchJob.mockResolvedValue({ id: "job-3", status: "queued" });
    const { supabase } = makeMockSupabase({});
    await runDeepResearchTool.handler(
      { user: "x", maxAgenticSteps: 9999 },
      CTX({ supabase, request: null }),
    );
    const callArgs = mockStartDeepResearchJob.mock.calls[0][0] as {
      request: { maxAgenticSteps?: number };
    };
    expect(callArgs.request.maxAgenticSteps).toBe(30);
  });

  it("rejects user over 4,000 chars", async () => {
    const { supabase } = makeMockSupabase({});
    const r = await runDeepResearchTool.handler(
      { user: "x".repeat(5000) },
      CTX({ supabase, request: null }),
    );
    expect(r.error).toMatch(/too long/);
  });
});
