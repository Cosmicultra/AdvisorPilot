"use client";

/**
 * Mounts ONE shared <OnboardingDialog /> for the CRM shell and exposes an
 * `open()` trigger via React context so any descendant — the AppRail's
 * Settings item, the TopHeader's UserMenu's "Profile & signature" item, etc.
 * — can fire the same dialog without each maintaining its own state.
 *
 * The dialog is the centralized settings surface (welcome, AI provider,
 * email signature, branding, disclosures). The legacy app reaches it via
 * the user-avatar dropdown's "Setup wizard" item; the CRM reaches it via
 * the rail Settings item AND the avatar dropdown.
 */

import {
  AP_ONBOARDING_DISMISSED_AT,
  OnboardingDialog,
} from "@/components/onboarding-dialog";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface SettingsDialogContextValue {
  /** Open the settings dialog. Clears the per-browser dismissal flag first
   *  so the dialog opens cleanly every time (matches the legacy "Setup
   *  wizard" menu item behavior). */
  open: () => void;
}

const SettingsDialogContext = createContext<SettingsDialogContextValue | null>(null);

export function useSettingsDialog(): SettingsDialogContextValue {
  const value = useContext(SettingsDialogContext);
  if (!value) {
    throw new Error(
      "useSettingsDialog must be used inside <SettingsDialogProvider>"
    );
  }
  return value;
}

export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openDialog = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AP_ONBOARDING_DISMISSED_AT);
    }
    setOpen(true);
  }, []);

  return (
    <SettingsDialogContext.Provider value={{ open: openDialog }}>
      {children}
      <OnboardingDialog
        open={open}
        onDismiss={() => setOpen(false)}
        onFinish={() => setOpen(false)}
      />
    </SettingsDialogContext.Provider>
  );
}
