import { getServerSession } from "next-auth";
import { createClient } from "@supabase/supabase-js";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

/**
 * Resolve the signed-in advisor email: NextAuth (Google) session or Supabase JWT (email/password).
 */
export async function resolveAdvisorOwnerEmail(request: Request): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const googleEmail = session?.user?.email?.trim().toLowerCase();
  if (googleEmail) return googleEmail;

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const jwt = auth.slice(7).trim();
    if (!jwt) return null;
    const { data, error } = await supabaseAdmin.auth.getUser(jwt);
    if (error || !data.user?.email) return null;
    return data.user.email.trim().toLowerCase();
  }

  return null;
}
