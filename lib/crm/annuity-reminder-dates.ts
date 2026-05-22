/**
 * Calendar math for per-contract annuity reallocation and maturity reminders.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const REMINDER_DAYS_BEFORE = 30;

/** Parse statement-style dates to UTC noon on that calendar day. */
export function parseContractDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const d = utcNoon(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const d = utcNoon(Number(slash[3]), Number(slash[1]), Number(slash[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function utcNoon(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}

export function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function subtractCalendarDays(date: Date, days: number): Date {
  return addCalendarDays(date, -days);
}

/** Issue-date anniversary in a given calendar year (month/day from issue). */
export function reallocationAnniversaryInYear(issueDate: Date, year: number): Date {
  return utcNoon(year, issueDate.getUTCMonth() + 1, issueDate.getUTCDate());
}

/**
 * Next reallocation anniversary strictly after `afterDate`.
 * First window is one year after issue (issue 2024-01-01 → first anniversary 2025-01-01).
 */
export function nextReallocationAnniversary(
  issueDate: Date,
  afterDate: Date,
  maturityDate?: Date | null
): Date | null {
  const startYear = issueDate.getUTCFullYear() + 1;
  const maxYear = maturityDate
    ? maturityDate.getUTCFullYear() + 1
    : afterDate.getUTCFullYear() + 50;

  for (let year = startYear; year <= maxYear; year++) {
    const anniversary = reallocationAnniversaryInYear(issueDate, year);
    if (maturityDate && anniversary.getTime() >= maturityDate.getTime()) {
      return null;
    }
    if (anniversary.getTime() > afterDate.getTime()) {
      return anniversary;
    }
  }
  return null;
}

export function reallocationReminderDate(anniversaryDate: Date): Date {
  return subtractCalendarDays(anniversaryDate, REMINDER_DAYS_BEFORE);
}

export function maturityReminderDate(maturityDate: Date): Date {
  return subtractCalendarDays(maturityDate, REMINDER_DAYS_BEFORE);
}

export function isReminderDue(remindDate: Date, today: Date = new Date()): boolean {
  const t = utcNoon(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate());
  return isSameCalendarDay(remindDate, t);
}

export type ReallocationDueEvent = {
  kind: "reallocation";
  anniversaryDate: Date;
  remindDate: Date;
  eventDateKey: string;
};

export type MaturityDueEvent = {
  kind: "maturity";
  maturityDate: Date;
  remindDate: Date;
  eventDateKey: string;
};

export type AnnuityDueEvent = ReallocationDueEvent | MaturityDueEvent;

/** Events whose 30-day-prior remind date is today. */
export function dueAnnuityEventsForToday(
  issueDateRaw: string,
  maturityDateRaw: string | undefined,
  today: Date = new Date(),
  options: { includeReallocation: boolean; includeMaturity: boolean }
): AnnuityDueEvent[] {
  const out: AnnuityDueEvent[] = [];
  const todayNoon = utcNoon(
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    today.getUTCDate()
  );

  const maturity = maturityDateRaw?.trim()
    ? parseContractDate(maturityDateRaw)
    : null;

  if (options.includeMaturity && maturity) {
    const remind = maturityReminderDate(maturity);
    if (isReminderDue(remind, todayNoon)) {
      out.push({
        kind: "maturity",
        maturityDate: maturity,
        remindDate: remind,
        eventDateKey: toDateKey(maturity),
      });
    }
  }

  if (options.includeReallocation) {
    const issue = parseContractDate(issueDateRaw);
    if (!issue) return out;

    let cursor = subtractCalendarDays(todayNoon, 1);
    for (let i = 0; i < 80; i++) {
      const anniversary = nextReallocationAnniversary(issue, cursor, maturity);
      if (!anniversary) break;
      const remind = reallocationReminderDate(anniversary);
      if (isReminderDue(remind, todayNoon)) {
        out.push({
          kind: "reallocation",
          anniversaryDate: anniversary,
          remindDate: remind,
          eventDateKey: toDateKey(anniversary),
        });
      }
      if (remind.getTime() > todayNoon.getTime()) break;
      cursor = anniversary;
    }
  }

  return out;
}

/** All scheduled reminder events for a contract, sorted by remind date (earliest first). */
export function listAnnuityReminderEvents(
  issueDateRaw: string,
  maturityDateRaw: string | undefined,
  options: { includeReallocation: boolean; includeMaturity: boolean }
): AnnuityDueEvent[] {
  const out: AnnuityDueEvent[] = [];
  const maturity = maturityDateRaw?.trim() ? parseContractDate(maturityDateRaw) : null;

  if (options.includeMaturity && maturity) {
    const remind = maturityReminderDate(maturity);
    out.push({
      kind: "maturity",
      maturityDate: maturity,
      remindDate: remind,
      eventDateKey: toDateKey(maturity),
    });
  }

  if (options.includeReallocation) {
    const issue = parseContractDate(issueDateRaw);
    if (issue) {
      let cursor = issue;
      for (let i = 0; i < 80; i++) {
        const anniversary = nextReallocationAnniversary(issue, cursor, maturity);
        if (!anniversary) break;
        const remind = reallocationReminderDate(anniversary);
        out.push({
          kind: "reallocation",
          anniversaryDate: anniversary,
          remindDate: remind,
          eventDateKey: toDateKey(anniversary),
        });
        cursor = anniversary;
      }
    }
  }

  return out.sort((a, b) => a.remindDate.getTime() - b.remindDate.getTime());
}

/** Upcoming reminders for UI preview (not necessarily due today). */
export function upcomingAnnuityReminders(
  issueDateRaw: string,
  maturityDateRaw: string | undefined,
  afterDate: Date = new Date(),
  options: { includeReallocation: boolean; includeMaturity: boolean; limit?: number }
): Array<{ kind: "reallocation" | "maturity"; eventDate: Date; remindDate: Date }> {
  const limit = options.limit ?? 6;
  const items: Array<{ kind: "reallocation" | "maturity"; eventDate: Date; remindDate: Date }> =
    [];
  const maturity = maturityDateRaw?.trim() ? parseContractDate(maturityDateRaw) : null;

  if (options.includeMaturity && maturity) {
    const remind = maturityReminderDate(maturity);
    if (remind.getTime() > afterDate.getTime()) {
      items.push({ kind: "maturity", eventDate: maturity, remindDate: remind });
    }
  }

  if (options.includeReallocation) {
    const issue = parseContractDate(issueDateRaw);
    if (issue) {
      let cursor = afterDate;
      for (let i = 0; i < 40 && items.length < limit * 2; i++) {
        const anniversary = nextReallocationAnniversary(issue, cursor, maturity);
        if (!anniversary) break;
        const remind = reallocationReminderDate(anniversary);
        if (remind.getTime() > afterDate.getTime()) {
          items.push({ kind: "reallocation", eventDate: anniversary, remindDate: remind });
        }
        cursor = anniversary;
      }
    }
  }

  return items
    .sort((a, b) => a.remindDate.getTime() - b.remindDate.getTime())
    .slice(0, limit);
}
