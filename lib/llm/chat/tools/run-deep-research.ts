/**
 * `run_deep_research` — kick off an async deep-research job.
 *
 * Returns immediately with `{jobId, status}`. The model uses
 * `query_crm.list:research_jobs` (PR 4d) to poll the job's status and
 * surface results to the advisor when complete.
 *
 * Bypasses the `/api/research/start` route handler and calls
 * `startDeepResearchJob()` directly — that function lives in
 * `lib/llm/deep-research-jobs.ts` and is the actual business logic
 * (the route is a thin auth/parse wrapper). Direct invocation avoids the
 * synthetic-request overhead and lets us thread the advisor's selection
 * cleanly.
 *
 * Spec: docs/crm/70-orchestrator-tools.md §6.4.
 */

import { resolveAdvisorLlmSelection, type ResearchRequest } from "@/lib/llm";
import { startDeepResearchJob } from "@/lib/llm/deep-research-jobs";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

const MAX_USER_LENGTH = 4_000;

const PARAMETERS = {
  type: "object" as const,
  properties: {
    user: {
      type: "string",
      description:
        "The research question. REQUIRED. Plain English; the deep-research model handles its own decomposition. Max 4,000 chars. Examples: 'Survey current views on 60/40 portfolios for retirees', 'What are advisors saying about Roth conversions in 2026?'",
    },
    system: {
      type: "string",
      description:
        "Optional system-prompt-style framing for the research. Most calls omit this — the deep-research model has good defaults.",
    },
    knownUrls: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional list of URLs the research model should crawl first. Useful when the advisor knows specific sources to include.",
    },
    allowedDomains: {
      type: "array",
      items: { type: "string" },
      description:
        "Restrict research to these domains. Empty/omitted = open web. Use sparingly — overly narrow domains return shallow results.",
    },
    blockedDomains: {
      type: "array",
      items: { type: "string" },
      description: "Domains the research should NOT consult. Optional.",
    },
    includeSocialSignals: {
      type: "boolean",
      description:
        "When true, includes social-media sources (Twitter/X, Reddit) in the research. Default false. Set true for 'what are people saying' style queries.",
    },
    maxAgenticSteps: {
      type: "integer",
      minimum: 1,
      maximum: 30,
      description: "Cap on tool-loop iterations inside the research job. Default 12.",
    },
  },
  required: ["user"],
};

export const runDeepResearchTool: ChatTool = {
  name: "run_deep_research",
  description:
    "Kick off an async deep-research job. Returns IMMEDIATELY with `{jobId, status: 'queued'|'running'}`. Use `query_crm.list:research_jobs` to poll until status='done'. Most jobs take 30s–3min; very wide queries can take 10min. Tell the advisor it's running and ask if they'd like you to check back in. The job's result lives at `research_jobs.result` once complete.",
  parameters: PARAMETERS,
  handler: handleRunDeepResearch,
};

async function handleRunDeepResearch(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const user = typeof args.user === "string" ? args.user.trim() : "";
  if (!user) {
    return { error: "`user` is required (the research question)." };
  }
  if (user.length > MAX_USER_LENGTH) {
    return {
      error: `\`user\` is too long (max ${MAX_USER_LENGTH} chars; got ${user.length}).`,
    };
  }

  const system =
    typeof args.system === "string" && args.system.trim() ? args.system.trim() : undefined;
  const knownUrls = stringArrayOrUndef(args.knownUrls);
  const allowedDomains = stringArrayOrUndef(args.allowedDomains);
  const blockedDomains = stringArrayOrUndef(args.blockedDomains);
  const includeSocialSignals = args.includeSocialSignals === true;
  const maxAgenticSteps =
    typeof args.maxAgenticSteps === "number" && Number.isFinite(args.maxAgenticSteps)
      ? Math.max(1, Math.min(30, Math.floor(args.maxAgenticSteps)))
      : undefined;

  const request: ResearchRequest = {
    tier: "deep-research",
    user,
    system,
    knownUrls,
    allowedDomains,
    blockedDomains,
    includeSocialSignals,
    maxAgenticSteps,
  };

  try {
    const selection = await resolveAdvisorLlmSelection(ctx.advisorEmail);
    const job = await startDeepResearchJob({
      ownerEmail: ctx.advisorEmail,
      // The chat tool ctx doesn't carry the Supabase user id (it's derived
      // from a different auth path); the job table tolerates null here.
      ownerUserId: null,
      selection,
      request,
    });
    return {
      result: {
        jobId: job.id,
        status: job.status,
        message:
          "Deep-research job is queued. Use `query_crm.list:research_jobs` with `filters: {status: 'running'}` (or by jobId) to check progress. Most jobs complete in 30s–3min.",
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to start research job." };
  }
}

function stringArrayOrUndef(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return out.length ? out : undefined;
}
