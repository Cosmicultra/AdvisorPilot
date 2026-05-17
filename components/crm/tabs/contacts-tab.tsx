"use client";

/**
 * Per-client Contacts tab. Mounted at /app/crm/[id]/contacts.
 *
 * The intake captures the primary client (always) and the spouse (when
 * `client.married === true`). Email/phone/location are stored as top-level
 * CRM columns on advisorpilot_clients (set via the Edit Client drawer);
 * intake doesn't capture phone or location, so those rows show "Not on
 * file" placeholders + an inline Add prompt to drive users to the Edit
 * drawer.
 *
 * Spec: docs/crm/00-fundamentals.md §4 (Contacts tab) and
 * docs/crm/20-technical-specs.md §5.3.
 */

import { Pencil, UserPlus } from "lucide-react";
import type { ClientDetail } from "@/lib/crm/types";

interface FactRow {
  label: string;
  value: string | null;
  /** Tooltip / hint text rendered under the value (or instead of "Add" when missing). */
  emptyHint?: string;
}

interface ContactInfo {
  id: "primary" | "spouse";
  name: string;
  relationship: string;
  badge?: string;
  /** Contact-method rows (email/phone/location) — always rendered even when null. */
  contactFacts: FactRow[];
  /** Other facts (DOB, age, retirement, SS). */
  detailFacts: FactRow[];
}

export type ContactsTabProps = {
  client: ClientDetail;
  /** Opens the EditClientDrawer. When provided, an Edit button appears on
   *  cards whose details can be updated via that drawer (primary only — the
   *  drawer doesn't model spouse contact info yet). */
  onEditClient?: () => void;
};

export function ContactsTab({ client, onEditClient }: ContactsTabProps) {
  const contacts = buildContacts(client);

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-[12px] uppercase tracking-wide"
          style={{ color: "var(--ap-gray)" }}
        >
          {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
        </p>
        <span
          className="text-[11px]"
          style={{ color: "var(--ap-gray)" }}
        >
          Primary contact info edits live on the Profile header
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {contacts.map((contact) => (
          <ContactCard
            key={contact.id}
            contact={contact}
            onEdit={contact.id === "primary" ? onEditClient : undefined}
          />
        ))}
      </div>

      <FutureNudge />
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────

function ContactCard({
  contact,
  onEdit,
}: {
  contact: ContactInfo;
  onEdit?: () => void;
}) {
  return (
    <article
      className="flex flex-col gap-3 bg-white px-4 py-4"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <header className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-[12px] font-semibold uppercase"
          style={{
            backgroundColor: "var(--ap-pilot-light)",
            color: "var(--ap-navy)",
            border: "1px solid var(--ap-border)",
          }}
        >
          {deriveInitials(contact.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--ap-gray)" }}
          >
            {contact.relationship}
          </p>
          <h3
            className="font-display text-[16px] font-semibold leading-tight"
            style={{ color: "var(--ap-navy)" }}
          >
            {contact.name}
          </h3>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          {contact.badge ? (
            <span
              className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              style={{
                backgroundColor: "rgba(12, 25, 41, 0.04)",
                color: "var(--ap-gray)",
              }}
            >
              {contact.badge}
            </span>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium"
              style={{
                border: "1px solid var(--ap-border)",
                backgroundColor: "#FFFFFF",
                color: "var(--ap-navy)",
              }}
            >
              <Pencil size={11} strokeWidth={1.75} />
              Edit
            </button>
          ) : null}
        </div>
      </header>

      {contact.contactFacts.length > 0 ? (
        <FactList facts={contact.contactFacts} onEdit={onEdit} />
      ) : null}

      {contact.detailFacts.length > 0 ? (
        <FactList facts={contact.detailFacts} />
      ) : null}
    </article>
  );
}

function FactList({
  facts,
  onEdit,
}: {
  facts: FactRow[];
  /** When provided, missing fact rows render an "Add" inline link that
   *  triggers the edit drawer. */
  onEdit?: () => void;
}) {
  return (
    <dl className="grid grid-cols-1 gap-y-2">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex items-baseline justify-between gap-3 text-[12px]"
        >
          <dt
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--ap-gray)" }}
          >
            {fact.label}
          </dt>
          <dd
            className="flex flex-col items-end text-right"
            style={{ color: "var(--ap-navy)" }}
          >
            {fact.value ? (
              <span className="break-all">{fact.value}</span>
            ) : onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="text-[11.5px] font-medium underline-offset-2 hover:underline"
                style={{ color: "var(--ap-royal)" }}
              >
                + Add {fact.label.toLowerCase()}
              </button>
            ) : (
              <span
                className="text-[11.5px]"
                style={{ color: "var(--ap-gray)" }}
              >
                Not on file
              </span>
            )}
            {fact.emptyHint && !fact.value ? (
              <span className="text-[10.5px]" style={{ color: "var(--ap-gray)" }}>
                {fact.emptyHint}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FutureNudge() {
  return (
    <div
      className="flex items-start gap-3 bg-white px-4 py-4"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <span
        className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center"
        style={{
          backgroundColor: "rgba(15, 111, 222, 0.08)",
          color: "var(--ap-royal)",
        }}
      >
        <UserPlus size={16} strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <p
          className="text-[13px] font-semibold"
          style={{ color: "var(--ap-navy)" }}
        >
          Add children, attorney, CPA
        </p>
        <p
          className="text-[12px] leading-snug"
          style={{ color: "var(--ap-gray)" }}
        >
          Today the intake captures the primary client + spouse only. A future
          phase adds a `client.contacts[]` JSONB array with full add/edit so
          you can attach kids, advisors of record, and trusted contacts here.
        </p>
      </div>
    </div>
  );
}

// ─── Builders ─────────────────────────────────────────────────────────────

function buildContacts(client: ClientDetail): ContactInfo[] {
  const intake = client.client;
  const contacts: ContactInfo[] = [];

  // Primary client — always present.
  const primaryName = `${intake.firstName} ${intake.lastName}`.trim() || "Primary client";
  contacts.push({
    id: "primary",
    name: primaryName,
    relationship: "Primary client",
    badge: "Primary",
    contactFacts: buildPrimaryContactFacts(client),
    detailFacts: buildPrimaryDetailFacts(client),
  });

  // Spouse — when married + name is set.
  if (intake.married) {
    const spouseName = `${intake.spouseFirstName ?? ""} ${intake.spouseLastName ?? ""}`.trim() || "Spouse";
    contacts.push({
      id: "spouse",
      name: spouseName,
      relationship: "Spouse",
      contactFacts: [], // Schema doesn't yet model per-spouse email/phone.
      detailFacts: buildSpouseDetailFacts(client),
    });
  }

  return contacts;
}

function buildPrimaryContactFacts(client: ClientDetail): FactRow[] {
  // Always render Email / Phone / Location rows so the user sees that the
  // fields exist; nulls render as an "+ Add" prompt that opens the editor.
  return [
    { label: "Email", value: client.email },
    { label: "Phone", value: client.phone },
    { label: "Location", value: client.location },
  ];
}

function buildPrimaryDetailFacts(client: ClientDetail): FactRow[] {
  const intake = client.client;
  const facts: FactRow[] = [];
  if (intake.dob) facts.push({ label: "DOB", value: formatDate(intake.dob) });
  if (intake.age) facts.push({ label: "Age", value: intake.age });
  if (intake.retirementAge) {
    facts.push({ label: "Retirement age", value: intake.retirementAge });
  }
  if (intake.takingSocialSecurity && intake.socialSecurityMonthlyClient) {
    facts.push({
      label: "SS (monthly)",
      value: formatCurrencyFromString(intake.socialSecurityMonthlyClient),
    });
  }
  return facts;
}

function buildSpouseDetailFacts(client: ClientDetail): FactRow[] {
  const intake = client.client;
  const facts: FactRow[] = [];
  if (intake.spouseDob) facts.push({ label: "DOB", value: formatDate(intake.spouseDob) });
  if (intake.spouseAge) facts.push({ label: "Age", value: intake.spouseAge });
  if (intake.spouseRetirementAge) {
    facts.push({ label: "Retirement age", value: intake.spouseRetirementAge });
  }
  if (intake.takingSocialSecurity && intake.socialSecurityMonthlySpouse) {
    facts.push({
      label: "SS (monthly)",
      value: formatCurrencyFromString(intake.socialSecurityMonthlySpouse),
    });
  }
  return facts;
}

function deriveInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]?.charAt(0) ?? ""}${parts[parts.length - 1]?.charAt(0) ?? ""}`.toUpperCase();
  }
  return parts[0]?.slice(0, 2).toUpperCase() || "?";
}

function formatDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCurrencyFromString(raw: string): string {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return raw;
  return `$${n.toLocaleString("en-US")}`;
}
