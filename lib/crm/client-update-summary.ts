/**
 * Summarize what changed on a client profile save for activity timeline titles.
 */

export type ClientSaveSnapshot = {
  client: unknown;
  holdings: unknown[];
  meeting_notes: string;
  demo_mode: boolean;
  analysis: unknown;
  total_value: number;
  status: string | null;
  last_contacted_at: string | null;
  roth_worksheet: unknown | null;
  fee_analysis_worksheet: unknown | null;
};

const SECTION_LABELS: Record<string, string> = {
  client: "Client profile",
  holdings: "Holdings",
  meeting_notes: "Meeting notes",
  analysis: "Portfolio analysis",
  roth_worksheet: "Roth worksheet",
  fee_analysis_worksheet: "Comparative fee analysis",
  status: "Status",
  total_value: "Portfolio value",
  demo_mode: "Demo mode",
  last_contacted_at: "Last contacted",
};

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Compare before/after save payloads; return human section labels that changed. */
export function clientSaveChangedSections(
  before: ClientSaveSnapshot,
  after: ClientSaveSnapshot
): string[] {
  const changed: string[] = [];

  if (stableJson(before.client) !== stableJson(after.client)) {
    changed.push(SECTION_LABELS.client);
  }
  if (stableJson(before.holdings) !== stableJson(after.holdings)) {
    changed.push(SECTION_LABELS.holdings);
  }
  if ((before.meeting_notes || "").trim() !== (after.meeting_notes || "").trim()) {
    changed.push(SECTION_LABELS.meeting_notes);
  }
  if (stableJson(before.analysis) !== stableJson(after.analysis)) {
    changed.push(SECTION_LABELS.analysis);
  }
  if (stableJson(before.roth_worksheet) !== stableJson(after.roth_worksheet)) {
    changed.push(SECTION_LABELS.roth_worksheet);
  }
  if (stableJson(before.fee_analysis_worksheet) !== stableJson(after.fee_analysis_worksheet)) {
    changed.push(SECTION_LABELS.fee_analysis_worksheet);
  }
  if ((before.status || null) !== (after.status || null)) {
    changed.push(SECTION_LABELS.status);
  }
  if (Number(before.total_value) !== Number(after.total_value)) {
    changed.push(SECTION_LABELS.total_value);
  }
  if (Boolean(before.demo_mode) !== Boolean(after.demo_mode)) {
    changed.push(SECTION_LABELS.demo_mode);
  }
  if ((before.last_contacted_at || null) !== (after.last_contacted_at || null)) {
    changed.push(SECTION_LABELS.last_contacted_at);
  }

  return changed;
}

export function clientSaveUpdateSummary(changedSections: string[]): string {
  return changedSections.join(", ");
}

/** Timeline title for client.updated audit rows. */
export function clientUpdatedActivityTitle(metadata: Record<string, unknown> | null | undefined): string {
  const summary = metadata?.summary;
  if (typeof summary === "string" && summary.trim()) {
    return `Client updated: ${summary.trim()}`;
  }

  const sections = metadata?.changedSections;
  if (Array.isArray(sections)) {
    const labels = sections.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    if (labels.length > 0) {
      return `Client updated: ${labels.join(", ")}`;
    }
  }

  return "Client updated";
}

/** CRM PATCH column keys → display labels. */
const CRM_PATCH_LABELS: Record<string, string> = {
  stage: "Stage",
  tags: "Tags",
  location: "Location",
  email: "Email",
  phone: "Phone",
  next_meeting_at: "Next meeting",
  review_due_at: "Review due date",
  owner_initials: "Owner initials",
  household_label: "Household",
  inception_year: "Inception year",
  ytd_return: "YTD return",
};

export function crmPatchChangedLabels(patchKeys: string[]): string[] {
  return patchKeys.map((k) => CRM_PATCH_LABELS[k] ?? k.replace(/_/g, " "));
}
