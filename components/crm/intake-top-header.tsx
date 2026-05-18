"use client";

/**
 * Dynamic top header for /app/intake — "AdvisorPilot" with a subtitle of
 * "New Client" or the loaded client's display name when ?clientId= is set.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TopHeader } from "@/components/crm/top-header";
import { TopHeaderDefaultActions } from "@/components/crm/top-header-default-actions";
import { advisorFetch } from "@/lib/advisor-fetch";
import { clientDisplayName, type IntakeClient } from "@/lib/intake-config";

function rosterName(firstName?: string, lastName?: string): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim();
}

/** Matches logo wordmark: navy “Advisor”, royal “Pilot”. */
function AdvisorPilotBrandTitle() {
  return (
    <>
      <span style={{ color: "var(--ap-navy)" }}>Advisor</span>
      <span style={{ color: "var(--ap-royal)" }}>Pilot</span>
    </>
  );
}

export function IntakeTopHeaderFallback() {
  return (
    <TopHeader
      title={<AdvisorPilotBrandTitle />}
      subtitle="New Client"
      rightActions={<TopHeaderDefaultActions />}
    />
  );
}

export function IntakeTopHeader() {
  const searchParams = useSearchParams();
  const clientId = searchParams?.get("clientId") ?? null;
  const [subtitle, setSubtitle] = useState("New Client");

  useEffect(() => {
    if (!clientId) {
      setSubtitle("New Client");
      return;
    }

    let cancelled = false;
    advisorFetch(`/api/clients/${clientId}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        const row = body?.client as
          | { firstName?: string; lastName?: string; client?: Partial<IntakeClient> }
          | undefined;
        if (!row) {
          setSubtitle("New Client");
          return;
        }
        const name =
          clientDisplayName(row.client ?? {}) || rosterName(row.firstName, row.lastName);
        setSubtitle(name || "New Client");
      })
      .catch(() => {
        if (!cancelled) setSubtitle("New Client");
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <TopHeader
      title={<AdvisorPilotBrandTitle />}
      subtitle={subtitle}
      rightActions={<TopHeaderDefaultActions />}
    />
  );
}
