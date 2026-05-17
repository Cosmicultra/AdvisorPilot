import { getServerSession } from "next-auth";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

// Service-role client — LAZILY initialized so module import doesn't crash
// when env vars are missing (the Supabase JS SDK now validates URL up-front,
// which used to silently no-op on empty strings). Same pattern as
// lib/crm/supabase-admin.ts and lib/crm/ensure-personal-org.ts.
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabaseAdmin = createClient(url, key);
  return _supabaseAdmin;
}

export type AdvisorIdentity = {
  email: string;
  userId: string | null;
  provider: "google" | "supabase";
};

/**
 * Resolve the signed-in advisor: NextAuth (Google) session or Supabase JWT (email/password).
 *
 * Google/NextAuth users do not have a Supabase auth user id unless separately
 * linked, so server routes must enforce ownership by normalized email for that
 * path. Supabase email/password users also include `userId` for RLS/storage.
 */
export async function resolveAdvisorIdentity(request: Request): Promise<AdvisorIdentity | null> {
  const session = await getServerSession(authOptions);
  const googleEmail = session?.user?.email?.trim().toLowerCase();
  if (googleEmail) {
    return {
      email: googleEmail,
      userId: null,
      provider: "google",
    };
  }

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const jwt = auth.slice(7).trim();
    if (!jwt) return null;
    const supabaseAdmin = getSupabaseAdmin();
    // When Supabase env is missing we silently fail closed — same outcome
    // as an invalid JWT (the route handler returns 401). Better than
    // throwing and breaking the whole request.
    if (!supabaseAdmin) return null;
    const { data, error } = await supabaseAdmin.auth.getUser(jwt);
    if (error || !data.user?.email) return null;
    return {
      email: data.user.email.trim().toLowerCase(),
      userId: data.user.id,
      provider: "supabase",
    };
  }

  return null;
}

export async function resolveAdvisorOwnerEmail(request: Request): Promise<string | null> {
  return (await resolveAdvisorIdentity(request))?.email ?? null;
}
