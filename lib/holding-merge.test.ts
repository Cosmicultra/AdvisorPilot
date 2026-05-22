import { describe, expect, it } from "vitest";
import { flagLikelyDuplicateHoldings } from "./holding-merge";

describe("holding-merge", () => {
  it("flags repeated symbol and value combinations", () => {
    const holdings = flagLikelyDuplicateHoldings([
      { normalizedSymbol: "AAPL", value: 1000 },
      { normalizedSymbol: "AAPL", value: 1000 },
      { normalizedSymbol: "MSFT", value: 1000 },
    ]);

    expect(holdings[0]?.duplicateOfIndex).toBeUndefined();
    expect(holdings[1]?.duplicateOfIndex).toBe(0);
    expect(holdings[2]?.duplicateOfIndex).toBeUndefined();
  });

  it("does not flag same symbol in different accounts", () => {
    const holdings = flagLikelyDuplicateHoldings([
      { normalizedSymbol: "AAPL", value: 1000, accountNumber: "BRK-****-1111" },
      { normalizedSymbol: "AAPL", value: 1000, accountNumber: "IRA-****-2222" },
    ]);

    expect(holdings[0]?.duplicateOfIndex).toBeUndefined();
    expect(holdings[1]?.duplicateOfIndex).toBeUndefined();
  });
});
