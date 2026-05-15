import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  resolveAdvisorLlmSelection,
  type ResearchRequest,
} from "@/lib/llm";
import { startDeepResearchJob } from "@/lib/llm/deep-research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartDeepResearchBody {
  user?: unknown;
  system?: unknown;
  knownUrls?: unknown;
  allowedDomains?: unknown;
  blockedDomains?: unknown;
  includeSocialSignals?: unknown;
  maxAgenticSteps?: unknown;
  jsonSchema?: unknown;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function strArrOrUndef(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => String(x).trim()).filter(Boolean);
  return out.length ? out : undefined;
}

export async function POST(req: Request) {
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) {
    return NextResponse.json(
      { error: "Sign in before starting deep research." },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as StartDeepResearchBody;
  const user = strOrUndef(body.user);
  if (!user) {
    return NextResponse.json(
      { error: "Missing `user` field in request body." },
      { status: 400 }
    );
  }

  const request: ResearchRequest = {
    tier: "deep-research",
    user,
    system: strOrUndef(body.system),
    knownUrls: strArrOrUndef(body.knownUrls),
    allowedDomains: strArrOrUndef(body.allowedDomains),
    blockedDomains: strArrOrUndef(body.blockedDomains),
    includeSocialSignals: body.includeSocialSignals === true,
    maxAgenticSteps:
      typeof body.maxAgenticSteps === "number" ? body.maxAgenticSteps : undefined,
    jsonSchema:
      typeof body.jsonSchema === "object" && body.jsonSchema !== null
        ? (body.jsonSchema as Record<string, unknown>)
        : undefined,
  };

  try {
    const selection = await resolveAdvisorLlmSelection(identity.email);
    const job = await startDeepResearchJob({
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      selection,
      request,
    });
    return NextResponse.json({ jobId: job.id, status: job.status, job });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start job." },
      { status: 500 }
    );
  }
}
