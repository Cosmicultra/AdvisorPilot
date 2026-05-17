"use client";

/**
 * Soft-resume CTA banner (PR 22).
 *
 * Rendered between the chat header and the message list whenever the
 * widget loads a conversation whose previous stream died mid-flight —
 * i.e. the persisted history ends with a user message that has no
 * matching assistant reply.
 *
 * Two actions:
 *   - "Continue" — re-sends the last user message via the live stream;
 *                  reducer clears `pendingResume` defensively in the
 *                  USER_MESSAGE handler.
 *   - "Dismiss"  — clears the CTA without sending (advisor decides
 *                  the question is no longer relevant).
 *
 * Styling: amber accent (matches the renderer's BlockErrorFallback +
 * the chat-error-banner) so the advisor's eye lands on it immediately
 * but it's clearly NOT a failure state.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.19 (soft-resume).
 */

import { RefreshCw, X } from "lucide-react";

export interface ChatResumeBannerProps {
  /** Truncated preview of the message we'd re-send (first ~60 chars). */
  lastUserMessage: string;
  onContinue(): void;
  onDismiss(): void;
}

const PREVIEW_MAX = 60;

export function ChatResumeBanner({
  lastUserMessage,
  onContinue,
  onDismiss,
}: ChatResumeBannerProps) {
  const preview =
    lastUserMessage.length > PREVIEW_MAX
      ? lastUserMessage.slice(0, PREVIEW_MAX).trimEnd() + "…"
      : lastUserMessage;

  return (
    <div
      role="region"
      aria-label="Continue interrupted chat"
      className="flex flex-shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px]"
    >
      <RefreshCw
        size={13}
        strokeWidth={1.75}
        className="mt-0.5 flex-shrink-0 text-amber-700"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium text-amber-900">
          The last reply was interrupted.
        </p>
        <p className="text-[11.5px] italic text-amber-800">
          &ldquo;{preview}&rdquo;
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="rounded-sm px-2 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--ap-royal)" }}
          >
            Continue this chat
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] text-amber-700 hover:underline"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss continue prompt"
        className="ml-1 flex h-5 w-5 flex-shrink-0 items-center justify-center text-amber-700 hover:text-amber-900"
      >
        <X size={11} strokeWidth={1.75} />
      </button>
    </div>
  );
}
