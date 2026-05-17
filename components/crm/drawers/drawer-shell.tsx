"use client";

/**
 * Shared chrome for right-side slide-in drawers (LogNote, AddTask,
 * EditClient in later phases). Handles:
 *   - Backdrop overlay (semi-transparent; click to dismiss)
 *   - Sharp-cornered panel sliding in from the right
 *   - Escape-to-close keyboard handling
 *   - Focus trap (basic — focuses the first input on open)
 *   - Sticky header with title + X button
 *   - Sticky footer slot for action buttons
 *
 * Spec: docs/crm/20-technical-specs.md §5.4.
 */

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export type DrawerShellProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  /** Width in px. Defaults to 400. */
  widthPx?: number;
};

export function DrawerShell({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  widthPx = 400,
}: DrawerShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Track the latest onClose in a ref so the Escape listener can call the
  // current function without needing onClose as a useEffect dependency.
  // (If we put onClose in the dep array, every parent re-render that
  // creates a new function reference re-runs the effect — which would
  // steal focus back to the first input on every keystroke. Verified bug.)
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus first input on open. Runs ONLY when `open` flips — never on
  // re-renders, so users can type freely without losing focus.
  useEffect(() => {
    if (!open) return;
    const firstInput = panelRef.current?.querySelector<HTMLElement>(
      "input, textarea, select, button"
    );
    firstInput?.focus();
  }, [open]);

  // Escape-to-close + body-scroll lock. Same single-fire-per-open pattern.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", handleKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="flex-1 cursor-default"
        style={{
          backgroundColor: "rgba(12, 25, 41, 0.32)",
        }}
      />
      <div
        ref={panelRef}
        className="flex h-full flex-col bg-white shadow-[0_0_24px_rgba(12,25,41,0.18)]"
        style={{
          width: `${widthPx}px`,
          borderLeft: "1px solid var(--ap-border)",
        }}
      >
        <header
          className="flex flex-shrink-0 items-start justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--ap-border)" }}
        >
          <div className="flex flex-col gap-0.5">
            <h2
              className="font-display text-[18px] font-semibold leading-tight"
              style={{ color: "var(--ap-navy)" }}
            >
              {title}
            </h2>
            {subtitle ? (
              <p
                className="text-[12px] leading-tight"
                style={{ color: "var(--ap-gray)" }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
              backgroundColor: "#FFFFFF",
            }}
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer
            className="flex flex-shrink-0 items-center justify-end gap-2 px-5 py-3"
            style={{
              borderTop: "1px solid var(--ap-border)",
              backgroundColor: "#F5F6F8",
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
