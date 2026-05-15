/**
 * Voice agent tool dispatcher (client-side).
 *
 * The agent calls tools via the Live API; we receive `function_call` events,
 * route to a handler here, and return the result via `sendToolResponse`.
 *
 * All handlers are READ-ONLY or navigational in v1 — no destructive actions.
 */

import { focusPayload, type VoiceAppState } from "./focus";
import type { AppStep, FocusPayload } from "./types";

type FocusState = VoiceAppState;

/**
 * Live "actions" the voice handlers can invoke — provided by the host app
 * (the React component that wraps the agent) via the VoiceAppActions
 * interface. Keeps the agent agnostic about which React state setters back
 * each action.
 */
export interface VoiceAppActions {
  /** Get current state snapshot — used to compute Focus and answer queries. */
  getState: () => FocusState;
  navigate: (step: AppStep) => void;
  navigateIntakeStep: (index: number) => void;
  openClient: (clientId: string) => void;
  startNewClient: (confirmed?: boolean) => void;
  listClients: (filter?: ListClientsFilter) => Promise<ClientSummary[]>;
  getClientDetails: (clientId?: string) => Promise<ClientDetails | null>;
}

export interface ListClientsFilter {
  search?: string;
  staleDays?: number;
  status?: string;
}

export interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  age?: number | null;
  riskProfile?: string | null;
  status?: string | null;
  lastContactedAt?: string | null;
}

export interface ClientDetails extends ClientSummary {
  totalValue?: number | null;
  incomeReadinessScore?: number | null;
  holdingsCount?: number | null;
  redFlags?: string[];
}

export type VoiceToolHandler = (
  args: Record<string, unknown>,
  actions: VoiceAppActions
) => Promise<unknown> | unknown;

export const VOICE_TOOL_HANDLERS: Record<string, VoiceToolHandler> = {
  get_context: (_args, actions): FocusPayload => focusPayload(actions.getState()),

  navigate: (args, actions) => {
    const step = String((args as { step?: unknown }).step ?? "");
    const valid: AppStep[] = [
      "intake",
      "upload",
      "confirm",
      "analysis",
      "meeting",
      "fia",
      "roth",
      "retIncome",
      "report",
      "saved",
    ];
    if (!valid.includes(step as AppStep)) {
      return { error: `Unknown step "${step}"` };
    }
    actions.navigate(step as AppStep);
    return { ok: true, step };
  },

  navigate_intake_step: (args, actions) => {
    const raw = (args as { index?: unknown }).index;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 9) {
      return { error: "index must be an integer 0..9" };
    }
    actions.navigate("intake");
    actions.navigateIntakeStep(n);
    return { ok: true, index: n };
  },

  open_client: async (args, actions) => {
    const name = String((args as { name?: unknown }).name ?? "").trim();
    if (!name) return { error: "name is required" };
    const list = await actions.listClients({ search: name });
    if (list.length === 0) return { matches: [], message: `No saved client matches "${name}".` };
    if (list.length === 1) {
      actions.openClient(list[0].id);
      return { ok: true, opened: list[0] };
    }
    return {
      matches: list.slice(0, 5),
      message: `Multiple matches for "${name}" — disambiguate by first or last name.`,
    };
  },

  start_new_client: (args, actions) => {
    const confirmed = (args as { confirmed?: unknown }).confirmed === true;
    actions.startNewClient(confirmed);
    return { ok: true, confirmed };
  },

  list_clients: async (args, actions) => {
    const filter: ListClientsFilter = {};
    const a = args as Record<string, unknown>;
    if (typeof a.search === "string") filter.search = a.search;
    if (typeof a.staleDays === "number") filter.staleDays = a.staleDays;
    if (typeof a.status === "string") filter.status = a.status;
    const list = await actions.listClients(filter);
    return { clients: list.slice(0, 25) };
  },

  get_client_details: async (args, actions) => {
    const clientId = typeof (args as { clientId?: unknown }).clientId === "string"
      ? (args as { clientId: string }).clientId
      : undefined;
    const details = await actions.getClientDetails(clientId);
    return details ?? { error: "No active client." };
  },

  read_analysis_section: async (args, actions) => {
    const section = String((args as { section?: unknown }).section ?? "");
    const allowed = [
      "synopsis",
      "highlights",
      "redFlags",
      "recommendations",
      "talkingPoints",
      "objectionHandling",
    ];
    if (!allowed.includes(section)) return { error: `Unknown section "${section}"` };
    const details = await actions.getClientDetails();
    if (!details) return { error: "No active client." };
    if (section === "redFlags") return { redFlags: details.redFlags ?? [] };
    // Other sections live on the full analysis object; for v1 we return the
    // detail summary and rely on the model to acknowledge what's available.
    return { details, section };
  },

  explain_ui: (args, actions) => {
    const topic = String((args as { topic?: unknown }).topic ?? "").trim();
    const state = actions.getState();
    return {
      currentStep: state.step,
      topic: topic || state.step,
      focus: focusPayload(state).description,
    };
  },
};

// Re-export VoiceAppState for backward-compat with focus.ts importers.
export type { VoiceAppState };
