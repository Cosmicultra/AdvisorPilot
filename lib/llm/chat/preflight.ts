/**
 * Chat preflight — Supabase fetches that populate the system prompt.
 *
 * Lives next to the runner (`chat-runner.ts`) because the route handler
 * calls THIS function, then passes the result to `runChatOnce()` as the
 * `preflight` field. Keeping the fetches out of the runner means the
 * runner stays pure (no Supabase coupling → unit-testable with
 * mocked streams).
 *
 * ─── What this v1 ships ──────────────────────────────────────────────────────
 *
 *   - ALWAYS fetches the advisor profile (advisor_name, advisor_title) so
 *     the prompt's `<advisor>` block has real values, not the
 *     email-heuristic display name the route handler used in PR 1.
 *
 *   - When `currentClientId` is set:
 *       1. Calls `clients_visible_to(viewer_email, client_id)` — same RPC
 *          the rest of the CRM uses. If the viewer can't see the client,
 *          we silently OMIT the client-scoped blocks rather than leak
 *          existence info.
 *       2. In parallel (Promise.all): client row, pinned notes, recent
 *          activity, open tasks for that client.
 *
 *   - When `currentClientId` is NULL: we fetch the advisor's OPEN GLOBAL
 *     TASKS (limit 10, sorted by due date) so Nova still has context when
 *     the advisor opens the chat from `/app/tasks` or the legacy shell
 *     with no client loaded. No pinned-notes / activity in this branch —
 *     those don't make sense globally.
 *
 *   - Every query soft-fails: a Supabase error logs a warning and yields
 *     the empty / null fallback. The chat never blocks on a partial DB
 *     outage; Nova just gets less context for that turn.
 *
 * ─── Trust model ─────────────────────────────────────────────────────────────
 *
 *   - Uses the service-role admin client (`getCrmSupabaseAdmin()`), which
 *     bypasses RLS by design. The visibility RPC is the authorization gate
 *     for the client itself; once we know the client is visible to the
 *     viewer we trust the `client_id = id` filter for its associated notes
 *     / tasks / activity. This mirrors the trust model in
 *     `app/api/clients/[id]/route.ts`.
 *
 *   - Org-shared and direct-shared notes/tasks are visible because the
 *     visibility check on the parent client already accounts for org
 *     membership + share grants.
 *
 * Design + rationale: docs/crm/60-chat-orchestrator.md §B.4 + §B.5.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCrmSupabaseAdmin, missingCrmSupabaseEnv } from "@/lib/crm/supabase-admin";
import type { ChatRunnerPreflight } from "./chat-runner";
import type {
  SystemPromptActivity,
  SystemPromptAdvisor,
  SystemPromptClient,
  SystemPromptNote,
  SystemPromptTask,
  SystemPromptView,
} from "./system-prompt";

// ─────────────────────────────────────────────────────────────────────────────
// Defaults — bounded so the prompt stays tractable
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CAPS = {
  pinnedNotes: 5,
  recentActivity: 10,
  openTasks: 10,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatPreflightOptions {
  /** Lowercase advisor email — the viewer for visibility RPCs. */
  advisorEmail: string;
  /** Currently focused client id (URL-derived or legacy-shell override). */
  currentClientId?: string | null;
  /** Current page route — populates `<current_view>`. */
  currentRoute?: string | null;
  /** Logical surface for `<current_view>` (e.g. "crm", "tasks", "legacy"). */
  surface?: string | null;
  /** Optional tab within the surface (e.g. "overview"). */
  tab?: string | null;
  /** IANA timezone hint from the browser; falls back to UTC in the prompt. */
  timezone?: string | null;
  /** Per-query caps. Caller can lower these to bound prompt size further. */
  caps?: Partial<typeof DEFAULT_CAPS>;
  /**
   * Optional error sink — called once per failed query with `(source, err)`.
   * Defaults to a console.warn. Tests pass a vi.fn() to assert on failures.
   */
  onError?: (source: string, err: unknown) => void;
  /**
   * Test-only injection. Production callers omit this and the function
   * uses `getCrmSupabaseAdmin()`. Tests pass a stub Supabase client.
   */
  supabaseImpl?: SupabaseClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchChatPreflight(
  opts: ChatPreflightOptions,
): Promise<ChatRunnerPreflight> {
  const caps = { ...DEFAULT_CAPS, ...opts.caps };
  const reportError = opts.onError ?? defaultErrorSink;

  // Build the view block first — pure, no IO, always valid.
  const currentView: SystemPromptView = {
    route: opts.currentRoute ?? "/app",
    surface: opts.surface ?? null,
    tab: opts.tab ?? null,
  };

  // Skip Supabase entirely if env is missing — degrade to the email-only
  // advisor block + view + no client context. The chat still works; Nova
  // just doesn't know who's loaded or what's been happening.
  if (missingCrmSupabaseEnv() && !opts.supabaseImpl) {
    reportError("env", new Error("Supabase env not configured; preflight degraded"));
    return {
      advisor: minimalAdvisor(opts.advisorEmail, opts.timezone ?? null),
      currentView,
    };
  }

  const supabase = opts.supabaseImpl ?? getCrmSupabaseAdmin();

  // Kick off the advisor-profile fetch immediately — it always runs.
  const advisorPromise = fetchAdvisorProfile(
    supabase,
    opts.advisorEmail,
    opts.timezone ?? null,
    reportError,
  );

  // Branch: client in focus vs no client.
  if (opts.currentClientId) {
    const clientId = opts.currentClientId;

    // Visibility gate FIRST — one round trip. Failing this means we skip
    // the client-scoped blocks entirely (treat the client as not in focus).
    const isVisible = await checkClientVisibility(
      supabase,
      opts.advisorEmail,
      clientId,
      reportError,
    );

    if (!isVisible) {
      // Visible-as-far-as-Nova's-concerned: false. Fall through to the
      // no-client branch (global tasks) — better than giving Nova partial
      // context about a client the viewer technically can't see.
      const [advisor, openTasks] = await Promise.all([
        advisorPromise,
        fetchGlobalOpenTasks(
          supabase,
          opts.advisorEmail,
          caps.openTasks,
          reportError,
        ),
      ]);
      return {
        advisor,
        currentView,
        openTasks: openTasks.length > 0 ? openTasks : undefined,
      };
    }

    // Client IS visible — fetch the four client-scoped blocks in parallel.
    const [advisor, client, pinnedNotes, recentActivity, openTasks] = await Promise.all([
      advisorPromise,
      fetchClientSnapshot(supabase, clientId, reportError),
      fetchPinnedNotes(supabase, clientId, caps.pinnedNotes, reportError),
      fetchRecentActivity(
        supabase,
        opts.advisorEmail,
        clientId,
        caps.recentActivity,
        reportError,
      ),
      fetchOpenTasksForClient(supabase, clientId, caps.openTasks, reportError),
    ]);

    return {
      advisor,
      currentView,
      currentClient: client ?? undefined,
      pinnedNotes: pinnedNotes.length > 0 ? pinnedNotes : undefined,
      recentActivity: recentActivity.length > 0 ? recentActivity : undefined,
      openTasks: openTasks.length > 0 ? openTasks : undefined,
    };
  }

  // No client in focus — global tasks only.
  const [advisor, openTasks] = await Promise.all([
    advisorPromise,
    fetchGlobalOpenTasks(supabase, opts.advisorEmail, caps.openTasks, reportError),
  ]);

  return {
    advisor,
    currentView,
    openTasks: openTasks.length > 0 ? openTasks : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-source fetchers (each soft-fails to its empty / null fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAdvisorProfile(
  supabase: SupabaseClient,
  advisorEmail: string,
  timezone: string | null,
  onError: (source: string, err: unknown) => void,
): Promise<SystemPromptAdvisor> {
  try {
    const { data, error } = await supabase
      .from("advisorpilot_advisor_profiles")
      .select("owner_email, advisor_name, advisor_title")
      .eq("owner_email", advisorEmail.toLowerCase())
      .maybeSingle();
    if (error) {
      onError("advisor_profile", error);
      return minimalAdvisor(advisorEmail, timezone);
    }
    if (!data) {
      return minimalAdvisor(advisorEmail, timezone);
    }
    return {
      name: typeof data.advisor_name === "string" && data.advisor_name.trim()
        ? data.advisor_name.trim()
        : deriveDisplayName(advisorEmail),
      email: advisorEmail,
      title:
        typeof data.advisor_title === "string" && data.advisor_title.trim()
          ? data.advisor_title.trim()
          : null,
      // Firm + communicationStyle aren't columns yet; PR adds them when the
      // profile table grows. Timezone uses the browser-supplied hint until
      // the profile gains its own column.
      firmName: null,
      timezone,
      communicationStyle: null,
    };
  } catch (err) {
    onError("advisor_profile", err);
    return minimalAdvisor(advisorEmail, timezone);
  }
}

async function checkClientVisibility(
  supabase: SupabaseClient,
  viewerEmail: string,
  clientId: string,
  onError: (source: string, err: unknown) => void,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("clients_visible_to", {
      viewer_email: viewerEmail,
      client_id: clientId,
    });
    if (error) {
      onError("visibility", error);
      return false; // fail closed — safer to omit context than to leak it
    }
    return data === true;
  } catch (err) {
    onError("visibility", err);
    return false;
  }
}

interface ClientRowSubset {
  client: unknown;
  holdings: unknown;
  total_value: number | string | null;
  stage: string | null;
  status: string | null;
  last_contacted_at: string | null;
  next_meeting_at: string | null;
  review_due_at: string | null;
}

async function fetchClientSnapshot(
  supabase: SupabaseClient,
  clientId: string,
  onError: (source: string, err: unknown) => void,
): Promise<SystemPromptClient | null> {
  try {
    const { data, error } = await supabase
      .from("advisorpilot_clients")
      .select(
        "client, holdings, total_value, stage, status, last_contacted_at, next_meeting_at, review_due_at",
      )
      .eq("id", clientId)
      .maybeSingle();
    if (error) {
      onError("client_snapshot", error);
      return null;
    }
    if (!data) return null;

    const row = data as ClientRowSubset;
    const intake = isObject(row.client) ? row.client : {};
    const firstName = pickString(intake, "firstName");
    const lastName = pickString(intake, "lastName");
    const name = [firstName, lastName].filter(Boolean).join(" ").trim() || "(unnamed)";

    return {
      name,
      stage: row.stage ?? row.status ?? null,
      lastReviewDate: toIsoDate(row.last_contacted_at),
      nextDueDate: toIsoDate(row.next_meeting_at) ?? toIsoDate(row.review_due_at),
      aum: deriveAum(row.holdings, row.total_value),
      // Risk profile + cash sleeve + account summary need holdings inspection.
      // Skipped for v1 — the prompt builder gracefully omits any field set to null.
      // Wire them in PR 2.5 once the prompt is field-tested.
      riskProfile: null,
      cashSleevePct: null,
      accountSummary: deriveAccountSummary(row.holdings),
    };
  } catch (err) {
    onError("client_snapshot", err);
    return null;
  }
}

async function fetchPinnedNotes(
  supabase: SupabaseClient,
  clientId: string,
  cap: number,
  onError: (source: string, err: unknown) => void,
): Promise<SystemPromptNote[]> {
  try {
    const { data, error } = await supabase
      .from("advisorpilot_notes")
      .select("created_at, body")
      .eq("client_id", clientId)
      .eq("pinned", true)
      .order("created_at", { ascending: false })
      .limit(cap);
    if (error) {
      onError("pinned_notes", error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data
      .filter((row) => typeof row.body === "string" && row.body.trim())
      .map((row) => ({
        date: toIsoDate(row.created_at) ?? "",
        body: String(row.body),
      }));
  } catch (err) {
    onError("pinned_notes", err);
    return [];
  }
}

async function fetchRecentActivity(
  supabase: SupabaseClient,
  viewerEmail: string,
  clientId: string,
  cap: number,
  onError: (source: string, err: unknown) => void,
): Promise<SystemPromptActivity[]> {
  // Uses the existing list_visible_activity SQL function — same one that
  // powers the Timeline tab + Overview's recent-activity rail. That function
  // already merges activity_log + audit_event rows AND enforces visibility.
  try {
    const { data, error } = await supabase.rpc("list_visible_activity", {
      viewer_email: viewerEmail,
      target_client_id: clientId,
      result_limit: cap,
    });
    if (error) {
      onError("recent_activity", error);
      return [];
    }
    if (!Array.isArray(data)) return [];
    return data
      .map((row): SystemPromptActivity | null => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const summary = typeof r.title === "string" ? r.title : null;
        if (!summary) return null;
        return {
          date: toIsoDate(r.occurred_at as string | null) ?? "",
          summary,
        };
      })
      .filter((x): x is SystemPromptActivity => x !== null);
  } catch (err) {
    onError("recent_activity", err);
    return [];
  }
}

async function fetchOpenTasksForClient(
  supabase: SupabaseClient,
  clientId: string,
  cap: number,
  onError: (source: string, err: unknown) => void,
): Promise<SystemPromptTask[]> {
  try {
    const { data, error } = await supabase
      .from("advisorpilot_tasks")
      .select("title, due_date, priority, status")
      .eq("client_id", clientId)
      .in("status", ["open", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(cap);
    if (error) {
      onError("open_tasks_client", error);
      return [];
    }
    return mapTasksRows(data);
  } catch (err) {
    onError("open_tasks_client", err);
    return [];
  }
}

async function fetchGlobalOpenTasks(
  supabase: SupabaseClient,
  advisorEmail: string,
  cap: number,
  onError: (source: string, err: unknown) => void,
): Promise<SystemPromptTask[]> {
  try {
    const { data, error } = await supabase
      .from("advisorpilot_tasks")
      .select("title, due_date, priority, status")
      .eq("owner_email", advisorEmail.toLowerCase())
      .in("status", ["open", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(cap);
    if (error) {
      onError("open_tasks_global", error);
      return [];
    }
    return mapTasksRows(data);
  } catch (err) {
    onError("open_tasks_global", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers + helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapTasksRows(data: unknown): SystemPromptTask[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        title: typeof r.title === "string" ? r.title : "(untitled)",
        dueDate: toIsoDate(r.due_date as string | null),
        priority: typeof r.priority === "string" ? r.priority : null,
      };
    });
}

function minimalAdvisor(email: string, timezone: string | null): SystemPromptAdvisor {
  return {
    name: deriveDisplayName(email),
    email,
    firmName: null,
    title: null,
    timezone,
    communicationStyle: null,
  };
}

/** `jane.doe@firm.com` → `Jane Doe`; falls back to local part. */
function deriveDisplayName(email: string): string {
  const at = email.indexOf("@");
  const local = at > 0 ? email.slice(0, at) : email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

/** Convert a Supabase timestamp string to ISO date (YYYY-MM-DD). */
function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Supabase returns timestamps like "2026-05-16T09:30:00+00:00". Slice the
  // calendar-date prefix; if the string isn't ISO-shaped, return null
  // rather than guess.
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return isoMatch ? isoMatch[1] : null;
}

/** Sum holdings[].value; fall back to `total_value` column when holdings is empty. */
function deriveAum(holdings: unknown, totalValue: number | string | null): number | null {
  if (Array.isArray(holdings) && holdings.length > 0) {
    let sum = 0;
    let sawNumber = false;
    for (const h of holdings) {
      if (!h || typeof h !== "object") continue;
      const v = (h as Record<string, unknown>).value;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) {
        sum += n;
        sawNumber = true;
      }
    }
    if (sawNumber) return sum;
  }
  if (totalValue !== null && totalValue !== undefined) {
    const n = Number(totalValue);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Brief account-list summary: "2 IRA, 1 Joint" — derived from holdings[].accountType. */
function deriveAccountSummary(holdings: unknown): string | null {
  if (!Array.isArray(holdings) || holdings.length === 0) return null;
  const counts = new Map<string, number>();
  for (const h of holdings) {
    if (!h || typeof h !== "object") continue;
    const t = (h as Record<string, unknown>).accountType;
    if (typeof t !== "string" || !t.trim()) continue;
    const key = t.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v.trim() : "";
}

function defaultErrorSink(source: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[chat:preflight] ${source} failed: ${message}`);
}
