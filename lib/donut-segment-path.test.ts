import { describe, expect, it } from "vitest";
import { buildDonutSegmentPaths, describeDonutSegmentPath } from "./donut-segment-path";

describe("donut-segment-path", () => {
  it("builds non-overlapping paths per percent slice", () => {
    const paths = buildDonutSegmentPaths(95, 95, 72, 22, [60, 25, 15]);
    expect(paths).toHaveLength(3);
    expect(paths[0]!.startAngle).toBe(0);
    expect(paths[0]!.endAngle).toBeCloseTo(216, 0);
    expect(paths[1]!.startAngle).toBeCloseTo(216, 0);
    expect(paths[2]!.endAngle).toBeCloseTo(360, 0);
    expect(paths.every((p) => p.d.startsWith("M"))).toBe(true);
  });

  it("returns empty path when sweep is zero", () => {
    expect(describeDonutSegmentPath(95, 95, 72, 22, 10, 10)).toBe("");
  });
});
