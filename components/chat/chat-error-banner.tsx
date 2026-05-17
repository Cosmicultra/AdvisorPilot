"use client";

/**
 * Terminal error banner shown at the top of the message list when the hook
 * is in `error` state. Surfaces:
 *   - The friendly error message (already mapped via `friendlyError()` in the hook)
 *   - A Retry button (re-sends the last user turn)
 *   - A Dismiss button (acks the error → idle)
 *   - The requestId for support tickets, when present
 *
 * The retry button does NOT show for `unauthorized` (the advisor needs to
 * sign back in, not retry the request). All other reasons show it.
 */

import { AlertCircle, RefreshCw, X } from "lucide-react";

interface ChatErrorBannerProps {
  message: string;
  reason: string | null;
  requestId: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}

export function ChatErrorBanner({
  message,
  reason,
  requestId,
  onRetry,
  onDismiss,
}: ChatErrorBannerProps) {
  const showRetry = reason !== "unauthorized" && reason !== "forbidden";

  return (
    <div
      role="alert"
      className="mx-3 mt-3 flex items-start gap-2 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900"
    >
      <AlertCircle
        size={14}
        strokeWidth={2.25}
        className="mt-px flex-shrink-0 text-rose-600"
      />
      <div className="min-w-0 flex-1">
        <p className="leading-snug">{message}</p>
        {requestId ? (
          <p className="mt-0.5 font-mono text-[10.5px] text-rose-700/70">
            req {requestId}
          </p>
        ) : null}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {showRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-rose-300 bg-white px-1.5 text-[10.5px] font-medium text-rose-700 transition-colors hover:bg-rose-100"
          >
            <RefreshCw size={10} strokeWidth={2.25} />
            Retry
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss error"
          onClick={onDismiss}
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-rose-600 transition-colors hover:bg-rose-100"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
