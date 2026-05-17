/**
 * Current allocation — stacked bar showing the distribution of the client's
 * holdings across asset classes. Reuses lib/voice/page-helpers's
 * buildAllocationSummary so the bucketing matches what the analysis flow
 * + voice agent see.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body).
 */

import { buildAllocationSummary } from "@/lib/voice/page-helpers";
import type { ClientDetail } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

const BUCKET_COLORS: Record<string, string> = {
  Equity: "var(--ap-royal)",
  Fixed: "#0F4C81",
  Cash: "#7EB3E8",
  Annuity: "#B65BE3",
  "Real Estate": "#E89B5B",
  Commodities: "#E8C25B",
  "Mutual Fund": "#5BB3E8",
  ETF: "#3E8CC4",
  Other: "rgba(12, 25, 41, 0.18)",
};

function colorFor(bucket: string): string {
  return BUCKET_COLORS[bucket] ?? BUCKET_COLORS.Other;
}

export function CurrentAllocationCard({ client }: { client: ClientDetail }) {
  const summary = buildAllocationSummary({
    id: client.id,
    client: client.client,
    holdings: client.holdings,
  });

  if (summary.buckets.length === 0 || summary.totalValue <= 0) {
    return (
      <OverviewCard title="Current allocation">
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          No holdings to chart yet. Upload a statement and confirm holdings to
          see this client's allocation.
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
                backgroundColor: colorFor(bucket.name),
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
                  style={{ backgroundColor: colorFor(bucket.name) }}
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
