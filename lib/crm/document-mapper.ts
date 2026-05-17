/**
 * Mapper from raw advisorpilot_documents rows → Document shape.
 */

import type { Document } from "./types";

export interface DocumentRow {
  id: string;
  owner_email: string;
  owner_user_id: string | null;
  client_id: string | null;
  storage_bucket: string | null;
  storage_path: string;
  original_file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | string | null;
  sha256: string | null;
  source: string | null;
  status: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

export function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    clientId: row.client_id,
    storageBucket: row.storage_bucket ?? "advisorpilot-statements",
    storagePath: row.storage_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes:
      row.file_size_bytes !== null && row.file_size_bytes !== undefined
        ? Number(row.file_size_bytes)
        : null,
    sha256: row.sha256,
    source: row.source ?? "advisor_upload",
    status: row.status ?? "uploaded",
    metadata: isPlainObject(row.metadata) ? row.metadata : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
