"use client";

/**
 * Chat empty state — shown inside the message list when no messages
 * exist yet (fresh conversation OR cleared chat). Greets the advisor,
 * surfaces 4–6 context-aware suggested prompts, and gives a softer
 * landing than the previous blank area (PR 23).
 *
 * Context-awareness: when the advisor is on a client detail route
 * (`useChatLocation()` exposes a client name), the suggested prompts
 * include client-scoped ones; otherwise they're advisor-wide.
 *
 * Clicking a prompt calls `onPrompt(text)` which the parent threads
 * straight into the chat hook's `send()`.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.18.
 */

import { Sparkles } from "lucide-react";
import type { ReactElement } from "react";

export interface ChatEmptyStateProps {
  /** Advisor's display name — used in the greeting. */
  advisorName: string | null;
  /** Currently-focused client (from useChatLocation). When set, drives client-scoped prompts. */
  clientName: string | null;
  /** Called when the advisor clicks a suggested prompt. Parent sends it. */
  onPrompt(text: string): void;
}

/** Pure helper exported for testing — returns the right prompt list per context. */
export function suggestedPrompts(clientName: string | null): string[] {
  if (clientName) {
    // Client-scoped — assumes useChatLocation has resolved a client.
    return [
      `Summarize ${clientName}'s portfolio and current allocation.`,
      `What are the open tasks and recent activity for ${clientName}?`,
      `Run a fresh fee analysis for ${clientName}.`,
      `Draft a Q3 review report for ${clientName}.`,
      `Compare ${clientName}'s allocation to my target model.`,
    ];
  }
  // Advisor-wide / no client in focus.
  return [
    "What's my total AUM and how is it split by stage?",
    "Which clients are overdue for review?",
    "Show me my open tasks across all clients.",
    "What client meetings happened in the last 7 days?",
    "Draft a market-update report for my book.",
  ];
}

export function ChatEmptyState({
  advisorName,
  clientName,
  onPrompt,
}: ChatEmptyStateProps): ReactElement {
  const prompts = suggestedPrompts(clientName);
  const firstName = advisorName?.split(/\s+/)[0] ?? "";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(79, 124, 172, 0.10)" }}
      >
        <Sparkles size={20} strokeWidth={1.5} style={{ color: "var(--ap-royal)" }} />
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <h2
          className="text-[15px] font-semibold"
          style={{ color: "var(--ap-navy)" }}
        >
          {firstName ? `Hi ${firstName} — how can I help?` : "How can I help?"}
        </h2>
        <p
          className="max-w-[420px] text-[12px] leading-snug"
          style={{ color: "var(--ap-gray)" }}
        >
          {clientName
            ? `I have ${clientName}'s context loaded. Try one of these, or ask anything.`
            : "Ask about clients, tasks, AUM, or kick off a report. Suggestions to get going:"}
        </p>
      </div>

      <div className="grid w-full max-w-[520px] grid-cols-1 gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPrompt(p)}
            className="group flex items-start gap-2 rounded-sm border bg-white px-3 py-2 text-left text-[12.5px] leading-snug transition-colors hover:border-[var(--ap-royal)] hover:bg-slate-50"
            style={{
              borderColor: "var(--ap-line, #E5E7EB)",
              color: "var(--ap-navy)",
            }}
          >
            <Sparkles
              size={11}
              strokeWidth={1.75}
              className="mt-0.5 flex-shrink-0 text-slate-400 transition-colors group-hover:text-[var(--ap-royal)]"
              aria-hidden="true"
            />
            <span>{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
