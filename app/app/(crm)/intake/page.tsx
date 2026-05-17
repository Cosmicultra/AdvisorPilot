import { LegacyEmbed } from "@/components/crm/legacy-embed";
import { TopHeader } from "@/components/crm/top-header";

/**
 * /app/intake — clicking "Intake" on the CRM rail brings the user here.
 *
 * Renders the existing legacy app shell embedded inside the CRM frame.
 * The embedded legacy reads `?clientId=…&step=…` query params and (when
 * present) auto-loads the saved client + jumps to the requested step —
 * used today by the Profile header's "Prep meeting" Link.
 *
 * Marked `dynamic = "force-dynamic"` because the embedded legacy calls
 * useSearchParams(); without this the static prerender bails on missing
 * Suspense boundary.
 *
 * Spec: docs/crm/00-fundamentals.md §8 ("New-client intake — `/app/intake`").
 */

export const dynamic = "force-dynamic";

export default function IntakePage() {
  return (
    <>
      <TopHeader title="Intake" subtitle="New client wizard" />
      <LegacyEmbed />
    </>
  );
}
