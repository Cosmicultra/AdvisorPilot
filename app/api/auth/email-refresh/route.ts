import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function POST(req: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const refresh_token = typeof body?.refresh_token === "string" ? body.refresh_token.trim() : "";
    if (!refresh_token) {
      return NextResponse.json({ error: "Missing refresh token." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });

    if (error || !data.session?.access_token) {
      return NextResponse.json(
        { error: error?.message || "Invalid or expired session." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token ?? refresh_token,
    });
  } catch (err: unknown) {
    console.error("EMAIL REFRESH ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not refresh session." },
      { status: 500 }
    );
  }
}
