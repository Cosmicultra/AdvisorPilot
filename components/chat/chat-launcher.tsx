"use client";

/**
 * Floating chat launcher button — bottom-right corner, fixed positioning.
 * Owns `isOpen` + the widget's size, renders the widget panel as an
 * overlay when opened.
 *
 * Sizing (PR 20 — simplified from PR 18's three modes):
 *   - `compact` — 380 × 600 floating panel, anchored bottom-right
 *   - `full`    — fills the viewport with a 16 px gutter, max-width
 *                 1280 px (modal-style overlay; click backdrop to
 *                 dismiss; advisor uses this for long sessions /
 *                 dense tool stacks)
 *
 * One header button toggles between the two. Size choice persists in
 * localStorage via `widget-size.ts` so the advisor's preference
 * survives reloads + tabs.
 *
 * Behavior:
 *   - Closed: a 52 px royal circle with the Nova mark.
 *   - Open: the widget owns its own close button.
 *   - Esc closes when open.
 *   - Full-screen mode also dismisses on backdrop click.
 *   - The widget UNMOUNTS when closed — that tears down the chat hook
 *     (aborts in-flight stream, clears intervals). Re-opening starts a
 *     fresh conversation; persisted history is still readable via the
 *     sidebar.
 *
 * Print mode hides the launcher entirely (`print:hidden`).
 */

import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AdvisorProfileForChat } from "@/lib/chat/use-advisor-profile";
import {
  readPersistedSize,
  SIZE_DIMENSIONS,
  toggleSize,
  writePersistedSize,
  type ChatWidgetSize,
} from "@/lib/chat/widget-size";
import { ChatWidget } from "./chat-widget";

interface ChatLauncherProps {
  advisor: AdvisorProfileForChat;
}

export function ChatLauncher({ advisor }: ChatLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  // `readPersistedSize` is SSR-safe (returns "compact" when window is
  // undefined). The launcher is a "use client" component that doesn't
  // render anything visible until the advisor clicks Open, so even the
  // initial mount on the client doesn't need to match server output —
  // no hydration warning risk. Avoids the react-hooks/set-state-in-effect
  // rule too.
  const [size, setSize] = useState<ChatWidgetSize>(readPersistedSize);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleToggleSize = useCallback(() => {
    setSize((prev) => {
      const next = toggleSize(prev);
      writePersistedSize(next);
      return next;
    });
  }, []);

  // Esc to close. Capture phase so we beat other listeners that might
  // also bind Esc (e.g. modals on the page).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen]);

  return (
    <>
      {/* Floating button — visible whenever the launcher isn't open. */}
      {!isOpen ? (
        <button
          type="button"
          aria-label="Open Nova chat assistant"
          onClick={open}
          className="group fixed bottom-4 right-4 z-[60] inline-flex h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-lg ring-2 ring-white transition-all hover:scale-105 print:hidden"
          style={{ backgroundColor: "var(--ap-royal)" }}
        >
          <MessageSquare size={22} strokeWidth={2} />
          <span className="sr-only">Open Nova chat assistant</span>
        </button>
      ) : null}

      {isOpen ? (
        <ChatPanel
          advisor={advisor}
          size={size}
          onClose={close}
          onToggleSize={handleToggleSize}
        />
      ) : null}
    </>
  );
}

interface ChatPanelProps {
  advisor: AdvisorProfileForChat;
  size: ChatWidgetSize;
  onClose: () => void;
  onToggleSize: () => void;
}

/**
 * The framed overlay. Two layouts:
 *
 *   `compact` — fixed-position floating box anchored bottom-right with a
 *   16 px gutter and a drop shadow. Pixel dimensions come from
 *   SIZE_DIMENSIONS.
 *
 *   `full` — modal-style overlay with a tinted backdrop + click-to-
 *   dismiss + a thin 16 px gutter so the panel doesn't kiss the
 *   viewport edges (looks better on ultrawide monitors).
 */
function ChatPanel({ advisor, size, onClose, onToggleSize }: ChatPanelProps) {
  const widgetProps = {
    advisor,
    onClose,
    autoFocusInput: true,
    size,
    onToggleSize,
  };

  if (size === "full") {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-stretch justify-center bg-slate-900/30 p-4 backdrop-blur-sm print:hidden"
        onMouseDown={(e) => {
          // Backdrop click → close. Only when the click started on the
          // backdrop itself (not bubbled up from inside the panel).
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="flex h-full w-full max-w-[1280px] flex-col"
          style={{
            boxShadow:
              "0 24px 48px -12px rgba(15, 23, 42, 0.25), 0 12px 24px -8px rgba(15, 23, 42, 0.15)",
          }}
        >
          <ChatWidget {...widgetProps} />
        </div>
      </div>
    );
  }

  const dim = SIZE_DIMENSIONS.compact;
  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex max-w-[calc(100vw-32px)] flex-col print:hidden"
      style={{
        width: dim.width,
        height: `min(${dim.height}px, calc(100vh - 32px))`,
        boxShadow:
          "0 12px 28px -6px rgba(15, 23, 42, 0.18), 0 8px 16px -8px rgba(15, 23, 42, 0.10)",
      }}
    >
      <ChatWidget {...widgetProps} />
    </div>
  );
}
