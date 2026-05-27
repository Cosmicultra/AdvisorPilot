"use client";

/**
 * Recent-activity rail — fetches /api/activity?clientId=... on mount and
 * renders the 6 most recent entries. Each entry shows type + title + actor
 * + relative timestamp.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body).
 */

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Droplets,
  FileText,
  Mail,
  PhoneCall,
  StickyNote,
  Wand2,
} from "lucide-react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { ActivityEntry, ActivityType } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

const RECENT_LIMIT = 6;

type FetchState =
  | { status: "loading" }
  | { status: "ready"; entries: ActivityEntry[] }
  | { status: "error"; message: string };

export function TimelineCard({
  clientId,
  prefetchedActivity,
  bundleLoading = false,
}: {
  clientId: string;
  prefetchedActivity?: ActivityEntry[];
  bundleLoading?: boolean;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (prefetchedActivity !== undefined) {
      setState({ status: "ready", entries: prefetchedActivity });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch(
      `/api/activity?clientId=${encodeURIComponent(clientId)}&limit=${RECENT_LIMIT}`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load activity (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setState({
          status: "ready",
          entries: (body?.entries ?? []) as ActivityEntry[],
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load activity.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, prefetchedActivity]);

  if (bundleLoading && prefetchedActivity === undefined) {
    return (
      <OverviewCard title="Recent activity">
        <p className="text-[12px] text-slate-500">Loading…</p>
      </OverviewCard>
    );
  }

  return (
    <OverviewCard title="Recent activity">
      {state.status === "loading" ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          Loading…
        </p>
      ) : state.status === "error" ? (
        <p className="text-[12.5px]" style={{ color: "#9B1C1C" }}>
          {state.message}
        </p>
      ) : state.entries.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          No activity yet. Logged notes, completed analyses, and email events
          show up here.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {state.entries.map((entry) => (
            <TimelineRow key={`${entry.source}:${entry.id}`} entry={entry} />
          ))}
        </ol>
      )}
    </OverviewCard>
  );
}

function TimelineRow({ entry }: { entry: ActivityEntry }) {
  const Icon = iconFor(entry.type);
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center"
        style={{
          backgroundColor: "var(--ap-pilot-light)",
          color: "var(--ap-navy)",
        }}
      >
        <Icon size={12} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className="truncate text-[12.5px] font-medium"
          style={{ color: "var(--ap-navy)" }}
        >
          {entry.title}
        </p>
        <p
          className="truncate text-[11px]"
          style={{ color: "var(--ap-gray)" }}
        >
          {[
            entry.actorEmail ? actorLabel(entry.actorEmail) : null,
            formatRelative(entry.occurredAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </li>
  );
}

function iconFor(type: ActivityType) {
  switch (type) {
    case "note":      return StickyNote;
    case "meeting":   return Calendar;
    case "document":  return FileText;
    case "email":     return Mail;
    case "call":      return PhoneCall;
    case "task":      return CheckCircle2;
    case "analysis":  return Wand2;
    case "dripper":   return Droplets;
    case "system":    return ClipboardCheck;
    default:          return AlertCircle;
  }
}

function actorLabel(email: string): string {
  const localPart = email.split("@")[0];
  if (!localPart) return email;
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) return "just now";
    return `${hours}h ago`;
  }
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
