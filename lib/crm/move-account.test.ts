import { describe, expect, it } from "vitest";
import {
  UNKNOWN_ACCOUNT_NUMBER,
  applyMoveFullAccount,
  countHoldingsInAccount,
  externalAccountNumber,
  isUnknownAccountNumber,
} from "./move-account";

describe("move-account", () => {
  const holdings = [
    { rawName: "A", suggested: "A", value: 100, accountNumber: "BRK-1111", assetClass: "Equity ETF" },
    { rawName: "B", suggested: "B", value: 50, accountNumber: "BRK-1111", assetClass: "Bond ETF" },
    { rawName: "C", suggested: "C", value: 200, accountNumber: "IRA-2222", assetClass: "Equity ETF" },
  ] as Parameters<typeof applyMoveFullAccount>[0];

  it("moves all holdings from source account to destination", () => {
    const out = applyMoveFullAccount(holdings, "BRK-1111", "IRA-2222");
    expect(countHoldingsInAccount(out, "BRK-1111")).toBe(0);
    expect(countHoldingsInAccount(out, "IRA-2222")).toBe(3);
  });

  it("externalAccountNumber prefixes user text", () => {
    expect(externalAccountNumber("Fidelity rollover")).toBe("EXTERNAL:Fidelity rollover");
    expect(externalAccountNumber("   ")).toBe(UNKNOWN_ACCOUNT_NUMBER);
  });

  it("isUnknownAccountNumber detects sentinel", () => {
    expect(isUnknownAccountNumber(UNKNOWN_ACCOUNT_NUMBER)).toBe(true);
    expect(isUnknownAccountNumber("BRK-1111")).toBe(false);
  });
});
