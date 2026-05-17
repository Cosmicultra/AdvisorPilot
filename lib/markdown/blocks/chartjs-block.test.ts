/**
 * Tests for the pure pieces of chartjs-block:
 *   - parseSpec: JSON-shape validator (rejects malformed input early so
 *     the renderer can swap in an error badge instead of crashing).
 *   - applyPalette: brand-color injection. Verifies the model can omit
 *     colors entirely and still get a polished chart.
 *
 * The actual <ChartJsBlock> React component is exercised in integration
 * via the streaming-markdown widget (and visually in the chat). Those
 * paths need a DOM + canvas, so we keep this file logic-only.
 */

import { describe, expect, it } from "vitest";
import type { ChartData, ChartType } from "chart.js";
import { __test_applyPalette, __test_parseSpec } from "./chartjs-block";

describe("parseSpec", () => {
  it("accepts a minimal valid bar spec", () => {
    const result = __test_parseSpec(
      JSON.stringify({
        type: "bar",
        data: {
          labels: ["A", "B"],
          datasets: [{ label: "X", data: [1, 2] }],
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.type).toBe("bar");
      expect(result.spec.data.datasets).toHaveLength(1);
    }
  });

  it("returns error for invalid JSON", () => {
    const result = __test_parseSpec("{ not valid }");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid JSON/);
  });

  it("rejects arrays at the top level", () => {
    const result = __test_parseSpec("[1, 2, 3]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON object/);
  });

  it("rejects unsupported chart types", () => {
    const result = __test_parseSpec(
      JSON.stringify({ type: "treemap", data: { datasets: [] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unsupported chart type/);
  });

  it("rejects missing data object", () => {
    const result = __test_parseSpec(JSON.stringify({ type: "bar" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/missing a valid `data`/);
  });

  it("rejects datasets that aren't an array", () => {
    const result = __test_parseSpec(
      JSON.stringify({ type: "bar", data: { datasets: "nope" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/datasets.*array/);
  });

  it("honors a custom height when positive", () => {
    const result = __test_parseSpec(
      JSON.stringify({
        type: "bar",
        height: 480,
        data: { datasets: [{ data: [1] }] },
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(result.spec.height).toBe(480);
  });

  it("ignores non-positive heights (falls through to default)", () => {
    const result = __test_parseSpec(
      JSON.stringify({
        type: "bar",
        height: -10,
        data: { datasets: [{ data: [1] }] },
      }),
    );
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
    expect(result.spec.height).toBeUndefined();
  });

  for (const ok of ["bar", "line", "pie", "doughnut", "radar", "polarArea", "scatter", "bubble"] as ChartType[]) {
    it(`accepts ${ok}`, () => {
      const result = __test_parseSpec(
        JSON.stringify({ type: ok, data: { datasets: [] } }),
      );
      expect(result.ok).toBe(true);
    });
  }
});

describe("applyPalette", () => {
  it("fills per-dataset colors for bar charts when missing", () => {
    const result = __test_applyPalette({
      type: "bar",
      data: {
        labels: ["A", "B"],
        datasets: [
          { label: "X", data: [1, 2] },
          { label: "Y", data: [3, 4] },
        ],
      } as ChartData<"bar">,
    });
    const [ds0, ds1] = result.data.datasets;
    expect(ds0.backgroundColor).toBeDefined();
    expect(ds0.borderColor).toBeDefined();
    expect(ds1.backgroundColor).toBeDefined();
    expect(ds0.backgroundColor).not.toBe(ds1.backgroundColor);
  });

  it("does not overwrite an explicit dataset color", () => {
    const result = __test_applyPalette({
      type: "bar",
      data: {
        labels: ["A"],
        datasets: [{ label: "X", data: [1], backgroundColor: "#FF0000" }],
      } as ChartData<"bar">,
    });
    expect(result.data.datasets[0].backgroundColor).toBe("#FF0000");
  });

  it("uses per-point colors for pie charts", () => {
    const result = __test_applyPalette({
      type: "pie",
      data: {
        labels: ["A", "B", "C"],
        datasets: [{ data: [1, 2, 3] }],
      } as ChartData<"pie">,
    });
    const colors = result.data.datasets[0].backgroundColor;
    expect(Array.isArray(colors)).toBe(true);
    expect((colors as string[]).length).toBe(3);
  });

  it("uses per-point colors for doughnut charts", () => {
    const result = __test_applyPalette({
      type: "doughnut",
      data: {
        labels: ["A", "B"],
        datasets: [{ data: [1, 2] }],
      } as ChartData<"doughnut">,
    });
    expect(Array.isArray(result.data.datasets[0].backgroundColor)).toBe(true);
  });

  it("preserves explicit per-point colors", () => {
    const result = __test_applyPalette({
      type: "pie",
      data: {
        labels: ["A", "B"],
        datasets: [{ data: [1, 2], backgroundColor: ["#111", "#222"] }],
      } as ChartData<"pie">,
    });
    expect(result.data.datasets[0].backgroundColor).toEqual(["#111", "#222"]);
  });

  it("does not mutate the input", () => {
    const input = {
      type: "bar" as const,
      data: {
        labels: ["A"],
        datasets: [{ label: "X", data: [1] }],
      } as ChartData<"bar">,
    };
    const before = JSON.stringify(input);
    __test_applyPalette(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
