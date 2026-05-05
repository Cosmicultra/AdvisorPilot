import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function mapProfile(record: any) {
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
  const { searchParams } = new URL(req.url);
  const ownerEmail = normalizeEmail(searchParams.get("ownerEmail"));

  if (!ownerEmail) {
    return NextResponse.json({ error: "Missing ownerEmail." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("advisorpilot_advisor_profiles")
    .select("*")
    .eq("owner_email", ownerEmail)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    profile: data ? mapProfile(data) : null,
  });
};

export const POST = async (req: Request) => {
  const body = await req.json();
  const ownerEmail = normalizeEmail(body?.ownerEmail);

  if (!ownerEmail) {
    return NextResponse.json({ error: "Missing ownerEmail." }, { status: 400 });
  }

  const payload = {
    owner_email: ownerEmail,
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
    profile: mapProfile(data),
    message: "Advisor profile saved.",
  });
};