import { describe, expect, it } from "vitest";
import { canonicalizeAssetClass, classifyAllocationBucket } from "./asset-classes";

describe("asset-classes", () => {
  it("canonicalizes bare ETF wrapper label", () => {
    expect(canonicalizeAssetClass("etf")).toBe("ETF");
  });

  it("classifies generic ETF using name hints", () => {
    expect(classifyAllocationBucket("ETF", "BND - Vanguard Total Bond Market ETF", "BND")).toBe("fixedIncome");
  });

  it("returns other for ambiguous ETF", () => {
    expect(classifyAllocationBucket("ETF", "ABC FUND", "ABC")).toBe("other");
  });

  it("maps Bond ETF to fixed allocation bucket", () => {
    expect(classifyAllocationBucket("Bond ETF", "BND", "Vanguard Total Bond")).toBe("fixedIncome");
    expect(canonicalizeAssetClass("Bond ETF")).toBe("Bond ETF");
  });

  it("maps Equity ETF and Equity Mutual Fund to equity allocation", () => {
    expect(classifyAllocationBucket("Equity ETF", "VOO", "S&P 500 ETF")).toBe("equity");
    expect(classifyAllocationBucket("Equity Mutual Fund", "VFIAX", "500 Index")).toBe("equity");
  });

  it("maps cash sleeve ETFs and mutual funds to cash allocation", () => {
    expect(classifyAllocationBucket("Cash ETF", "SGOV", "0-3 Month Treasury")).toBe("cash");
    expect(classifyAllocationBucket("Cash Mutual Fund", "VMFXX", "Federal Money Market")).toBe("cash");
  });
});
