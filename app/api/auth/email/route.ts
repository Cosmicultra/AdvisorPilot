import { NextResponse } from "next/server";
import {
  getSupabaseServiceAdmin,
  missingSupabaseServiceEnv,
} from "@/lib/supabase-service-admin";

export async function POST(req: Request) {
  try {
    const { email, password, type } = await req.json();

    if (missingSupabaseServiceEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }
    const supabaseAdmin = getSupabaseServiceAdmin()!;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    if (String(password).length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    if (type === "signup") {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        user: data.user,
        message: "Account created successfully.",
      });
    }

    if (type === "login") {
      const { data, error } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }

      return NextResponse.json({
        ok: true,
        user: data.user,
        session: data.session,
        message: "Logged in successfully.",
      });
    }

    return NextResponse.json(
      { error: "Invalid request type." },
      { status: 400 }
    );
  } catch (err: unknown) {
    console.error("SUPABASE EMAIL AUTH ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Email authentication failed." },
      { status: 500 }
    );
  }
}
