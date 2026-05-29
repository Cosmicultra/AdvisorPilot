"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ViewportModalProps = {
  open: boolean;
  onClose: () => void;
  ariaLabelledBy: string;
  children: ReactNode;
  zIndexClass?: string;
};

/**
 * Modal anchored to the browser viewport (not a nested scroll column).
 * Portals to document.body so `position: fixed` works inside CRM LegacyEmbed.
 */
export function ViewportModal({
  open,
  onClose,
  ariaLabelledBy,
  children,
  zIndexClass = "z-[400]",
}: ViewportModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const workflowMain = document.getElementById("workflow-main");
    const prevMainOverflow = workflowMain?.style.overflow ?? "";
    const prevBodyOverflow = document.body.style.overflow;

    if (workflowMain) workflowMain.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      if (workflowMain) workflowMain.style.overflow = prevMainOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-slate-950/55 p-4`}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-none border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
