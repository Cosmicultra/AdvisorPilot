/**
 * Shared mapper from raw advisorpilot_clients rows → ClientRosterItem and
 * ClientDetail shapes. Keeps the mapping logic in ONE place so the list
 * (/api/clients) and detail (/api/clients/[id]) endpoints stay in sync.
 *
 * Rules consolidated from docs/crm/20-technical-specs.md §3 and §1.2:
 *   - initials   = first letter of firstName + first letter of lastName
 *   - aum        = sum of holdings[].value
 *   - accounts   = distinct holdings[].accountNumber count (null when no
 *                  account numbers known)
 *   - isOverdue  = computed by lib/crm/stage.ts
 *   - stage      = top-level if persisted, else computed via computeStage
 *   - email      = top-level first, fall back to client.advisorEmail (the
 *                  intake JSONB field that's misleadingly named — see
 *                  lib/intake-config.ts:42-43)
 *   - phone      = top-level only (no JSONB equivalent today)
 *   - location   = top-level only (no JSONB equivalent today)
 */

import { normalizeIntakeClient, type IntakeClient } from "@/lib/intake-config";
import {
  normalizeAiAnalysis,
  type UiHolding,
} from "@/lib/saved-review-normalize";
import {
  normalizeRothWorksheet,
  type RothWorksheet,
} from "@/lib/roth-worksheet";
import { computeStage, isOverdue, type StageInput } from "./stage";
import type {
  ClientDetail,
  ClientRosterItem,
  ClientStage,
  Visibility,
} from "./types";

/** Raw shape of an advisorpilot_clients row as returned by Supabase. */
export interface ClientRow {
  id: string;
  owner_email: string;
  owner_user_id: string | null;
  client: unknown;
  holdings: unknown;
  meeting_notes: string | null;
  demo_mode: boolean | null;
  analysis: unknown;
  total_value: number | string | null;
  status: string | null;
  last_contacted_at: string | null;
  source: string | null;
  roth_worksheet: unknown;
  created_at: string;
  updated_at: string;
  // Phase 0 additive columns:
  stage: string | null;
  owner_initials: string | null;
  household_label: string | null;
  tags: unknown;
  location: string | null;
  email: string | null;
  phone: string | null;
  inception_year: number | null;
  next_meeting_at: string | null;
  review_due_at: string | null;
  ytd_return: number | string | null;
  org_id: string | null;
  visibility: string | null;
}

/** Build the Roster row shape from a raw client row. */
export function toRosterItem(
  row: ClientRow,
  options: { now?: Date } = {}
): ClientRosterItem {
  const intake = normalizeIntakeClient(row.client) as IntakeClient;
  const holdings = normalizeHoldingsList(row.holdings);
  const tags = normalizeTags(row.tags);

  const stageInput: StageInput = {
    status: row.status,
    reviewDueAt: row.review_due_at,
    nextMeetingAt: row.next_meeting_at,
    lastContactedAt: row.last_contacted_at,
    inceptionYear: row.inception_year,
  };

  const computedStage = computeStage(stageInput, options.now);
  const persistedStage = isClientStage(row.stage) ? row.stage : null;
  const stage = persistedStage ?? computedStage;

  return {
    id: row.id,
    firstName: intake.firstName,
    lastName: intake.lastName,
    initials: deriveInitials(intake.firstName, intake.lastName),
    householdLabel: row.household_label,
    stage,
    status: row.status,
    aum: deriveAum(holdings, row.total_value),
    ytdReturn: row.ytd_return !== null ? Number(row.ytd_return) : null,
    accountsCount: deriveAccountsCount(holdings),
    custodians: [], // Phase 1 ships empty; Phase 2+ extracts from holdings.metadata.
    ownerEmail: row.owner_email,
    ownerInitials: row.owner_initials,
    lastContactedAt: row.last_contacted_at,
    nextMeetingAt: row.next_meeting_at,
    reviewDueAt: row.review_due_at,
    isOverdue: isOverdue({ reviewDueAt: row.review_due_at }, options.now),
    tags,
    visibility: isVisibility(row.visibility) ? row.visibility : undefined,
  };
}

/** Build the full ClientDetail shape — extends Roster with intake JSONB,
 *  holdings, analysis, plus aggregate counts. */
export function toClientDetail(
  row: ClientRow,
  aggregates: { openTaskCount: number; recentNoteCount: number },
  options: { now?: Date } = {}
): ClientDetail {
  const base = toRosterItem(row, options);
  const intake = normalizeIntakeClient(row.client) as IntakeClient;
  const holdings = normalizeHoldingsList(row.holdings);
  const analysis = row.analysis ? normalizeAiAnalysis(row.analysis) : null;
  const rothWorksheet = row.roth_worksheet
    ? (normalizeRothWorksheet(row.roth_worksheet) as RothWorksheet)
    : null;

  return {
    ...base,
    client: intake,
    holdings,
    analysis,
    rothWorksheet,
    meetingNotes: row.meeting_notes ?? "",
    email: deriveClientEmail(row, intake),
    phone: row.phone,
    location: row.location,
    relationshipSummary: deriveRelationshipSummary(intake),
    inceptionYear: row.inception_year,
    openTaskCount: aggregates.openTaskCount,
    recentNoteCount: aggregates.recentNoteCount,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function normalizeHoldingsList(raw: unknown): UiHolding[] {
  if (!Array.isArray(raw)) return [];
  return raw as UiHolding[];
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((tag): tag is string => typeof tag === "string");
}

function deriveInitials(firstName: string, lastName: string): string {
  const f = firstName.trim().charAt(0).toUpperCase();
  const l = lastName.trim().charAt(0).toUpperCase();
  const initials = `${f}${l}`.trim();
  return initials || "?";
}

function deriveAum(holdings: UiHolding[], totalValue: number | string | null): number | null {
  if (holdings.length > 0) {
    const sum = holdings.reduce((acc, h) => acc + (Number(h.value) || 0), 0);
    if (Number.isFinite(sum) && sum > 0) return sum;
  }
  if (totalValue !== null && totalValue !== undefined) {
    const n = Number(totalValue);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function deriveAccountsCount(holdings: UiHolding[]): number | null {
  if (holdings.length === 0) return null;
  const accountNumbers = new Set<string>();
  for (const h of holdings) {
    if (h.accountNumber && h.accountNumber.trim()) {
      accountNumbers.add(h.accountNumber.trim());
    }
  }
  return accountNumbers.size > 0 ? accountNumbers.size : null;
}

/**
 * Email read-fallback per docs/crm/20-§1.2.
 *
 * NOTE: `client.advisorEmail` is misleadingly named — per the comment in
 * lib/intake-config.ts:42-43, it IS the client's email, not the advisor's.
 * Top-level `clients.email` is the source of truth going forward; we fall
 * back to JSONB only for legacy rows where intake collected an email but
 * the top-level column is still NULL.
 */
/** Client email for CRM + drippers (top-level column, then intake JSONB fallback). */
export function deriveClientEmail(row: ClientRow, intake: IntakeClient): string | null {
  if (row.email && row.email.trim()) return row.email.trim();
  const jsonbEmail = intake.advisorEmail?.trim();
  return jsonbEmail || null;
}

/**
 * Build a one-line relationship summary from intake fields. Phase 1
 * intentionally simple — Phase 2 may extend with kids count, etc.
 */
function deriveRelationshipSummary(intake: IntakeClient): string | null {
  const parts: string[] = [];
  if (intake.married) {
    if (intake.spouseFirstName || intake.spouseLastName) {
      parts.push(`Married to ${[intake.spouseFirstName, intake.spouseLastName].filter(Boolean).join(" ")}`);
    } else {
      parts.push("Married");
    }
  }
  if (intake.takingSocialSecurity) {
    parts.push("Receiving Social Security");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function isClientStage(value: unknown): value is ClientStage {
  return (
    value === "Lead" ||
    value === "Prospect" ||
    value === "Onboarding" ||
    value === "Engaged" ||
    value === "Review due" ||
    value === "Upcoming" ||
    value === "Stable" ||
    value === "At risk"
  );
}

function isVisibility(value: unknown): value is Visibility {
  return value === "private" || value === "shared" || value === "organization";
}
