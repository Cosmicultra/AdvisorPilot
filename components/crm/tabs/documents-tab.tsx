"use client";

/**
 * Per-client Documents tab. Mounted at /app/crm/[id]/documents.
 *
 * Shows ONLY documents the system generates — reports, meeting prep PDFs,
 * client snapshots, etc. Statement uploads (advisor_upload + client_upload)
 * are EXCLUDED by default per /api/documents's compliance filter: those
 * are personal financial PDFs run through AI for extraction, then
 * discarded — they should never persist or surface here.
 *
 * Two views:
 *   - Table (default): compact list; click row → preview modal; per-row
 *     download button.
 *   - Cards (2-col grid): each card embeds an inline PDF preview via
 *     iframe + signed URL; click → same preview modal.
 *
 * Preview modal: large iframe with the same signed URL + a download button.
 *
 * Auth: every fetch goes through advisorFetch.
 *
 * Spec: docs/crm/00-fundamentals.md §4 (Documents tab).
 */

import {
  Download,
  FileText,
  FileType2,
  LayoutGrid,
  List as ListIcon,
  Mail,
  Upload,
  User,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { DocumentWithUrls } from "@/lib/crm/types";

type ViewMode = "table" | "cards";

type FetchState =
  | { status: "loading" }
  | { status: "ready"; documents: DocumentWithUrls[] }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

const SOURCE_LABELS: Record<string, { label: string; icon: typeof Upload }> = {
  advisor_upload: { label: "Advisor upload", icon: Upload },
  client_upload: { label: "Client upload", icon: User },
  generated_client_snapshot: { label: "Client snapshot", icon: FileText },
  generated_advisor_deep_dive: { label: "Advisor deep dive", icon: Wand2 },
  generated_roth_report: { label: "Roth option report", icon: FileText },
  generated_snapshot_email: { label: "Emailed snapshot", icon: Mail },
  generated_report: { label: "Report", icon: FileText },
  report: { label: "Report", icon: FileText },
};

export type DocumentsTabProps = {
  clientId: string;
  refreshKey: number;
};

export function DocumentsTab({ clientId, refreshKey }: DocumentsTabProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [view, setView] = useState<ViewMode>("table");
  const [previewing, setPreviewing] = useState<DocumentWithUrls | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch(
      `/api/documents?clientId=${encodeURIComponent(clientId)}&withSignedUrls=true&limit=200`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load documents (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        setState({
          status: "ready",
          documents: (body?.documents ?? []) as DocumentWithUrls[],
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load documents.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  // Single-row enterprise toolbar matching Tasks/Notes. Count on left,
  // compliance hint as a hover tooltip on an info icon, view toggle on
  // right. Total height ~32px.
  return (
    <div className="flex flex-1 flex-col gap-3 px-6 py-4">
      <div
        className="flex flex-wrap items-center gap-2 bg-white px-2 py-1.5"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        <span
          className="text-[11px] uppercase tracking-wide"
          style={{ color: "var(--ap-gray)" }}
        >
          {state.status === "ready"
            ? `${state.documents.length} generated ${state.documents.length === 1 ? "document" : "documents"}`
            : ""}
        </span>
        <span
          className="cursor-help text-[11px]"
          style={{ color: "var(--ap-gray)" }}
          title="Statement uploads are run through AI for extraction, then discarded for compliance. Only AI-generated PDFs (client snapshots, reports, etc.) persist here."
        >
          ⓘ
        </span>

        <span className="ml-auto">
          <ViewToggle view={view} onChange={setView} />
        </span>
      </div>

      {state.status === "loading" ? (
        <BlockMessage message="Loading documents…" />
      ) : state.status === "unauthorized" ? (
        <BlockMessage message="Sign in to load documents." />
      ) : state.status === "error" ? (
        <BlockMessage message={state.message} tone="error" />
      ) : state.documents.length === 0 ? (
        <EmptyState />
      ) : view === "table" ? (
        <TableView documents={state.documents} onPreview={setPreviewing} />
      ) : (
        <CardsView documents={state.documents} onPreview={setPreviewing} />
      )}

      {previewing ? (
        <PreviewModal
          document={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </div>
  );
}

// ─── View toggle ──────────────────────────────────────────────────────────

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange(next: ViewMode): void;
}) {
  return (
    <div
      className="flex items-stretch"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <ToggleButton
        active={view === "table"}
        onClick={() => onChange("table")}
        label="Table view"
      >
        <ListIcon size={12} strokeWidth={1.75} />
        Table
      </ToggleButton>
      <ToggleButton
        active={view === "cards"}
        onClick={() => onChange("cards")}
        label="Card view"
      >
        <LayoutGrid size={12} strokeWidth={1.75} />
        Cards
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick(): void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-medium uppercase tracking-wide transition-colors"
      style={{
        backgroundColor: active ? "var(--ap-royal)" : "#FFFFFF",
        color: active ? "#FFFFFF" : "var(--ap-gray)",
      }}
    >
      {children}
    </button>
  );
}

// ─── Table view ───────────────────────────────────────────────────────────

function TableView({
  documents,
  onPreview,
}: {
  documents: DocumentWithUrls[];
  onPreview(doc: DocumentWithUrls): void;
}) {
  return (
    <div
      className="flex flex-col bg-white"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      {documents.map((doc) => (
        <TableRow key={doc.id} document={doc} onPreview={onPreview} />
      ))}
    </div>
  );
}

function TableRow({
  document,
  onPreview,
}: {
  document: DocumentWithUrls;
  onPreview(doc: DocumentWithUrls): void;
}) {
  const sourceMeta = SOURCE_LABELS[document.source] ?? {
    label: humanize(document.source),
    icon: FileType2,
  };
  const SourceIcon = sourceMeta.icon;
  const displayName = document.originalFileName ?? truncatePath(document.storagePath);

  const openPreview = () => onPreview(document);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPreview}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPreview();
        }
      }}
      aria-label={`Preview ${displayName}`}
      className="flex cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(12,25,41,0.02)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ap-royal)]"
      style={{ borderBottom: "1px solid var(--ap-border)" }}
    >
      <span
        className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center"
        style={{
          backgroundColor: "var(--ap-pilot-light)",
          color: "var(--ap-navy)",
        }}
      >
        <FileText size={14} strokeWidth={1.75} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          className="truncate text-[13px] font-medium"
          style={{ color: "var(--ap-navy)" }}
          title={displayName}
        >
          {displayName}
        </p>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
          style={{ color: "var(--ap-gray)" }}
        >
          <span className="flex items-center gap-1">
            <SourceIcon size={11} strokeWidth={1.75} />
            {sourceMeta.label}
          </span>
          <span>{formatRelative(document.createdAt)}</span>
          {document.fileSizeBytes !== null ? (
            <span>{formatBytes(document.fileSizeBytes)}</span>
          ) : null}
        </div>
      </div>

      <span
        className="mt-0.5 flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
        style={statusChipStyle(document.status)}
      >
        {humanize(document.status)}
      </span>

      <DownloadButton document={document} compact />
    </div>
  );
}

// ─── Card view ────────────────────────────────────────────────────────────

function CardsView({
  documents,
  onPreview,
}: {
  documents: DocumentWithUrls[];
  onPreview(doc: DocumentWithUrls): void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {documents.map((doc) => (
        <DocumentCard key={doc.id} document={doc} onPreview={onPreview} />
      ))}
    </div>
  );
}

function DocumentCard({
  document,
  onPreview,
}: {
  document: DocumentWithUrls;
  onPreview(doc: DocumentWithUrls): void;
}) {
  const sourceMeta = SOURCE_LABELS[document.source] ?? {
    label: humanize(document.source),
    icon: FileType2,
  };
  const SourceIcon = sourceMeta.icon;
  const displayName = document.originalFileName ?? truncatePath(document.storagePath);

  return (
    <article
      className="flex flex-col bg-white"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <button
        type="button"
        onClick={() => onPreview(document)}
        className="relative block h-[260px] w-full overflow-hidden bg-[rgba(12,25,41,0.04)]"
        aria-label={`Preview ${displayName}`}
      >
        {document.previewUrl ? (
          <iframe
            src={`${document.previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            title={displayName}
            className="pointer-events-none h-full w-full"
            style={{ border: 0 }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FileText
              size={48}
              strokeWidth={1.25}
              style={{ color: "var(--ap-gray)" }}
            />
          </div>
        )}
      </button>

      <div
        className="flex items-start justify-between gap-3 px-4 py-3"
        style={{ borderTop: "1px solid var(--ap-border)" }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p
            className="truncate text-[13px] font-medium"
            style={{ color: "var(--ap-navy)" }}
            title={displayName}
          >
            {displayName}
          </p>
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]"
            style={{ color: "var(--ap-gray)" }}
          >
            <span className="flex items-center gap-1">
              <SourceIcon size={11} strokeWidth={1.75} />
              {sourceMeta.label}
            </span>
            <span>{formatRelative(document.createdAt)}</span>
            {document.fileSizeBytes !== null ? (
              <span>{formatBytes(document.fileSizeBytes)}</span>
            ) : null}
          </div>
        </div>
        <DownloadButton document={document} />
      </div>
    </article>
  );
}

// ─── Preview modal ────────────────────────────────────────────────────────

function PreviewModal({
  document,
  onClose,
}: {
  document: DocumentWithUrls;
  onClose(): void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    const prevOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const displayName = document.originalFileName ?? truncatePath(document.storagePath);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${displayName}`}
      className="fixed inset-0 z-[200] flex flex-col"
      style={{ backgroundColor: "rgba(12, 25, 41, 0.55)" }}
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      <div
        className="relative mx-auto my-6 flex max-h-[calc(100vh-48px)] w-[min(1100px,calc(100vw-48px))] flex-1 flex-col bg-white shadow-2xl"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        <header
          className="flex flex-shrink-0 items-center justify-between gap-3 px-5 py-3"
          style={{ borderBottom: "1px solid var(--ap-border)" }}
        >
          <div className="flex min-w-0 flex-col">
            <p
              className="truncate text-[13px] font-semibold"
              style={{ color: "var(--ap-navy)" }}
            >
              {displayName}
            </p>
            <p
              className="text-[11px]"
              style={{ color: "var(--ap-gray)" }}
            >
              {formatRelative(document.createdAt)}
              {document.fileSizeBytes !== null
                ? ` · ${formatBytes(document.fileSizeBytes)}`
                : ""}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <DownloadButton document={document} />
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
          </div>
        </header>

        <div className="flex-1 overflow-hidden bg-[rgba(12,25,41,0.04)]">
          {document.previewUrl ? (
            <iframe
              src={document.previewUrl}
              title={`Preview ${displayName}`}
              className="h-full w-full"
              style={{ border: 0 }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
                Preview unavailable.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Download button ──────────────────────────────────────────────────────

function DownloadButton({
  document,
  compact = false,
}: {
  document: DocumentWithUrls;
  compact?: boolean;
}) {
  if (!document.downloadUrl) {
    return null;
  }
  return (
    <a
      href={document.downloadUrl}
      // Hint to browsers — Supabase forces attachment-disposition via the
      // signed URL's `download` param, so this works cross-origin too.
      download={document.originalFileName ?? "document.pdf"}
      onClick={(e) => e.stopPropagation()}
      aria-label="Download PDF"
      title="Download PDF"
      className={
        compact
          ? "mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center"
          : "flex h-7 w-7 flex-shrink-0 items-center justify-center"
      }
      style={{
        border: "1px solid var(--ap-border)",
        color: "var(--ap-navy)",
        backgroundColor: "#FFFFFF",
      }}
    >
      <Download size={12} strokeWidth={1.75} />
    </a>
  );
}

// ─── States ───────────────────────────────────────────────────────────────

function BlockMessage({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "error";
}) {
  return (
    <p
      className="px-4 py-6 text-[12.5px]"
      style={{ color: tone === "error" ? "#9B1C1C" : "var(--ap-gray)" }}
    >
      {message}
    </p>
  );
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center gap-2 bg-white px-6 py-10 text-center"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <p className="text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
        No generated documents yet
      </p>
      <p
        className="max-w-[440px] text-[12px] leading-snug"
        style={{ color: "var(--ap-gray)" }}
      >
        This tab archives PDFs the system generates — client snapshot reports,
        meeting prep packets, and other artifacts produced after analysis.
        Statement uploads are run through AI for extraction and then discarded
        for compliance, so they don&apos;t appear here.
      </p>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function statusChipStyle(status: string): React.CSSProperties {
  switch (status) {
    case "complete":
    case "extracted":
      return { backgroundColor: "#E6F4EE", color: "#065F46" };
    case "processing":
      return { backgroundColor: "#FFF5E6", color: "#92400E" };
    case "error":
    case "failed":
      return { backgroundColor: "#FDECEC", color: "#9B1C1C" };
    default:
      return {
        backgroundColor: "rgba(12, 25, 41, 0.04)",
        color: "var(--ap-gray)",
      };
  }
}

function humanize(value: string): string {
  return value
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function truncatePath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) return "just now";
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
