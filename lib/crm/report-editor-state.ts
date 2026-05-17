/**
 * Pure state machine for the report editor.
 *
 * Lives outside React so it's testable without RTL — the editor
 * component (components/crm/reports/report-editor.tsx) is a thin shell
 * around `useReducer(reportEditorReducer, initial)`.
 *
 * State invariants:
 *   - `mode` distinguishes new vs editing-existing
 *   - `dirty` is derived: title OR content has diverged from `baseline`
 *   - `saving` blocks new edits until the network call resolves
 *   - Validation errors live on the state (not thrown) so the UI can
 *     surface them inline next to the input
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a (Reports surface).
 */

export type EditorMode = "new" | "existing";

export interface EditorBaseline {
  title: string;
  content: string;
}

export interface ReportEditorState {
  mode: EditorMode;
  /** Last server-known values; used to compute the `dirty` flag. */
  baseline: EditorBaseline;
  /** Working values. */
  title: string;
  content: string;
  /** True while a save POST/PATCH is in flight. */
  saving: boolean;
  /** Most recent terminal error from a save attempt; cleared on next edit. */
  saveError: string | null;
  /** Inline validation error for the title input (length, empty). */
  titleError: string | null;
  /** Inline validation error for the content textarea. */
  contentError: string | null;
}

export const MAX_TITLE_LENGTH = 250;
export const MAX_CONTENT_LENGTH = 200_000;

export function initialEditorState(opts: {
  mode: EditorMode;
  title?: string;
  content?: string;
}): ReportEditorState {
  const title = opts.title ?? "";
  const content = opts.content ?? "";
  return {
    mode: opts.mode,
    baseline: { title, content },
    title,
    content,
    saving: false,
    saveError: null,
    titleError: null,
    contentError: null,
  };
}

export type ReportEditorAction =
  | { type: "SET_TITLE"; title: string }
  | { type: "SET_CONTENT"; content: string }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; nextBaseline: EditorBaseline }
  | { type: "SAVE_ERROR"; message: string }
  | { type: "RESET"; baseline: EditorBaseline }
  | { type: "REVERT" };

export function reportEditorReducer(
  state: ReportEditorState,
  action: ReportEditorAction,
): ReportEditorState {
  switch (action.type) {
    case "SET_TITLE": {
      const titleError = validateTitle(action.title);
      return {
        ...state,
        title: action.title,
        titleError,
        // Any edit clears the last save error so it doesn't sit forever.
        saveError: null,
      };
    }
    case "SET_CONTENT": {
      const contentError = validateContent(action.content);
      return {
        ...state,
        content: action.content,
        contentError,
        saveError: null,
      };
    }
    case "SAVE_START":
      return {
        ...state,
        saving: true,
        saveError: null,
      };
    case "SAVE_SUCCESS":
      return {
        ...state,
        saving: false,
        baseline: action.nextBaseline,
        title: action.nextBaseline.title,
        content: action.nextBaseline.content,
        saveError: null,
        titleError: null,
        contentError: null,
      };
    case "SAVE_ERROR":
      return { ...state, saving: false, saveError: action.message };
    case "RESET":
      return initialEditorState({
        mode: state.mode,
        title: action.baseline.title,
        content: action.baseline.content,
      });
    case "REVERT":
      return {
        ...state,
        title: state.baseline.title,
        content: state.baseline.content,
        titleError: null,
        contentError: null,
        saveError: null,
      };
    default:
      // Exhaustiveness — TS will catch new action types.
      return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived selectors (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** True when title OR content has diverged from the baseline. */
export function isDirty(state: ReportEditorState): boolean {
  return (
    state.title !== state.baseline.title || state.content !== state.baseline.content
  );
}

/** True when save is allowed (dirty + valid + not already saving). */
export function canSave(state: ReportEditorState): boolean {
  if (state.saving) return false;
  if (state.titleError || state.contentError) return false;
  // Title must be present (validateTitle would say so, but enforce here too).
  if (!state.title.trim()) return false;
  // New reports MUST have content; updates can be empty (rare but allowed).
  if (state.mode === "new" && !state.content.trim()) return false;
  // Only save when there's something to save (except for new — first save
  // is the create call regardless of dirty-vs-baseline).
  if (state.mode === "existing" && !isDirty(state)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validators (pure; mirror the API server-side caps)
// ─────────────────────────────────────────────────────────────────────────────

export function validateTitle(value: string): string | null {
  if (!value.trim()) return "Title is required.";
  if (value.length > MAX_TITLE_LENGTH) {
    return `Title must be ${MAX_TITLE_LENGTH} characters or fewer (${value.length} now).`;
  }
  return null;
}

export function validateContent(value: string): string | null {
  if (value.length > MAX_CONTENT_LENGTH) {
    return `Content must be ${MAX_CONTENT_LENGTH.toLocaleString()} characters or fewer (${value.length.toLocaleString()} now).`;
  }
  return null;
}
