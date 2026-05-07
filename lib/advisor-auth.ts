import { getServerSession } from "next-auth";
import { createClient } from "@supabase/supabase-js";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

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
