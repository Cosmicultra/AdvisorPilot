import { redirect } from "next/navigation";

/**
 * /app/settings (and /app/settings/[section]) redirects to the Roster.
 *
 * Settings used to live on a dedicated page; they're now centralized in
 * the OnboardingDialog reachable from the rail's Settings item or the
 * avatar dropdown's "Profile & signature" item. This catch-all route
 * exists only so old bookmarks don't 404.
 */
export default async function SettingsRedirect() {
  redirect("/app/crm");
}
