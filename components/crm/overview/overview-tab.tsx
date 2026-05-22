/**
 * Overview tab body — two-column grid:
 *
 *   ┌──────────────────────────┬─────────────────────────┐
 *   │  Current allocation      │  Profile facts          │
 *   │  Accounts                │  Open tasks             │
 *   │  Recent activity         │  Pinned note            │
 *   │                          │  Contacts (placeholder) │
 *   └──────────────────────────┴─────────────────────────┘
 *
 * Phase 2: Tasks card + Pinned Note card become real (replaced from Phase 1
 * placeholders); Contacts stays as a placeholder until v1.5/Phase 7.
 *
 * Drawer state lives in the parent <ClientDetailContent />; the cards
 * receive `onLogNote` / `onAddTask` callbacks so any action button in the
 * Overview opens the right drawer.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body).
 */

import type { ClientDetail } from "@/lib/crm/types";
import { CurrentAllocationCard } from "./current-allocation-card";
import { AccountsCard } from "./accounts-card";
import { ContactsCard } from "./contacts-card";
import { ProfileFactsCard } from "./profile-facts-card";
import { TimelineCard } from "./timeline-card";
import { TasksCard } from "./tasks-card";
import { PinnedNoteCard } from "./pinned-note-card";

export type OverviewTabProps = {
  client: ClientDetail;
  /** Bumped by the parent after a drawer save so tasks/notes cards re-fetch. */
  refreshKey: number;
  onLogNote(): void;
  onAddTask(): void;
  onClientUpdated?(client: ClientDetail): void;
};

export function OverviewTab({
  client,
  refreshKey,
  onLogNote,
  onAddTask,
  onClientUpdated,
}: OverviewTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 px-6 py-5 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <CurrentAllocationCard client={client} />
        <AccountsCard client={client} />
        <TimelineCard clientId={client.id} />
      </div>
      <div className="flex flex-col gap-4">
        <ProfileFactsCard client={client} />
        <TasksCard
          clientId={client.id}
          refreshKey={refreshKey}
          onAddTask={onAddTask}
        />
        <PinnedNoteCard
          clientId={client.id}
          refreshKey={refreshKey}
          onLogNote={onLogNote}
        />
        <ContactsCard client={client} />
      </div>
    </div>
  );
}
