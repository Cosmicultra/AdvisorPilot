import { describe, expect, it } from "vitest";
import { expandHoldingsPageSpec } from "./holdings-page-spec";

describe("expandHoldingsPageSpec", () => {
  it("returns [] for empty or whitespace", () => {
    expect(expandHoldingsPageSpec("")).toEqual([]);
    expect(expandHoldingsPageSpec("   ")).toEqual([]);
  });

  it("parses inclusive ranges and commas", () => {
    expect(expandHoldingsPageSpec("1-2")).toEqual([1, 2]);
    expect(expandHoldingsPageSpec("1,3,5,9")).toEqual([1, 3, 5, 9]);
    expect(expandHoldingsPageSpec("1-3,5-6,10-11")).toEqual([1, 2, 3, 5, 6, 10, 11]);
  });

  it("normalizes reversed ranges and dedupes", () => {
    expect(expandHoldingsPageSpec("3-1")).toEqual([1, 2, 3]);
    expect(expandHoldingsPageSpec("1-2,2-3")).toEqual([1, 2, 3]);
  });

  it("allows spaces in input", () => {
    expect(expandHoldingsPageSpec("1 - 3 , 5")).toEqual([1, 2, 3, 5]);
  });

  it("normalizes page labels, middle dots, unicode commas, and en-dash ranges", () => {
    expect(expandHoldingsPageSpec("page 1,4,7")).toEqual([1, 4, 7]);
    expect(expandHoldingsPageSpec("Pages: 1,4,7")).toEqual([1, 4, 7]);
    expect(expandHoldingsPageSpec("1·4·7")).toEqual([1, 4, 7]);
    expect(expandHoldingsPageSpec("1，4，7")).toEqual([1, 4, 7]);
    expect(expandHoldingsPageSpec("2–5")).toEqual([2, 3, 4, 5]); // en-dash inside range part
  });
});
