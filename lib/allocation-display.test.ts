import { describe, expect, it } from "vitest";
import {
  ALLOCATION_SLEEVE_COLORS,
  buildCurrentAllocationDonutData,
  buildInteractiveSleeveAllocation,
  buildProposedAllocationDonutSleeves,
  buildSleeveAllocationSummary,
  formatAllocationPopupAccountLabel,
  holdingAllocationSleeveMeta,
  riskProfileDisplayLabel,
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

  it("formatAllocationPopupAccountLabel uses prefix or registration", () => {
    expect(
      formatAllocationPopupAccountLabel({
        accountKey: "BRK-12345502",
        registrationType: "non_qualified",
      })
    ).toMatch(/Brk\s+5502/i);
    expect(
      formatAllocationPopupAccountLabel({
        accountKey: "****7710",
        registrationType: "qualified",
      })
    ).toBe("401(K) 7710");
  });

  it("buildInteractiveSleeveAllocation groups accounts per sleeve", () => {
    const sleeves = buildInteractiveSleeveAllocation([
      {
        value: 60_000,
        assetClass: "Individual Stock",
        suggested: "AAPL",
        rawName: "APPLE",
        accountNumber: "BRK-12345502",
        registrationType: "non_qualified",
      },
      {
        value: 40_000,
        assetClass: "Bond Fund",
        suggested: "AGG",
        rawName: "BOND",
        accountNumber: "****7710",
        registrationType: "qualified",
      },
    ]);
    const equity = sleeves.find((s) => s.label === "Equity");
    expect(equity?.accounts).toHaveLength(1);
    expect(equity?.accounts[0]?.pctOfSleeve).toBe(100);
    const fixed = sleeves.find((s) => s.label === "Fixed");
    expect(fixed?.accounts[0]?.accountLabel).toBe("401(K) 7710");
  });

  it("buildCurrentAllocationDonutData matches sleeve summary percents", () => {
    const donut = buildCurrentAllocationDonutData([
      { value: 60_000, assetClass: "Equity ETF", suggested: "VTI", rawName: "VTI" },
      { value: 40_000, assetClass: "Bond ETF", suggested: "AGG", rawName: "AGG" },
    ]);
    expect(donut).toHaveLength(2);
    const equity = donut.find((d) => d.label === "Equity");
    expect(equity?.value).toBe(60);
    expect(equity?.color).toBe(ALLOCATION_SLEEVE_COLORS.equity);
  });

  it("buildProposedAllocationDonutSleeves uses Analysis target mix", () => {
    const slices = buildProposedAllocationDonutSleeves({
      age: "62",
      riskProfile: "moderate-conservative",
    } as Parameters<typeof buildProposedAllocationDonutSleeves>[0]);
    expect(slices.map((s) => s.label).sort()).toEqual(["Cash", "Equity", "Fixed"]);
    const total = slices.reduce((sum, s) => sum + s.value, 0);
    expect(total).toBe(100);
    expect(slices.find((s) => s.label === "Equity")?.color).toBe(ALLOCATION_SLEEVE_COLORS.equity);
  });

  it("riskProfileDisplayLabel title-cases hyphenated profiles", () => {
    expect(riskProfileDisplayLabel("moderate-conservative")).toBe("Moderate Conservative");
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
