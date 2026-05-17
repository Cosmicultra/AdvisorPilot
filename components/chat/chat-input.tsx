"use client";

/**
 * Chat input — textarea + send/stop button row.
 *
 * Behaviors:
 *   - Enter sends; Shift+Enter inserts a newline (standard chat pattern).
 *   - Auto-grows to ~5 rows; scrolls beyond that to prevent the whole
 *     widget from ballooning.
 *   - Send button toggles to Stop when a turn is in flight (canAbort).
 *   - Disabled state mirrors the hook's `inputLocked` flag (covers
 *     preflight, streaming, aborting, reconnecting).
 *   - Cleared after a successful send; preserved if blocked by inputLocked.
 *   - Auto-focuses on mount (widget just opened) so the advisor can type
 *     immediately.
 */

import { ArrowUp, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ChatInputProps {
  /** True when a turn is in flight (preflight, streaming, etc.). */
  isStreaming: boolean;
  /** True when send() will be accepted by the hook (idle or error). */
  canSend: boolean;
  /** True when the Stop button should be exposed. */
  canAbort: boolean;
  /** Send the current text to the orchestrator. */
  onSend: (text: string) => void;
  /** Abort the in-flight turn. */
  onAbort: () => void;
  /** Auto-focus the textarea when the widget opens. */
  autoFocus?: boolean;
  /** Switch into voice mode. When set, a mic icon appears next to the input. */
  onToggleVoice?: () => void;
}

const MAX_VISIBLE_ROWS = 5;
const LINE_HEIGHT_PX = 20; // matches text-sm leading-5

export function ChatInput({
  isStreaming,
  canSend,
  canAbort,
  onSend,
  onAbort,
  autoFocus = false,
  onToggleVoice,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the textarea to its content, capping at MAX_VISIBLE_ROWS.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = LINE_HEIGHT_PX * MAX_VISIBLE_ROWS + 16; // +16 for vertical padding
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const trySend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
  }, [value, canSend, onSend]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends; Shift+Enter inserts a newline. IME composition (CJK
      // input) sets isComposing=true; we never intercept those Enters.
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        trySend();
      }
    },
    [trySend],
  );

  return (
    <div
      className="flex flex-col gap-2 border-t bg-white px-3 py-2.5"
      style={{ borderColor: "var(--ap-line, #E5E7EB)" }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          isStreaming ? "Nova is thinking…" : "Ask Nova about a client, task, or workflow…"
        }
        rows={1}
        disabled={!canSend && !canAbort}
        className="w-full resize-none border-none bg-transparent text-sm leading-5 text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        style={{ minHeight: `${LINE_HEIGHT_PX + 12}px` }}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-slate-400">
          Enter to send · Shift+Enter for newline
        </span>
        <div className="flex items-center gap-1.5">
          {/* Voice-mode toggle — opens VoiceModeView in the input slot.
              Hidden when the parent doesn't pass `onToggleVoice` so
              the surface stays text-only on routes that don't host a
              voice session yet. */}
          {onToggleVoice ? (
            <button
              type="button"
              aria-label="Switch to voice mode"
              title="Switch to voice mode"
              onClick={onToggleVoice}
              disabled={isStreaming}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Mic size={12} strokeWidth={2} />
            </button>
          ) : null}
          {canAbort ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={onAbort}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-slate-300 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              <Square size={11} strokeWidth={2.5} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send message"
              onClick={trySend}
              disabled={!canSend || value.trim().length === 0}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[11px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: "var(--ap-royal)" }}
            >
              Send
              <ArrowUp size={11} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
