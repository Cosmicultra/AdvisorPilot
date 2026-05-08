import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function missingEnv() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Public: lets the client page load advisor-prefilled intake (same token as upload).
 * Does not increment upload counts.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    if (missingEnv()) {
      return NextResponse.json({ error: "Server configuration error." }, { status: 500 });
    }

    const { token: raw } = await context.params;
    const token = String(raw || "").trim();
    if (!token) {
      return NextResponse.json({ error: "Missing link." }, { status: 400 });
    }

    const { data: tokenRow, error: tokenErr } = await supabaseAdmin
      .from("advisorpilot_upload_tokens")
      .select("expires_at, revoked_at, intake_snapshot")
      .eq("token", token)
      .maybeSingle();

    if (tokenErr || !tokenRow) {
      return NextResponse.json({ error: "Invalid or expired upload link." }, { status: 404 });
    }

    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "This upload link has expired." }, { status: 410 });
    }

    if (tokenRow.revoked_at) {
      return NextResponse.json({ error: "This upload link has been revoked." }, { status: 410 });
    }

    return NextResponse.json({
      intakeSnapshot: tokenRow.intake_snapshot ?? null,
      expiresAt: tokenRow.expires_at,
    });
  } catch (err: unknown) {
    console.error("CLIENT UPLOAD CONTEXT:", err);
    return NextResponse.json({ error: "Could not load link." }, { status: 500 });
  }
}
