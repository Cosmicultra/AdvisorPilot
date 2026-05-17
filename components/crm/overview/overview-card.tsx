/**
 * Shared card chrome for every Overview-tab card. Matches the design
 * language: white bg, sharp corners, hairline border, small uppercase
 * eyebrow + h3 title, no shadow.
 *
 * Spec: docs/crm/00-fundamentals.md §6 (surface rules).
 */

import type { ReactNode } from "react";

export type OverviewCardProps = {
  title: string;
  eyebrow?: string;
  rightSlot?: ReactNode;
  children: ReactNode;
};

export function OverviewCard({
  title,
  eyebrow,
  rightSlot,
  children,
}: OverviewCardProps) {
  return (
    <article
      className="flex flex-col"
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid var(--ap-border)",
      }}
    >
      <header
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--ap-border)" }}
      >
        <div className="flex flex-col gap-0.5">
          {eyebrow ? (
            <span
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
              style={{ color: "var(--ap-gray)" }}
            >
              {eyebrow}
            </span>
          ) : null}
          <h3
            className="font-display text-[15px] font-semibold leading-tight"
            style={{ color: "var(--ap-navy)" }}
          >
            {title}
          </h3>
        </div>
        {rightSlot ? (
          <div className="flex flex-shrink-0 items-center gap-2">{rightSlot}</div>
        ) : null}
      </header>
      <div className="flex-1 px-4 py-4">{children}</div>
    </article>
  );
}
