import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function normalizeAdvisorEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Persist Outlook refresh token after Microsoft OAuth (NextAuth jwt callback). */
export async function persistOutlookRefreshToken(
  advisorEmail: string,
  refreshToken: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn("[outlook:token-store] missing Supabase env; skip persist");
    return;
  }
  const email = normalizeAdvisorEmail(advisorEmail);
  if (!email || !refreshToken.trim()) return;

  const { error } = await supabase.from("advisorpilot_advisor_outlook_tokens").upsert(
    {
      advisor_email: email,
      refresh_token: refreshToken.trim(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "advisor_email" }
  );

  if (error) {
    if (error.code === "PGRST204" || error.message?.includes("advisorpilot_advisor_outlook_tokens")) {
      console.warn(
        "[outlook:token-store] advisorpilot_advisor_outlook_tokens missing — run supabase/advisorpilot_advisor_outlook_tokens.sql"
      );
      return;
    }
    console.error("[outlook:token-store] upsert failed:", error.message);
  }
}

export async function loadOutlookRefreshToken(advisorEmail: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("advisorpilot_advisor_outlook_tokens")
    .select("refresh_token")
    .eq("advisor_email", normalizeAdvisorEmail(advisorEmail))
    .maybeSingle();

  if (error || !data?.refresh_token) return null;
  return String(data.refresh_token);
}

export async function hasOutlookRefreshToken(advisorEmail: string): Promise<boolean> {
  const token = await loadOutlookRefreshToken(advisorEmail);
  return Boolean(token?.trim());
}
