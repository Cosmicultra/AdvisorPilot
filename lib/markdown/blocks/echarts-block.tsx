"use client";

/**
 * Renders a `chart:echarts` fenced code block.
 *
 * Use case (vs `chart:chartjs`): ECharts ships chart types Chart.js doesn't
 * have — sankey (money flow), heatmap (calendar / matrix), treemap (nested
 * composition), sunburst (hierarchical), graph/network, gauge. We keep
 * basic charts (bar / line / pie / doughnut / radar / scatter / bubble) on
 * Chart.js because its API is simpler for the model to emit correctly.
 *
 * Performance:
 *   - ECharts is ~1 MB minified — lazy-loaded via dynamic import so it
 *     never hits the SSR bundle and only downloads when a real ECharts
 *     block appears.
 *   - First render seeds Chart's `option` object with brand defaults
 *     (palette + text colors) so the model can OMIT all color fields.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.15.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { BRAND_PALETTE } from "../chart-theme";
import { BlockErrorFallback } from "./error-fallback";

/**
 * Lazy-load echarts the first time we need it. The module-level promise
 * is cached so concurrent renders share one download.
 */
let echartsPromise: Promise<typeof import("echarts")> | null = null;
function loadECharts(): Promise<typeof import("echarts")> {
  if (echartsPromise) return echartsPromise;
  echartsPromise = import("echarts");
  return echartsPromise;
}

/**
 * Brand defaults merged into every spec before rendering. The model is
 * encouraged (via the system prompt) to OMIT these fields — we fill them
 * in. When the model DOES supply them, ECharts's deep-merge keeps theirs.
 */
function brandDefaults() {
  return {
    color: [...BRAND_PALETTE],
    textStyle: {
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      color: "#475569", // slate-600
      fontSize: 11.5,
    },
    title: {
      textStyle: {
        color: "#0f172a", // slate-900
        fontSize: 13,
        fontWeight: 600,
      },
    },
    legend: {
      textStyle: { color: "#475569" },
      itemWidth: 12,
      itemHeight: 10,
    },
    tooltip: {
      backgroundColor: "#0f172a",
      borderColor: "#0f172a",
      textStyle: { color: "#ffffff", fontSize: 11.5 },
    },
    backgroundColor: "transparent",
  };
}

interface ParsedSpec {
  spec: Record<string, unknown>;
  height: number | undefined;
}

function parseSpec(
  raw: string,
): { ok: true; parsed: ParsedSpec } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Chart spec must be a JSON object." };
  }
  const obj = parsed as Record<string, unknown>;
  // Minimum sanity: ECharts needs at least one of `series` / `dataset`.
  // The `series` shape varies wildly between chart types (sankey vs heatmap
  // vs treemap), so we don't try to validate further.
  if (!Array.isArray(obj.series) && obj.dataset === undefined) {
    return {
      ok: false,
      error: "ECharts spec needs a `series` array (or a `dataset` field).",
    };
  }
  const height =
    typeof obj.height === "number" && obj.height > 0 ? obj.height : undefined;
  return { ok: true, parsed: { spec: obj, height } };
}

/**
 * Shallow-merge brand defaults UNDER the model's spec. ECharts's own
 * `setOption(option, { notMerge: false })` does the deep merge at render
 * time — we just provide a base.
 */
function withBrandDefaults(spec: Record<string, unknown>): Record<string, unknown> {
  const defaults = brandDefaults();
  return { ...defaults, ...spec };
}

export interface EChartsBlockProps {
  /** Raw JSON source between the fence markers. */
  source: string;
}

export function EChartsBlock({ source }: EChartsBlockProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseSpec(source), [source]);

  // Token-guard pattern (same as MermaidBlock) cancels stale setState
  // calls if `parsed` changes mid-flight. The render-side `!parsed.ok`
  // check below handles the parse-error path directly — no need to
  // setState from inside the effect for that case (which would also
  // trip the react-hooks/set-state-in-effect lint).
  useEffect(() => {
    if (!parsed.ok) return;
    let cancelled = false;
    let instance: import("echarts").ECharts | null = null;

    loadECharts()
      .then((echarts) => {
        if (cancelled || !containerRef.current) return;
        try {
          instance = echarts.init(containerRef.current, undefined, {
            renderer: "canvas",
          });
          instance.setOption(withBrandDefaults(parsed.parsed.spec));
          setStatus("ready");
          setError(null);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus("error");
          setError(msg);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setStatus("error");
        setError(`Failed to load ECharts: ${msg}`);
      });

    // Resize handler — ECharts canvases don't auto-track container size
    // (unlike SVG-only libraries). Re-fire on window resize so the chart
    // stays crisp during browser zoom / sidebar toggles.
    const onResize = () => {
      instance?.resize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      instance?.dispose();
    };
  }, [parsed]);

  if (!parsed.ok) {
    return (
      <BlockErrorFallback
        message={parsed.error}
        raw={source}
        language="chart:echarts"
      />
    );
  }
  if (status === "error") {
    return (
      <BlockErrorFallback
        message={error ?? "Chart failed to render."}
        raw={source}
        language="chart:echarts"
      />
    );
  }

  const height = parsed.parsed.height ?? 360;
  return (
    <div
      className="my-4 rounded-lg border border-slate-200 bg-white p-3"
      style={{ height }}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

// Exported for unit tests.
export const __test_parseSpec = parseSpec;
export const __test_withBrandDefaults = withBrandDefaults;
