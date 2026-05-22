import { NextResponse } from "next/server";
import { getCrmSupabaseAdmin, missingCrmSupabaseEnv } from "@/lib/crm/supabase-admin";
import { processAnnuityReminderDrippers } from "@/lib/crm/annuity-reminder-runner";
import { processDueDrippers } from "@/lib/crm/dripper-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron-driven execution for due client drippers. Configure a Vercel cron
 * to hit this hourly. Protected by DRIPPER_CRON_SECRET / x-cron-secret.
 */
export async function POST(req: Request) {
  const expected = process.env.DRIPPER_CRON_SECRET?.trim();
  if (expected) {
    const got = req.headers.get("x-cron-secret")?.trim();
    if (got !== expected) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  if (missingCrmSupabaseEnv()) {
    return NextResponse.json(
      { error: "Missing Supabase environment variables." },
      { status: 500 }
    );
  }

  const supabase = getCrmSupabaseAdmin();
  const [frequency, annuity] = await Promise.all([
    processDueDrippers(supabase),
    processAnnuityReminderDrippers(supabase),
  ]);
  return NextResponse.json({ frequency, annuity });
}

export async function GET(req: Request) {
  return POST(req);
}
