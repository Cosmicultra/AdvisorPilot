/**
 * Maps raw rows from the list_visible_activity SQL function into the
 * ActivityEntry shape consumed by the Timeline tab + Overview's recent-
 * activity rail.
 *
 * Two row sources, one shape:
 *   - source='activity_log' rows come from advisorpilot_activity_log
 *     (CRM-native; manually-logged entries + side-effects from Phase 2
 *     task/note routes). Their `type` column is already a valid ActivityType.
 *   - source='audit_event' rows come from advisorpilot_audit_events (the
 *     existing audit trail). Their `type` column is a raw audit action
 *     string like 'statement.extracted' that we map to a UI-friendly
 *     ActivityType + humanized title.
 *
 * **Lazy mapping with fallback.** The AUDIT_ACTION_TO_ACTIVITY_TYPE map is
 * partial — known actions get a typed category + a display title; unknown
 * actions fall through to type='system' with a generic humanized title.
 * This means new writeAuditEvent() actions (added by future PRs in
 * unrelated routes) render in the timeline immediately without requiring
 * the adapter map to be updated in lockstep.
 *
 * Spec: docs/crm/20-technical-specs.md §2.3.
 */

import type { ActivityEntry, ActivityType } from "./types";

/** Raw row shape returned by public.list_visible_activity. */
export interface VisibleActivityRow {
  id: string;
  source: "activity_log" | "audit_event";
  client_id: string | null;
  owner_email: string;
  type: string;       // ActivityType for activity_log; raw action for audit_event
  title: string;      // human title for activity_log; raw action for audit_event
  body: string | null;
  actor_email: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
}

/**
 * Partial map of audit-event action strings → (ActivityType, display title).
 * Add entries as we want specific actions categorized; missing actions fall
 * through to {type: "system", title: humanizeAction(action)}.
 */
const AUDIT_ACTION_MAP: Record<string, { type: ActivityType; title: string }> = {
  "client.created":        { type: "system",   title: "Client created" },
  "client.updated":        { type: "system",   title: "Client updated" },
  "client.deleted":        { type: "system",   title: "Client deleted" },
  "statement.extracted":   { type: "document", title: "Statement extracted" },
  "analysis.completed":    { type: "analysis", title: "Analysis completed" },
  "fee_analysis.completed": { type: "analysis", title: "Fee analysis completed" },
  "report.generated":      { type: "document", title: "Report generated" },
  "email.client_snapshot_sent": { type: "email", title: "Client snapshot emailed" },
  "email.follow_up_sent":  { type: "email",    title: "Follow-up emailed" },
  "inbound_email.received": { type: "email",   title: "Inbound email received" },
  "upload_token.created":  { type: "system",   title: "Upload link created" },
};

/** Convert a raw activity row to the UI's ActivityEntry shape. */
export function toActivityEntry(row: VisibleActivityRow): ActivityEntry {
  if (row.source === "activity_log") {
    return {
      id: row.id,
      ownerEmail: row.owner_email,
      clientId: row.client_id,
      type: isActivityType(row.type) ? row.type : "system",
      title: row.title,
      body: row.body,
      actorEmail: row.actor_email,
      metadata: row.metadata ?? {},
      occurredAt: row.occurred_at,
      createdAt: row.occurred_at,
      source: "activity_log",
    };
  }

  // source === "audit_event"
  const mapped = AUDIT_ACTION_MAP[row.type];
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    clientId: row.client_id,
    type: mapped?.type ?? "system",
    title: mapped?.title ?? humanizeAuditAction(row.type),
    body: row.body,
    actorEmail: row.actor_email,
    metadata: row.metadata ?? {},
    occurredAt: row.occurred_at,
    createdAt: row.occurred_at,
    source: "audit_event",
  };
}

/**
 * Convert an audit-event action string like "statement.extracted" or
 * "email.follow_up_sent" into a Sentence Case display title for the fallback
 * path. Cosmetic only — adding the action to AUDIT_ACTION_MAP supersedes.
 */
function humanizeAuditAction(action: string): string {
  if (!action) return "System event";
  const cleaned = action
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "System event";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isActivityType(value: unknown): value is ActivityType {
  return (
    value === "note" ||
    value === "meeting" ||
    value === "document" ||
    value === "email" ||
    value === "call" ||
    value === "task" ||
    value === "analysis" ||
    value === "system"
  );
}
