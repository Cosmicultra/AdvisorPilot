import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { isGmailConnected } from "@/lib/gmail-connection";
import { isOutlookConnected } from "@/lib/outlook-connection";
import { getNextAuthAuthProvider } from "@/lib/outlook-connection";

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
    "fee-analysis",
    "chat",
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

function trimOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

/** Build upsert payload: start from existing row, patch only keys present in body. */
function buildMergedProfilePayload(
  existing: AdvisorProfileRecord | null,
  body: Record<string, unknown>,
  identity: { email: string; userId: string | null }
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    owner_email: identity.email,
    owner_user_id: identity.userId,
    email_signature: existing?.email_signature ?? null,
    logo_url: existing?.logo_url ?? null,
    advisor_name: existing?.advisor_name ?? null,
    advisor_title: existing?.advisor_title ?? null,
    advisor_license: existing?.advisor_license ?? null,
    calendar_link: existing?.calendar_link ?? null,
    office_address: existing?.office_address ?? null,
    office_phone: existing?.office_phone ?? null,
    cell_phone: existing?.cell_phone ?? null,
    website: existing?.website ?? null,
    disclosures_text: existing?.disclosures_text ?? null,
    disclosures_image_url: existing?.disclosures_image_url ?? null,
    llm_provider: existing?.llm_provider ?? null,
    llm_model_overrides: existing?.llm_model_overrides ?? null,
    default_research_tier: existing?.default_research_tier ?? null,
  };

  if (Object.hasOwn(body, "emailSignature")) {
    payload.email_signature = String(body.emailSignature || "").trim();
  }
  if (Object.hasOwn(body, "logoUrl")) {
    payload.logo_url = nullableTrim(body.logoUrl);
  }
  if (Object.hasOwn(body, "advisorName")) {
    payload.advisor_name = trimOrNull(body.advisorName);
  }
  if (Object.hasOwn(body, "advisorTitle")) {
    payload.advisor_title = trimOrNull(body.advisorTitle);
  }
  if (Object.hasOwn(body, "advisorLicense")) {
    payload.advisor_license = trimOrNull(body.advisorLicense);
  }
  if (Object.hasOwn(body, "calendarLink")) {
    payload.calendar_link = trimOrNull(body.calendarLink);
  }
  if (Object.hasOwn(body, "officeAddress")) {
    payload.office_address = trimOrNull(body.officeAddress);
  }
  if (Object.hasOwn(body, "officePhone")) {
    payload.office_phone = trimOrNull(body.officePhone);
  }
  if (Object.hasOwn(body, "cellPhone")) {
    payload.cell_phone = trimOrNull(body.cellPhone);
  }
  if (Object.hasOwn(body, "website")) {
    payload.website = trimOrNull(body.website);
  }
  if (Object.hasOwn(body, "disclosuresText")) {
    payload.disclosures_text = trimOrNull(body.disclosuresText);
  }
  if (Object.hasOwn(body, "disclosuresImageUrl")) {
    payload.disclosures_image_url = nullableTrim(body.disclosuresImageUrl);
  }
  if (Object.hasOwn(body, "llmProvider")) {
    payload.llm_provider = sanitizeProvider(body.llmProvider);
  }
  if (Object.hasOwn(body, "llmModelOverrides")) {
    payload.llm_model_overrides = sanitizeModelOverrides(body.llmModelOverrides);
  }
  if (Object.hasOwn(body, "defaultResearchTier")) {
    payload.default_research_tier = sanitizeTier(body.defaultResearchTier);
  }

  return payload;
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

    const gmailConnected = await isGmailConnected(req);
    const outlookConnected = await isOutlookConnected(req);
    const emailConnected = gmailConnected || outlookConnected;
    const authProvider = await getNextAuthAuthProvider(req);
    const emailProvider = outlookConnected
      ? "outlook"
      : gmailConnected
        ? "gmail"
        : authProvider === "azure-ad"
          ? "outlook"
          : authProvider === "google"
            ? "gmail"
            : null;

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_advisor_profiles")
      .select("*")
      .eq("owner_email", identity.email)
      .maybeSingle();

    if (error) {
      // If a new column is missing in the user's deployment, the SELECT *
      // can fail. Fall back to a minimal SELECT so the profile UI still
      // loads.
      const msg = error.message || "";
      const missingLlmColumn = /Could not find the '(llm_provider|llm_model_overrides|default_research_tier)'/i.test(
        msg
      );
      if (missingLlmColumn) {
        const retry = await supabaseAdmin
          .from("advisorpilot_advisor_profiles")
          .select(
            "owner_email, email_signature, logo_url, advisor_name, advisor_title, advisor_license, calendar_link, office_address, office_phone, cell_phone, website, disclosures_text, disclosures_image_url, created_at, updated_at"
          )
          .eq("owner_email", identity.email)
          .maybeSingle();
        if (retry.error) {
          return NextResponse.json({ error: retry.error.message }, { status: 400 });
        }
        return NextResponse.json({
          profile: retry.data ? mapProfile(retry.data as AdvisorProfileRecord) : null,
          emailConnected,
          emailProvider,
          migrationRequired: "supabase/advisorpilot_advisor_profiles_llm_columns.sql",
        });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      profile: data ? mapProfile(data as AdvisorProfileRecord) : null,
      emailConnected,
      emailProvider,
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

    const body = (await req.json()) as Record<string, unknown>;

    const { data: existing, error: loadError } = await supabaseAdmin
      .from("advisorpilot_advisor_profiles")
      .select("*")
      .eq("owner_email", identity.email)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json({ error: loadError.message }, { status: 400 });
    }

    const payload = buildMergedProfilePayload(
      existing ? (existing as AdvisorProfileRecord) : null,
      body,
      identity
    );

    const { data, error } = await supabaseAdmin
      .from("advisorpilot_advisor_profiles")
      .upsert(payload, { onConflict: "owner_email" })
      .select("*")
      .single();

    if (error) {
      // Common case: the new LLM-preference columns haven't been added yet.
      // Detect "Could not find the '...' column" / PGRST204 and retry with
      // the legacy payload so existing profile fields still save, then
      // surface a clear migration nag.
      const msg = error.message || "";
      const missingLlmColumn =
        /Could not find the '(llm_provider|llm_model_overrides|default_research_tier)'/i.test(msg);
      if (missingLlmColumn) {
        const fallback: Record<string, unknown> = { ...payload };
        delete fallback.llm_provider;
        delete fallback.llm_model_overrides;
        delete fallback.default_research_tier;
        const retry = await supabaseAdmin
          .from("advisorpilot_advisor_profiles")
          .upsert(fallback, { onConflict: "owner_email" })
          .select("*")
          .single();
        if (retry.error) {
          return NextResponse.json({ error: retry.error.message }, { status: 400 });
        }
        return NextResponse.json({
          profile: mapProfile(retry.data as AdvisorProfileRecord),
          message:
            "Profile saved, but AI model preferences could NOT be persisted because the schema migration hasn't been applied yet. Run supabase/advisorpilot_advisor_profiles_llm_columns.sql in the Supabase SQL editor.",
          migrationRequired: "supabase/advisorpilot_advisor_profiles_llm_columns.sql",
        });
      }
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
