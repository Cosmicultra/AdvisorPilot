/**
 * Pure helpers for safely rendering markdown that's still streaming.
 *
 * Problem: when Nova streams a response containing a fenced code block
 * (e.g. a `chart:chartjs` definition), the markdown parser sees an
 * UNCLOSED ``` and either:
 *   (a) treats the rest of the document as raw code, dropping all the
 *       text after the chart, OR
 *   (b) throws.
 *
 * Both look like rendering bugs to the advisor. The fix is to detect the
 * open fence at render time and either:
 *   - synthesize a closing ```\n so the parser can finish the document, OR
 *   - hand the in-progress chart a skeleton placeholder.
 *
 * This module is pure — no React, no DOM. The chat widget uses it on every
 * delta to decide what to render.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.15 (streaming markdown).
 */

/** Matches the OPENING of a fenced code block at the start of a line.
 *  Captures the language tag (everything after the backticks until the
 *  end of the line). Spec allows ```lang OR ~~~lang; we only support
 *  backticks because that's what the LLM emits.
 */
const FENCE_OPEN_RE = /^```([^\s`]*)\s*$/;
/** Matches a closing fence (no language tag, just three backticks). */
const FENCE_CLOSE_RE = /^```\s*$/;

/**
 * Walks every line of `markdown` and tracks whether we're inside a fenced
 * code block. Returns `null` when every fence is closed, or the language
 * tag of the OPEN fence when one is unterminated. Empty language = "".
 *
 * O(n) — single pass through the lines.
 */
export function detectOpenFence(markdown: string): string | null {
  let openLang: string | null = null;
  const lines = markdown.split("\n");
  for (const line of lines) {
    if (openLang === null) {
      const m = line.match(FENCE_OPEN_RE);
      if (m) openLang = m[1] ?? "";
    } else {
      if (FENCE_CLOSE_RE.test(line)) openLang = null;
    }
  }
  return openLang;
}

/** True when the markdown ends mid-fenced-block. Convenience wrapper. */
export function hasIncompleteCodeBlock(markdown: string): boolean {
  return detectOpenFence(markdown) !== null;
}

/**
 * Returns the markdown with a synthetic closing fence appended if there's
 * an unterminated block. Leaves complete markdown unchanged. Useful when
 * the renderer just needs the parser to FINISH the document — the
 * `closing` content shows up as an empty code block, which is fine when
 * the calling component has already replaced the in-flight block with a
 * skeleton (see streaming-markdown.tsx).
 */
export function closeOpenFences(markdown: string): string {
  if (!hasIncompleteCodeBlock(markdown)) return markdown;
  // Append a newline + closing fence. Newline guards against the input
  // ending with a partial line that would glue against ```.
  return markdown.endsWith("\n") ? `${markdown}\`\`\`` : `${markdown}\n\`\`\``;
}

/**
 * The two pieces the streaming renderer needs: the "complete" markdown
 * (everything up to the start of the unterminated fence — if any) and the
 * in-flight language tag for the open fence (or null).
 *
 * This lets the component:
 *   1. Render the complete prefix as normal markdown
 *   2. Append a skeleton placeholder for the in-flight block
 *
 * When `openLang` is null the entire input is in `complete` and `inFlight`
 * is null.
 */
export interface SplitAtFence {
  /** Markdown up to (but not including) the line that opened the unfinished fence. */
  complete: string;
  /** Language tag of the unfinished fence, or null when nothing's pending. */
  inFlight: string | null;
}

export function splitAtIncompleteFence(markdown: string): SplitAtFence {
  let openLang: string | null = null;
  let openIndex = -1; // line index where the still-open fence began
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (openLang === null) {
      const m = line.match(FENCE_OPEN_RE);
      if (m) {
        openLang = m[1] ?? "";
        openIndex = i;
      }
    } else {
      if (FENCE_CLOSE_RE.test(line)) {
        openLang = null;
        openIndex = -1;
      }
    }
  }

  if (openLang === null) {
    return { complete: markdown, inFlight: null };
  }
  // Everything BEFORE the line that started the open fence is safe to render.
  // We trim a trailing newline so the prefix's last paragraph isn't artificially
  // double-spaced from the placeholder block.
  const prefix = lines.slice(0, openIndex).join("\n");
  return { complete: prefix, inFlight: openLang };
}

/**
 * Languages the StreamingMarkdown renderer recognizes for custom blocks.
 * Anything not in this list falls through to standard `<code>` rendering.
 *
 * Each language has a matching block component in `./blocks/` and a
 * dispatch case in `streaming-markdown.tsx`'s code-block renderer.
 *
 *   - `chart:chartjs` — Chart.js v4 JSON spec (PR 9)
 *   - `mermaid`       — Mermaid v11 diagram definition (PR 12)
 *   - `chart:echarts` — Apache ECharts v6 JSON spec for advanced viz
 *                       (sankey / heatmap / treemap / sunburst / graph /
 *                       gauge) — PR 13
 */
export const CUSTOM_BLOCK_LANGUAGES = [
  "chart:chartjs",
  "mermaid",
  "chart:echarts",
] as const;

export type CustomBlockLanguage = (typeof CUSTOM_BLOCK_LANGUAGES)[number];

export function isCustomBlockLanguage(lang: string): lang is CustomBlockLanguage {
  return (CUSTOM_BLOCK_LANGUAGES as readonly string[]).includes(lang);
}
