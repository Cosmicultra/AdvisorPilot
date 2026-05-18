import { describe, expect, it } from "vitest";
import {
  ALLOCATION_SLEEVE_COLORS,
  buildSleeveAllocationSummary,
  holdingAllocationSleeveMeta,
} from "./allocation-display";

describe("buildSleeveAllocationSummary", () => {
  it("uses Analysis sleeve colors and labels", () => {
    const out = buildSleeveAllocationSummary([
      { value: 600_000, assetClass: "Individual Stock", suggested: "AAPL", rawName: "APPLE" },
      { value: 300_000, assetClass: "Bond Fund", suggested: "AGG", rawName: "BOND" },
      { value: 100_000, assetClass: "Cash / Money Market", suggested: "CASH", rawName: "SWEEP" },
    ]);
    expect(out.buckets.find((b) => b.name === "Equity")?.color).toBe(ALLOCATION_SLEEVE_COLORS.equity);
    expect(out.buckets.find((b) => b.name === "Fixed")?.color).toBe(ALLOCATION_SLEEVE_COLORS.fixedIncome);
    expect(out.buckets.find((b) => b.name === "Cash")?.color).toBe(ALLOCATION_SLEEVE_COLORS.cash);
  });

  it("exposes per-holding sleeve meta for row shading", () => {
    const meta = holdingAllocationSleeveMeta({
      assetClass: "Cash / Money Market",
      suggested: "CASH",
      rawName: "SWEEP",
    });
    expect(meta.color).toBe(ALLOCATION_SLEEVE_COLORS.cash);
    expect(meta.rowBg).toContain("rgba");
  });

  it("groups annuities and unknown wrappers into alternative investments", () => {
    const out = buildSleeveAllocationSummary([
      { value: 50_000, assetClass: "Alternative / Other", suggested: "ALT", rawName: "HEDGE" },
    ]);
    const alt = out.buckets.find((b) => b.name === "Alternative investments");
    expect(alt?.color).toBe(ALLOCATION_SLEEVE_COLORS.other);
    expect(alt?.valueUsd).toBe(50_000);
  });
});
