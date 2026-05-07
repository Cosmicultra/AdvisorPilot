import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function missingSupabaseEnv() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export async function GET(req: Request) {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }

    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing Supabase access token." }, { status: 401 });
    }

    const jwt = auth.slice(7).trim();
    const { data, error } = await supabaseAdmin.auth.getUser(jwt);
    if (error || !data.user?.email) {
      return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (err: unknown) {
    console.error("EMAIL SESSION ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not verify email session." },
      { status: 500 }
    );
  }
}
