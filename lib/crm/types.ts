/**
 * Shared TypeScript types for the CRM. Imported by both server routes and
 * client components so the Roster, Profile header, drawers, and API handlers
 * agree on shapes.
 *
 * Specs: docs/crm/20-technical-specs.md §3 and
 * docs/crm/50-organizations-and-sharing.md §7.
 */

import type { IntakeClient } from "@/lib/intake-config";
import type { UiHolding, NormalizedAiAnalysis } from "@/lib/saved-review-normalize";
import type { RothWorksheet } from "@/lib/roth-worksheet";

// ─── Visibility primitive ─────────────────────────────────────────────────
//
// Every shareable entity (clients, tasks, notes) carries a visibility value.
// `private` = creator-only; `shared` = explicit grants via share_grants;
// `organization` = every active member of the entity's org.

export type Visibility = "private" | "shared" | "organization";

// ─── Organizations ────────────────────────────────────────────────────────
//
// An organization is a tenant. Every advisor belongs to ≥1 org via a
// membership row (the Phase 0 backfill creates a personal-org-of-one per
// existing advisor). Phase 6 ships the multi-member sharing UI; until then
// every org is a hidden single-member tenant.

export interface Organization {
  id: string;
  name: string;
  slug: string | null;
  createdByEmail: string;
  planTier: "solo" | "team" | "enterprise" | null;
  maxSeats: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  id: string;
  orgId: string;
  memberEmail: string;
  memberUserId: string | null;
  role: "owner" | "admin" | "member";
  status: "invited" | "active" | "removed";
  invitedByEmail: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
}

// ─── Sharing grants ───────────────────────────────────────────────────────
//
// One row per (entity, grantee) pair. Populated only when an entity's
// visibility = 'shared'. Never queried directly by the UI — the visibility
// SQL functions consult share_grants when evaluating row access.

export interface ShareGrant {
  id: string;
  entityType: "client" | "task" | "note";
  entityId: string;
  granteeEmail: string;
  granteeUserId: string | null;
  grantedByEmail: string;
  grantedAt: string;
  permission: "view" | "edit";
}

// ─── Documents ─────────────────────────────────────────────────────────────
//
// Stored in advisorpilot_documents. Today these are advisor-uploaded
// statement PDFs (`source: 'advisor_upload'`) and client-uploaded statements
// from magic-link sessions (`source: 'client_upload'`). Future sources may
// include generated reports.

export interface Document {
  id: string;
  ownerEmail: string;
  clientId: string | null;
  storageBucket: string;
  storagePath: string;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sha256: string | null;
  source: string;              // 'advisor_upload' | 'client_upload' | 'report' | other
  status: string;              // 'uploaded' | 'processing' | 'extracted' | other
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Document with on-demand signed URLs for inline preview + forced download.
 *  Populated only when the list API is called with `?withSignedUrls=true`.
 *  URLs are short-lived (default 1h TTL) — refetch the list to renew. */
export interface DocumentWithUrls extends Document {
  /** Signed URL with inline disposition — load directly into an iframe. */
  previewUrl: string | null;
  /** Signed URL with attachment disposition — forces download via the
   *  browser when followed (uses Supabase storage's `?download=` param). */
  downloadUrl: string | null;
}

// ─── Client lifecycle stage ───────────────────────────────────────────────
//
// Computed by lib/crm/stage.ts from review_due_at + next_meeting_at +
// last_contacted_at + status. Persisted when the advisor sets it manually;
// computed on-the-fly when NULL. The Roster filter chips and row-status
// indicator render this value.

export type ClientStage =
  | "Lead"
  | "Prospect"
  | "Onboarding"
  | "Engaged"
  | "Review due"
  | "Upcoming"
  | "Stable"
  | "At risk";

// ─── Tasks ─────────────────────────────────────────────────────────────────
//
// Stored in advisorpilot_tasks. Always scoped to an advisor (owner_email);
// optionally linked to a client via client_id. Tasks with no client_id are
// personal todos that show in the global /app/tasks list but not on any
// client's Tasks tab.

export interface Task {
  id: string;
  ownerEmail: string;
  clientId: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;     // ISO date (YYYY-MM-DD)
  dueTime: string | null;     // HH:MM (24h)
  priority: "High" | "Medium" | "Low";
  status: "open" | "in_progress" | "done" | "cancelled";
  completedAt: string | null;
  reminderAt: string | null;
  tags: string[];
  visibility: Visibility | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Notes ────────────────────────────────────────────────────────────────
//
// Free-form text attached to a client. Optionally pinned (one card on the
// Overview tab shows the most recent pinned note). The author_email may
// differ from owner_email when an org-mate logs a note on a shared client.

export interface Note {
  id: string;
  ownerEmail: string;
  clientId: string;
  authorEmail: string;
  body: string;
  tags: string[];
  pinned: boolean;
  source: "manual" | "voice_agent" | "meeting_recap";
  visibility: Visibility | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Reports ──────────────────────────────────────────────────────────────
//
// Stored in advisorpilot_reports (Phase 4). Markdown content + structured
// metadata + optional client link. Created by Nova via `manage_report`
// or by a human via the (future) `/app/reports/[id]` editor. RLS uses
// the same visibility model as notes/tasks.

export type ReportStatus = "draft" | "published" | "archived";

export type ReportSource = "ai_generated" | "advisor_authored" | "imported";

/**
 * Embedded-media entries point into Supabase Storage. Populated by the
 * (future) `manage_report.embed_image` operation. v1 reports ship without
 * embedded media — this field stays an empty array.
 */
export interface ReportEmbeddedMedia {
  type: "image";
  storagePath: string;
  caption?: string | null;
  /** Line in the markdown body where the image is positioned. */
  atLine?: number | null;
}

export interface Report {
  id: string;
  ownerEmail: string;
  clientId: string | null;
  /** Markdown body. May include `chart:chartjs` / `chart:echarts` / `mermaid` fenced blocks. */
  content: string;
  title: string;
  icon: string;
  color: string | null;
  status: ReportStatus;
  source: ReportSource;
  tags: string[];
  embeddedMedia: ReportEmbeddedMedia[];
  generatedByProvider: string | null;
  generatedByModel: string | null;
  generatedInConversationId: string | null;
  visibility: Visibility | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Activity entries ─────────────────────────────────────────────────────
//
// Powers the Timeline tab + Overview's recent-activity rail. Read endpoint
// unions advisorpilot_activity_log (CRM-native) with advisorpilot_audit_events
// (existing audit trail) via lib/crm/activity-adapter.ts. Write endpoint
// only inserts into advisorpilot_activity_log.

export type ActivityType =
  | "note"
  | "meeting"
  | "document"
  | "email"
  | "call"
  | "task"
  | "analysis"
  | "dripper"
  | "system";

export interface ActivityEntry {
  id: string;
  ownerEmail: string;
  clientId: string | null;
  type: ActivityType;
  title: string;
  body: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
  /** Source table — useful for the UI to differentiate native CRM entries
   *  (which support delete/edit in later phases) from audit-event mirrors
   *  (read-only). */
  source: "activity_log" | "audit_event";
}

// ─── Drippers ─────────────────────────────────────────────────────────────
//
// Per-client scheduled AI prompts. Templates live in lib/crm/dripper-templates.ts;
// enrollments and runs in advisorpilot_client_drippers / advisorpilot_dripper_runs.

export interface ClientDripperEnrollment {
  id: string;
  clientId: string;
  templateId: string;
  enabled: boolean;
  startsAt: string;
  endsAt: string | null;
  frequencyDays: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DripperEmailStatus = "sent" | "skipped" | "failed";

export interface DripperRun {
  id: string;
  enrollmentId: string;
  clientId: string;
  templateId: string;
  status: "success" | "failed";
  outputText: string | null;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
  ranAt: string;
  emailStatus: DripperEmailStatus | null;
  emailError: string | null;
  clientEmailTo: string | null;
}

// ─── Roster row ───────────────────────────────────────────────────────────
//
// One per client. The Roster's left-pane list renders an array of these.
// Returned by GET /api/clients. Computed server-side so the UI doesn't do
// math on holdings JSONB.

export interface ClientRosterItem {
  id: string;
  firstName: string;
  lastName: string;
  initials: string;
  householdLabel: string | null;
  stage: ClientStage | null;
  /** Source of truth: clients.status (existing column; default 'Analyzed').
   *  Magic-link ingest sets 'Prospect' once that one-line fix lands per
   *  40-§5.5. */
  status: string | null;
  /** Sum of holdings.value for the most-recent saved review (computed). */
  aum: number | null;
  /** Stored on clients.ytd_return; null until the advisor sets it. */
  ytdReturn: number | null;
  /** Distinct accountNumber count from holdings (computed). */
  accountsCount: number | null;
  /** Distinct custodian names from holdings.metadata (Phase 1: empty). */
  custodians: string[];
  /** Creator email — the existing `owner_email` column. Drives the
   *  "Owned by D. Patel" chip when ownerEmail !== viewer.email. */
  ownerEmail: string;
  ownerInitials: string | null;
  lastContactedAt: string | null;
  nextMeetingAt: string | null;
  reviewDueAt: string | null;
  isOverdue: boolean;
  tags: string[];
  // Org-aware fields (Phase 0 backfill populates these on every row).
  visibility?: Visibility;
  /** Phase 6 only — populated when viewer is the entity owner or an org admin.
   *  Empty when the viewer doesn't have permission to see who else has access. */
  sharedWith?: string[];
}

// ─── Client detail ────────────────────────────────────────────────────────
//
// Returned by GET /api/clients/[id]. Extends ClientRosterItem with the full
// per-client payload: intake JSONB, holdings, analysis, plus aggregate
// counts for the profile-header KPI strip.
//
// Read-fallback note (per 20-§1.2): when top-level email/phone/location are
// NULL, the API populates them from client JSONB:
//   email    ← client.advisorEmail   (note: misleading field name; this IS
//                                    the client's email, see lib/intake-config.ts:42-43)
//   phone    ← (no JSONB equivalent today)
//   location ← (no JSONB equivalent today)

export interface ClientDetail extends ClientRosterItem {
  client: IntakeClient;
  holdings: UiHolding[];
  analysis: NormalizedAiAnalysis | null;
  rothWorksheet: RothWorksheet | null;
  meetingNotes: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  /** Derivable from client.married + spouse* fields; computed on read. */
  relationshipSummary: string | null;
  inceptionYear: number | null;
  // Aggregates computed server-side for the profile-header KPI strip.
  openTaskCount: number;
  recentNoteCount: number;
}
