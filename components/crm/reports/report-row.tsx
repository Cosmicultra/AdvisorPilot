"use client";

/**
 * Single row in the reports list. Click anywhere on the row to open the
 * viewer; the inline action buttons stop propagation so they don't double-
 * fire the navigation.
 *
 * Layout (left to right):
 *   - Icon (emoji) — fixed width
 *   - Title + subtitle (client name | source · "created date · X tags")
 *   - Status badge
 *   - Date column (right-aligned)
 *   - Trash button
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */

import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { Report } from "@/lib/crm/types";
import { ReportStatusBadge } from "./report-status-badge";

export interface ReportRowProps {
  report: Report;
  clientName: string | null;
  pending: boolean;
  onDelete(): void;
}

export function ReportRow({ report, clientName, pending, onDelete }: ReportRowProps) {
  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
      style={{
        borderBottom: "1px solid var(--ap-border)",
        opacity: pending ? 0.5 : 1,
      }}
    >
      <Link
        href={`/app/reports/${report.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
        aria-label={`Open report: ${report.title}`}
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center text-[18px] leading-none"
          style={{
            backgroundColor: "rgba(12, 25, 41, 0.04)",
            border: "1px solid var(--ap-border)",
          }}
        >
          {report.icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            className="truncate text-[13px] font-semibold"
            style={{ color: "var(--ap-navy)" }}
          >
            {report.title || "Untitled report"}
          </p>
          <div
            className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]"
            style={{ color: "var(--ap-gray)" }}
          >
            {clientName ? (
              <span
                className="truncate font-medium"
                style={{ color: "var(--ap-royal)" }}
              >
                {clientName}
              </span>
            ) : (
              <span>Standalone</span>
            )}
            <span>·</span>
            <span>{formatSourceLabel(report.source)}</span>
            <span>·</span>
            <span>{formatDate(report.createdAt)}</span>
            {report.tags.length > 0 ? (
              <>
                <span>·</span>
                <span>
                  {report.tags.length} {report.tags.length === 1 ? "tag" : "tags"}
                </span>
              </>
            ) : null}
            {report.generatedByModel ? (
              <>
                <span>·</span>
                <span title={`${report.generatedByProvider ?? ""}`}>
                  {report.generatedByModel}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </Link>

      <ReportStatusBadge status={report.status} />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={pending}
        aria-label={`Delete "${report.title}"`}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
        style={{
          border: "1px solid var(--ap-border)",
          color: "var(--ap-gray)",
          backgroundColor: "#FFFFFF",
        }}
      >
        <Trash2 size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function formatSourceLabel(source: Report["source"]): string {
  switch (source) {
    case "ai_generated":
      return "AI generated";
    case "advisor_authored":
      return "You wrote";
    case "imported":
      return "Imported";
  }
}

function formatDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const date = new Date(ts);
  const now = Date.now();
  const ageMs = now - date.getTime();
  // < 24h → relative; otherwise calendar date.
  if (ageMs < 24 * 60 * 60 * 1000) {
    return relativeTime(ageMs);
  }
  // < 1y → "Mon DD"; older → "Mon DD, YYYY"
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  return ageMs < oneYear
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function relativeTime(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ago`;
}
