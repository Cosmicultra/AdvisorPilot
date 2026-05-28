/** Shared helpers for last_contacted_at vs meeting timestamps. */

export function isNextMeetingPast(
  nextMeetingAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!nextMeetingAt) return false;
  const ms = Date.parse(String(nextMeetingAt));
  return Number.isFinite(ms) && ms < nowMs;
}

/** Pick the later of last contacted vs another touchpoint time. */
export function mergeLastContactedWithMeeting(
  lastContactedAt: string | null | undefined,
  touchpointAt: string,
): string {
  const touchMs = Date.parse(touchpointAt);
  if (!Number.isFinite(touchMs)) {
    return lastContactedAt ? String(lastContactedAt) : touchpointAt;
  }
  const lastMs = lastContactedAt ? Date.parse(String(lastContactedAt)) : NaN;
  if (!Number.isFinite(lastMs)) {
    return new Date(touchMs).toISOString();
  }
  return new Date(Math.max(touchMs, lastMs)).toISOString();
}
