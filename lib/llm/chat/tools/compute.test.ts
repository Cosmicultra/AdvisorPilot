import { describe, expect, it } from "vitest";
import { computeTool } from "./compute";
import type { ChatToolContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `compute` tool tests — focused on:
 *   1. Operation gate (rejects unknown ops)
 *   2. clientId UUID validation
 *   3. Visibility gate (404-style notFound result)
 *   4. Each operation dispatches to the right projection helper + wraps the result
 *   5. topN argument flows through to holdings_breakdown
 *
 * Projection math is already covered by lib/crm/projections.test.ts; here we
 * only verify the tool dispatch, args parsing, and visibility behavior.
 */

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

function makeMockSupabase(fixtures: {
  tables?: Record<string, TableResult>;
  rpcs?: Record<string, TableResult>;
}): SupabaseClient {
  const byTable = new Map(Object.entries(fixtures.tables ?? {}));
  const byRpc = new Map(Object.entries(fixtures.rpcs ?? {}));
  return {
    from(table: string) {
      const result = byTable.get(table) ?? ({ data: null, error: null } as TableResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const chainable = () => builder;
      for (const m of ["select", "eq"]) builder[m] = chainable;
      builder.maybeSingle = () => Promise.resolve(result);
      return builder;
    },
    rpc(name: string) {
      const result = byRpc.get(name) ?? ({ data: null, error: null } as TableResult);
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;
}

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

const CTX = (supabase: SupabaseClient): ChatToolContext => ({
  advisorEmail: "jane@firm.com",
  conversationId: "conv_1",
  currentClientId: CLIENT_ID,
  supabase,
  request: null,
  selection: null,
  emitPartial: () => undefined,
});

function clientRow(holdings: Array<Record<string, unknown>>) {
  return {
    id: CLIENT_ID,
    owner_email: "jane@firm.com",
    client: { firstName: "John", lastName: "Smith" },
    holdings,
    total_value: holdings.reduce((s, h) => s + (Number(h.value) || 0), 0),
    stage: null,
    status: "Analyzed",
    tags: [],
    location: null,
    email: null,
    phone: null,
    last_contacted_at: null,
    next_meeting_at: null,
    review_due_at: null,
    owner_initials: "JS",
    household_label: null,
    inception_year: null,
    ytd_return: null,
    org_id: null,
    visibility: "private",
    owner_user_id: null,
    meeting_notes: null,
    demo_mode: false,
    analysis: null,
    source: null,
    roth_worksheet: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument validation
// ─────────────────────────────────────────────────────────────────────────────

describe("compute — argument validation", () => {
  it("rejects unknown operation", async () => {
    const supabase = makeMockSupabase({});
    const r = await computeTool.handler(
      { operation: "fee_drag", clientId: CLIENT_ID },
      CTX(supabase),
    );
    expect(r.error).toMatch(/Unknown operation/);
  });

  it("rejects missing clientId", async () => {
    const supabase = makeMockSupabase({});
    const r = await computeTool.handler(
      { operation: "allocation_summary" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/clientId.*UUID/i);
  });

  it("rejects non-UUID clientId", async () => {
    const supabase = makeMockSupabase({});
    const r = await computeTool.handler(
      { operation: "allocation_summary", clientId: "abc" },
      CTX(supabase),
    );
    expect(r.error).toMatch(/UUID/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Visibility gate
// ─────────────────────────────────────────────────────────────────────────────

describe("compute — visibility gate", () => {
  it("returns notFound:true when visibility RPC returns false", async () => {
    const supabase = makeMockSupabase({
      rpcs: { clients_visible_to: { data: false, error: null } },
    });
    const r = await computeTool.handler(
      { operation: "allocation_summary", clientId: CLIENT_ID },
      CTX(supabase),
    );
    expect(r.result).toEqual({ notFound: true });
  });

  it("propagates RPC error as structured tool error", async () => {
    const supabase = makeMockSupabase({
      rpcs: {
        clients_visible_to: { data: null, error: { message: "rpc failure" } },
      },
    });
    const r = await computeTool.handler(
      { operation: "allocation_summary", clientId: CLIENT_ID },
      CTX(supabase),
    );
    expect(r.error).toMatch(/rpc failure/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Operations — happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe("compute — operations", () => {
  it("allocation_summary returns bucketed AllocationSummary", async () => {
    const supabase = makeMockSupabase({
      tables: {
        advisorpilot_clients: {
          data: clientRow([
            { value: 300_000, assetClass: "US Stock" },
            { value: 200_000, assetClass: "Cash" },
          ]),
          error: null,
        },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await computeTool.handler(
      { operation: "allocation_summary", clientId: CLIENT_ID },
      CTX(supabase),
    );
    const out = r.result as {
      clientId: string;
      totalValue: number;
      buckets: Array<{ name: string; valueUsd: number }>;
    };
    expect(out.clientId).toBe(CLIENT_ID);
    expect(out.totalValue).toBe(500_000);
    expect(out.buckets[0]).toEqual(
      expect.objectContaining({ name: "Equity", valueUsd: 300_000 }),
    );
    expect(out.buckets.find((b) => b.name === "Cash")?.valueUsd).toBe(200_000);
  });

  it("holdings_breakdown returns top-N positions (default 5)", async () => {
    const supabase = makeMockSupabase({
      tables: {
        advisorpilot_clients: {
          data: clientRow(
            Array.from({ length: 8 }, (_, i) => ({
              value: (i + 1) * 100_000,
              enrichmentResolvedTicker: `T${i + 1}`,
              assetClass: "US Stock",
            })),
          ),
          error: null,
        },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await computeTool.handler(
      { operation: "holdings_breakdown", clientId: CLIENT_ID },
      CTX(supabase),
    );
    const out = r.result as { topPositions: Array<{ ticker: string }>; holdingCount: number };
    expect(out.topPositions).toHaveLength(5);
    expect(out.holdingCount).toBe(8);
    expect(out.topPositions[0].ticker).toBe("T8");
  });

  it("holdings_breakdown topN argument controls the cut + is clamped to 50", async () => {
    const supabase = makeMockSupabase({
      tables: {
        advisorpilot_clients: {
          data: clientRow(
            Array.from({ length: 100 }, (_, i) => ({
              value: 1000,
              suggested: `S${i}`,
            })),
          ),
          error: null,
        },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });

    // topN=3 → 3 positions
    let r = await computeTool.handler(
      { operation: "holdings_breakdown", clientId: CLIENT_ID, topN: 3 },
      CTX(supabase),
    );
    expect((r.result as { topPositions: unknown[] }).topPositions).toHaveLength(3);

    // topN=9999 → clamped to 50
    r = await computeTool.handler(
      { operation: "holdings_breakdown", clientId: CLIENT_ID, topN: 9999 },
      CTX(supabase),
    );
    expect((r.result as { topPositions: unknown[] }).topPositions).toHaveLength(50);
  });

  it("account_summary returns per-account totals", async () => {
    const supabase = makeMockSupabase({
      tables: {
        advisorpilot_clients: {
          data: clientRow([
            { value: 100_000, accountNumber: "A1", registrationType: "ira" },
            { value: 50_000, accountNumber: "A1", registrationType: "ira" },
            { value: 200_000, accountNumber: "B2", registrationType: "joint" },
          ]),
          error: null,
        },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const r = await computeTool.handler(
      { operation: "account_summary", clientId: CLIENT_ID },
      CTX(supabase),
    );
    const out = r.result as {
      clientId: string;
      accounts: Array<{
        accountNumber: string;
        totalValue: number;
        holdingCount: number;
        registrationType: string;
      }>;
    };
    expect(out.clientId).toBe(CLIENT_ID);
    expect(out.accounts).toHaveLength(2);
    // Sorted by value desc — B2 (200k) > A1 (150k)
    expect(out.accounts[0]).toEqual({
      accountNumber: "B2",
      registrationType: "Joint",
      totalValue: 200_000,
      holdingCount: 1,
    });
    expect(out.accounts[1]).toEqual({
      accountNumber: "A1",
      registrationType: "Ira",
      totalValue: 150_000,
      holdingCount: 2,
    });
  });
});
