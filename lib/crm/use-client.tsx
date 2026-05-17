"use client";

/**
 * AdvisorClientProvider — React context that holds the editable workflow
 * state for a single client. The provider fetches /api/clients/[id] on
 * mount and exposes the IntakeClient + holdings + analysis + roth + meeting
 * notes as React state with setters, so workflow components extracted from
 * legacy-app-shell.tsx (Phase 3) can drive their UI without prop-drilling.
 *
 * Why a separate provider instead of just consuming ClientDetailContent's
 * existing fetch:
 *   1. Each extracted workflow block (intake, upload, confirm, analysis,
 *      meeting, fia, roth, ret-income, fee-analysis, report) needs to read
 *      AND write the same shared state. Lifting it to a context here means
 *      the legacy page stays unchanged AND the new tab routes don't have to
 *      rebuild that wiring.
 *   2. The same extracted component file ships in both the legacy single-page
 *      workflow (drives off legacy-app-shell.tsx's local useState) and the new
 *      CRM tab routes (drives off this context). Component takes props; the
 *      CRM-side wrapper pulls those props from useAdvisorClient(); the legacy
 *      wrapper pulls them from its existing state. No coupling either way.
 *
 * Persistence: Phase 3 holds local state only — no auto-save. Saving back
 * to advisorpilot_clients goes through the existing /api/client-database
 * POST endpoint (called by the legacy save flow today; will be wired into
 * the CRM in a later phase). Calling refresh() re-fetches detail and
 * overwrites local state with the server's truth.
 *
 * Auth: detail fetch goes through advisorFetch() per
 * .cursor/rules/50-authentication.mdc — handles both NextAuth cookies and
 * email/password Bearer tokens.
 *
 * Spec: docs/crm/10-implementation.md §6.1.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { normalizeIntakeClient, type IntakeClient } from "@/lib/intake-config";
import {
  emptyRothWorksheet,
  type RothWorksheet,
} from "@/lib/roth-worksheet";
import type {
  NormalizedAiAnalysis,
  UiHolding,
} from "@/lib/saved-review-normalize";
import type { ClientDetail } from "./types";

// ─── Context shape ────────────────────────────────────────────────────────

export type AdvisorClientStatus =
  | "loading"
  | "ready"
  | "unauthorized"
  | "not-found"
  | "error";

export interface AdvisorClientContextValue {
  /** The id this provider is hydrating. */
  clientId: string;

  /** Status of the initial detail fetch. Workflow components should render
   *  a loading state until this is "ready". */
  status: AdvisorClientStatus;

  /** Populated when status === "error". */
  error?: string;

  /** Read-only snapshot of the latest /api/clients/[id] response. Useful
   *  for the Profile header / Roster row chrome that doesn't mutate. Null
   *  before the fetch resolves. */
  detail: ClientDetail | null;

  // ── Editable workflow state ────────────────────────────────────────────
  // Setters mutate local state only; nothing is persisted until the caller
  // (legacy save flow today, CRM save flow later) POSTs to /api/client-database.

  client: IntakeClient;
  setClient: Dispatch<SetStateAction<IntakeClient>>;

  holdings: UiHolding[];
  setHoldings: Dispatch<SetStateAction<UiHolding[]>>;

  analysis: NormalizedAiAnalysis | null;
  setAnalysis: Dispatch<SetStateAction<NormalizedAiAnalysis | null>>;

  rothWorksheet: RothWorksheet;
  setRothWorksheet: Dispatch<SetStateAction<RothWorksheet>>;

  meetingNotes: string;
  setMeetingNotes: Dispatch<SetStateAction<string>>;

  // ── Imperative helpers ─────────────────────────────────────────────────

  /** Re-fetch /api/clients/[id] and overwrite local state with the server's
   *  truth. Useful after a successful save round-trip, or when an external
   *  mutation (Phase 2 task/note POST that bumped last_contacted_at)
   *  invalidates local data. */
  refresh: () => Promise<void>;

  /** True while a refresh() call is in-flight. The initial mount fetch is
   *  reflected by `status === "loading"` instead. */
  refreshing: boolean;
}

// ─── Context + hook ───────────────────────────────────────────────────────

const AdvisorClientContext = createContext<AdvisorClientContextValue | null>(null);

/**
 * Read the active client's workflow state. Throws if used outside of an
 * AdvisorClientProvider — workflow components depend on the provider being
 * mounted by their host route.
 */
export function useAdvisorClient(): AdvisorClientContextValue {
  const value = useContext(AdvisorClientContext);
  if (!value) {
    throw new Error(
      "useAdvisorClient must be called from a child of <AdvisorClientProvider>."
    );
  }
  return value;
}

/**
 * Same as useAdvisorClient but returns null instead of throwing. Useful for
 * components that may run in either the legacy shell (no provider) or a CRM
 * route (provider present) — they can branch on whether a context exists.
 */
export function useOptionalAdvisorClient(): AdvisorClientContextValue | null {
  return useContext(AdvisorClientContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────

export interface AdvisorClientProviderProps {
  clientId: string;
  children: ReactNode;
}

export function AdvisorClientProvider({
  clientId,
  children,
}: AdvisorClientProviderProps) {
  const [status, setStatus] = useState<AdvisorClientStatus>("loading");
  const [error, setError] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Workflow state — initialized to safe empty values, hydrated when the
  // initial fetch resolves.
  const [client, setClient] = useState<IntakeClient>(() => normalizeIntakeClient({}));
  const [holdings, setHoldings] = useState<UiHolding[]>([]);
  const [analysis, setAnalysis] = useState<NormalizedAiAnalysis | null>(null);
  const [rothWorksheet, setRothWorksheet] = useState<RothWorksheet>(() => emptyRothWorksheet());
  const [meetingNotes, setMeetingNotes] = useState<string>("");

  /** Hydrate local state from a fresh ClientDetail payload. */
  const hydrateFromDetail = useCallback((d: ClientDetail) => {
    setDetail(d);
    setClient(d.client);
    setHoldings(d.holdings ?? []);
    setAnalysis(d.analysis ?? null);
    setRothWorksheet(d.rothWorksheet ?? emptyRothWorksheet());
    setMeetingNotes(d.meetingNotes ?? "");
  }, []);

  /** Fetch /api/clients/[id] via advisorFetch. Returns the parsed detail
   *  on success, or sets the appropriate status on failure. */
  const fetchDetail = useCallback(
    async (signal?: AbortSignal): Promise<ClientDetail | null> => {
      try {
        const res = await advisorFetch(`/api/clients/${clientId}`, {
          cache: "no-store",
          signal,
        });
        if (signal?.aborted) return null;

        if (res.status === 401) {
          setStatus("unauthorized");
          setError(undefined);
          return null;
        }
        if (res.status === 404) {
          setStatus("not-found");
          setError(undefined);
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load client (${res.status})`);
        }
        const body = (await res.json()) as { client: ClientDetail };
        if (!body?.client) throw new Error("Malformed client response.");
        return body.client;
      } catch (err) {
        if (signal?.aborted) return null;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Failed to load client.");
        return null;
      }
    },
    [clientId]
  );

  // Initial fetch on mount + refetch on clientId change. We don't reset
  // to "loading" synchronously here — first render already starts in
  // "loading" via useState's initial value; on clientId change keeping
  // the previous client visible until the new fetch resolves is the
  // better UX. Also dodges the react-hooks/set-state-in-effect lint.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const next = await fetchDetail(controller.signal);
      if (controller.signal.aborted) return;
      if (next) {
        hydrateFromDetail(next);
        setStatus("ready");
        setError(undefined);
      }
    })();
    return () => controller.abort();
  }, [fetchDetail, hydrateFromDetail]);

  // Imperative refresh (post-save, post-mutation, etc.).
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchDetail();
      if (next) {
        hydrateFromDetail(next);
        setStatus("ready");
      }
    } finally {
      setRefreshing(false);
    }
  }, [fetchDetail, hydrateFromDetail]);

  const value = useMemo<AdvisorClientContextValue>(
    () => ({
      clientId,
      status,
      error,
      detail,
      client,
      setClient,
      holdings,
      setHoldings,
      analysis,
      setAnalysis,
      rothWorksheet,
      setRothWorksheet,
      meetingNotes,
      setMeetingNotes,
      refresh,
      refreshing,
    }),
    [
      clientId,
      status,
      error,
      detail,
      client,
      holdings,
      analysis,
      rothWorksheet,
      meetingNotes,
      refresh,
      refreshing,
    ]
  );

  return (
    <AdvisorClientContext.Provider value={value}>
      {children}
    </AdvisorClientContext.Provider>
  );
}
