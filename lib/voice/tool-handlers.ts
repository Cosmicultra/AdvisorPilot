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
  // ── New read-only lenses (Phase 2 voice expansion) ────────────────────
  getHoldingsBreakdown: (clientId?: string) => Promise<HoldingsBreakdown | null>;
  getAllocationSummary: (clientId?: string) => Promise<AllocationSummary | null>;
  getMeetingGuide: (clientId?: string) => Promise<MeetingGuide | null>;
  getRecommendations: (clientId?: string) => Promise<string[] | null>;
  getRedFlags: (clientId?: string) => Promise<string[] | null>;
  getOverlapInsights: (clientId?: string) => Promise<string[] | null>;
  getRothSummary: (clientId?: string) => Promise<RothSummary | null>;
  getClientOverview: (clientId?: string) => Promise<ClientOverview | null>;
  findClientsByCriteria: (filter: FindClientsCriteria) => Promise<ClientSummary[]>;
}

export interface ListClientsFilter {
  search?: string;
  staleDays?: number;
  status?: string;
}

export interface FindClientsCriteria {
  /** Match on first or last name (substring, case-insensitive). */
  search?: string;
  /** Risk profile string match — e.g. "Conservative". */
  riskProfile?: string;
  /** Inclusive minimum age. */
  minAge?: number;
  /** Inclusive maximum age. */
  maxAge?: number;
  /** Inclusive minimum total portfolio value (USD). */
  minTotalValue?: number;
  /** Inclusive maximum total portfolio value (USD). */
  maxTotalValue?: number;
  /** Minimum days since last contact (stale-flag). */
  staleDays?: number;
  /** Maximum income-readiness score; useful for "who's at risk?". */
  maxIncomeReadinessScore?: number;
  /** Has at least one red flag in the analysis. */
  hasRedFlags?: boolean;
  /** Exact status, e.g. "Analyzed". */
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
  totalValue?: number | null;
  incomeReadinessScore?: number | null;
}

export interface ClientDetails extends ClientSummary {
  holdingsCount?: number | null;
  redFlags?: string[];
}

export interface HoldingPosition {
  ticker: string;
  name: string;
  assetClass: string;
  valueUsd: number;
  weightPct: number;
}

export interface HoldingsBreakdown {
  clientId: string;
  totalValue: number;
  holdingCount: number;
  /** Top 5 positions by weight. */
  topPositions: HoldingPosition[];
}

export interface AllocationSummary {
  clientId: string;
  totalValue: number;
  /** Bucketed allocation in dollars. */
  buckets: Array<{ name: string; valueUsd: number; weightPct: number }>;
}

export interface MeetingGuide {
  clientId: string;
  advisorOpeningScript: string;
  talkingPoints: string[];
  objectionHandling: string[];
}

export interface RothSummary {
  clientId: string;
  hasWorksheet: boolean;
  conversionAmount?: number | null;
  yearsToBreakeven?: number | null;
  recommendation?: string | null;
}

export interface ClientOverview {
  clientId: string;
  name: string;
  age?: number | null;
  riskProfile?: string | null;
  retirementAge?: string | null;
  totalValue?: number | null;
  incomeReadinessScore?: number | null;
  diversificationScore?: number | null;
  topHoldings: HoldingPosition[];
  allocation: AllocationSummary["buckets"];
  topRedFlags: string[];
  topRecommendations: string[];
  /** Brief synthesis the agent can speak as an "overview". */
  spokenSummary: string;
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
    switch (section) {
      case "redFlags": {
        const flags = await actions.getRedFlags();
        return flags ? { redFlags: flags } : { error: "No active client." };
      }
      case "recommendations": {
        const recs = await actions.getRecommendations();
        return recs ? { recommendations: recs } : { error: "No active client." };
      }
      case "talkingPoints": {
        const guide = await actions.getMeetingGuide();
        return guide ? { talkingPoints: guide.talkingPoints } : { error: "No active client." };
      }
      case "objectionHandling": {
        const guide = await actions.getMeetingGuide();
        return guide ? { objectionHandling: guide.objectionHandling } : { error: "No active client." };
      }
      default: {
        const details = await actions.getClientDetails();
        return details ? { details, section } : { error: "No active client." };
      }
    }
  },

  // ── New lens tools ──────────────────────────────────────────────────

  get_holdings_breakdown: async (args, actions) => {
    const clientId =
      typeof (args as { clientId?: unknown }).clientId === "string"
        ? (args as { clientId: string }).clientId
        : undefined;
    const b = await actions.getHoldingsBreakdown(clientId);
    return b ?? { error: "No holdings available for the active client." };
  },

  get_allocation_summary: async (args, actions) => {
    const clientId =
      typeof (args as { clientId?: unknown }).clientId === "string"
        ? (args as { clientId: string }).clientId
        : undefined;
    const s = await actions.getAllocationSummary(clientId);
    return s ?? { error: "No allocation available." };
  },

  get_meeting_guide: async (args, actions) => {
    const clientId =
      typeof (args as { clientId?: unknown }).clientId === "string"
        ? (args as { clientId: string }).clientId
        : undefined;
    const g = await actions.getMeetingGuide(clientId);
    return g ?? { error: "No meeting guide available." };
  },

  get_overlap_insights: async (args, actions) => {
    const clientId =
      typeof (args as { clientId?: unknown }).clientId === "string"
        ? (args as { clientId: string }).clientId
        : undefined;
    const insights = await actions.getOverlapInsights(clientId);
    return insights ? { overlapInsights: insights } : { error: "No active client." };
  },

  get_roth_summary: async (args, actions) => {
    const clientId =
      typeof (args as { clientId?: unknown }).clientId === "string"
        ? (args as { clientId: string }).clientId
        : undefined;
    const r = await actions.getRothSummary(clientId);
    return r ?? { error: "No Roth analysis available." };
  },

  client_overview: async (args, actions) => {
    const clientId =
      typeof (args as { clientId?: unknown }).clientId === "string"
        ? (args as { clientId: string }).clientId
        : undefined;
    const o = await actions.getClientOverview(clientId);
    return o ?? { error: "No active client to summarize." };
  },

  find_clients_by_criteria: async (args, actions) => {
    const filter: FindClientsCriteria = {};
    const a = args as Record<string, unknown>;
    if (typeof a.search === "string") filter.search = a.search;
    if (typeof a.riskProfile === "string") filter.riskProfile = a.riskProfile;
    if (typeof a.minAge === "number") filter.minAge = a.minAge;
    if (typeof a.maxAge === "number") filter.maxAge = a.maxAge;
    if (typeof a.minTotalValue === "number") filter.minTotalValue = a.minTotalValue;
    if (typeof a.maxTotalValue === "number") filter.maxTotalValue = a.maxTotalValue;
    if (typeof a.staleDays === "number") filter.staleDays = a.staleDays;
    if (typeof a.maxIncomeReadinessScore === "number")
      filter.maxIncomeReadinessScore = a.maxIncomeReadinessScore;
    if (typeof a.hasRedFlags === "boolean") filter.hasRedFlags = a.hasRedFlags;
    if (typeof a.status === "string") filter.status = a.status;
    const matches = await actions.findClientsByCriteria(filter);
    return { count: matches.length, clients: matches.slice(0, 25) };
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
