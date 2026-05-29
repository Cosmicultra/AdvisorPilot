/**
 * Static copy for the in-app beginner product guide.
 * Shell variant (CRM rail vs legacy wizard) is chosen at render time in the dialog.
 */

import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Compass,
  GitBranch,
  MessageCircle,
  Users,
  UserCircle,
} from "lucide-react";

export type ProductGuideShell = "crm" | "legacy";

export interface ProductGuideStepMeta {
  id: string;
  short: string;
  title: string;
  icon: LucideIcon;
}

export const PRODUCT_GUIDE_STEPS: readonly ProductGuideStepMeta[] = [
  { id: "welcome", short: "Welcome", title: "Welcome to AdvisorPilot", icon: BookOpen },
  { id: "navigation", short: "Navigation", title: "Find your way around", icon: Compass },
  { id: "workflow", short: "Workflow", title: "Your first review workflow", icon: GitBranch },
  { id: "crm", short: "Clients", title: "Clients & follow-up", icon: Users },
  { id: "nova", short: "Nova", title: "Nova assistant", icon: MessageCircle },
  { id: "account", short: "Account", title: "Your account", icon: UserCircle },
] as const;

/** True when the advisor is on a CRM-shell route (side rail layout). */
export function isCrmShellPathname(pathname: string): boolean {
  return (
    pathname.startsWith("/app/intake") ||
    pathname.startsWith("/app/crm") ||
    pathname.startsWith("/app/tasks") ||
    pathname.startsWith("/app/reports") ||
    pathname.startsWith("/app/settings")
  );
}

export function resolveProductGuideShell(pathname: string): ProductGuideShell {
  return isCrmShellPathname(pathname) ? "crm" : "legacy";
}
