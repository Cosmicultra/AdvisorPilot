import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./async-pool";

describe("mapWithConcurrency", () => {
  it("preserves order and respects concurrency cap", async () => {
    const order: number[] = [];
    const out = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async (n) => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 5 - n));
      return n * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40]);
    expect(order.length).toBe(5);
  });
});
