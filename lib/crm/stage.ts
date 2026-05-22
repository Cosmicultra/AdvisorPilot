/**
 * Client lifecycle stage computation.
 *
 * `stage` can be persisted (advisor sets it manually) or computed. When the
 * advisor hasn't set one, the API computes it on read using the rules below.
 * A Phase-2 cron is planned to write the computed value back so the database
 * stays the source of truth for the Roster filter chips, but Phase 1 is
 * compute-on-read.
 *
 * Pure functions, no IO, no `Date.now()` reads in the body — every
 * "current time" is passed in via the `now` parameter so tests are
 * deterministic.
 *
 * Spec: docs/crm/20-technical-specs.md §4.
 */

import type { ClientStage } from "./types";

/** Subset of the client row that stage computation needs. Keeps this module
 *  decoupled from the full ClientRosterItem / ClientDetail shapes. */
export interface StageInput {
  /** clients.status — typically 'Analyzed' (default) or 'Prospect'
   *  (magic-link upload). Other values pass through as themselves. */
  status: string | null;
  /** ISO date (YYYY-MM-DD) of the next required review. */
  reviewDueAt: string | null;
  /** ISO datetime of the next scheduled meeting. */
  nextMeetingAt: string | null;
  /** ISO datetime of the most recent client-touchpoint (note logged,
   *  meeting held, etc.). Updated by the Phase 2 notes API. */
  lastContactedAt: string | null;
  /** Year the relationship started. Drives the 'Onboarding' stage when
   *  it's within the last 90 days. */
  inceptionYear: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REVIEW_UPCOMING_DAYS = 14;
const MEETING_UPCOMING_DAYS = 14;
const STALE_CONTACT_DAYS = 90;
const ONBOARDING_DAYS = 90;

/**
 * Compute the lifecycle stage for a client given their current state.
 *
 * Rules (in priority order):
 *
 *   1. status === 'Prospect'                          → 'Prospect'
 *   2. review_due_at < today                          → 'Review due' (overdue)
 *   3. review_due_at within next 14d                  → 'Upcoming'
 *   4. last_contacted_at older than 90d               → 'At risk'
 *   5. next_meeting_at within next 14d                → 'Upcoming'
 *   6. inception_year within last 90d                 → 'Onboarding'
 *   7. otherwise                                       → 'Stable'
 *
 * @param input - Subset of client fields the rules need.
 * @param now   - Reference "current time" (test injection point).
 *                Defaults to `new Date()` for production callers.
 */
export function computeStage(input: StageInput, now: Date = new Date()): ClientStage {
  if (input.status === "Prospect") return "Prospect";

  const reviewDue = parseDate(input.reviewDueAt);
  if (reviewDue !== null) {
    const daysUntilReview = daysBetween(now, reviewDue);
    if (daysUntilReview < 0) return "Review due";
    if (daysUntilReview <= REVIEW_UPCOMING_DAYS) return "Upcoming";
  }

  const lastContacted = parseDate(input.lastContactedAt);
  if (lastContacted !== null) {
    const daysSinceContact = daysBetween(lastContacted, now);
    if (daysSinceContact > STALE_CONTACT_DAYS) return "At risk";
  }

  const nextMeeting = parseDate(input.nextMeetingAt);
  if (nextMeeting !== null) {
    const daysUntilMeeting = daysBetween(now, nextMeeting);
    if (daysUntilMeeting >= 0 && daysUntilMeeting <= MEETING_UPCOMING_DAYS) {
      return "Upcoming";
    }
  }

  if (input.inceptionYear !== null) {
    const inceptionStart = new Date(input.inceptionYear, 0, 1);
    const daysSinceInception = daysBetween(inceptionStart, now);
    if (daysSinceInception >= 0 && daysSinceInception <= ONBOARDING_DAYS) {
      return "Onboarding";
    }
  }

  return "Stable";
}

/**
 * True when the client has a review_due_at in the past. Surfaces the same
 * condition as the 'Review due' stage but without re-running the full
 * priority chain — useful when the UI already has the persisted stage and
 * just needs the boolean for chip styling.
 */
export function isOverdue(input: Pick<StageInput, "reviewDueAt">, now: Date = new Date()): boolean {
  const reviewDue = parseDate(input.reviewDueAt);
  if (reviewDue === null) return false;
  return daysBetween(now, reviewDue) < 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Parse an ISO date or datetime string. Returns null on null/empty/invalid. */
function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return null;
  return new Date(ts);
}

/** Whole-day delta from `from` to `to`, rounded down. Negative when `to` is
 *  before `from`. Uses UTC so DST transitions don't produce off-by-one
 *  surprises around the boundary. */
function daysBetween(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((toUtc - fromUtc) / MS_PER_DAY);
}

/** Stages the advisor can set manually (PATCH validation + tools). */
export const CLIENT_STAGE_OPTIONS = [
  "Lead",
  "Prospect",
  "Onboarding",
  "Engaged",
  "Review due",
  "Upcoming",
  "Stable",
  "At risk",
] as const satisfies readonly ClientStage[];

/** Profile-header stage dropdown (display order). */
export const CLIENT_STAGE_HEADER_SELECT_OPTIONS = [
  "Lead",
  "Prospect",
  "Onboarding",
  "Engaged",
] as const satisfies readonly ClientStage[];

/** Persisted on insert when a new client row is created. */
export const DEFAULT_NEW_CLIENT_STAGE: ClientStage = "Prospect";
