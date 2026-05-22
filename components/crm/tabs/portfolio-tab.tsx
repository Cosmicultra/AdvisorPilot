"use client";

/**
 * Portfolio tab â€” current + proposed allocation donuts + accounts list.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  buildInteractiveSleeveAllocation,
  buildProposedAllocationDonutSleeves,
  buildSleeveAllocationSummary,
  riskProfileDisplayLabel,
} from "@/lib/allocation-display";
import type { ClientDetail } from "@/lib/crm/types";
import {
  AllocationDonutChart,
  AllocationSleeveLegend,
  StaticAllocationDonutChart,
} from "@/components/crm/allocation-donut-chart";
import { AccountsCard } from "@/components/crm/overview/accounts-card";
import { OverviewCard } from "@/components/crm/overview/overview-card";

export function PortfolioTab({
  client,
  onClientUpdated,
}: {
  client: ClientDetail;
  onClientUpdated?: (client: ClientDetail) => void;
}) {
  const [activeSleeveKey, setActiveSleeveKey] = useState<string | null>(null);

  const sleeves = useMemo(
    () => buildInteractiveSleeveAllocation(client.holdings),
    [client.holdings]
  );
  const proposedSleeves = useMemo(
    () => buildProposedAllocationDonutSleeves(client.client),
    [client.client]
  );
  const summary = useMemo(
    () => buildSleeveAllocationSummary(client.holdings),
    [client.holdings]
  );

  const currentSubtitle =
    summary.totalValue > 0
      ? `Based on confirmed holdings Â· ${formatTotalAum(summary.totalValue)}`
      : undefined;

  const proposedSubtitle = `Calibration mix for discussion Â· ${riskProfileDisplayLabel(
    client.client.riskProfile || "moderate-conservative"
  )}`;

  const toggleSleeve = (key: string) => {
    setActiveSleeveKey((prev) => (prev === key ? null : key));
  };

  const showAllocationPair = sleeves.length > 0 || proposedSleeves.length > 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-5">
      {showAllocationPair ? (
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
          <AllocationColumn>
            <OverviewCard title="Current allocation" eyebrow="Portfolio" className="h-full flex-1">
              {sleeves.length > 0 ? (
                <AllocationDonutChart
                  sleeves={sleeves}
                  subtitle={currentSubtitle}
                  activeSleeveKey={activeSleeveKey}
                  onSleeveSelect={setActiveSleeveKey}
                />
              ) : (
                <AllocationEmptyState>
                  No holdings to chart yet. Upload a statement and confirm holdings to see
                  this client&apos;s allocation.
                </AllocationEmptyState>
              )}
            </OverviewCard>
            {sleeves.length > 0 ? (
              <AllocationSleeveLegend
                sleeves={sleeves}
                activeSleeveKey={activeSleeveKey}
                onSelectSleeve={toggleSleeve}
              />
            ) : (
              <LegendPlaceholder />
            )}
          </AllocationColumn>

          <AllocationColumn>
            <OverviewCard title="Proposed allocation" eyebrow="Portfolio" className="h-full flex-1">
              {proposedSleeves.length > 0 ? (
                <StaticAllocationDonutChart
                  sleeves={proposedSleeves}
                  subtitle={proposedSubtitle}
                />
              ) : (
                <AllocationEmptyState>
                  Set age and risk profile on the client record to show the proposed mix.
                </AllocationEmptyState>
              )}
            </OverviewCard>
            {proposedSleeves.length > 0 ? (
              <AllocationSleeveLegend sleeves={proposedSleeves} showPercent />
            ) : (
              <LegendPlaceholder />
            )}
          </AllocationColumn>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
          <OverviewCard title="Current allocation" eyebrow="Portfolio" className="h-full">
            <AllocationEmptyState>
              No holdings to chart yet. Upload a statement and confirm holdings to see
              this client&apos;s allocation.
            </AllocationEmptyState>
          </OverviewCard>
          <OverviewCard title="Proposed allocation" eyebrow="Portfolio" className="h-full">
            <AllocationEmptyState>
              Set age and risk profile on the client record to show the proposed mix.
            </AllocationEmptyState>
          </OverviewCard>
        </div>
      )}

      <AccountsCard
        client={client}
        enableMoveAccount
        onClientUpdated={onClientUpdated}
      />
    </div>
  );
}

function AllocationColumn({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col gap-4">{children}</div>;
}

function AllocationEmptyState({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex min-h-[380px] items-center justify-center text-center text-[12.5px]"
      style={{ color: "var(--ap-gray)" }}
    >
      {children}
    </p>
  );
}

function LegendPlaceholder() {
  return (
    <div
      className="min-h-[52px] border border-transparent px-4 py-3"
      aria-hidden
    />
  );
}

function formatTotalAum(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "â€”";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

