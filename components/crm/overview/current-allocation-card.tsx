/**
 * Current allocation — stacked bar showing the distribution of the client's
 * holdings across equity / fixed / cash / alternative sleeves. Matches step
 * 04 Analysis donut colors and bucketing.
 */

import { buildSleeveAllocationSummary } from "@/lib/allocation-display";
import type { ClientDetail } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

export function CurrentAllocationCard({ client }: { client: ClientDetail }) {
  const summary = buildSleeveAllocationSummary(client.holdings);

  if (summary.buckets.length === 0 || summary.totalValue <= 0) {
    return (
      <OverviewCard title="Current allocation">
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          No holdings to chart yet. Upload a statement and confirm holdings to
          see this client&apos;s allocation.
        </p>
      </OverviewCard>
    );
  }

  return (
    <OverviewCard title="Current allocation">
      <div className="flex flex-col gap-3">
        <div
          className="flex h-3 w-full overflow-hidden"
          style={{ border: "1px solid var(--ap-border)" }}
          aria-label="Allocation bar"
        >
          {summary.buckets.map((bucket) => (
            <div
              key={bucket.name}
              className="h-full"
              title={`${bucket.name}: ${bucket.weightPct.toFixed(1)}%`}
              style={{
                width: `${bucket.weightPct}%`,
                backgroundColor: bucket.color,
              }}
            />
          ))}
        </div>

        <ul className="flex flex-col gap-1.5">
          {summary.buckets.map((bucket) => (
            <li
              key={bucket.name}
              className="flex items-center justify-between text-[12px]"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5"
                  style={{ backgroundColor: bucket.color }}
                />
                <span style={{ color: "var(--ap-navy)" }}>{bucket.name}</span>
              </span>
              <span
                className="font-mono"
                style={{
                  color: "var(--ap-gray)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {bucket.weightPct.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </OverviewCard>
  );
}
