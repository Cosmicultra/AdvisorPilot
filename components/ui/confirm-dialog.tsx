"use client";

/**
 * In-app confirmation dialog system.
 *
 * Two pieces:
 *   - `<ConfirmProvider>`     — mount ONCE at the app root; owns the
 *                                modal queue + the rendered overlay
 *   - `useConfirm()`          — imperative API for any client component:
 *                                `const ok = await confirm({...})`
 *
 * Why a Promise-returning imperative API (instead of a typical
 * "controlled modal" pattern)? Delete flows would otherwise need
 * useState + onConfirm + onCancel callbacks plus separate JSX —
 * `if (!(await confirm(...))) return` is shorter, reads top-to-bottom,
 * and matches the muscle memory advisors built with `window.confirm`.
 * Crucially we never block the main thread the way `window.confirm`
 * does; the resolution comes via React state.
 *
 * Visual contract:
 *   - Backdrop click + Esc → cancel (resolve false)
 *   - Confirm button color depends on `tone` ("danger" → rose, "primary"
 *     → royal, "neutral" → navy)
 *   - Focus lands on the cancel button by default to make accidental
 *     Enter-key confirms less destructive; pass `defaultFocus: "confirm"`
 *     for non-destructive flows where the advisor is already
 *     comfortable proceeding.
 *
 * Replaces every `window.confirm()` call site in the app. The browser
 * dialog API is banned by convention going forward.
 */

import { AlertTriangle, Info, Trash2 } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Public API surface
// ─────────────────────────────────────────────────────────────────────────────

export type ConfirmTone = "danger" | "primary" | "neutral";

export interface ConfirmOptions {
  /** Bold heading at the top of the dialog. */
  title: string;
  /** Body copy. Single line or multi-paragraph. */
  message: string | ReactNode;
  /** Button label for the proceed action. Defaults per tone. */
  confirmLabel?: string;
  /** Button label for the abort action. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual + iconography variant. Defaults to "primary". */
  tone?: ConfirmTone;
  /**
   * Initial focus target. Defaults to "cancel" for `tone: "danger"` so
   * an accidental Enter doesn't blow things away; "confirm" otherwise.
   */
  defaultFocus?: "confirm" | "cancel";
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

// ─────────────────────────────────────────────────────────────────────────────
// Context + provider
// ─────────────────────────────────────────────────────────────────────────────

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  id: number;
  options: ConfirmOptions;
  resolve(answer: boolean): void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  const idRef = useRef(0);

  const confirm = useCallback<ConfirmFn>((options) => {
    idRef.current += 1;
    const id = idRef.current;
    return new Promise<boolean>((resolve) => {
      setQueue((q) => [...q, { id, options, resolve }]);
    });
  }, []);

  // Pop a pending dialog when it resolves so the next one can render.
  const close = useCallback((id: number, answer: boolean) => {
    setQueue((q) => {
      const target = q.find((entry) => entry.id === id);
      if (target) target.resolve(answer);
      return q.filter((entry) => entry.id !== id);
    });
  }, []);

  // The active dialog is the FIRST entry in the queue; subsequent
  // queued requests render only after the active one resolves. This
  // matches the way native confirm() queues sequentially.
  const active = queue[0] ?? null;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {active ? (
        <ConfirmDialog
          key={active.id}
          options={active.options}
          onConfirm={() => close(active.id, true)}
          onCancel={() => close(active.id, false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Imperative hook — return a function that yields `Promise<boolean>`.
 * Throws if called outside a `<ConfirmProvider>` (faster failure than
 * a silent no-op). Pages that haven't wrapped the provider yet should
 * either add the provider or fall back to inline JSX state.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error(
      "useConfirm() must be called inside a <ConfirmProvider>. Mount one at the app root (typically app/app/layout.tsx).",
    );
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// The dialog itself — internal; not exported. All interaction happens
// via useConfirm().
// ─────────────────────────────────────────────────────────────────────────────

function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm(): void;
  onCancel(): void;
}) {
  const tone: ConfirmTone = options.tone ?? "primary";
  const defaultFocus = options.defaultFocus ?? defaultFocusForTone(tone);
  const confirmLabel = options.confirmLabel ?? defaultConfirmLabel(tone);
  const cancelLabel = options.cancelLabel ?? "Cancel";

  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Focus the appropriate button on mount.
  useEffect(() => {
    const target = defaultFocus === "confirm" ? confirmRef.current : cancelRef.current;
    target?.focus();
  }, [defaultFocus]);

  // Esc → cancel; Enter → confirm. Capture phase so we beat any
  // underlying form handlers that might also bind Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // Only confirm on Enter when focus is INSIDE the dialog —
        // prevents stray Enter presses from the page background.
        const active = document.activeElement;
        if (
          active === confirmRef.current ||
          active === cancelRef.current
        ) {
          e.stopPropagation();
          e.preventDefault();
          if (active === cancelRef.current) onCancel();
          else onConfirm();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel]);

  const iconSlot = (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
      style={{
        backgroundColor:
          tone === "danger"
            ? "rgba(220, 38, 38, 0.10)"
            : tone === "primary"
              ? "rgba(79, 124, 172, 0.10)"
              : "rgba(12, 25, 41, 0.06)",
        color:
          tone === "danger"
            ? "#9B1C1C"
            : tone === "primary"
              ? "var(--ap-royal)"
              : "var(--ap-navy)",
      }}
    >
      {tone === "danger" ? (
        <Trash2 size={16} strokeWidth={1.75} />
      ) : tone === "neutral" ? (
        <Info size={16} strokeWidth={1.75} />
      ) : (
        <AlertTriangle size={16} strokeWidth={1.75} />
      )}
    </span>
  );

  return (
    <div
      // Backdrop. Click-outside resolves as cancel. mousedown so we
      // beat any underlying click handlers (e.g. a row's onClick that
      // happens to share the click target due to z-stacking surprises).
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ap-confirm-title"
        aria-describedby="ap-confirm-body"
        className="w-full max-w-[420px] bg-white shadow-2xl"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          {iconSlot}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2
              id="ap-confirm-title"
              className="text-[15px] font-semibold leading-tight"
              style={{ color: "var(--ap-navy)" }}
            >
              {options.title}
            </h2>
            <div
              id="ap-confirm-body"
              className="text-[13px] leading-snug"
              style={{ color: "var(--ap-gray)" }}
            >
              {typeof options.message === "string" ? (
                <p className="whitespace-pre-wrap">{options.message}</p>
              ) : (
                options.message
              )}
            </div>
          </div>
        </div>

        <div
          className="mt-5 flex items-center justify-end gap-2 px-5 py-3"
          style={{
            borderTop: "1px solid var(--ap-border)",
            backgroundColor: "rgba(12, 25, 41, 0.02)",
          }}
        >
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px] font-medium"
            style={{
              border: "1px solid var(--ap-border)",
              backgroundColor: "#FFFFFF",
              color: "var(--ap-navy)",
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{
              backgroundColor:
                tone === "danger"
                  ? "#9B1C1C"
                  : tone === "primary"
                    ? "var(--ap-royal)"
                    : "var(--ap-navy)",
              border: `1px solid ${
                tone === "danger"
                  ? "#9B1C1C"
                  : tone === "primary"
                    ? "var(--ap-royal)"
                    : "var(--ap-navy)"
              }`,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Default labels per tone. Exported for unit testing + so any custom
 * triggering code can match the implicit defaults if it wants.
 */
export function defaultConfirmLabel(tone: ConfirmTone): string {
  switch (tone) {
    case "danger":
      return "Delete";
    case "primary":
      return "Confirm";
    case "neutral":
      return "OK";
  }
}

/**
 * Default focus target. Exported for unit testing. Danger tone defaults
 * to "cancel" so accidental Enter doesn't destroy data; everything else
 * defaults to "confirm" since the advisor is most likely about to take
 * a constructive action.
 */
export function defaultFocusForTone(
  tone: ConfirmTone,
): "confirm" | "cancel" {
  return tone === "danger" ? "cancel" : "confirm";
}
