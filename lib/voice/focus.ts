/**
 * Build the per-call "Focus" snapshot the voice agent gets in its
 * system prompt. Single source of truth for what the agent knows
 * about the advisor's current screen + active client.
 *
 * Voice v3 — rewritten for CRM routes instead of legacy wizard steps.
 * The advisor moves between `/app/crm`, `/app/crm/:id/:tab`,
 * `/app/intake`, `/app/tasks`, `/app/reports`, etc. The voice agent
 * needs to know which one is active so it can produce contextually
 * appropriate responses ("you're on Sarah's overview, do you want me
 * to summarize her holdings?").
 *
 * Privacy rule: this is the ONLY function that turns React/router
 * state into agent-visible JSON. It avoids PII the advisor doesn't
 * need spoken aloud:
 *   - email addresses → never included
 *   - DOB → omitted (age is fine)
 *   - SSN → never in our model; defensive-omitted anyway
 *   - account numbers → never included
 */

import type { FocusPayload, FocusSnapshot } from "./types";

/**
 * The advisor's current location + active-client context as known by
 * the voice host (ChatWidget). Populated by the host from
 * `usePathname()` and the chat location context — no React imports
 * here so this stays a pure module.
 */
export interface VoiceAppState {
  /** Current pathname, e.g. "/app/crm/123/overview". */
  pathname: string;
  /** Tab segment if on a client detail page, else null. */
  clientTab: string | null;
  /** Currently focused client id (URL or chat context), else null. */
  activeClientId: string | null;
  /** Display name for the active client when known, else null. */
  activeClientName: string | null;
}

/**
 * Coarse classification of the active route so the prompt can produce
 * appropriate behavior without parsing pathnames itself. The list
 * mirrors the new MobileNav / AppRail primary-nav items + the client
 * detail surfaces.
 */
export type VoiceLocation =
  | "home"
  | "intake"
  | "tasks"
  | "reports"
  | "report"
  | "clients"
  | "client"
  | "settings"
  | "other";

export function classifyLocation(pathname: string): VoiceLocation {
  if (pathname === "/app" || pathname === "/app/") return "home";
  if (pathname.startsWith("/app/intake")) return "intake";
  if (pathname.startsWith("/app/tasks")) return "tasks";
  if (pathname.startsWith("/app/reports/") && pathname !== "/app/reports")
    return "report";
  if (pathname.startsWith("/app/reports")) return "reports";
  if (pathname.startsWith("/app/crm/") && pathname !== "/app/crm/")
    return "client";
  if (pathname.startsWith("/app/crm")) return "clients";
  if (pathname.startsWith("/app/settings")) return "settings";
  return "other";
}

const TAB_DESCRIPTIONS: Record<string, string> = {
  overview: "the client's overview (snapshot card, pinned note, summary).",
  workflow: "the workflow tab (Roth, FIA, fee analysis, retirement income).",
  notes: "the notes tab.",
  timeline: "the timeline / activity feed.",
  tasks: "the tasks tab for this client.",
  documents: "the documents tab (statements + reports).",
  contacts: "the contacts tab (household members + linked people).",
};

export function focusDescription(state: VoiceAppState): string {
  const location = classifyLocation(state.pathname);
  const clientLabel = state.activeClientName ?? "the active client";

  switch (location) {
    case "home":
      return "AdvisorPilot home — the legacy workflow shell. No specific client active.";
    case "intake":
      return state.activeClientName
        ? `Intake wizard, currently working on ${clientLabel}.`
        : "Intake wizard for a brand-new client.";
    case "tasks":
      return state.activeClientName
        ? `Tasks for ${clientLabel}.`
        : "Tasks view (all of the advisor's tasks).";
    case "reports":
      return "Reports library (all of the advisor's reports).";
    case "report":
      return "Single-report viewer.";
    case "clients":
      return "Client roster — the advisor is browsing their full client list.";
    case "client":
      if (state.clientTab && TAB_DESCRIPTIONS[state.clientTab]) {
        return `Looking at ${clientLabel} — ${TAB_DESCRIPTIONS[state.clientTab]}`;
      }
      return `Looking at ${clientLabel}'s profile.`;
    case "settings":
      return "Settings dialog.";
    default:
      return `AdvisorPilot — ${state.pathname}.`;
  }
}

export function focusPayload(state: VoiceAppState): FocusPayload {
  const snapshot: FocusSnapshot = {
    pathname: state.pathname,
    location: classifyLocation(state.pathname),
    clientTab: state.clientTab,
    activeClientId: state.activeClientId,
    activeClientName: state.activeClientName,
  };
  return {
    description: focusDescription(state),
    snapshot,
  };
}
