import { describe, expect, it } from "vitest";
import { bucketValuesToPercents, allocationForRiskModel } from "./allocation-math";

describe("allocation-math", () => {
  it("percent buckets sum to 100", () => {
    const p = bucketValuesToPercents(
      { equity: 50000, fixedIncome: 30000, cash: 15000, other: 5000 },
      100000
    );
    expect(p.equity + p.fixedIncome + p.cash + p.other).toBe(100);
  });

  it("splits other into model mix", () => {
    const m = allocationForRiskModel({ equity: 40, fixedIncome: 30, cash: 10, other: 20 });
    expect(Math.round(m.equity + m.fixedIncome + m.cash)).toBe(100);
    expect(m.equity).toBeGreaterThan(40);
    expect(m.fixedIncome).toBeGreaterThan(30);
  });
});
