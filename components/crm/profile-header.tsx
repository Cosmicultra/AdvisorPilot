/**
 * Hero card at the top of the right pane — 56px avatar, household eyebrow,
 * h2 name, meta strip (location · email · phone · owner · client-since),
 * a 4-column KPI strip (Total AUM, YTD return, Accounts, Next meeting),
 * and action buttons.
 *
 * Phase 1 ships the layout + KPIs; the action buttons are present but
 * non-functional placeholders (Log note → Phase 2, Prep meeting → Phase 4).
 *
 * Spec: docs/crm/00-fundamentals.md §2 (the client detail) and
 * docs/crm/20-technical-specs.md §5.3.
 */

import { Calendar, Link2, Mail, MapPin, MoreHorizontal, Phone, User } from "lucide-react";
import Link from "next/link";
import { formatNextMeetingBookingHint } from "@/lib/crm/next-meeting-activity";
import type { ClientDetail } from "@/lib/crm/types";
import { ClientStageSelect } from "./client-stage-select";

export type ProfileHeaderProps = {
  client: ClientDetail;
  /** Opens the LogNoteDrawer. When omitted, the Log note button is disabled. */
  onLogNote?: () => void;
  /** Opens the EditClientDrawer. When omitted, the kebab is disabled. */
  onEditClient?: () => void;
  /** Called after an inline stage change is saved. */
  onClientUpdated?: (client: ClientDetail) => void;
};

export function ProfileHeader({
  client,
  onLogNote,
  onEditClient,
  onClientUpdated,
}: ProfileHeaderProps) {
  const metaItems = buildMetaItems(client);

  return (
    <header
      className="flex flex-col gap-4 px-6 py-5"
      style={{
        backgroundColor: "#FFFFFF",
        borderBottom: "1px solid var(--ap-border)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span
            className="flex h-14 w-14 flex-shrink-0 items-center justify-center text-[16px] font-semibold uppercase"
            style={{
              backgroundColor: "var(--ap-pilot-light)",
              color: "var(--ap-navy)",
              border: "1px solid var(--ap-border)",
            }}
          >
            {client.initials}
          </span>
          <div className="flex flex-col gap-1">
            {client.householdLabel ? (
              <p
                className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: "var(--ap-gray)" }}
              >
                {client.householdLabel}
              </p>
            ) : null}
            <h2
              className="font-display text-[28px] font-semibold leading-tight"
              style={{ color: "var(--ap-navy)" }}
            >
              {client.firstName} {client.lastName}
            </h2>
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]"
              style={{ color: "var(--ap-gray)" }}
            >
              {metaItems.map((item) =>
                item.key === "owner" ? (
                  <span key={item.key} className="flex items-center gap-1">
                    <item.icon size={12} strokeWidth={1.75} />
                    {item.value}
                    {onClientUpdated ? (
                      <ClientStageSelect
                        clientId={client.id}
                        stage={client.stage}
                        onUpdated={onClientUpdated}
                        variant="meta"
                      />
                    ) : null}
                  </span>
                ) : (
                  <span key={item.key} className="flex items-center gap-1">
                    <item.icon size={12} strokeWidth={1.75} />
                    {item.value}
                  </span>
                )
              )}
              {onClientUpdated && !metaItems.some((i) => i.key === "owner") ? (
                <ClientStageSelect
                  clientId={client.id}
                  stage={client.stage}
                  onUpdated={onClientUpdated}
                  variant="meta"
                />
              ) : null}
              {client.client.magicLinkUpload ? (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide"
                  style={{
                    backgroundColor: "rgba(15, 111, 222, 0.08)",
                    color: "var(--ap-royal)",
                  }}
                  title="Intake completed by client via magic-link upload"
                >
                  <Link2 size={10} strokeWidth={2} />
                  Self-uploaded
                </span>
              ) : null}
            </div>
            {client.tags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {client.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide"
                    style={{
                      backgroundColor: "var(--ap-pilot-light)",
                      color: "var(--ap-navy)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onLogNote}
            disabled={!onLogNote}
            title={onLogNote ? "Log a note for this client" : "Coming soon"}
            className="px-3 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
              backgroundColor: "#FFFFFF",
            }}
          >
            Log note
          </button>
          {/* Prep meeting — stopgap: navigates to the legacy intake area
           *  where the advisor can load this client from Saved Clients and
           *  step into the Meeting Guide. Auto-load + deep-link to step
           *  arrives when the Workflow-tab pivot lands (will read clientId
           *  + step query params and drive the legacy state directly). */}
          <Link
            href={`/app/intake?clientId=${encodeURIComponent(client.id)}&step=meeting`}
            title={`Open the legacy app to prep a meeting for ${client.firstName} ${client.lastName}. For now, load the client from Saved Clients then click Meeting in the side rail.`}
            className="px-3 py-1.5 text-[12px] font-medium"
            style={{
              backgroundColor: "var(--ap-royal)",
              color: "#FFFFFF",
            }}
          >
            Prep meeting
          </Link>
          <button
            type="button"
            onClick={onEditClient}
            disabled={!onEditClient}
            title={onEditClient ? "Edit client details" : "Coming soon"}
            aria-label="Edit client details"
            className="flex h-7 w-7 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              border: "1px solid var(--ap-border)",
              color: "var(--ap-navy)",
              backgroundColor: "#FFFFFF",
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
        style={{ borderTop: "1px solid var(--ap-border)", paddingTop: "16px" }}
      >
        <KpiCell label="Total AUM" value={formatAum(client.aum)} />
        <KpiCell label="YTD return" value={formatYtd(client.ytdReturn)} />
        <KpiCell
          label="Accounts"
          value={client.accountsCount !== null ? String(client.accountsCount) : "—"}
        />
        <KpiCell label="Last contacted" value={formatLastContacted(client.lastContactedAt)} />
        <KpiCell
          label="Next meeting"
          value={formatNextMeeting(client.nextMeetingAt)}
          hint={formatNextMeetingBookingHint(
            client.nextMeetingSource,
            client.nextMeetingInitiator,
          )}
        />
      </div>
    </header>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

type MetaItem = {
  key: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  value: string;
};

function buildMetaItems(client: ClientDetail): MetaItem[] {
  const items: MetaItem[] = [];
  if (client.location) {
    items.push({ key: "location", icon: MapPin, value: client.location });
  }
  if (client.email) {
    items.push({ key: "email", icon: Mail, value: client.email });
  }
  if (client.phone) {
    items.push({ key: "phone", icon: Phone, value: client.phone });
  }
  if (client.ownerInitials || client.ownerEmail) {
    items.push({
      key: "owner",
      icon: User,
      value: client.ownerInitials ?? client.ownerEmail.split("@")[0],
    });
  }
  if (client.inceptionYear) {
    items.push({
      key: "inception",
      icon: Calendar,
      value: `Client since ${client.inceptionYear}`,
    });
  }
  return items;
}

function formatAum(aum: number | null): string {
  if (aum === null || aum <= 0) return "—";
  if (aum >= 1_000_000) {
    return `$${(aum / 1_000_000).toFixed(aum >= 10_000_000 ? 1 : 2)}M`;
  }
  if (aum >= 1_000) {
    return `$${Math.round(aum / 1_000)}k`;
  }
  return `$${aum.toFixed(0)}`;
}

function formatYtd(ytd: number | null): string {
  if (ytd === null) return "—";
  const pct = ytd * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatNextMeeting(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const date = new Date(ts);
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatLastContacted(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const date = new Date(ts);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function KpiCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--ap-gray)" }}
      >
        {label}
      </span>
      <span
        className="font-display text-[22px] font-semibold leading-tight"
        style={{
          color: "var(--ap-navy)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-[10.5px] leading-snug" style={{ color: "var(--ap-gray)" }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
