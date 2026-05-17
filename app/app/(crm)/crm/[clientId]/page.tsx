import { redirect } from "next/navigation";

/**
 * Bare /app/crm/[clientId] redirects to the Overview tab. Phase 1 builds
 * the actual client-detail tabs; until then this exists so links shared
 * during testing don't 404.
 */
export default async function ClientDetailRedirectPage(props: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await props.params;
  redirect(`/app/crm/${clientId}/overview`);
}
