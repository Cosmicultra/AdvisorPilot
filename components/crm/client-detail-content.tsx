"use client";

/**
 * Client-side loader for the per-client right pane. Fetches /api/clients/[id]
 * via advisorFetch (handles both NextAuth cookies AND email/password Bearer
 * tokens stored in sessionStorage), then renders the Profile header + tabs
 * + dispatched tab body.
 *
 * Why client-side: email/password users keep their Supabase JWT in browser
 * sessionStorage. A Server Component fetch can't access that, so it would
 * 401 for those users. Phase 1 ships the client-side path; if RSC streaming
 * benefits are needed later we can add a cookie-backed Supabase session as
 * a follow-up.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import { ClientTabs } from "./client-tabs";
import { ProfileHeader } from "./profile-header";
import { OverviewTab } from "./overview/overview-tab";
import { AddTaskDrawer } from "./drawers/add-task-drawer";
import { LogNoteDrawer } from "./drawers/log-note-drawer";
import { ContactsTab } from "./tabs/contacts-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { NotesTab } from "./tabs/notes-tab";
import { TasksTab } from "./tabs/tasks-tab";
import { TimelineTab } from "./tabs/timeline-tab";
import { WorkflowTab } from "./tabs/workflow-tab";
import { EditClientDrawer } from "./drawers/edit-client-drawer";
import type { ClientDetail } from "@/lib/crm/types";

type DrawerState =
  | { kind: "log-note" }
  | { kind: "add-task" }
  | { kind: "edit-client" }
  | null;

/** Tabs still rendered as placeholders. Workflow stays placeholder until
 *  it's repurposed for on-demand AI reruns. Everything else is real. */
const PHASE_2_TABS = new Set<string>([]);

const PHASE_3_TABS = new Set([
  "workflow",
  "intake",
  "upload",
  "confirm",
  "analysis",
  "meeting",
  "fia",
  "roth",
  "ret-income",
  "fee-analysis",
  "report",
]);

const TAB_LABELS: Record<string, string> = {
  overview: "Overview",
  workflow: "Workflow",
  intake: "Intake",
  upload: "Upload",
  confirm: "Confirm holdings",
  analysis: "Analysis",
  meeting: "Meeting guide",
  fia: "FIA calculator",
  roth: "Roth worksheet",
  "ret-income": "Retirement income",
  "fee-analysis": "Fee analysis",
  report: "Report",
  notes: "Notes",
  timeline: "Timeline",
  tasks: "Tasks",
  documents: "Documents",
  contacts: "Contacts",
};

const TAB_TO_LEGACY_STEP: Record<string, string> = {
  workflow: "intake",
  intake: "intake",
  upload: "upload",
  confirm: "confirm",
  analysis: "analysis",
  meeting: "meeting",
  fia: "fia",
  roth: "roth",
  "ret-income": "retIncome",
  "fee-analysis": "feeAnalysis",
  report: "report",
};

type FetchState =
  | { status: "loading" }
  | { status: "ready"; client: ClientDetail }
  | { status: "unauthorized" }
  | { status: "not-found" }
  | { status: "error"; message: string };

export function ClientDetailContent({
  clientId,
  tab,
}: {
  clientId: string;
  tab: string;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openLogNote = useCallback(() => setDrawer({ kind: "log-note" }), []);
  const openAddTask = useCallback(() => setDrawer({ kind: "add-task" }), []);
  const openEditClient = useCallback(() => setDrawer({ kind: "edit-client" }), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch(`/api/clients/${clientId}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (res.status === 404) {
          if (!cancelled) setState({ status: "not-found" });
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load client (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        const client = body?.client as ClientDetail | undefined;
        if (!client) {
          setState({ status: "not-found" });
          return;
        }
        setState({ status: "ready", client });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load client.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (state.status === "loading") {
    return <CenteredMessage tone="info">Loading client…</CenteredMessage>;
  }

  if (state.status === "unauthorized") {
    return (
      <CenteredMessage tone="info">
        <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
          Your session has expired
        </p>
        <p className="mb-3 text-[12px]" style={{ color: "var(--ap-gray)" }}>
          Sign in again to load this client.
        </p>
        <Link
          href="/login"
          className="text-[12.5px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--ap-royal)" }}
        >
          Go to sign in →
        </Link>
      </CenteredMessage>
    );
  }

  if (state.status === "not-found") {
    return (
      <CenteredMessage tone="info">
        <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
          Client not found
        </p>
        <p className="mb-3 text-[12px]" style={{ color: "var(--ap-gray)" }}>
          We couldn't find a client with id <code>{clientId.slice(0, 8)}…</code>
          {" "}that you have access to.
        </p>
        <Link
          href="/app/crm"
          className="text-[12.5px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--ap-royal)" }}
        >
          ← Back to roster
        </Link>
      </CenteredMessage>
    );
  }

  if (state.status === "error") {
    return (
      <CenteredMessage tone="error">
        <p className="text-[13px]" style={{ color: "#9B1C1C" }}>
          {state.message}
        </p>
      </CenteredMessage>
    );
  }

  const client = state.client;
  const clientName = `${client.firstName} ${client.lastName}`.trim() || "this client";

  return (
    <>
      <ProfileHeader
        client={client}
        onLogNote={openLogNote}
        onEditClient={openEditClient}
      />
      <ClientTabs
        clientId={clientId}
        badges={{
          tasks: client.openTaskCount,
          notes: client.recentNoteCount,
        }}
      />
      <TabBody
        tab={tab}
        client={client}
        clientName={clientName}
        refreshKey={refreshKey}
        onLogNote={openLogNote}
        onAddTask={openAddTask}
        onEditClient={openEditClient}
        onMutated={bumpRefresh}
      />

      <LogNoteDrawer
        open={drawer?.kind === "log-note"}
        clientId={clientId}
        clientName={clientName}
        onClose={closeDrawer}
        onSaved={() => bumpRefresh()}
      />
      <AddTaskDrawer
        open={drawer?.kind === "add-task"}
        clientId={clientId}
        clientName={clientName}
        onClose={closeDrawer}
        onSaved={() => bumpRefresh()}
      />
      <EditClientDrawer
        open={drawer?.kind === "edit-client"}
        client={client}
        onClose={closeDrawer}
        onSaved={(updatedClient) => {
          // PATCH returned the refreshed detail — drop it straight into state
          // so the Profile header updates immediately. Bump refreshKey too so
          // dependent cards (Tasks/Pinned Note/Timeline) re-fetch in case
          // counts shifted.
          setState({ status: "ready", client: updatedClient });
          bumpRefresh();
        }}
      />
    </>
  );
}

function TabBody({
  tab,
  client,
  clientName,
  refreshKey,
  onLogNote,
  onAddTask,
  onEditClient,
  onMutated,
}: {
  tab: string;
  client: ClientDetail;
  clientName: string;
  refreshKey: number;
  onLogNote(): void;
  onAddTask(): void;
  onEditClient(): void;
  onMutated(): void;
}) {
  if (tab === "overview") {
    return (
      <OverviewTab
        client={client}
        refreshKey={refreshKey}
        onLogNote={onLogNote}
        onAddTask={onAddTask}
      />
    );
  }

  if (tab === "tasks") {
    return (
      <TasksTab
        clientId={client.id}
        clientName={clientName}
        refreshKey={refreshKey}
        onAddTask={onAddTask}
        onMutated={onMutated}
      />
    );
  }

  if (tab === "notes") {
    return (
      <NotesTab
        clientId={client.id}
        clientName={clientName}
        refreshKey={refreshKey}
        onLogNote={onLogNote}
        onMutated={onMutated}
      />
    );
  }

  if (tab === "timeline") {
    return <TimelineTab clientId={client.id} refreshKey={refreshKey} />;
  }

  if (tab === "documents") {
    return <DocumentsTab clientId={client.id} refreshKey={refreshKey} />;
  }

  if (tab === "contacts") {
    return <ContactsTab client={client} onEditClient={onEditClient} />;
  }

  if (tab === "workflow") {
    return <WorkflowTab client={client} />;
  }

  const label = TAB_LABELS[tab] ?? tab;
  const legacyStep = TAB_TO_LEGACY_STEP[tab];
  const legacyHref = legacyStep
    ? `/app?step=${legacyStep}&clientId=${encodeURIComponent(client.id)}`
    : `/app?clientId=${encodeURIComponent(client.id)}`;

  let phase = "Coming in a later phase";
  if (PHASE_2_TABS.has(tab)) phase = "Coming in Phase 2";
  if (PHASE_3_TABS.has(tab)) phase = "Coming in Phase 3";

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div
        className="w-full max-w-[480px] border bg-white px-7 py-8"
        style={{ borderColor: "var(--ap-border)" }}
      >
        <p
          className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--ap-royal)" }}
        >
          {phase}
        </p>
        <h2
          className="mb-3 font-display text-[22px] font-semibold leading-tight"
          style={{ color: "var(--ap-navy)" }}
        >
          {label}
        </h2>
        <p
          className="mb-5 text-[13px] leading-snug"
          style={{ color: "var(--ap-gray)" }}
        >
          The "{label}" tab is part of the CRM rollout and isn't built yet.
          Use the legacy workflow link below to access this surface today.
        </p>
        <Link
          href={legacyHref}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--ap-royal)" }}
        >
          Open {label} in the legacy workflow →
        </Link>
      </div>
    </div>
  );
}

function CenteredMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "info" | "error";
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div
        className="w-full max-w-[420px] border bg-white px-6 py-7 text-center"
        style={{
          borderColor: tone === "error" ? "#9B1C1C" : "var(--ap-border)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
