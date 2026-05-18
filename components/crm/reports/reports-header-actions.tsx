"use client";

/**
 * Right-action slot for the /app/reports TopHeader.
 *
 * Primary CTA: "New report" → /app/reports/new (blank-canvas editor).
 * Includes <NewClientButton /> and <UserMenu /> (passing rightActions
 * overrides TopHeader defaults, so both are mounted here explicitly).
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a.
 */

import Link from "next/link";
import { Plus } from "lucide-react";
import { NewClientButton } from "../new-client-button";
import { UserMenu } from "../user-menu";

export function ReportsHeaderActions() {
  return (
    <>
      <NewClientButton />
      <Link
        href="/app/reports/new"
        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold"
        style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
      >
        <Plus size={12} strokeWidth={2.25} />
        New report
      </Link>
      <UserMenu />
    </>
  );
}
