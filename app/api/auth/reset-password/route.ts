import { NextResponse } from "next/server";
import {
  getSupabaseServiceAdmin,
  missingSupabaseServiceEnv,
} from "@/lib/supabase-service-admin";

export async function POST(req: Request) {
  try {
    const { accessToken, password } = await req.json();

    if (missingSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }
    const supabaseAdmin = getSupabaseServiceAdmin()!;

    const token = String(accessToken || "").trim();
    if (!token) {
      return NextResponse.json({ error: "Reset token is required." }, { status: 400 });
    }

    if (String(password || "").length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user?.id) {
      return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 401 });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userData.user.id, {
      password: String(password),
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "Password updated successfully." });
  } catch (err: unknown) {
    console.error("RESET PASSWORD ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reset password." },
      { status: 500 }
    );
  }
}
