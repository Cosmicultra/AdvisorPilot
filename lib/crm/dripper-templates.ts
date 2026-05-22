/**
 * Pre-built dripper templates (v1: code-only catalog).
 * Prompts are server-defined and read-only in the UI.
 */

export interface DripperFrequencyExample {
  label: string;
  days: number;
}

export type DripperScheduleMode = "frequency" | "annuity_event";
export type AnnuityReminderKind = "reallocation" | "maturity";

export interface DripperTemplate {
  id: string;
  title: string;
  description: string;
  /** Lucide icon name — resolved in the UI. */
  icon: string;
  prompt: string;
  defaultFrequencyDays: number;
  frequencyExamples: DripperFrequencyExample[];
  scheduleMode?: DripperScheduleMode;
  reminderKind?: AnnuityReminderKind;
  /** When set, drawer pre-fills end date = start + N days if user has not saved one. */
  defaultEndDateOffsetDays?: number;
  endDateHelperText?: string;
}

export const ANNUITY_REALLOCATION_TEMPLATE_ID = "annuity-reallocation-reminder";
export const ANNUITY_MATURITY_TEMPLATE_ID = "annuity-maturity-reminder";

export const ANNUITY_EVENT_TEMPLATE_IDS = [
  ANNUITY_REALLOCATION_TEMPLATE_ID,
  ANNUITY_MATURITY_TEMPLATE_ID,
] as const;

export function isAnnuityEventTemplateId(templateId: string): boolean {
  return (ANNUITY_EVENT_TEMPLATE_IDS as readonly string[]).includes(templateId);
}

export function reminderKindForTemplateId(
  templateId: string
): AnnuityReminderKind | null {
  const t = getDripperTemplate(templateId);
  return t?.reminderKind ?? null;
}

const ADVISOR_ONLY_RULES = `
You are drafting for a financial advisor's internal review only — not for the client.
Do not promise returns, guarantees, or specific trade instructions.
Use only facts present in the client context JSON; if data is missing, say so briefly.
Output concise bullet points (max 12 bullets). No markdown headers.
`.trim();

export const DRIPPER_TEMPLATES: DripperTemplate[] = [
  {
    id: "quarterly-review-brief",
    title: "Client Review Brief",
    description:
      "Portfolio snapshot, allocation themes, and discussion prompts ahead of a client review.",
    icon: "BarChart3",
    defaultFrequencyDays: 90,
    frequencyExamples: [
      { label: "Quarterly", days: 90 },
      { label: "Every 6 months", days: 180 },
      { label: "Annually", days: 365 },
    ],
    prompt: `${ADVISOR_ONLY_RULES}

Produce a client review brief: current allocation summary, notable concentration or drift vs stated risk profile, income/liquidity considerations, and 3–5 advisor discussion questions.`,
  },
  {
    id: "pre-meeting-talking-points",
    title: "Closing Meeting Book",
    description:
      "Follow-up touchpoints while working to book or confirm a meeting with the client.",
    icon: "MessageSquareText",
    defaultFrequencyDays: 7,
    frequencyExamples: [
      { label: "Every 7 days", days: 7 },
      { label: "Every 14 days", days: 14 },
    ],
    defaultEndDateOffsetDays: 30,
    endDateHelperText:
      "Recommended: end this drip after 30 days (auto-filled when you open the schedule).",
    prompt: `${ADVISOR_ONLY_RULES}

Primary goal: help the advisor book or confirm a meeting. No portfolio advice, no return promises, and no dollar amounts or calculator outputs in client-facing copy.

Use client context JSON:
- recentDripAngles: do NOT repeat the same hook or opening theme as any prior run listed there.
- Pick ONE primary angle this run from: recentNotesExcerpt, meetingNotesExcerpt, riskAlignment, analysisThemes, or toolsReviewed (FIA / Roth / retirement income).
- If toolsReviewed.fia or toolsReviewed.roth is true, you may note that a hypothetical illustration was reviewed and how it could relate to stated goals — never cite figures, rates, or product specifics.
- If riskAlignment shows stated vs suggested profiles differ, frame a neutral alignment conversation (no advice).

Produce follow-up talking points: brief reason to connect, one value-add tied to the chosen angle, a clear meeting ask, and 2–3 short questions. Do not invent last-contact dates — use only what is in context.`,
  },
  {
    id: "stale-contact-nudge",
    title: "Prospect/Lead Drip",
    description:
      "Outreach ideas for prospects or leads who have not yet become active clients.",
    icon: "Clock",
    defaultFrequencyDays: 14,
    frequencyExamples: [
      { label: "Weekly", days: 7 },
      { label: "Biweekly", days: 14 },
    ],
    prompt: `${ADVISOR_ONLY_RULES}

The contact is a prospect or lead. Primary goal: warm outreach to schedule an introductory conversation — no financial advice, no return promises, and no dollar amounts or calculator outputs.

Use client context JSON:
- recentDripAngles: vary each run — never produce substantively the same outreach as a prior run listed there.
- Prefer a fresh hook from recentNotesExcerpt when present.
- If toolsReviewed flags are set, mention at most ONE tool this run (Roth OR FIA OR retirement income planning) as something explored together — no figures, no product recommendations.
- Do not mention tools that are false in toolsReviewed.

Suggest a brief, professional outreach angle, one value-add topic, and a soft call-to-action. Do not invent prior contact history — use only what is in context.`,
  },
  {
    id: ANNUITY_REALLOCATION_TEMPLATE_ID,
    title: "Annuity Reallocation Reminder",
    description:
      "Emails each annuity contract 30 days before its annual reallocation window (issue-date anniversary).",
    icon: "CalendarClock",
    scheduleMode: "annuity_event",
    reminderKind: "reallocation",
    defaultFrequencyDays: 365,
    frequencyExamples: [{ label: "Automatic (per contract dates)", days: 365 }],
    prompt: `Automatic per-contract reminders. No AI generation.

When enabled, the system emails the client 30 days before each annuity contract's annual reallocation window (based on issue date), once per contract per year. Requires issue date on each annuity holding.`,
  },
  {
    id: ANNUITY_MATURITY_TEMPLATE_ID,
    title: "Annuity Maturity Reminder",
    description:
      "Emails each annuity contract 30 days before its maturity date.",
    icon: "CalendarCheck",
    scheduleMode: "annuity_event",
    reminderKind: "maturity",
    defaultFrequencyDays: 365,
    frequencyExamples: [{ label: "Automatic (per contract dates)", days: 365 }],
    prompt: `Automatic per-contract reminders. No AI generation.

When enabled, the system emails the client 30 days before each annuity contract's maturity date. Requires maturity date on each annuity holding.`,
  },
];

const TEMPLATE_BY_ID = new Map(DRIPPER_TEMPLATES.map((t) => [t.id, t]));

export function getDripperTemplate(templateId: string): DripperTemplate | undefined {
  return TEMPLATE_BY_ID.get(templateId);
}

export function isKnownDripperTemplateId(templateId: string): boolean {
  return TEMPLATE_BY_ID.has(templateId);
}

/** Public template shape for API (includes prompt for read-only display). */
export function toPublicDripperTemplate(t: DripperTemplate) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    icon: t.icon,
    prompt: t.prompt,
    defaultFrequencyDays: t.defaultFrequencyDays,
    frequencyExamples: t.frequencyExamples,
    scheduleMode: t.scheduleMode ?? "frequency",
    reminderKind: t.reminderKind,
    defaultEndDateOffsetDays: t.defaultEndDateOffsetDays,
    endDateHelperText: t.endDateHelperText,
  };
}
