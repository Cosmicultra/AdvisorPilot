/**
 * Tiny placeholder for Overview cards whose content lands in a later phase.
 * Renders inside an OverviewCard with the same chrome as real cards so the
 * layout stays consistent.
 */

import { OverviewCard } from "./overview-card";

export function PlaceholderCard({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <OverviewCard title={title}>
      <p
        className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--ap-royal)" }}
      >
        {phase}
      </p>
      <p
        className="text-[12.5px] leading-snug"
        style={{ color: "var(--ap-gray)" }}
      >
        {description}
      </p>
    </OverviewCard>
  );
}
