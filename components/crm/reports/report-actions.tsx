"use client";

/**
 * Action bar for the report viewer. Owns the in-flight state for each
 * mutation and surfaces errors inline (small text under the buttons).
 *
 * Buttons:
 *   - Publish / Unpublish (draft ↔ published)
 *   - Archive / Restore (published|draft ↔ archived)
 *   - Print (opens /print/reports/[id] in a new tab — chromeless
 *     forced-light view tuned for the browser's print/Save-as-PDF flow)
 *   - Copy link (clipboard)
 *   - Delete (hard delete with confirmation; navigates back on success)
 *
 * All button labels reflect the CURRENT status so the advisor sees
 * "what this will become" — Publish appears when status=draft, Unpublish
 * when status=published, etc.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  Printer,
  Trash2,
  Undo2,
} from "lucide-react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Report, ReportStatus } from "@/lib/crm/types";

export interface ReportActionsProps {
  report: Report;
  /** Called after a successful PATCH so the viewer can update its state without refetching. */
  onUpdated(next: Report): void;
}

export function ReportActions({ report, onUpdated }: ReportActionsProps) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, setPending] = useState<"publish" | "archive" | "delete" | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const patchStatus = async (nextStatus: ReportStatus, busy: "publish" | "archive") => {
    if (pending) return;
    setPending(busy);
    setError(null);
    try {
      const res = await advisorFetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        report?: Report;
        error?: string;
      };
      if (!res.ok || !body.report) {
        throw new Error(body.error ?? `Update failed (${res.status})`);
      }
      onUpdated(body.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setPending(null);
    }
  };

  const deleteReport = async () => {
    if (pending) return;
    const ok = await confirm({
      title: "Delete report?",
      message: (
        <span>
          Permanently delete <strong>&ldquo;{report.title}&rdquo;</strong>?
          This cannot be undone — consider <em>Archive</em> instead if you
          might want it back.
        </span>
      ),
      tone: "danger",
      confirmLabel: "Delete report",
    });
    if (!ok) return;
    setPending("delete");
    setError(null);
    try {
      const res = await advisorFetch(`/api/reports/${report.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      router.push("/app/reports");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setPending(null);
    }
  };

  /**
   * Print opens a dedicated chromeless route in a new tab rather than
   * calling `window.print()` directly. Printing the in-app viewer
   * would drag the CrmShell sidebar, TopHeader, status badges, and a
   * dozen branded surfaces into the printed output — and Mermaid +
   * Chart.js would have to be re-themed for paper anyway. The dedicated
   * route renders the same markdown via <StreamingMarkdown> but with a
   * forced light palette, capped chart sizes, and @media print rules
   * tuned for page breaks. Pattern ported from Control Tower; see
   * components/crm/reports/print-report-view.tsx.
   */
  const print = () => {
    if (typeof window === "undefined") return;
    const url = `/print/reports/${report.id}`;
    // `noopener,noreferrer` so the print tab can't reach back into our
    // window via window.opener — defense-in-depth even though we own
    // both surfaces.
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const copyLink = async () => {
    if (pending) return;
    setPending("copy");
    setError(null);
    try {
      const url = `${window.location.origin}/app/reports/${report.id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed.");
    } finally {
      setPending(null);
    }
  };

  const isDraft = report.status === "draft";
  const isArchived = report.status === "archived";

  return (
    <div className="flex flex-col gap-1.5 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        {!isArchived ? (
          <ActionButton
            label={isDraft ? "Publish" : "Unpublish"}
            icon={isDraft ? CheckCircle2 : Undo2}
            primary={isDraft}
            disabled={pending !== null}
            busy={pending === "publish"}
            onClick={() => patchStatus(isDraft ? "published" : "draft", "publish")}
          />
        ) : null}

        {!isArchived ? (
          <ActionButton
            label="Archive"
            icon={Archive}
            disabled={pending !== null}
            busy={pending === "archive"}
            onClick={() => patchStatus("archived", "archive")}
          />
        ) : (
          <ActionButton
            label="Restore"
            icon={ArchiveRestore}
            primary
            disabled={pending !== null}
            busy={pending === "archive"}
            onClick={() => patchStatus("draft", "archive")}
          />
        )}

        <ActionButton
          label={copied ? "Copied!" : "Copy link"}
          icon={Copy}
          disabled={pending !== null}
          busy={pending === "copy"}
          onClick={() => void copyLink()}
        />

        <ActionButton label="Print" icon={Printer} onClick={print} disabled={pending !== null} />

        <span className="flex-1" />

        <ActionButton
          label="Delete"
          icon={Trash2}
          danger
          disabled={pending !== null}
          busy={pending === "delete"}
          onClick={() => void deleteReport()}
        />
      </div>

      {error ? (
        <p className="text-[11.5px]" style={{ color: "#9B1C1C" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  primary = false,
  danger = false,
  disabled = false,
  busy = false,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  onClick(): void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  const bg = danger
    ? "transparent"
    : primary
      ? "var(--ap-royal)"
      : "#FFFFFF";
  const fg = danger
    ? "#9B1C1C"
    : primary
      ? "#FFFFFF"
      : "var(--ap-navy)";
  const border = danger ? "#F5C2C2" : primary ? "var(--ap-royal)" : "var(--ap-border)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium transition-opacity disabled:opacity-50"
      style={{
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${border}`,
      }}
    >
      <Icon size={12} strokeWidth={1.75} />
      {busy ? "…" : label}
    </button>
  );
}
