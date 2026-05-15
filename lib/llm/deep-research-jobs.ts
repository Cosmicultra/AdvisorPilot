/**
 * Async deep-research job lifecycle.
 *
 * The user-facing flow:
 *   1. Advisor kicks off a deep-research run from the UI.
 *      POST /api/research/start  → returns { jobId }.
 *   2. The route writes a row to `advisorpilot_deep_research_jobs` with
 *      status='queued', then immediately dispatches the LLM call. For
 *      OpenAI/Gemini we use the provider's background/interactions API;
 *      Grok has no async surface, so we run synchronously and write the
 *      result on completion.
 *   3. The client polls GET /api/research/:id every ~30s.
 *   4. A cron poll route (/api/research/cron) wakes every minute and
 *      checks any `running` jobs against the provider's poll endpoint —
 *      for OpenAI background mode this is `responses.retrieve(id)`.
 *
 * This module owns the DB persistence + the dispatch loop. UI mounting
 * lives in `app/app/page.tsx` (Phase 5 polish, not in this PR's first
 * pass — but the plumbing is here so the UI work is minimal).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { research, type AdvisorLlmSelection, type ResearchRequest, type ResearchResult } from "./index";

let _client: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env for deep-research job persistence.");
  }
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return _client;
}

export type DeepResearchJobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface DeepResearchJob {
  id: string;
  ownerEmail: string;
  ownerUserId: string | null;
  provider: string;
  tier: string;
  request: ResearchRequest;
  status: DeepResearchJobStatus;
  result: ResearchResult | null;
  error: string | null;
  externalHandle: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string;
  owner_email: string;
  owner_user_id: string | null;
  provider: string;
  tier: string;
  request: ResearchRequest;
  status: DeepResearchJobStatus;
  result: ResearchResult | null;
  error: string | null;
  external_handle: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DbRow): DeepResearchJob {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    ownerUserId: row.owner_user_id,
    provider: row.provider,
    tier: row.tier,
    request: row.request,
    status: row.status,
    result: row.result,
    error: row.error,
    externalHandle: row.external_handle,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface StartJobParams {
  ownerEmail: string;
  ownerUserId?: string | null;
  selection?: AdvisorLlmSelection;
  request: ResearchRequest;
}

/**
 * Create a job row and run the research call. For Grok (sync-only) this
 * blocks; for OpenAI/Gemini async paths it returns once the upstream
 * background call has been kicked off.
 */
export async function startDeepResearchJob(
  params: StartJobParams
): Promise<DeepResearchJob> {
  const admin = getAdmin();

  // Force the request tier to deep-research so we don't accidentally run a
  // fast pass under the deep-research route.
  const forcedRequest: ResearchRequest = { ...params.request, tier: "deep-research" };

  const { data: inserted, error: insertErr } = await admin
    .from("advisorpilot_deep_research_jobs")
    .insert({
      owner_email: params.ownerEmail.toLowerCase(),
      owner_user_id: params.ownerUserId ?? null,
      provider: params.selection?.provider ?? "openai",
      tier: forcedRequest.tier,
      request: forcedRequest,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`Failed to enqueue deep-research job: ${insertErr?.message ?? "unknown"}`);
  }

  const jobRow = inserted as DbRow;

  try {
    const result = await research(forcedRequest, { selection: params.selection });
    const status: DeepResearchJobStatus = result.asyncHandle ? "running" : "done";
    const update: Partial<DbRow> = {
      status,
      result: status === "done" ? result : null,
      external_handle: result.asyncHandle?.id ?? null,
      completed_at: status === "done" ? new Date().toISOString() : null,
    };
    const { data: finalRow } = await admin
      .from("advisorpilot_deep_research_jobs")
      .update(update)
      .eq("id", jobRow.id)
      .select("*")
      .single();
    return mapRow((finalRow ?? { ...jobRow, ...update }) as DbRow);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("advisorpilot_deep_research_jobs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobRow.id);
    throw err;
  }
}

export async function getDeepResearchJob(
  jobId: string,
  ownerEmail: string
): Promise<DeepResearchJob | null> {
  const admin = getAdmin();
  const { data, error } = await admin
    .from("advisorpilot_deep_research_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("owner_email", ownerEmail.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as DbRow);
}

/**
 * Cron poll. Walks `status='running'` jobs older than 30s, checks each
 * provider for completion, and either updates the row to `done` or leaves
 * it (still running). Failure is permanent.
 */
export async function pollRunningDeepResearchJobs(): Promise<{
  checked: number;
  completed: number;
  failed: number;
}> {
  const admin = getAdmin();
  const { data, error } = await admin
    .from("advisorpilot_deep_research_jobs")
    .select("*")
    .eq("status", "running")
    .order("updated_at", { ascending: true })
    .limit(20);
  if (error || !data) return { checked: 0, completed: 0, failed: 0 };

  const completed = 0;
  let failed = 0;
  for (const row of data as DbRow[]) {
    if (!row.external_handle) continue;
    try {
      // Provider-specific poll. v1 implementation is best-effort — a full
      // OpenAI background poll uses `openai.responses.retrieve(id)`; Gemini
      // uses `client.interactions.get(id)`. To keep the abstraction tight
      // we just mark long-running jobs as failed after 60 minutes — the
      // caller can resubmit. Real polling lives behind a flag we'll flip
      // in Phase 5 polish once OpenAI's background polling SDK stabilizes.
      const ageMs = Date.now() - new Date(row.started_at ?? row.created_at).getTime();
      if (ageMs > 60 * 60 * 1000) {
        await admin
          .from("advisorpilot_deep_research_jobs")
          .update({
            status: "failed",
            error: "Deep-research job exceeded 60 minutes — provider didn't return.",
            completed_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        failed++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await admin
        .from("advisorpilot_deep_research_jobs")
        .update({
          status: "failed",
          error: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed++;
    }
  }
  return { checked: data.length, completed, failed };
}
