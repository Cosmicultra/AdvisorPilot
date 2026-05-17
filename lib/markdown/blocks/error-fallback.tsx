/**
 * Shared error badge for misbehaving custom blocks.
 *
 * Renders inline so it doesn't disrupt the flow of the message but is
 * obvious enough that the advisor knows something didn't render. The
 * full raw source is kept in a <details> so they can still see it.
 */

import type { ReactElement } from "react";

export interface BlockErrorFallbackProps {
  /** Short human-readable description of what went wrong. */
  message: string;
  /** Raw source of the block, shown in a collapsed <details>. */
  raw?: string;
  /** Block language for context (e.g. "chart:chartjs"). */
  language?: string;
}

export function BlockErrorFallback({
  message,
  raw,
  language,
}: BlockErrorFallbackProps): ReactElement {
  return (
    <div className="my-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <div className="flex items-center gap-1.5 font-medium">
        <span aria-hidden>⚠</span>
        <span>
          {language ? `Couldn't render ${language} block` : "Block render failed"}
        </span>
      </div>
      <div className="mt-1 text-amber-800">{message}</div>
      {raw ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-amber-700 hover:text-amber-900">
            Show source
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-amber-100 p-2 text-[11px] text-amber-900">
            {raw}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
