import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const DEFAULT_EXPIRY_DAYS = 7;

function missingEnv() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function publicBaseUrl(request: Request) {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Mint a short-lived upload token bound to the signed-in advisor (Google session or Supabase JWT).
 */
export async function POST(request: Request) {
  try {
    if (missingEnv()) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }

    const identity = await resolveAdvisorIdentity(request);
    if (!identity) {
      return NextResponse.json(
        { error: "Sign in to create a client upload link." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const days = Math.min(30, Math.max(1, Number(body?.expiresInDays) || DEFAULT_EXPIRY_DAYS));
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const token = randomBytes(24).toString("hex");

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_upload_tokens")
      .insert({
        token,
        advisor_owner_email: identity.email,
        advisor_user_id: identity.userId,
        expires_at: expiresAt.toISOString(),
        upload_count: 0,
      })
      .select("id, expires_at, created_at")
      .single();

    if (error) {
      console.error("UPLOAD TOKEN INSERT:", error);
      return NextResponse.json(
        {
          error:
            error.message ||
            "Could not create upload token. If this is the first use, run supabase/advisorpilot_upload_tokens.sql in Supabase.",
        },
        { status: 400 }
      );
    }

    const base = publicBaseUrl(request);
    const uploadUrl = `${base}/client-upload/${token}`;
    await writeAuditEvent({
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      action: "upload_token.created",
      entityType: "upload_token",
      entityId: data.id,
      metadata: { expiresAt: data.expires_at },
    });

    return NextResponse.json({
      token,
      uploadUrl,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
    });
  } catch (err: unknown) {
    console.error("CLIENT UPLOAD TOKEN ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create upload link." },
      { status: 500 }
    );
  }
}
