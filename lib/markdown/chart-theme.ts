/**
 * AdvisorPilot brand defaults for Chart.js.
 *
 * Single source of truth so every chart in every report — and in the chat
 * — uses the same palette + font + axis styling. Without this every model
 * call would re-roll its own colors and the reports would look chaotic
 * side by side.
 *
 * The model is encouraged (via the `generate_report_content` system
 * prompt, when that ships) to OMIT colors entirely — the renderer fills
 * them in from the palette below. When the model DOES specify colors,
 * we honor them.
 */

/**
 * The AdvisorPilot royal/navy palette + warm accents, in priority order.
 * Repeats when there are more buckets than colors.
 */
export const BRAND_PALETTE = [
  "#163765", // navy
  "#4f7cac", // royal
  "#a8c1e3", // light royal
  "#d3dff0", // pale royal
  "#1f7a3a", // success-green (gain)
  "#d97706", // amber (warning)
  "#b91c1c", // rose (negative)
  "#7c3aed", // purple (alternative)
  "#0891b2", // teal
  "#737373", // neutral
] as const;

/**
 * Pick a color from the palette for index `i`. Repeats on overflow.
 */
export function paletteColor(i: number): string {
  return BRAND_PALETTE[i % BRAND_PALETTE.length];
}

/**
 * Map a contiguous slice of palette colors to an array of length `n`.
 * Used for series that need one color per data point (pie / doughnut).
 */
export function paletteFor(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(paletteColor(i));
  return out;
}

/**
 * Chart.js global defaults applied lazily on first render. We mutate
 * Chart.defaults (the Chart.js convention) instead of passing options
 * to every chart — same effect, much less per-call config.
 *
 * Safe to call multiple times; second+ calls are no-ops.
 */
let _applied = false;
export async function ensureChartDefaults(): Promise<void> {
  if (_applied) return;
  // Lazy import so SSR doesn't pull Chart.js into the server bundle when
  // a server component renders the report (without rendering charts).
  const { Chart } = await import("chart.js/auto");
  const defaults = Chart.defaults;
  defaults.font = {
    ...defaults.font,
    family:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
    size: 11.5,
  };
  defaults.color = "#475569"; // slate-600
  // Light, readable gridlines.
  if (defaults.scale?.grid) {
    defaults.scale.grid.color = "#e2e8f0"; // slate-200
  }
  // Plugins live separately
  if (defaults.plugins?.legend?.labels) {
    defaults.plugins.legend.labels.boxWidth = 12;
    defaults.plugins.legend.labels.padding = 14;
  }
  if (defaults.plugins?.title) {
    defaults.plugins.title.color = "#0f172a"; // slate-900
    defaults.plugins.title.font = {
      family: defaults.font.family,
      size: 13,
      weight: "bold",
    };
  }
  defaults.responsive = true;
  defaults.maintainAspectRatio = false;
  _applied = true;
}
