/**
 * Pure helpers for the chat widget's resize toggle.
 *
 * Two states (deliberately):
 *   - `compact` — default floating panel, 380 × 600, bottom-right
 *   - `full`    — modal-style overlay filling the viewport (16 px gutter,
 *                 backdrop click dismisses, max-width 1280 px)
 *
 * One button in the header toggles between them. The advisor's choice
 * persists per browser via localStorage so the widget remembers between
 * sessions.
 *
 * Pure: no React, no DOM access at module load.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.18 (PR 18 + PR 20).
 */

export type ChatWidgetSize = "compact" | "full";

export const CHAT_WIDGET_SIZES: readonly ChatWidgetSize[] = ["compact", "full"] as const;

export function isChatWidgetSize(v: unknown): v is ChatWidgetSize {
  return v === "compact" || v === "full";
}

/**
 * Pixel dimensions for the `compact` floating panel. `full` is NOT
 * here — full-screen uses an `inset:0` overlay, not a fixed box.
 */
export const SIZE_DIMENSIONS: Record<
  Exclude<ChatWidgetSize, "full">,
  { width: number; height: number }
> = {
  compact: { width: 380, height: 600 },
};

/** Human-readable label for the toggle button's tooltip + aria-label. */
export const SIZE_LABEL: Record<ChatWidgetSize, string> = {
  compact: "Floating panel",
  full: "Full screen",
};

/**
 * Toggle to the other size. Used by the header's single Maximize2/
 * Minimize2 button (icon swaps based on current state).
 */
export function toggleSize(current: ChatWidgetSize): ChatWidgetSize {
  return current === "compact" ? "full" : "compact";
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "advisorpilot.chat.widgetSize";
const DEFAULT_SIZE: ChatWidgetSize = "compact";

/** Read the persisted size from localStorage. SSR-safe. */
export function readPersistedSize(): ChatWidgetSize {
  if (typeof window === "undefined") return DEFAULT_SIZE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // Backward-compat: PR 18 shipped a "wide" middle size. Treat any
    // legacy "wide" value as "full" so the user's prior preference for
    // a larger panel still applies under the simplified two-mode system.
    if (raw === "wide") return "full";
    return isChatWidgetSize(raw) ? raw : DEFAULT_SIZE;
  } catch {
    return DEFAULT_SIZE;
  }
}

/** Persist size to localStorage. SSR-safe + tolerant of quota errors. */
export function writePersistedSize(size: ChatWidgetSize): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Quota / private-mode — ignore silently. The size still works in-tab.
  }
}
