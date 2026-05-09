import { describe, expect, it } from "vitest";
import {
  cacheRowIsFresh,
  cachedFigiConflictsLive,
  enrichmentLookupKeys,
} from "./security-enrichment-cache";

describe("enrichmentLookupKeys", () => {
  it("prefers figi then cusip then symbol", () => {
    const keys = enrichmentLookupKeys({
      figi: { figi: "ABC", ticker: "ZZZ" },
      cusip: "037833100",
      inferredSymbol: "AAPL",
    });
    expect(keys).toEqual(["figi:ABC", "cusip:037833100", "sym:AAPL"]);
  });

  it("omits figi when OpenFIGI skipped", () => {
    const keys = enrichmentLookupKeys({
      figi: { figi: "", skipped: true, reason: "no_hit" },
      cusip: "",
      inferredSymbol: "VOO",
    });
    expect(keys).toEqual(["sym:VOO"]);
  });
});

describe("cacheRowIsFresh", () => {
  it("returns false when older than ttl", () => {
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    expect(cacheRowIsFresh(old, 90)).toBe(false);
  });

  it("returns true when inside ttl", () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(cacheRowIsFresh(recent, 90)).toBe(true);
  });
});

describe("cachedFigiConflictsLive", () => {
  it("no conflict when OpenFIGI skipped", () => {
    expect(
      cachedFigiConflictsLive({
        cachedFigi: "OLD",
        liveFigi: "",
        liveOpenFigiSkipped: true,
      })
    ).toBe(false);
  });

  it("conflict when cache empty but live FIGI present", () => {
    expect(
      cachedFigiConflictsLive({
        cachedFigi: "",
        liveFigi: "NEWFIGI",
        liveOpenFigiSkipped: false,
      })
    ).toBe(true);
  });

  it("conflict when cached differs from live", () => {
    expect(
      cachedFigiConflictsLive({
        cachedFigi: "A",
        liveFigi: "B",
        liveOpenFigiSkipped: false,
      })
    ).toBe(true);
  });
});
