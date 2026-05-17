/**
 * Tests for the pure report-line-ops helpers. Lives outside the
 * manage_report tool so we can test the string + range logic without
 * the DB / visibility-gate layer.
 *
 * Covers:
 *   1. splitLines: 1-indexed sentinel + CRLF normalization
 *   2. getLines: full read, range slice, out-of-bounds clamping
 *   3. insertLines: prepend / middle / append / out-of-bounds / oversize
 *   4. replaceLines: shrink / grow / out-of-bounds / oversize
 *   5. deleteLines: middle / first / last / out-of-bounds
 */

import { describe, expect, it } from "vitest";
import {
  deleteLines,
  getLines,
  insertLines,
  MAX_CONTENT_LENGTH,
  replaceLines,
  splitLines,
} from "./report-line-ops";

const SAMPLE = "# Title\n\nLine 3\nLine 4\nLine 5";

describe("splitLines", () => {
  it("returns a sentinel-prefixed 1-indexed array", () => {
    const out = splitLines("a\nb\nc");
    expect(out).toHaveLength(4); // sentinel + 3 lines
    expect(out[1]).toBe("a");
    expect(out[2]).toBe("b");
    expect(out[3]).toBe("c");
  });

  it("normalizes CRLF + CR to LF", () => {
    const out = splitLines("a\r\nb\rc");
    expect(out.slice(1)).toEqual(["a", "b", "c"]);
  });
});

describe("getLines", () => {
  it("returns every line when no range provided", () => {
    const out = getLines(SAMPLE);
    expect(out.map((l) => l.line)).toEqual([1, 2, 3, 4, 5]);
    expect(out[0]).toEqual({ line: 1, text: "# Title" });
    expect(out[2]).toEqual({ line: 3, text: "Line 3" });
  });

  it("returns a sliced range inclusive on both ends", () => {
    const out = getLines(SAMPLE, 3, 4);
    expect(out).toEqual([
      { line: 3, text: "Line 3" },
      { line: 4, text: "Line 4" },
    ]);
  });

  it("clamps out-of-range start/end to valid bounds", () => {
    const out = getLines(SAMPLE, 100, 200);
    // Clamped to [5..5]
    expect(out).toEqual([{ line: 5, text: "Line 5" }]);
  });
});

describe("insertLines", () => {
  it("inserts a single line in the middle, shifting subsequent rows", () => {
    const out = insertLines(SAMPLE, 3, "INSERTED");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    const lines = splitLines(out.content).slice(1);
    expect(lines).toEqual(["# Title", "", "INSERTED", "Line 3", "Line 4", "Line 5"]);
    expect(out.insertedAtLine).toBe(3);
    expect(out.insertedLineCount).toBe(1);
  });

  it("inserts multiple lines at once", () => {
    const out = insertLines("a\nb\nc", 2, "X\nY");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(splitLines(out.content).slice(1)).toEqual(["a", "X", "Y", "b", "c"]);
    expect(out.insertedLineCount).toBe(2);
  });

  it("appends when atLine == total+1", () => {
    const out = insertLines("a\nb", 3, "c");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(splitLines(out.content).slice(1)).toEqual(["a", "b", "c"]);
  });

  it("rejects atLine == 0 or negative", () => {
    expect(insertLines("a\nb", 0, "x").ok).toBe(false);
    expect(insertLines("a\nb", -1, "x").ok).toBe(false);
  });

  it("rejects atLine beyond document end", () => {
    const r = insertLines("a\nb", 5, "x");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error).toMatch(/beyond the end/);
  });

  it("rejects when the resulting content exceeds the cap", () => {
    const big = "x".repeat(MAX_CONTENT_LENGTH - 5);
    const r = insertLines(big, 1, "x".repeat(20));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error).toMatch(/exceed/);
  });
});

describe("replaceLines", () => {
  it("replaces a range with shorter content (shrinks)", () => {
    const out = replaceLines("a\nb\nc\nd\ne", 2, 4, "X");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(splitLines(out.content).slice(1)).toEqual(["a", "X", "e"]);
    expect(out.removedLineCount).toBe(3);
    expect(out.insertedLineCount).toBe(1);
  });

  it("replaces a single line with multiple (grows)", () => {
    const out = replaceLines("a\nb\nc", 2, 2, "X\nY\nZ");
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(splitLines(out.content).slice(1)).toEqual(["a", "X", "Y", "Z", "c"]);
  });

  it("rejects when start > end", () => {
    expect(replaceLines("a\nb", 2, 1, "x").ok).toBe(false);
  });

  it("rejects when end is beyond document", () => {
    const r = replaceLines("a\nb", 1, 5, "x");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected error");
    expect(r.error).toMatch(/out of bounds/);
  });
});

describe("deleteLines", () => {
  it("removes a contiguous middle range", () => {
    const out = deleteLines("a\nb\nc\nd\ne", 2, 4);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(splitLines(out.content).slice(1)).toEqual(["a", "e"]);
    expect(out.removedLineCount).toBe(3);
  });

  it("removes the first line", () => {
    const out = deleteLines("a\nb\nc", 1, 1);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(splitLines(out.content).slice(1)).toEqual(["b", "c"]);
  });

  it("removes the last line", () => {
    const out = deleteLines("a\nb\nc", 3, 3);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected ok");
    expect(splitLines(out.content).slice(1)).toEqual(["a", "b"]);
  });

  it("rejects ranges outside the document", () => {
    expect(deleteLines("a\nb", 3, 5).ok).toBe(false);
    expect(deleteLines("a\nb", 0, 1).ok).toBe(false);
  });
});
