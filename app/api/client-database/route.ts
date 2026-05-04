import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function missingSupabaseEnv() {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function mapRecord(record: any) {
  return {
    id: record.id,
    savedAt: record.updated_at || record.created_at,
    client: record.client || {},
    holdings: Array.isArray(record.holdings) ? record.holdings : [],
    meetingNotes: record.meeting_notes || "",
    demoMode: Boolean(record.demo_mode),
    analysis: record.analysis || null,
    totalValue: Number(record.total_value || 0),
    status: record.status || "Analyzed",
    lastContactedAt: record.last_contacted_at || null,
  };
}

export const GET = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const ownerEmail = normalizeEmail(searchParams.get("ownerEmail"));

    if (!ownerEmail) {
      return NextResponse.json(
        { error: "Missing ownerEmail." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_clients")
      .select("*")
      .eq("owner_email", ownerEmail)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      clients: (data || []).map(mapRecord),
    });
  } catch (err: any) {
    console.error("CLIENT DATABASE GET ERROR:", err);

    return NextResponse.json(
      { error: err?.message || "Failed to load client database." },
      { status: 500 }
    );
  }
};

export const POST = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const ownerEmail = normalizeEmail(body?.ownerEmail);

    if (!ownerEmail) {
      return NextResponse.json(
        { error: "Missing ownerEmail." },
        { status: 400 }
      );
    }

    const existingId = body?.id || null;

    const payload: any = {
      owner_email: ownerEmail,
      client: body?.client || {},
      holdings: Array.isArray(body?.holdings) ? body.holdings : [],
      meeting_notes: body?.meetingNotes || "",
      demo_mode: Boolean(body?.demoMode),
      analysis: body?.analysis || null,
      total_value: Number(body?.totalValue || 0),
    };

    if (typeof body?.status === "string" && body.status.trim()) {
      payload.status = body.status.trim();
    } else if (!existingId) {
      payload.status = "Analyzed";
    }

    if (body?.lastContactedAt) {
      payload.last_contacted_at = body.lastContactedAt;
    }

    const result = existingId
      ? await supabaseAdmin
          .from("advisorpilot_clients")
          .update(payload)
          .eq("id", existingId)
          .eq("owner_email", ownerEmail)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("advisorpilot_clients")
          .insert(payload)
          .select("*")
          .single();

    if (result.error) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      client: mapRecord(result.data),
      message: "Client profile saved.",
    });
  } catch (err: any) {
    console.error("CLIENT DATABASE POST ERROR:", err);

    return NextResponse.json(
      { error: err?.message || "Failed to save client profile." },
      { status: 500 }
    );
  }
};

export const DELETE = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const ownerEmail = normalizeEmail(body?.ownerEmail);
    const id = body?.id;

    if (!ownerEmail || !id) {
      return NextResponse.json(
        { error: "Missing ownerEmail or id." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("advisorpilot_clients")
      .delete()
      .eq("id", id)
      .eq("owner_email", ownerEmail);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: "Client profile deleted.",
    });
  } catch (err: any) {
    console.error("CLIENT DATABASE DELETE ERROR:", err);

    return NextResponse.json(
      { error: err?.message || "Failed to delete client profile." },
      { status: 500 }
    );
  }
};
