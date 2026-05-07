import { describe, expect, it } from "vitest";
import { emptyRothWorksheet, parseMoneyInput, rothIllustrationQualifiedBalance } from "./roth-worksheet";

describe("parseMoneyInput", () => {
  it("parses currency-like strings", () => {
    expect(parseMoneyInput("100,000")).toBe(100000);
    expect(parseMoneyInput("$250k")).toBe(0); // rejects non numeric tail
    expect(parseMoneyInput("")).toBe(0);
  });
});

describe("rothIllustrationQualifiedBalance", () => {
  it("caps entire-balance path to traditional qualified when holdings breakdown exists", () => {
    const ws = { ...emptyRothWorksheet(), useEntireQualifiedBalance: true, qualifiedAssetValue: "" };
    const portfolio = 1_000_000;
    const traditional = 420_000;
    expect(rothIllustrationQualifiedBalance(ws, portfolio, traditional)).toBe(traditional);
  });

  it("clamps worksheet entry above traditional total", () => {
    const ws = {
      ...emptyRothWorksheet(),
      useEntireQualifiedBalance: true,
      qualifiedAssetValue: "999999999",
    };
    expect(rothIllustrationQualifiedBalance(ws, 2_000_000, 100_000)).toBe(100_000);
  });

  it("uses portfolio when traditional qualified unavailable (legacy uploads)", () => {
    const ws = { ...emptyRothWorksheet(), useEntireQualifiedBalance: true, qualifiedAssetValue: "" };
    expect(rothIllustrationQualifiedBalance(ws, 300_000, 0)).toBe(300_000);
  });

  it("caps specific conversion amounts", () => {
    const ws = {
      ...emptyRothWorksheet(),
      useEntireQualifiedBalance: false,
      specificConversionAmount: "999999999",
    };
    expect(rothIllustrationQualifiedBalance(ws, 1_000_000, 50_000)).toBe(50_000);
  });

  it("defaults unanswered worksheet to capped statement total when breakdown exists", () => {
    const ws = emptyRothWorksheet();
    expect(rothIllustrationQualifiedBalance(ws, 800_000, 90_000)).toBe(90_000);
  });
});
