"use client";

/**
 * User avatar + dropdown menu for the CRM TopHeader's right-slot.
 *
 * Mirrors what the legacy top-nav exposed: AI model settings (opens the
 * existing LlmSettingsDrawer) and Sign out (handles both NextAuth Google
 * sessions AND email/password sessions per the auth rule).
 *
 * Identity is read from /api/advisor-profile via advisorFetch — same
 * pattern as LlmSettingsButton — so the menu works for both auth paths
 * without a special case.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (the app rail / replacing top nav).
 */

import { ChevronDown, LogOut, Settings, User } from "lucide-react";
import { signOut } from "next-auth/react";
import { DropdownMenu } from "radix-ui";
import { useCallback, useEffect, useState } from "react";
import { advisorFetch, AP_SUPABASE_AT, AP_SUPABASE_RT } from "@/lib/advisor-fetch";
import { LlmSettingsDrawer } from "@/components/llm-settings-drawer";
import { useSettingsDialog } from "./settings-dialog-provider";

/**
 * Why no `useSession()`: this codebase doesn't mount `<SessionProvider>`
 * (legacy-app-shell.tsx manages session state manually via useState +
 * /api/auth/email-session). Calling useSession() here would crash
 * prerendering. We get identity from /api/advisor-profile — which works
 * for BOTH NextAuth (Google) AND Supabase email/password users — and
 * handle sign-out by clearing both auth surfaces (NextAuth cookie via
 * signOut() + sessionStorage Bearer tokens). Either is a no-op when the
 * user isn't on that path, so doing both is always safe.
 */

interface AdvisorProfileResponse {
  profile?: {
    ownerEmail?: string | null;
    advisorName?: string | null;
  } | null;
  emailConnected?: boolean;
}

export function UserMenu() {
  const settingsDialog = useSettingsDialog();
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [emailConnected, setEmailConnected] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fetch the advisor profile (works for both Google + email/password) so
  // we always have a real email/name to render the avatar from.
  useEffect(() => {
    let cancelled = false;
    advisorFetch("/api/advisor-profile", { method: "GET", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as AdvisorProfileResponse;
      })
      .then((body) => {
        if (cancelled || !body) return;
        setProfileEmail(body.profile?.ownerEmail ?? null);
        setProfileName(body.profile?.advisorName ?? null);
        setEmailConnected(body.emailConnected === true);
      })
      .catch(() => {
        // Soft-fail — avatar shows "?" instead of initials.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const email = profileEmail;
  const triggerLabel = formatAdvisorFirstName(profileName, email);
  const emailStatusHint =
    emailConnected === true ? "Connected to email" : "Re-Authenticate email";

  const handleSignOut = useCallback(() => {
    // Clear email/password Bearer tokens (no-op if Google user).
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(AP_SUPABASE_AT);
      sessionStorage.removeItem(AP_SUPABASE_RT);
    }
    // Clear NextAuth session cookie (no-op if email/password user).
    // signOut() handles the redirect via callbackUrl.
    void signOut({ callbackUrl: "/login" });
  }, []);

  return (
    <>
      <DropdownMenu.Root modal={false}>
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor:
                emailConnected === null
                  ? "#cbd5e1"
                  : emailConnected
                    ? "#22c55e"
                    : "#f59e0b",
            }}
            title={emailConnected === null ? undefined : emailStatusHint}
            aria-label={emailConnected === null ? undefined : emailStatusHint}
          />
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={email ? `Account menu, ${triggerLabel}` : "Account menu"}
              aria-haspopup="menu"
              className="flex items-center gap-2 px-2 py-1 transition-colors hover:bg-[rgba(12,25,41,0.04)] data-[state=open]:bg-[rgba(12,25,41,0.06)]"
              style={{ border: "1px solid var(--ap-border)" }}
            >
              <span
                className="flex h-7 max-w-[5.5rem] flex-shrink-0 items-center justify-center px-2 text-[11px] font-semibold leading-none"
                style={{
                  backgroundColor: "var(--ap-royal)",
                  color: "#FFFFFF",
                }}
              >
                <span className="truncate">{triggerLabel}</span>
              </span>
              <ChevronDown
                size={12}
                strokeWidth={1.75}
                className="flex-shrink-0"
                style={{ color: "var(--ap-gray)" }}
                aria-hidden
              />
            </button>
          </DropdownMenu.Trigger>
        </div>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={6}
            align="end"
            className="z-[300] min-w-[14rem] bg-white py-1"
            style={{
              border: "1px solid var(--ap-border-strong, var(--ap-border))",
              boxShadow: "0 8px 24px rgba(12, 25, 41, 0.12)",
            }}
          >
            {email ? (
              <div
                className="px-3 py-2 text-[11px]"
                style={{ color: "var(--ap-gray)", borderBottom: "1px solid var(--ap-border)" }}
              >
                Signed in as
                <p
                  className="mt-0.5 truncate text-[12.5px] font-medium"
                  style={{ color: "var(--ap-navy)" }}
                >
                  {email}
                </p>
              </div>
            ) : null}

            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] outline-none data-[highlighted]:bg-[rgba(12,25,41,0.04)]"
              onSelect={() => setDrawerOpen(true)}
              style={{ color: "var(--ap-navy)" }}
            >
              <Settings size={14} strokeWidth={1.75} />
              AI models &amp; research tier
            </DropdownMenu.Item>

            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] outline-none data-[highlighted]:bg-[rgba(12,25,41,0.04)]"
              onSelect={() => settingsDialog.open()}
              style={{ color: "var(--ap-navy)" }}
            >
              <User size={14} strokeWidth={1.75} />
              Profile &amp; signature
            </DropdownMenu.Item>

            <DropdownMenu.Separator
              className="my-1 h-px"
              style={{ backgroundColor: "var(--ap-border)" }}
            />

            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] outline-none data-[highlighted]:bg-red-50 data-[highlighted]:text-red-900"
              onSelect={handleSignOut}
              style={{ color: "var(--ap-navy)" }}
            >
              <LogOut size={14} strokeWidth={1.75} />
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <LlmSettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}

/** First name shown inside the blue account badge (per advisor). */
function formatAdvisorFirstName(profileName: string | null, email: string | null): string {
  const raw = (() => {
    const name = profileName?.trim();
    if (name) return name.split(/\s+/)[0] || name;
    if (email) {
      const local = email.split("@")[0] ?? "";
      const part = local.split(/[._-]/).filter(Boolean)[0];
      if (part) return part;
    }
    return "Account";
  })();

  if (raw === "Account") return raw;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}
