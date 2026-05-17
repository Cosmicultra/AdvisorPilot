/**
 * Contacts summary card on the Overview tab — condensed glance of the
 * primary client + spouse (when married). Full per-person facts live in
 * the dedicated Contacts tab; this card links there via a "View all" CTA.
 *
 * Derived entirely from the IntakeClient JSONB on `client.client`. No API
 * call needed.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body, right column).
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ClientDetail } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

interface ContactRow {
  id: string;
  name: string;
  role: "Primary" | "Spouse";
  facts: string[];
}

export type ContactsCardProps = {
  client: ClientDetail;
};

export function ContactsCard({ client }: ContactsCardProps) {
  const contacts = buildContacts(client);

  return (
    <OverviewCard
      title="Contacts"
      rightSlot={
        <Link
          href={`/app/crm/${client.id}/contacts`}
          className="flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium"
          style={{
            border: "1px solid var(--ap-border)",
            backgroundColor: "#FFFFFF",
            color: "var(--ap-navy)",
          }}
        >
          View all
          <ArrowRight size={11} strokeWidth={1.75} />
        </Link>
      }
    >
      {contacts.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-3">
          {contacts.map((contact) => (
            <ContactSummaryRow key={contact.id} contact={contact} />
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}

function ContactSummaryRow({ contact }: { contact: ContactRow }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-[11px] font-semibold uppercase"
        style={{
          backgroundColor: "var(--ap-pilot-light)",
          color: "var(--ap-navy)",
          border: "1px solid var(--ap-border)",
        }}
      >
        {deriveInitials(contact.name)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <p
            className="truncate text-[13px] font-medium"
            style={{ color: "var(--ap-navy)" }}
          >
            {contact.name}
          </p>
          <span
            className="flex-shrink-0 px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: "rgba(12, 25, 41, 0.04)",
              color: "var(--ap-gray)",
            }}
          >
            {contact.role}
          </span>
        </div>
        {contact.facts.length > 0 ? (
          <p
            className="truncate text-[11.5px]"
            style={{ color: "var(--ap-gray)" }}
          >
            {contact.facts.join(" · ")}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
        No related contacts on file. The Contacts tab surfaces the primary
        client + spouse (and future advisors-of-record from a Phase 7
        `client.contacts[]` array).
      </p>
    </div>
  );
}

// ─── Builder ──────────────────────────────────────────────────────────────

function buildContacts(client: ClientDetail): ContactRow[] {
  const intake = client.client;
  const contacts: ContactRow[] = [];

  // Primary client
  const primaryName = `${intake.firstName} ${intake.lastName}`.trim();
  if (primaryName) {
    const facts: string[] = [];
    if (client.email) facts.push(client.email);
    else if (client.phone) facts.push(client.phone);
    else if (intake.age) facts.push(`age ${intake.age}`);
    contacts.push({
      id: "primary",
      name: primaryName,
      role: "Primary",
      facts,
    });
  }

  // Spouse (when married + name set)
  if (intake.married) {
    const spouseName = `${intake.spouseFirstName ?? ""} ${intake.spouseLastName ?? ""}`.trim();
    if (spouseName) {
      const facts: string[] = [];
      if (intake.spouseAge) facts.push(`age ${intake.spouseAge}`);
      if (intake.spouseRetirementAge) {
        facts.push(`retires at ${intake.spouseRetirementAge}`);
      }
      contacts.push({
        id: "spouse",
        name: spouseName,
        role: "Spouse",
        facts,
      });
    }
  }

  return contacts;
}

function deriveInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[parts.length - 1]?.charAt(0) ?? ""}`.toUpperCase();
  }
  return parts[0]?.slice(0, 2).toUpperCase() || "?";
}
