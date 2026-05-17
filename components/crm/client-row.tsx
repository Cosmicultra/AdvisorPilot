/**
 * Single row in the Roster's left-pane list.
 *
 * Always renders the FULL row (avatar + identity + AUM/stage) by
 * default. The icon-only "collapse to just the avatar" treatment is
 * applied per-context via parent CSS, NOT per-row Tailwind classes,
 * because the same row appears in two viewport contexts with
 * different needs:
 *
 *   1. Sidebar context (CRM layout's left column, visible at md+):
 *        - md → lg: icon-only column (60px wide)  → hide identity + AUM
 *        - lg+:     full labeled column (360px)  → show everything
 *
 *   2. Inline page context (rendered by /app/crm/page.tsx, only
 *      visible at < md when the sidebar is hidden):
 *        - always show everything (advisor needs to know whose row
 *          they're tapping on a phone-width page)
 *
 * Earlier this file used `hidden lg:flex` to gate visibility — that
 * works for the sidebar but breaks the mobile inline page because
 * both contexts see `viewport < lg`. The fix: stable class names
 * here (`roster-row-identity`, `roster-row-meta`), default visible,
 * and a media-query rule in globals.css scoped to the sidebar
 * wrapper (`.ap-roster-sidebar`) that hides them only in the icon
 * column mode.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (the client roster) and
 * docs/crm/20-technical-specs.md §5.2.
 */

import type { ClientRosterItem } from "@/lib/crm/types";
import { stageChipStyle } from "./stage-chip-style";

export type ClientRowProps = {
  item: ClientRosterItem;
  selected: boolean;
  onClick(): void;
};

export function ClientRow({ item, selected, onClick }: ClientRowProps) {
  const subtitle = formatSubtitle(item);
  const aum = formatAumShort(item.aum);
  const stageStyle = item.stage ? stageChipStyle(item.stage) : null;
  const displayName = `${item.firstName} ${item.lastName}`.trim();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      aria-label={displayName}
      title={displayName}
      className="group relative flex w-full items-center gap-3 px-2 py-2.5 text-left transition-colors lg:px-3"
      style={{
        backgroundColor: selected ? "var(--ap-pilot-light)" : "transparent",
        borderBottom: "1px solid var(--ap-border)",
      }}
    >
      {/* 3px royal LEFT accent bar when selected. */}
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ backgroundColor: "var(--ap-royal)" }}
        />
      ) : null}

      {/* Avatar (always visible — the only thing shown in the
          md→lg icon-only column). */}
      <span
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center text-[12px] font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: selected ? "#FFFFFF" : "var(--ap-pilot-light)",
          color: "var(--ap-navy)",
          border: "1px solid var(--ap-border)",
        }}
      >
        {item.initials}
      </span>

      {/* Identity block — name + subtitle + tags. Visible by default;
          hidden only inside `.ap-roster-sidebar` at md→lg via
          globals.css (icon-only column mode). */}
      <span className="roster-row-identity flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-[13px] font-semibold leading-tight"
          style={{ color: "var(--ap-navy)" }}
        >
          {displayName}
        </span>
        <span
          className="truncate text-[11.5px] leading-tight"
          style={{ color: "var(--ap-gray)" }}
        >
          {subtitle}
        </span>
        {item.tags.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1 py-px text-[9.5px] font-medium uppercase tracking-wide"
                style={{
                  backgroundColor: "rgba(15, 111, 222, 0.08)",
                  color: "var(--ap-royal)",
                }}
              >
                {tag}
              </span>
            ))}
            {item.tags.length > 3 ? (
              <span
                className="text-[9.5px] font-medium uppercase tracking-wide"
                style={{ color: "var(--ap-gray)" }}
              >
                +{item.tags.length - 3}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>

      {/* AUM + stage block — visible by default; hidden only inside
          `.ap-roster-sidebar` at md→lg (icon column mode). */}
      <span className="roster-row-meta flex flex-shrink-0 flex-col items-end gap-1">
        {aum ? (
          <span
            className="font-mono text-[11.5px] font-semibold"
            style={{
              color: "var(--ap-navy)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {aum}
          </span>
        ) : null}
        {stageStyle ? (
          <span
            className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={stageStyle}
          >
            {item.stage}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function formatSubtitle(item: ClientRosterItem): string {
  const parts: string[] = [];
  if (item.householdLabel) parts.push(item.householdLabel);
  if (item.accountsCount !== null) {
    parts.push(`${item.accountsCount} ${item.accountsCount === 1 ? "account" : "accounts"}`);
  }
  if (parts.length === 0 && item.lastContactedAt) {
    parts.push(`Last contact ${formatRelativeShort(item.lastContactedAt)}`);
  }
  return parts.join(" · ") || "No saved details yet";
}

function formatAumShort(aum: number | null): string | null {
  if (aum === null || aum <= 0) return null;
  if (aum >= 1_000_000) return `$${(aum / 1_000_000).toFixed(aum >= 10_000_000 ? 0 : 1)}M`;
  if (aum >= 1_000) return `$${Math.round(aum / 1_000)}k`;
  return `$${Math.round(aum)}`;
}

function formatRelativeShort(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
