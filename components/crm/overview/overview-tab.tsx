"use client";

/**
 * Overview tab body — fetches a single overview bundle, then renders cards.
 */

import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { ActivityEntry, ClientDetail, Note, Task } from "@/lib/crm/types";
import { CurrentAllocationCard } from "./current-allocation-card";
import { AccountsCard } from "./accounts-card";
import { ContactsCard } from "./contacts-card";
import { ProfileFactsCard } from "./profile-facts-card";
import { TimelineCard } from "./timeline-card";
import { TasksCard } from "./tasks-card";
import { PinnedNoteCard } from "./pinned-note-card";

export type OverviewTabProps = {
  client: ClientDetail;
  refreshKey: number;
  onLogNote(): void;
  onAddTask(): void;
  onClientUpdated?(client: ClientDetail): void;
};

type BundleState =
  | { status: "loading" }
  | {
      status: "ready";
      activity: ActivityEntry[];
      openTasks: Task[];
      pinnedNote: Note | null;
    }
  | { status: "error" };

export function OverviewTab({
  client,
  refreshKey,
  onLogNote,
  onAddTask,
}: OverviewTabProps) {
  const [bundle, setBundle] = useState<BundleState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setBundle({ status: "loading" });
    advisorFetch(`/api/clients/${client.id}/overview`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load overview (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setBundle({
          status: "ready",
          activity: (body?.activity ?? []) as ActivityEntry[],
          openTasks: (body?.openTasks ?? []) as Task[],
          pinnedNote: (body?.pinnedNote ?? null) as Note | null,
        });
      })
      .catch(() => {
        if (!cancelled) setBundle({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [client.id, refreshKey]);

  const bundleReady = bundle.status === "ready" ? bundle : null;

  return (
    <div className="grid grid-cols-1 gap-4 px-6 py-5 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <CurrentAllocationCard client={client} />
        <AccountsCard client={client} />
        <TimelineCard
          clientId={client.id}
          prefetchedActivity={bundleReady?.activity}
          bundleLoading={bundle.status === "loading"}
        />
      </div>
      <div className="flex flex-col gap-4">
        <ProfileFactsCard client={client} />
        <TasksCard
          clientId={client.id}
          refreshKey={refreshKey}
          onAddTask={onAddTask}
          prefetchedTasks={bundleReady?.openTasks}
          bundleLoading={bundle.status === "loading"}
        />
        <PinnedNoteCard
          clientId={client.id}
          refreshKey={refreshKey}
          onLogNote={onLogNote}
          prefetchedNote={bundleReady?.pinnedNote}
          bundleLoading={bundle.status === "loading"}
        />
        <ContactsCard client={client} />
      </div>
    </div>
  );
}
