/**
 * SVG arc paths for donut chart segments — each slice is its own closed path
 * so click/hover targets match the visible color only (no full-ring overlap).
 */

export type DonutSegmentPath = {
  d: string;
  startAngle: number;
  endAngle: number;
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/** Closed annular slice from startAngle to endAngle (degrees, 0 = 12 o'clock). */
export function describeDonutSegmentPath(
  cx: number,
  cy: number,
  radius: number,
  strokeWidth: number,
  startAngle: number,
  endAngle: number
): string {
  if (endAngle <= startAngle) return "";

  const innerR = radius - strokeWidth / 2;
  const outerR = radius + strokeWidth / 2;
  const sweep = endAngle - startAngle;
  const largeArc = sweep > 180 ? 1 : 0;

  const startOuter = polarToCartesian(cx, cy, outerR, startAngle);
  const endOuter = polarToCartesian(cx, cy, outerR, endAngle);
  const endInner = polarToCartesian(cx, cy, innerR, endAngle);
  const startInner = polarToCartesian(cx, cy, innerR, startAngle);

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${startInner.x} ${startInner.y}`,
    "Z",
  ].join(" ");
}

/** Build one path per segment from portfolio-weight percents (should sum ~100). */
export function buildDonutSegmentPaths(
  cx: number,
  cy: number,
  radius: number,
  strokeWidth: number,
  segmentPercents: number[]
): DonutSegmentPath[] {
  let cursor = 0;
  const out: DonutSegmentPath[] = [];

  for (const pct of segmentPercents) {
    const sweep = Math.max(0, (pct / 100) * 360);
    const startAngle = cursor;
    const endAngle = cursor + sweep;
    cursor = endAngle;
    if (sweep <= 0) continue;
    out.push({
      startAngle,
      endAngle,
      d: describeDonutSegmentPath(cx, cy, radius, strokeWidth, startAngle, endAngle),
    });
  }

  return out;
}
