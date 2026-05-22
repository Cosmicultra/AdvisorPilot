/**
 * Scheduling helpers for client drippers (next_run_at, end-date disable).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addDays(isoOrDate: string | Date, days: number): Date {
  const base = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return new Date(base.getTime() + days * MS_PER_DAY);
}

export function computeInitialNextRunAt(
  startsAt: string | Date,
  now: Date = new Date()
): Date {
  const start = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  return start.getTime() > now.getTime() ? start : now;
}

export function computeNextRunAfterSuccess(
  frequencyDays: number,
  from: Date = new Date()
): Date {
  return addDays(from, frequencyDays);
}

export interface ScheduleEndCheckInput {
  endsAt: string | null;
  nextRunAt: Date;
}

/** True when the next scheduled run would fall after ends_at. */
export function shouldDisableAfterRun(input: ScheduleEndCheckInput): boolean {
  if (!input.endsAt) return false;
  const end = new Date(input.endsAt);
  return input.nextRunAt.getTime() > end.getTime();
}

export function isEnrollmentDue(
  row: {
    enabled: boolean;
    starts_at: string;
    ends_at: string | null;
    next_run_at: string | null;
  },
  now: Date = new Date()
): boolean {
  if (!row.enabled) return false;
  const starts = new Date(row.starts_at);
  if (starts.getTime() > now.getTime()) return false;
  if (row.ends_at) {
    const end = new Date(row.ends_at);
    if (end.getTime() <= now.getTime()) return false;
  }
  if (!row.next_run_at) return false;
  return new Date(row.next_run_at).getTime() <= now.getTime();
}
