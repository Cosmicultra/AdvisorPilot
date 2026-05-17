import { notFound } from "next/navigation";
import { ClientDetailContent } from "@/components/crm/client-detail-content";

/**
 * /app/crm/[clientId]/[tab]
 *
 * Thin server component — validates the clientId is a UUID, then hands off
 * to the <ClientDetailContent /> client component which fetches the client
 * detail via advisorFetch (Bearer-aware for email/password users) and
 * dispatches based on the tab.
 *
 * Why client-side fetch instead of RSC: email/password users keep their
 * Supabase JWT in browser sessionStorage. A Server Component fetch can't
 * see that, so it would 401 for those users.
 */

export default async function ClientTabPage(props: {
  params: Promise<{ clientId: string; tab: string }>;
}) {
  const { clientId, tab } = await props.params;

  if (!isUuid(clientId)) {
    notFound();
  }

  return <ClientDetailContent clientId={clientId} tab={tab} />;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}
