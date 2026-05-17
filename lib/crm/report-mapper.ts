/**
 * Mapper from raw advisorpilot_reports rows → Report shape.
 *
 * Same shape conventions as note-mapper / task-mapper. Tolerant of NULLs
 * and unexpected types because the JSONB columns (tags, embedded_media)
 * are unconstrained at the DB layer.
 *
 * Spec: docs/crm/70-orchestrator-tools.md §10.1 (table schema) +
 *       lib/crm/types.ts:Report (target shape).
 */

import type {
  Report,
  ReportEmbeddedMedia,
  ReportSource,
  ReportStatus,
  Visibility,
} from "./types";

export interface ReportRow {
  id: string;
  owner_email: string;
  owner_user_id: string | null;
  client_id: string | null;
  org_id: string | null;
  visibility: string | null;

  title: string;
  content: string;
  embedded_media: unknown;
  icon: string | null;
  color: string | null;
  status: string | null;

  tags: unknown;
  source: string | null;
  generated_by_model: string | null;
  generated_by_provider: string | null;
  generated_in_conversation_id: string | null;

  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    clientId: row.client_id,
    title: row.title ?? "",
    content: row.content ?? "",
    icon: row.icon ?? "📄",
    color: row.color,
    status: normalizeStatus(row.status),
    source: normalizeSource(row.source),
    tags: normalizeTags(row.tags),
    embeddedMedia: normalizeEmbeddedMedia(row.embedded_media),
    generatedByModel: row.generated_by_model,
    generatedByProvider: row.generated_by_provider,
    generatedInConversationId: row.generated_in_conversation_id,
    visibility: isVisibility(row.visibility) ? row.visibility : null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Guards + normalizers ─────────────────────────────────────────────────

export function isReportStatus(value: unknown): value is ReportStatus {
  return value === "draft" || value === "published" || value === "archived";
}

export function isReportSource(value: unknown): value is ReportSource {
  return value === "ai_generated" || value === "advisor_authored" || value === "imported";
}

function normalizeStatus(value: string | null): ReportStatus {
  return isReportStatus(value) ? value : "draft";
}

function normalizeSource(value: string | null): ReportSource {
  return isReportSource(value) ? value : "ai_generated";
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((tag): tag is string => typeof tag === "string");
}

function isVisibility(value: unknown): value is Visibility {
  return value === "private" || value === "shared" || value === "organization";
}

function normalizeEmbeddedMedia(raw: unknown): ReportEmbeddedMedia[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportEmbeddedMedia[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type !== "image") continue; // only `image` supported in v1
    const storagePath = typeof o.storagePath === "string" ? o.storagePath : "";
    if (!storagePath) continue;
    out.push({
      type: "image",
      storagePath,
      caption: typeof o.caption === "string" ? o.caption : null,
      atLine: typeof o.atLine === "number" ? o.atLine : null,
    });
  }
  return out;
}
