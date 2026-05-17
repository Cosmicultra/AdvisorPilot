/**
 * Compact status pill shared between the reports list, the viewer, and
 * the Timeline tab.
 *
 * Color tokens:
 *   - draft     — muted slate (royal at 8% on slate text)
 *   - published — royal/navy (most prominent; means "this is final")
 *   - archived  — gray on gray (recedes from the eye)
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */

import type { ReportStatus } from "@/lib/crm/types";

const STYLES: Record<ReportStatus, { bg: string; fg: string; label: string }> = {
  draft: {
    bg: "rgba(12, 25, 41, 0.06)",
    fg: "var(--ap-navy)",
    label: "Draft",
  },
  published: {
    bg: "var(--ap-royal)",
    fg: "#FFFFFF",
    label: "Published",
  },
  archived: {
    bg: "rgba(12, 25, 41, 0.04)",
    fg: "var(--ap-gray)",
    label: "Archived",
  },
};

export function ReportStatusBadge({
  status,
  size = "sm",
}: {
  status: ReportStatus;
  size?: "sm" | "md";
}) {
  const s = STYLES[status];
  const padding = size === "md" ? "px-2 py-0.5 text-[11.5px]" : "px-1.5 py-0.5 text-[10.5px]";
  return (
    <span
      className={`inline-flex items-center font-medium uppercase tracking-[0.06em] ${padding}`}
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}
