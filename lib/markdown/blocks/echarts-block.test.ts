/**
 * Tests for the pure pieces of echarts-block:
 *   - parseSpec: JSON-shape validator (rejects malformed input early)
 *   - withBrandDefaults: shallow-merges brand defaults UNDER the model
 *     spec — model values WIN when supplied
 *
 * The actual <EChartsBlock> component needs a DOM + canvas. Those paths
 * are exercised in-browser. Keeping this file pure logic.
 */

import { describe, expect, it } from "vitest";
import { __test_parseSpec, __test_withBrandDefaults } from "./echarts-block";

describe("parseSpec (echarts)", () => {
  it("accepts a minimal sankey spec", () => {
    const result = __test_parseSpec(
      JSON.stringify({
        series: [
          {
            type: "sankey",
            data: [{ name: "A" }, { name: "B" }],
            links: [{ source: "A", target: "B", value: 1 }],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a heatmap with xAxis/yAxis/visualMap", () => {
    const result = __test_parseSpec(
      JSON.stringify({
        xAxis: { type: "category", data: ["Mon", "Tue"] },
        yAxis: { type: "category", data: ["AM", "PM"] },
        visualMap: { min: 0, max: 10 },
        series: [{ type: "heatmap", data: [[0, 0, 5]] }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a spec with `dataset` instead of `series`", () => {
    const result = __test_parseSpec(
      JSON.stringify({
        dataset: { source: [["A", 1], ["B", 2]] },
        series: [{ type: "bar" }],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("returns error for invalid JSON", () => {
    const result = __test_parseSpec("{ not valid }");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid JSON/);
  });

  it("rejects top-level arrays", () => {
    const result = __test_parseSpec("[1,2,3]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON object/);
  });

  it("rejects specs with neither series nor dataset", () => {
    const result = __test_parseSpec(
      JSON.stringify({ title: { text: "X" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/series.*dataset/i);
  });

  it("honors a positive integer height", () => {
    const result = __test_parseSpec(
      JSON.stringify({ height: 480, series: [{ type: "bar" }] }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.parsed.height).toBe(480);
  });

  it("ignores non-positive height (defaults later)", () => {
    const result = __test_parseSpec(
      JSON.stringify({ height: 0, series: [{ type: "bar" }] }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.parsed.height).toBeUndefined();
  });
});

describe("withBrandDefaults (echarts)", () => {
  it("supplies brand palette + textStyle when the spec omits them", () => {
    const out = __test_withBrandDefaults({ series: [{ type: "sankey" }] });
    expect(Array.isArray(out.color)).toBe(true);
    expect((out.color as unknown[])[0]).toBe("#163765"); // brand navy
    expect((out.textStyle as Record<string, unknown>).color).toBe("#475569");
  });

  it("keeps model-supplied fields (shallow merge — spec wins)", () => {
    const out = __test_withBrandDefaults({
      series: [{ type: "sankey" }],
      backgroundColor: "#000000",
      color: ["#ff00ff"],
    });
    expect(out.backgroundColor).toBe("#000000");
    expect(out.color).toEqual(["#ff00ff"]);
  });

  it("passes through the original series array untouched", () => {
    const inputSeries = [{ type: "heatmap", data: [[0, 0, 1]] }];
    const out = __test_withBrandDefaults({ series: inputSeries });
    expect(out.series).toBe(inputSeries);
  });
});
