"use client";

/** Shown while the legacy workflow bundle loads (code-split entry). */
export function WorkflowLoadingShell() {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6"
      role="status"
      aria-live="polite"
    >
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-[var(--ap-royal,#1d4ed8)]"
        aria-hidden
      />
      <p className="font-serif text-lg font-semibold text-slate-800">
        Loading AdvisorPilot…
      </p>
      <p className="max-w-sm text-center text-sm text-slate-500">
        Preparing your workflow. This may take a moment on first visit.
      </p>
    </div>
  );
}
