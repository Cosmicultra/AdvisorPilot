/**
 * Mapper from raw advisorpilot_notes rows → Note shape.
 *
 * Spec: docs/crm/20-technical-specs.md §3.
 */

import type { Note, Visibility } from "./types";

export interface NoteRow {
  id: string;
  owner_email: string;
  owner_user_id: string | null;
  client_id: string;
  org_id: string | null;
  visibility: string | null;
  author_email: string;
  body: string;
  tags: unknown;
  pinned: boolean | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    clientId: row.client_id,
    authorEmail: row.author_email,
    body: row.body,
    tags: normalizeTags(row.tags),
    pinned: Boolean(row.pinned),
    source: normalizeSource(row.source),
    visibility: isVisibility(row.visibility) ? row.visibility : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isVisibility(value: unknown): value is Visibility {
  return value === "private" || value === "shared" || value === "organization";
}

export function isNoteSource(value: unknown): value is Note["source"] {
  return (
    value === "manual" ||
    value === "voice_agent" ||
    value === "meeting_recap"
  );
}

function normalizeSource(value: string | null): Note["source"] {
  return isNoteSource(value) ? value : "manual";
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((tag): tag is string => typeof tag === "string");
}
