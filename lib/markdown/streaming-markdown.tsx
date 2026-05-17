"use client";

/**
 * <StreamingMarkdown> — incremental markdown renderer used by the chat
 * widget (and, later, the report viewer).
 *
 * Goals:
 *   1. Render markdown progressively as the LLM streams tokens, NOT
 *      only after the message completes.
 *   2. When an in-flight response opens a custom fenced block (e.g.
 *      a ```chart:chartjs``` definition), show a placeholder for that
 *      block until it's fully closed — instead of dropping the rest
 *      of the document on the floor.
 *   3. Render the final form with rich custom blocks (Chart.js charts,
 *      tables via GFM, etc.) once streaming is done.
 *
 * The component is intentionally THIN — all parsing logic lives in
 * `fence-tokenizer.ts` (pure, fully unit-tested) and individual block
 * renderers live in `./blocks/*`.
 */

import { useMemo, type ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChartJsBlock } from "./blocks/chartjs-block";
import { EChartsBlock } from "./blocks/echarts-block";
import { MermaidBlock } from "./blocks/mermaid-block";
import { splitAtIncompleteFence } from "./fence-tokenizer";

export interface StreamingMarkdownProps {
  /** Markdown text. May be partial / in-flight. */
  text: string;
  /** True while the LLM is still producing tokens. Drives placeholder rendering. */
  isStreaming?: boolean;
  /** Optional class merged onto the root container. */
  className?: string;
}

// react-markdown's `code` component receives more props than our renderer
// uses, so we narrow them to what we need.
type CodeProps = {
  className?: string;
  children?: React.ReactNode;
  /**
   * react-markdown v10 sets `inline` for backtick spans vs fenced blocks.
   * Older versions don't have it; we treat absent as "block".
   */
  inline?: boolean;
};

/**
 * The custom code-block renderer. Three cases:
 *   1. Inline code: <code> with light styling.
 *   2. Fenced block with a custom language we recognize (e.g.
 *      `chart:chartjs`): hand off to the matching block renderer.
 *   3. Anything else: default <pre><code> styled block.
 */
function buildComponents(): Components {
  return {
    code(props: CodeProps) {
      const { className, children, inline } = props;
      const langMatch = /language-([^\s]+)/.exec(className ?? "");
      const lang = langMatch ? langMatch[1] : "";
      const raw = String(children ?? "").replace(/\n$/, "");

      if (inline || !lang) {
        return (
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12.5px] text-slate-800">
            {children}
          </code>
        );
      }

      if (lang === "chart:chartjs") {
        return <ChartJsBlock source={raw} />;
      }

      if (lang === "chart:echarts") {
        return <EChartsBlock source={raw} />;
      }

      if (lang === "mermaid") {
        return <MermaidBlock source={raw} />;
      }

      // Default fenced block.
      return (
        <pre className="my-3 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[12.5px]">
          <code className="font-mono text-slate-800">{children}</code>
        </pre>
      );
    },
    // Light typography tweaks so we match the chat bubble's compact style
    // without dragging in @tailwindcss/typography.
    a(props) {
      return (
        <a
          {...props}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[#163765] underline hover:text-[#4f7cac]"
        />
      );
    },
    p(props) {
      return <p {...props} className="mb-2 last:mb-0 leading-relaxed" />;
    },
    ul(props) {
      return <ul {...props} className="mb-2 list-disc pl-5 last:mb-0" />;
    },
    ol(props) {
      return <ol {...props} className="mb-2 list-decimal pl-5 last:mb-0" />;
    },
    li(props) {
      return <li {...props} className="mb-0.5" />;
    },
    h1(props) {
      return <h1 {...props} className="mb-2 mt-3 text-lg font-semibold text-slate-900" />;
    },
    h2(props) {
      return <h2 {...props} className="mb-2 mt-3 text-base font-semibold text-slate-900" />;
    },
    h3(props) {
      return <h3 {...props} className="mb-1.5 mt-3 text-sm font-semibold text-slate-900" />;
    },
    blockquote(props) {
      return (
        <blockquote
          {...props}
          className="my-2 border-l-2 border-slate-300 pl-3 italic text-slate-600"
        />
      );
    },
    table(props) {
      return (
        <div className="my-3 overflow-x-auto">
          <table {...props} className="w-full border-collapse text-left text-xs" />
        </div>
      );
    },
    thead(props) {
      return <thead {...props} className="bg-slate-50 text-slate-700" />;
    },
    th(props) {
      return (
        <th
          {...props}
          className="border-b border-slate-200 px-2 py-1.5 font-medium"
        />
      );
    },
    td(props) {
      return <td {...props} className="border-b border-slate-100 px-2 py-1.5 align-top" />;
    },
    hr() {
      return <hr className="my-3 border-slate-200" />;
    },
  };
}

/**
 * Renders a "this block is being generated" skeleton matching the size
 * of a finished Chart.js block. Used while an in-flight ```chart:chartjs```
 * is still open.
 */
function InFlightBlockPlaceholder({ language }: { language: string }): ReactElement {
  if (language === "chart:chartjs") {
    return (
      <div className="my-4 flex h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-3 w-3 animate-pulse rounded-full bg-[#4f7cac]"
            aria-hidden
          />
          Generating chart…
        </span>
      </div>
    );
  }
  if (language === "chart:echarts") {
    return (
      <div className="my-4 flex h-[360px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-3 w-3 animate-pulse rounded-full bg-[#4f7cac]"
            aria-hidden
          />
          Generating visualization…
        </span>
      </div>
    );
  }
  if (language === "mermaid") {
    // Sized to roughly match a small flowchart so layout doesn't jump
    // when the diagram resolves.
    return (
      <div className="my-4 flex min-h-[160px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-3 w-3 animate-pulse rounded-full bg-[#4f7cac]"
            aria-hidden
          />
          Generating diagram…
        </span>
      </div>
    );
  }
  // Unknown / generic in-flight block: tiny placeholder
  return (
    <div className="my-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs italic text-slate-500">
      Streaming {language || "code"}…
    </div>
  );
}

const MARKDOWN_COMPONENTS = buildComponents();
const REMARK_PLUGINS = [remarkGfm];

export function StreamingMarkdown({
  text,
  isStreaming = false,
  className,
}: StreamingMarkdownProps): ReactElement {
  // While streaming we split off any in-flight unterminated fenced block
  // so the parser only sees complete content, then render a placeholder
  // for the in-flight block. When NOT streaming we render the full text
  // as-is — if it ends up unterminated, the user can see whatever the
  // LLM actually produced.
  const { complete, inFlight } = useMemo(() => {
    if (!isStreaming) return { complete: text, inFlight: null as string | null };
    return splitAtIncompleteFence(text);
  }, [text, isStreaming]);

  return (
    <div className={className}>
      {complete ? (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {complete}
        </ReactMarkdown>
      ) : null}
      {inFlight !== null ? <InFlightBlockPlaceholder language={inFlight} /> : null}
    </div>
  );
}
