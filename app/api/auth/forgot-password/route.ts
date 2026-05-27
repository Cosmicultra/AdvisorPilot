import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function resolveRedirectOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const redirectTo = `${resolveRedirectOrigin(req)}/reset-password`;
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo,
    });

    if (error) {
      console.error("[auth:forgot-password]", error.message);
      return NextResponse.json(
        { error: "Could not send reset email. Check Supabase Auth email settings." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email, we sent a reset link.",
    });
  } catch (err: unknown) {
    console.error("FORGOT PASSWORD ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not send reset email." },
      { status: 500 }
    );
  }
}
