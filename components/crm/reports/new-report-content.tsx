"use client";

/**
 * /app/reports/new — blank-canvas editor for a brand-new advisor-authored
 * report. POSTs to /api/reports on save and redirects to the viewer for
 * the freshly created row.
 *
 * Why a separate page (vs a modal on /app/reports):
 *   - Editing markdown deserves its own viewport — the split-screen
 *     editor needs the full content area.
 *   - Native browser URL = shareable / browser-back-friendly.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a (Reports surface).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { Report } from "@/lib/crm/types";
import { ReportEditor } from "./report-editor";

export function NewReportContent() {
  const router = useRouter();

  const onSave = async ({
    title,
    content,
  }: {
    title: string;
    content: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const res = await advisorFetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, status: "draft" }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        report?: Report;
        error?: string;
      };
      if (!res.ok || !body.report) {
        return {
          ok: false,
          error: body.error ?? `Save failed (${res.status})`,
        };
      }
      // Navigate to the viewer for the freshly created report so the
      // advisor can publish / archive / refine from there. Using
      // router.replace (not push) so Back goes to the list, not back to
      // an empty editor.
      router.replace(`/app/reports/${body.report.id}`);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Save failed.",
      };
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-5">
      <Link
        href="/app/reports"
        className="inline-flex items-center gap-1 self-start text-[12px] font-medium underline-offset-2 hover:underline"
        style={{ color: "var(--ap-royal)" }}
      >
        <ArrowLeft size={12} strokeWidth={1.75} />
        Back to reports
      </Link>

      <ReportEditor
        mode="new"
        onSave={onSave}
        onCancel={() => router.push("/app/reports")}
        saveLabel="Create draft"
      />
    </div>
  );
}
