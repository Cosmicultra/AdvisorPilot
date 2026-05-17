"use client";

/**
 * Renders a `mermaid` fenced code block.
 *
 * Contract: the fenced body must be a valid Mermaid diagram definition
 * (flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram,
 * gantt, pie, journey, mindmap, timeline, etc. — any v11 diagram type).
 * Anything that fails to parse is shown via `<BlockErrorFallback>` so
 * the surrounding message still renders.
 *
 * Performance:
 *   - Mermaid is ~1 MB minified — lazy-loaded via dynamic import so it
 *     never hits the SSR bundle and only downloads when a real diagram
 *     appears in the chat / a report.
 *   - First render initializes Mermaid with the AdvisorPilot brand theme.
 *     Subsequent renders reuse the same instance.
 *
 * Theming: matches the Chart.js `BRAND_PALETTE` (royal navy + accents)
 * so diagrams + charts in the same report look like one design system.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.15.
 */

import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { BlockErrorFallback } from "./error-fallback";

/**
 * Lazy-load Mermaid the first time we need it + initialize the brand
 * theme. The module-level promise is cached so concurrent renders share
 * one download.
 */
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import("mermaid").then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // 'base' lets us override every color via themeVariables.
      // 'neutral' would also work but locks more of the palette.
      theme: "base",
      themeVariables: {
        // Core colors mirror lib/markdown/chart-theme.ts BRAND_PALETTE
        // so a report with a flowchart + a doughnut chart looks unified.
        primaryColor: "#d3dff0", // pale royal — node fill
        primaryTextColor: "#0f172a", // slate-900 — node label
        primaryBorderColor: "#4f7cac", // royal — node border
        lineColor: "#4f7cac", // royal — edges
        secondaryColor: "#a8c1e3", // light royal — alt nodes
        secondaryTextColor: "#163765", // navy
        secondaryBorderColor: "#163765", // navy
        tertiaryColor: "#f8fafc", // slate-50 — background fills
        tertiaryTextColor: "#475569", // slate-600
        tertiaryBorderColor: "#cbd5e1", // slate-300
        // Diagram backgrounds / cluster fills
        background: "#ffffff",
        mainBkg: "#d3dff0",
        secondBkg: "#f8fafc",
        clusterBkg: "rgba(12, 25, 41, 0.03)",
        clusterBorder: "#cbd5e1",
        // Notes (sequence diagrams, etc.)
        noteBkgColor: "#fef3c7", // amber-100
        noteTextColor: "#92400e", // amber-800
        noteBorderColor: "#fcd34d", // amber-300
        // Edges / arrows
        edgeLabelBackground: "#ffffff",
        // Fonts — match the chat bubble + report body
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
        fontSize: "12.5px",
      },
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: "basis" },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
    });
    return mermaid;
  });
  return mermaidPromise;
}

export interface MermaidBlockProps {
  /** Raw diagram definition between the fence markers. */
  source: string;
}

interface RenderState {
  status: "loading" | "ok" | "error";
  svg?: string;
  error?: string;
}

export function MermaidBlock({ source }: MermaidBlockProps): ReactElement {
  // useId gives us a stable, render-safe DOM id Mermaid uses internally
  // for SVG element ids. Must start with a letter so we prefix it.
  const rawId = useId();
  const diagramId = `mermaid-${rawId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [state, setState] = useState<RenderState>({ status: "loading" });
  // Used by the parse/render effect to bail out if the component
  // re-renders mid-flight (e.g. streaming source still changing).
  const tokenRef = useRef(0);

  // We intentionally do NOT reset state to "loading" synchronously here.
  // First render starts in "loading" via useState's initial value; on a
  // `source` change (rare — mostly during streaming), keeping the
  // previous SVG visible until the new parse resolves looks better than
  // a flash of skeleton. The token guard cancels stale setState calls.
  // Also avoids the react-hooks/set-state-in-effect lint warning.
  useEffect(() => {
    const myToken = ++tokenRef.current;

    loadMermaid()
      .then(async (mermaid) => {
        if (tokenRef.current !== myToken) return;

        // 1. Validate the source can be parsed BEFORE rendering. This
        //    surfaces syntax errors via our friendly fallback rather
        //    than Mermaid's own (which dumps a broken SVG into the DOM).
        try {
          await mermaid.parse(source);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (tokenRef.current === myToken) {
            setState({ status: "error", error: msg });
          }
          return;
        }

        // 2. Render → SVG string.
        try {
          const { svg } = await mermaid.render(diagramId, source);
          if (tokenRef.current === myToken) {
            setState({ status: "ok", svg });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (tokenRef.current === myToken) {
            setState({ status: "error", error: msg });
          }
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (tokenRef.current === myToken) {
          setState({ status: "error", error: `Failed to load Mermaid: ${msg}` });
        }
      });

    // No teardown needed — `tokenRef.current !== myToken` cancels stale
    // setState calls from the previous render's pending promises.
  }, [source, diagramId]);

  if (state.status === "error") {
    return (
      <BlockErrorFallback
        message={state.error ?? "Diagram failed to render."}
        raw={source}
        language="mermaid"
      />
    );
  }

  if (state.status === "loading" || !state.svg) {
    return (
      <div
        className="my-4 flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-xs text-slate-500"
      >
        <span className="inline-flex items-center gap-2">
          <span
            className="h-3 w-3 animate-pulse rounded-full bg-[#4f7cac]"
            aria-hidden
          />
          Rendering diagram…
        </span>
      </div>
    );
  }

  // Mermaid SVG goes through `mermaid.render()` with `securityLevel: "strict"`
  // so script tags + javascript: URLs are stripped. The SVG is safe to inject.
  return (
    <div
      className="my-4 overflow-x-auto rounded-lg border border-slate-200 bg-white p-4"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
