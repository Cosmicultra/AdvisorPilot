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
  disclosures_text?: string | null;
  disclosures_image_url?: string | null;
  // LLM preferences — all nullable; NULL → "use firm/env default."
  llm_provider?: string | null;
  llm_model_overrides?: Record<string, string> | null;
  default_research_tier?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function missingSupabaseEnv() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function nullableTrim(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
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
    disclosuresText: record.disclosures_text || "",
    disclosuresImageUrl: record.disclosures_image_url || "",
    llmProvider: record.llm_provider || null,
    llmModelOverrides: record.llm_model_overrides || {},
    defaultResearchTier: record.default_research_tier || null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const ALLOWED_PROVIDERS = new Set(["openai", "gemini", "grok"]);
const ALLOWED_TIERS = new Set(["fast-grounded", "agentic-research", "deep-research"]);

function sanitizeProvider(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return ALLOWED_PROVIDERS.has(t) ? t : null;
}
function sanitizeTier(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return ALLOWED_TIERS.has(t) ? t : null;
}
function sanitizeModelOverrides(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const allowed = new Set([
    "extraction",
    "intake.turn",
    "research.fast-grounded",
    "research.agentic",
    "research.deep",
    "synthesis.json",
    "tts",
    "stt",
  ]);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (allowed.has(k) && typeof val === "string" && val.trim()) {
      out[k] = val.trim();
    }
  }
  return Object.keys(out).length ? out : null;
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
      logo_url: nullableTrim(body?.logoUrl),
      advisor_name: String(body?.advisorName || "").trim() || null,
      advisor_title: String(body?.advisorTitle || "").trim() || null,
      advisor_license: String(body?.advisorLicense || "").trim() || null,
      calendar_link: String(body?.calendarLink || "").trim() || null,
      office_address: String(body?.officeAddress || "").trim() || null,
      office_phone: String(body?.officePhone || "").trim() || null,
      cell_phone: String(body?.cellPhone || "").trim() || null,
      website: String(body?.website || "").trim() || null,
      disclosures_text: String(body?.disclosuresText || "").trim() || null,
      disclosures_image_url: nullableTrim(body?.disclosuresImageUrl),
      llm_provider: sanitizeProvider(body?.llmProvider),
      llm_model_overrides: sanitizeModelOverrides(body?.llmModelOverrides),
      default_research_tier: sanitizeTier(body?.defaultResearchTier),
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
