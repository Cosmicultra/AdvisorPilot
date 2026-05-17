/**
 * Royal-blue "+ New client" CTA for the CRM TopHeader's right slot.
 *
 * Navigates to /app/intake which mounts the legacy intake wizard inside
 * the CRM shell (see components/crm/legacy-embed.tsx). Acts as a
 * shortcut for "create a brand-new client" from anywhere — the Roster
 * uses it in its TopHeader's rightActions; other surfaces can drop this
 * in alongside <UserMenu /> too.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (top header → "New client" button).
 */

import { Plus } from "lucide-react";
import Link from "next/link";

export function NewClientButton() {
  return (
    <Link
      href="/app/intake"
      className="flex h-7 items-center gap-1 px-2.5 text-[11.5px] font-semibold"
      style={{ backgroundColor: "var(--ap-royal)", color: "#FFFFFF" }}
    >
      <Plus size={11} strokeWidth={2.25} />
      New client
    </Link>
  );
}
