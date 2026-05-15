import { NextResponse } from "next/server";
import { pollRunningDeepResearchJobs } from "@/lib/llm/deep-research-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron-driven poll for running deep-research jobs. Configure a Vercel cron
 * to hit this every minute. The route checks any jobs that have been
 * running >60 minutes and marks them failed so the UI doesn't hang.
 *
 * Real provider polling (OpenAI `responses.retrieve(id)`, Gemini
 * Interactions get) lands in Phase 5 polish; the queue + UI surfaces work
 * with synchronous completion today.
 *
 * Protected by a shared secret; set `RESEARCH_CRON_SECRET` and pass it as
 * `x-cron-secret`. If unset (dev), unauthenticated calls are accepted.
 */
export async function POST(req: Request) {
  const expected = process.env.RESEARCH_CRON_SECRET?.trim();
  if (expected) {
    const got = req.headers.get("x-cron-secret")?.trim();
    if (got !== expected) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  const stats = await pollRunningDeepResearchJobs();
  return NextResponse.json(stats);
}

export async function GET(req: Request) {
  return POST(req);
}
