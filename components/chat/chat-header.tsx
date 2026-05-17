"use client";

/**
 * Chat widget header — fixed-height navy bar with:
 *   - Nova title + provider/model pill
 *   - In-focus client name (if any) — surfaced from useChatLocation
 *   - "New chat" button (calls clear())
 *   - Close button (collapses the widget)
 *
 * Matches the AppRail's navy + royal color palette for visual continuity.
 */

import type { ReactNode } from "react";
import { Maximize2, Minimize2, Plus, X } from "lucide-react";
import { toggleSize, type ChatWidgetSize } from "@/lib/chat/widget-size";

interface ChatHeaderProps {
  clientName: string | null;
  onClear: () => void;
  onClose: () => void;
  /** Disable clear when a turn is in flight — clearing mid-stream is confusing. */
  canClear: boolean;
  /**
   * Optional element rendered LEFT of the Nova title — used by the
   * widget for the history-sidebar toggle. Renders as a 7×7 button-
   * sized slot so it slots into the header's vertical rhythm.
   */
  leftSlot?: ReactNode;
  /**
   * Current widget size. When provided alongside `onToggleSize`, the
   * header renders ONE toggle button (Maximize2 in compact, Minimize2
   * in full). The widget passes these through from the launcher
   * (which owns the persisted preference).
   */
  size?: ChatWidgetSize;
  /** Toggle between compact and full screen. */
  onToggleSize?: () => void;
  /**
   * Active persisted conversation title (PR 23). When set, replaces
   * the default "AdvisorPilot" / clientName subtitle with the
   * conversation's auto-derived or advisor-renamed title. Truncates
   * with ellipsis on overflow.
   */
  conversationTitle?: string | null;
}

export function ChatHeader({
  clientName,
  onClear,
  onClose,
  canClear,
  leftSlot,
  size,
  onToggleSize,
  conversationTitle,
}: ChatHeaderProps) {
  // Single toggle: Maximize2 icon when we're compact (clicks expand to
  // full); Minimize2 icon when we're full (clicks back to compact).
  // Icon flip is the affordance — no need for two buttons.
  const isFull = size === "full";
  const ToggleIcon = isFull ? Minimize2 : Maximize2;
  const toggleLabel = isFull ? "Shrink to floating panel" : "Expand to full screen";
  const toggleTarget = size ? toggleSize(size) : null;
  return (
    <header
      className="flex h-12 items-center justify-between gap-2 px-3 text-white"
      style={{ backgroundColor: "var(--ap-navy)" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {leftSlot ? (
          <span className="flex flex-shrink-0 items-center text-white/75 [&_button]:text-white/75 [&_button:hover]:text-white">
            {leftSlot}
          </span>
        ) : null}
        <NovaMark />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold tracking-tight">
            {/* Active conversation title takes top billing when present;
                otherwise show the persona name. Truncates with ellipsis
                so long titles don't push the action buttons off the
                header. */}
            {conversationTitle ? conversationTitle : "Nova"}
          </span>
          {/* Subtitle priority:
              - When showing a conversation title up top: subtitle is
                Nova · clientName (if any) — keeps both pieces of
                context visible.
              - When showing Nova up top: subtitle is the client name
                OR the "AdvisorPilot" fallback (the previous behavior). */}
          {conversationTitle ? (
            <span className="truncate text-[10.5px] uppercase tracking-[0.08em] text-white/70">
              Nova{clientName ? ` · ${clientName}` : ""}
            </span>
          ) : clientName ? (
            <span className="truncate text-[10.5px] uppercase tracking-[0.08em] text-white/70">
              {clientName}
            </span>
          ) : (
            <span className="text-[10.5px] uppercase tracking-[0.08em] text-white/55">
              AdvisorPilot
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Start a new chat"
          onClick={onClear}
          disabled={!canClear}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={15} strokeWidth={2} />
        </button>

        {/* Single size-toggle button — Maximize2 when compact (expands
            to full screen); Minimize2 when full (collapses back to the
            floating panel). The icon flip IS the affordance. */}
        {size && onToggleSize && toggleTarget ? (
          <button
            type="button"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={onToggleSize}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ToggleIcon size={14} strokeWidth={2} />
          </button>
        ) : null}

        <button
          type="button"
          aria-label="Close chat"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}

/** Inline mark — a 6px ring + dot pulsing softly. Matches the chat launcher button. */
function NovaMark() {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-6 w-6 flex-shrink-0 items-center justify-center"
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{ backgroundColor: "var(--ap-royal)" }}
      />
      <span
        className="absolute inset-[5px] rounded-full"
        style={{ backgroundColor: "var(--ap-navy)" }}
      />
      <span
        className="absolute inset-[9px] rounded-full"
        style={{ backgroundColor: "#FFFFFF" }}
      />
    </span>
  );
}
