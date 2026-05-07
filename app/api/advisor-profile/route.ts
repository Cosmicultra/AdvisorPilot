import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

type AdvisorProfileRecord = {
  owner_email: string;
  email_signature?: string | null;
  logo_url?: string | null;
  advisor_name?: string | null;
  advisor_title?: string | null;
  advisor_license?: string | null;
  calendar_link?: string | null;
  office_address?: string | null;
  office_phone?: string | null;
  cell_phone?: string | null;
  website?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function missingSupabaseEnv() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function mapProfile(record: AdvisorProfileRecord) {
  return {
    ownerEmail: record.owner_email,
    emailSignature: record.email_signature || "",
    logoUrl: record.logo_url || "",
    advisorName: record.advisor_name || "",
    advisorTitle: record.advisor_title || "",
    advisorLicense: record.advisor_license || "",
    calendarLink: record.calendar_link || "",
    officeAddress: record.office_address || "",
    officePhone: record.office_phone || "",
    cellPhone: record.cell_phone || "",
    website: record.website || "",
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export const GET = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in before loading your advisor profile." }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_advisor_profiles")
      .select("*")
      .eq("owner_email", identity.email)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      profile: data ? mapProfile(data as AdvisorProfileRecord) : null,
    });
  } catch (err: unknown) {
    console.error("ADVISOR PROFILE GET ERROR:", err);
    return NextResponse.json({ error: errorMessage(err, "Failed to load advisor profile.") }, { status: 500 });
  }
};

export const POST = async (req: Request) => {
  try {
    if (missingSupabaseEnv()) {
      return NextResponse.json({ error: "Missing Supabase environment variables." }, { status: 500 });
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in before saving your advisor profile." }, { status: 401 });
    }

    const body = await req.json();
    const payload = {
      owner_email: identity.email,
      owner_user_id: identity.userId,
      email_signature: String(body?.emailSignature || "").trim(),
      logo_url: body?.logoUrl || null,
      advisor_name: String(body?.advisorName || "").trim() || null,
      advisor_title: String(body?.advisorTitle || "").trim() || null,
      advisor_license: String(body?.advisorLicense || "").trim() || null,
      calendar_link: String(body?.calendarLink || "").trim() || null,
      office_address: String(body?.officeAddress || "").trim() || null,
      office_phone: String(body?.officePhone || "").trim() || null,
      cell_phone: String(body?.cellPhone || "").trim() || null,
      website: String(body?.website || "").trim() || null,
    };

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_advisor_profiles")
      .upsert(payload, { onConflict: "owner_email" })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      profile: mapProfile(data as AdvisorProfileRecord),
      message: "Advisor profile saved.",
    });
  } catch (err: unknown) {
    console.error("ADVISOR PROFILE POST ERROR:", err);
    return NextResponse.json({ error: errorMessage(err, "Failed to save advisor profile.") }, { status: 500 });
  }
};
