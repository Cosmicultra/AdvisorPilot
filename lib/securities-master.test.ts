import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyMasterResolutionToHolding,
  holdingNameConsistencyScore,
  mapNasdaqAssetClassToAdvisorPilot,
  normalizePrimarySymbol,
  resolveFromSecuritiesMaster,
} from "./securities-master";

describe("normalizePrimarySymbol", () => {
  it("uppercases ascii and trims", () => {
    expect(normalizePrimarySymbol("  aapl ")).toBe("AAPL");
    expect(normalizePrimarySymbol("abR$D")).toBe("ABR$D");
  });

  it("returns empty string for blanks", () => {
    expect(normalizePrimarySymbol("")).toBe("");
    expect(normalizePrimarySymbol(undefined)).toBe("");
  });
});

describe("mapNasdaqAssetClassToAdvisorPilot", () => {
  const pairs: Array<{ nasdaqIn: string; advisorOut: string }> = [
    { nasdaqIn: "Stock / Equity", advisorOut: "Individual Stock" },
    { nasdaqIn: "Stock ETF", advisorOut: "Equity ETF" },
    { nasdaqIn: "Bond ETF / Fixed Income ETF", advisorOut: "Bond ETF" },
    { nasdaqIn: "International / Global Stock ETF", advisorOut: "International Equity" },
    { nasdaqIn: "Foreign Equity", advisorOut: "International Equity" },
    { nasdaqIn: "Preferred Equity", advisorOut: "Individual Stock" },
    { nasdaqIn: "Leveraged / Inverse ETF", advisorOut: "Equity ETF" },
    { nasdaqIn: "Alternative / Options Strategy ETF", advisorOut: "Equity ETF" },
    { nasdaqIn: "Commodity / Crypto ETF or Trust", advisorOut: "Alternative / Other" },
    { nasdaqIn: "Real Estate ETF", advisorOut: "Equity ETF" },
    { nasdaqIn: "Cash / Cash-Like ETF", advisorOut: "Cash ETF" },
    { nasdaqIn: "Listed Fund / Trust", advisorOut: "Mutual Fund" },
    { nasdaqIn: "Closed-End Fund", advisorOut: "Mutual Fund" },
    { nasdaqIn: "Derivative / Warrant", advisorOut: "Alternative / Other" },
    { nasdaqIn: "Rights", advisorOut: "Alternative / Other" },
    { nasdaqIn: "Unit", advisorOut: "Alternative / Other" },
    { nasdaqIn: "Other", advisorOut: "Unknown" },
  ];

  it.each(pairs)("$nasdaqIn → $advisorOut", ({ nasdaqIn, advisorOut }) => {
    expect(mapNasdaqAssetClassToAdvisorPilot(nasdaqIn)).toBe(advisorOut);
  });
});

describe("holdingNameConsistencyScore", () => {
  it("scores reasonably high overlap for NVIDIA variants", () => {
    expect(
      holdingNameConsistencyScore("NVIDIA CORP COMMON STOCK", "NVIDIA Corporation - Common Stock")
    ).toBeGreaterThanOrEqual(0.25);
  });

  it("scores low overlap between NVIDIA text and unrelated CORP wording", () => {
    expect(holdingNameConsistencyScore("NVIDIA CORPORATION", "Some unrelated CORP LLC savings")).toBeLessThan(
      0.35
    );
  });
});

function supabaseReturningRow(row: Record<string, unknown> | null): SupabaseClient {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient;
}

describe("resolveFromSecuritiesMaster", () => {
  beforeEach(() => {
    vi.stubEnv("ADVISORPILOT_MASTER_NAME_SCORE_THRESHOLD", "35");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when inferred symbol missing", async () => {
    const sb = supabaseReturningRow(null);
    const hit = await resolveFromSecuritiesMaster(sb, { inferredSymbol: "", suggested: "x", rawName: "y" });
    expect(hit).toBeNull();
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("rejects CORP master row vs NVIDIA statement when names disagree", async () => {
    const row = {
      primary_symbol: "CORP",
      holding_name: "Generic Corporation Incorporated",
      investment_type: "Common Stock",
      share_class: "Common Stock",
      nasdaq_asset_class: "Stock / Equity",
      region_scope: "Domestic / U.S. Listed",
      source: "nasdaq_csv",
    };
    const sb = supabaseReturningRow(row);
    const hit = await resolveFromSecuritiesMaster(sb, {
      inferredSymbol: "CORP",
      suggested: "CORP?",
      rawName: "NVIDIA CORPORATION",
    });
    expect(hit).toBeNull();
  });

  it("accepts NVDA when master name aligns with extracted context", async () => {
    const row = {
      primary_symbol: "NVDA",
      holding_name: "NVIDIA Corporation",
      investment_type: "Common Stock",
      share_class: "Common Stock",
      nasdaq_asset_class: "Stock / Equity",
      region_scope: "Domestic / U.S. Listed",
      source: "nasdaq_csv",
    };
    const sb = supabaseReturningRow(row);
    const hit = await resolveFromSecuritiesMaster(sb, {
      inferredSymbol: "NVDA",
      suggested: "NVDA listed equity",
      rawName: "NVIDIA Corporation",
    });
    expect(hit).not.toBeNull();
    expect(hit?.matchConfidencePercent).toBeGreaterThanOrEqual(35);
    expect(hit?.row.primary_symbol).toBe("NVDA");
  });
});

describe("applyMasterResolutionToHolding", () => {
  it("fills suggested + enrichment bookkeeping", () => {
    const patched = applyMasterResolutionToHolding(
      { rawName: "NVIDIA CORP", suggested: "", assetClass: "Unknown", confidence: 60 },
      {
        row: {
          primary_symbol: "NVDA",
          holding_name: "NVIDIA Corporation - Common Stock",
          investment_type: "Common Stock",
          share_class: "Common Stock",
          nasdaq_asset_class: "Stock / Equity",
          region_scope: "Domestic / U.S. Listed",
        },
        matchConfidencePercent: 90,
        nameConsistencyPercent: 90,
      }
    );

    expect(patched.masterResolvedSymbol).toBe("NVDA");
    expect(String(patched.suggested)).toContain("NVDA");
    expect(patched.enrichmentFigiSkippedReason).toBe("securities_master_hit");
  });
});
