"use client";

/**
 * Per-client Workflow tab. Mounted at /app/crm/[id]/workflow.
 *
 * Interim landing surface: a grid of step launcher cards, each a Link to
 * /app/intake?clientId={id}&step={stepName} which deep-links into the
 * legacy embedded shell with this client auto-loaded + the requested step
 * jumped to (URL-intent hydration wired in app/app/legacy-app-shell.tsx).
 *
 * Cards are grouped into three categories — Setup, Analysis, Output — to
 * keep the surface scannable. Same Link pattern as the Profile header's
 * "Prep meeting" button (which is a Meeting Guide shortcut).
 *
 * This is a placeholder for the on-demand AI-rerun concept that will
 * eventually replace it. Until then, it makes the tab useful (no more
 * "Coming in Phase 3" wall).
 */

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileText,
  Landmark,
  MessageSquareText,
  Percent,
  Upload,
} from "lucide-react";
import type { ClientDetail } from "@/lib/crm/types";

interface StepCard {
  step: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

interface StepGroup {
  label: string;
  hint: string;
  steps: StepCard[];
}

const GROUPS: StepGroup[] = [
  {
    label: "Setup",
    hint: "Capture and confirm portfolio data",
    steps: [
      {
        step: "intake",
        title: "Intake",
        description: "Re-open the 10-question intake form to update facts.",
        icon: ClipboardList,
      },
      {
        step: "upload",
        title: "Statement upload",
        description: "Drop new statements for AI extraction.",
        icon: Upload,
      },
      {
        step: "confirm",
        title: "Confirm holdings",
        description: "Review extracted holdings and resolve any flagged rows.",
        icon: CheckCircle2,
      },
    ],
  },
  {
    label: "Analysis",
    hint: "Run AI passes and scenario worksheets",
    steps: [
      {
        step: "analysis",
        title: "Portfolio analysis",
        description: "Allocation, scores, red flags, recommendations.",
        icon: BarChart3,
      },
      {
        step: "fia",
        title: "FIA scenario",
        description: "Hypothetical fixed-index annuity terms.",
        icon: Landmark,
      },
      {
        step: "roth",
        title: "Roth worksheet",
        description: "Roth conversion comparison and tax illustration.",
        icon: BrainCircuit,
      },
      {
        step: "retIncome",
        title: "Retirement income",
        description: "Projected income vs. need over retirement years.",
        icon: DollarSign,
      },
      {
        step: "feeAnalysis",
        title: "Fee analysis",
        description: "Holdings-level cost breakdown vs. proposed.",
        icon: Percent,
      },
    ],
  },
  {
    label: "Output",
    hint: "Talk to the client and deliver the report",
    steps: [
      {
        step: "meeting",
        title: "Meeting guide",
        description: "Talking points and agenda for the next conversation.",
        icon: MessageSquareText,
      },
      {
        step: "report",
        title: "Client snapshot",
        description: "Generate the client-facing or advisor PDF.",
        icon: FileText,
      },
    ],
  },
];

export type WorkflowTabProps = {
  client: ClientDetail;
};

export function WorkflowTab({ client }: WorkflowTabProps) {
  return (
    <div className="flex flex-1 flex-col gap-5 px-6 py-5">
      <div
        className="flex flex-col gap-1 bg-white px-4 py-3"
        style={{ border: "1px solid var(--ap-border)" }}
      >
        <p
          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--ap-royal)" }}
        >
          Workflow launcher
        </p>
        <p className="text-[12.5px] leading-snug" style={{ color: "var(--ap-navy)" }}>
          Open any step of the analysis flow with{" "}
          <strong className="font-semibold">{client.firstName} {client.lastName}</strong>{" "}
          loaded. This tab will eventually host on-demand AI reruns against
          existing or new documents.
        </p>
      </div>

      {GROUPS.map((group) => (
        <Group key={group.label} group={group} clientId={client.id} />
      ))}
    </div>
  );
}

function Group({ group, clientId }: { group: StepGroup; clientId: string }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <h3
          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--ap-gray)" }}
        >
          {group.label}
        </h3>
        <p className="text-[11px]" style={{ color: "var(--ap-gray)" }}>
          {group.hint}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {group.steps.map((step) => (
          <StepCardLink key={step.step} step={step} clientId={clientId} />
        ))}
      </div>
    </section>
  );
}

function StepCardLink({
  step,
  clientId,
}: {
  step: StepCard;
  clientId: string;
}) {
  const Icon = step.icon;
  return (
    <Link
      href={`/app/intake?clientId=${encodeURIComponent(clientId)}&step=${step.step}`}
      className="group flex items-start gap-3 bg-white px-4 py-3 transition-colors hover:bg-[rgba(15,111,222,0.04)]"
      style={{ border: "1px solid var(--ap-border)" }}
    >
      <span
        className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center transition-colors"
        style={{
          backgroundColor: "var(--ap-pilot-light)",
          color: "var(--ap-navy)",
        }}
      >
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <p
            className="text-[13px] font-semibold"
            style={{ color: "var(--ap-navy)" }}
          >
            {step.title}
          </p>
          <ArrowRight
            size={13}
            strokeWidth={1.75}
            className="flex-shrink-0 transition-transform group-hover:translate-x-0.5"
            style={{ color: "var(--ap-royal)" }}
          />
        </div>
        <p
          className="text-[11.5px] leading-snug"
          style={{ color: "var(--ap-gray)" }}
        >
          {step.description}
        </p>
      </div>
    </Link>
  );
}
