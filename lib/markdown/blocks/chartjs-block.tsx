"use client";

/**
 * Renders a `chart:chartjs` fenced code block.
 *
 * Contract: the fenced block body must be valid Chart.js v4 JSON of the
 * shape `{ type, data, options? }`. Anything else is rejected up-front
 * with BlockErrorFallback so the parent message still renders cleanly.
 *
 * Chart.js + react-chartjs-2 are loaded only on the client (dynamic
 * import inside ensureChartDefaults + the `<Chart>` component is
 * client-only via "use client" above) — keeps the SSR bundle small.
 *
 * The renderer also injects palette colors when the model omits them,
 * so charts are visually consistent regardless of how chatty the LLM
 * was about styling.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ChartType, ChartData, ChartOptions } from "chart.js";
import { Chart as ChartReact } from "react-chartjs-2";
import { ensureChartDefaults, paletteColor, paletteFor } from "../chart-theme";
import { BlockErrorFallback } from "./error-fallback";

/** Shape we accept from the LLM. Mirrors Chart.js v4. */
interface ChartJsBlockSpec {
  type: ChartType;
  data: ChartData;
  options?: ChartOptions;
  /** Optional pixel height for the container (defaults to 320). */
  height?: number;
}

const SUPPORTED_TYPES: ReadonlySet<ChartType> = new Set<ChartType>([
  "bar",
  "line",
  "pie",
  "doughnut",
  "radar",
  "polarArea",
  "scatter",
  "bubble",
]);

function parseSpec(raw: string): { ok: true; spec: ChartJsBlockSpec } | { ok: false; error: string } {
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
  const type = obj.type;
  if (typeof type !== "string" || !SUPPORTED_TYPES.has(type as ChartType)) {
    return {
      ok: false,
      error: `Unsupported chart type "${String(type)}". Allowed: ${[...SUPPORTED_TYPES].join(", ")}.`,
    };
  }
  const data = obj.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "Chart spec is missing a valid `data` object." };
  }
  const dataObj = data as Record<string, unknown>;
  if (!Array.isArray(dataObj.datasets)) {
    return { ok: false, error: "Chart `data.datasets` must be an array." };
  }
  const height = typeof obj.height === "number" && obj.height > 0 ? obj.height : undefined;
  return {
    ok: true,
    spec: {
      type: type as ChartType,
      data: data as ChartData,
      options: (obj.options ?? undefined) as ChartOptions | undefined,
      height,
    },
  };
}

/**
 * Walk datasets and fill in palette colors when the model didn't supply
 * any. Mutates a shallow copy — never the original.
 *
 *   - bar / line / radar / scatter / bubble: per-dataset color
 *   - pie / doughnut / polarArea: per-DATA-POINT color (one slice each)
 */
function applyPalette(spec: ChartJsBlockSpec): ChartJsBlockSpec {
  const usesPerPointColors =
    spec.type === "pie" || spec.type === "doughnut" || spec.type === "polarArea";
  const datasets = spec.data.datasets.map((ds, dsIdx) => {
    // Cast through a permissive record to read/write color fields
    // across dataset variants without fighting Chart.js's discriminated
    // union types.
    const next = { ...ds } as ChartData["datasets"][number] & Record<string, unknown>;
    if (usesPerPointColors) {
      const n =
        Array.isArray(spec.data.labels) ? spec.data.labels.length : 0;
      if (next.backgroundColor === undefined && n > 0) {
        next.backgroundColor = paletteFor(n);
      }
    } else {
      const color = paletteColor(dsIdx);
      if (next.backgroundColor === undefined) {
        next.backgroundColor = color;
      }
      if (next.borderColor === undefined) {
        next.borderColor = color;
      }
    }
    return next as ChartData["datasets"][number];
  });
  return {
    ...spec,
    data: { ...spec.data, datasets },
  };
}

export interface ChartJsBlockProps {
  /** Raw JSON source between the fence markers. */
  source: string;
}

export function ChartJsBlock({ source }: ChartJsBlockProps): ReactElement {
  const [defaultsReady, setDefaultsReady] = useState(false);

  // Apply Chart.js global defaults once on first render. Effect, not
  // useMemo, because ensureChartDefaults is async.
  useEffect(() => {
    let cancelled = false;
    ensureChartDefaults().then(() => {
      if (!cancelled) setDefaultsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const parsed = useMemo(() => parseSpec(source), [source]);
  const themed = useMemo(
    () => (parsed.ok ? applyPalette(parsed.spec) : null),
    [parsed],
  );

  if (!parsed.ok) {
    return (
      <BlockErrorFallback
        message={parsed.error}
        raw={source}
        language="chart:chartjs"
      />
    );
  }

  const height = themed?.height ?? 320;
  // Render a sized container so Chart.js (with maintainAspectRatio:false)
  // has a deterministic box to draw into.
  return (
    <div
      className="my-4 rounded-lg border border-slate-200 bg-white p-3"
      style={{ height }}
    >
      {defaultsReady && themed ? (
        <ChartReact
          type={themed.type}
          data={themed.data}
          options={themed.options}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-slate-400">
          Preparing chart…
        </div>
      )}
    </div>
  );
}

// Exported for unit tests.
export const __test_parseSpec = parseSpec;
export const __test_applyPalette = applyPalette;
