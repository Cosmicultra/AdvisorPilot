"use client";

/**
 * Split-screen markdown editor for reports.
 *
 *   ┌────────────────┬───────────────────┐
 *   │ Edit (left)    │ Preview (right)   │
 *   │ - title input  │ - live render via │
 *   │ - markdown     │   <StreamingMd>   │
 *   │   textarea     │ - same renderer   │
 *   │                │   as viewer       │
 *   └────────────────┴───────────────────┘
 *
 * Two modes:
 *   - "new"      → `onSave` does a POST + redirect on success
 *   - "existing" → `onSave` does a PATCH and stays in the viewer
 *
 * Editor state lives in `lib/crm/report-editor-state.ts` (pure reducer)
 * so the logic is unit-testable without RTL. This component is a thin
 * shell over that reducer + the network call.
 *
 * Keyboard:
 *   - Cmd/Ctrl+S → save (when valid)
 *   - Esc        → cancel (revert dirty state OR exit edit mode)
 *
 * Dirty-state guard: `beforeunload` warns if there are unsaved edits.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a (Reports surface).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { StreamingMarkdown } from "@/lib/markdown/streaming-markdown";
import {
  canSave as canSaveSelector,
  initialEditorState,
  isDirty as isDirtySelector,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  reportEditorReducer,
  type EditorBaseline,
  type EditorMode,
} from "@/lib/crm/report-editor-state";
import { useConfirm } from "@/components/ui/confirm-dialog";

export interface ReportEditorProps {
  mode: EditorMode;
  initialTitle?: string;
  initialContent?: string;
  /** Optional emoji prefix shown next to the title input. */
  icon?: string;
  /** Called on save click + Cmd+S. Receives the current title + content. */
  onSave(values: EditorBaseline): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Called on cancel button when state is clean. */
  onCancel?: () => void;
  /** Optional label override for the primary save button. */
  saveLabel?: string;
  /** Hide the cancel button entirely (e.g. on the "new report" page). */
  hideCancel?: boolean;
}

export function ReportEditor({
  mode,
  initialTitle,
  initialContent,
  icon = "📄",
  onSave,
  onCancel,
  saveLabel,
  hideCancel = false,
}: ReportEditorProps) {
  const confirm = useConfirm();
  const [state, dispatch] = useReducer(
    reportEditorReducer,
    { mode, title: initialTitle, content: initialContent },
    initialEditorState,
  );

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const dirty = isDirtySelector(state);
  const canSave = canSaveSelector(state);

  // Focus the title input on first mount so the advisor can start typing
  // immediately when creating a new report. For "existing" mode the
  // textarea is usually the more interesting field, but we still focus
  // the title because edit-mode entry should not steal the textarea
  // scroll position.
  useEffect(() => {
    if (mode === "new") titleInputRef.current?.focus();
  }, [mode]);

  // Browser-level dirty guard. Prevents lost work from accidental tab
  // close / reload. (React Router navigation is not blocked — that's
  // the parent component's responsibility via `dirty`.)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Most modern browsers ignore the message but require the
      // assignment to trigger the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    dispatch({ type: "SAVE_START" });
    const result = await onSave({ title: state.title, content: state.content });
    if (result.ok) {
      dispatch({
        type: "SAVE_SUCCESS",
        nextBaseline: { title: state.title, content: state.content },
      });
    } else {
      dispatch({ type: "SAVE_ERROR", message: result.error });
    }
  }, [canSave, onSave, state.title, state.content]);

  const handleCancel = useCallback(async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message:
          "Your edits to this report haven't been saved. Discard them?",
        tone: "danger",
        confirmLabel: "Discard changes",
      });
      if (!ok) return;
      dispatch({ type: "REVERT" });
    }
    onCancel?.();
  }, [dirty, onCancel, confirm]);

  // Cmd/Ctrl+S save, Esc cancel — bound at the editor root so they fire
  // from either pane (textarea or title input).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isSave = (e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S");
    if (isSave) {
      e.preventDefault();
      void handleSave();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  // Quick stats for the editor's footer bar (helps the advisor see scope
  // at a glance).
  const stats = useMemo(() => {
    const chars = state.content.length;
    const lines = state.content === "" ? 0 : state.content.split("\n").length;
    const words = state.content.trim() === ""
      ? 0
      : state.content.trim().split(/\s+/).length;
    return { chars, words, lines };
  }, [state.content]);

  return (
    <div
      role="region"
      aria-label="Report editor"
      className="flex flex-col gap-3"
      onKeyDown={onKeyDown}
    >
      {/* Title row + actions */}
      <div
        className="flex flex-wrap items-start gap-2 bg-white p-3"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center text-[18px] leading-none"
          style={{
            backgroundColor: "rgba(12, 25, 41, 0.04)",
            border: "1px solid var(--ap-border)",
          }}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            ref={titleInputRef}
            type="text"
            value={state.title}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              dispatch({ type: "SET_TITLE", title: e.target.value })
            }
            placeholder="Report title…"
            aria-label="Report title"
            aria-invalid={Boolean(state.titleError)}
            maxLength={MAX_TITLE_LENGTH + 10}
            className="w-full bg-transparent font-display text-[18px] font-semibold leading-tight outline-none"
            style={{ color: "var(--ap-navy)" }}
          />
          {state.titleError ? (
            <p className="text-[11.5px]" style={{ color: "#9B1C1C" }}>
              {state.titleError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {!hideCancel ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={state.saving}
              className="px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-50"
              style={{
                border: "1px solid var(--ap-border)",
                backgroundColor: "#FFFFFF",
                color: "var(--ap-navy)",
              }}
            >
              {dirty ? "Discard" : "Cancel"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            aria-keyshortcuts="Meta+S Control+S"
            title="Save (Cmd/Ctrl+S)"
            className="px-3 py-1.5 text-[12px] font-semibold transition-opacity disabled:opacity-40"
            style={{
              backgroundColor: "var(--ap-royal)",
              color: "#FFFFFF",
              border: "1px solid var(--ap-royal)",
            }}
          >
            {state.saving ? "Saving…" : saveLabel ?? "Save"}
          </button>
        </div>
      </div>

      {state.saveError ? (
        <div
          role="alert"
          className="px-3 py-2 text-[12px]"
          style={{
            border: "1px solid #F5C2C2",
            backgroundColor: "#FDECEC",
            color: "#9B1C1C",
          }}
        >
          {state.saveError}
        </div>
      ) : null}

      {/* Split panes */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Editor pane */}
        <section
          aria-label="Markdown source"
          className="flex min-h-[60vh] flex-col bg-white"
          style={{ border: "1px solid var(--ap-border)" }}
        >
          <header
            className="flex items-center justify-between border-b px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em]"
            style={{
              borderColor: "var(--ap-border)",
              color: "var(--ap-gray)",
              backgroundColor: "rgba(12, 25, 41, 0.02)",
            }}
          >
            <span>Markdown</span>
            <span aria-hidden="true">⌘S to save</span>
          </header>
          <textarea
            ref={textareaRef}
            value={state.content}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              dispatch({ type: "SET_CONTENT", content: e.target.value })
            }
            placeholder={
              "# Section title\n\nWrite report body here.\n\nSupports GFM tables, `chart:chartjs`, `chart:echarts`, and `mermaid` fenced blocks — see the chat rendering guide.\n"
            }
            spellCheck={false}
            aria-label="Markdown source"
            aria-invalid={Boolean(state.contentError)}
            className="min-h-[55vh] flex-1 resize-none bg-transparent p-3 font-mono text-[12.5px] leading-relaxed outline-none"
            style={{ color: "var(--ap-navy)" }}
          />
          {state.contentError ? (
            <p
              className="border-t px-3 py-1.5 text-[11.5px]"
              style={{ borderColor: "var(--ap-border)", color: "#9B1C1C" }}
            >
              {state.contentError}
            </p>
          ) : null}
        </section>

        {/* Preview pane */}
        <section
          aria-label="Live preview"
          className="flex min-h-[60vh] flex-col bg-white"
          style={{ border: "1px solid var(--ap-border)" }}
        >
          <header
            className="flex items-center justify-between border-b px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em]"
            style={{
              borderColor: "var(--ap-border)",
              color: "var(--ap-gray)",
              backgroundColor: "rgba(12, 25, 41, 0.02)",
            }}
          >
            <span>Preview</span>
            {dirty ? (
              <span style={{ color: "var(--ap-royal)" }}>● Unsaved</span>
            ) : (
              <span>● Saved</span>
            )}
          </header>
          <div
            className="flex-1 overflow-auto p-4 text-[13.5px] leading-relaxed"
            style={{ color: "var(--ap-navy)" }}
          >
            {state.content.trim() ? (
              <StreamingMarkdown text={state.content} isStreaming={false} />
            ) : (
              <p
                className="text-[12.5px] italic"
                style={{ color: "var(--ap-gray)" }}
              >
                Start typing on the left — the preview updates as you go.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Footer stats */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
        style={{ color: "var(--ap-gray)" }}
      >
        <span>
          {stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} chars ·{" "}
          {stats.lines.toLocaleString()} lines
        </span>
        <span>
          Max {MAX_CONTENT_LENGTH.toLocaleString()} chars
        </span>
      </div>
    </div>
  );
}
