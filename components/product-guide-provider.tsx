"use client";

/**
 * Global product guide — one dialog for all /app/* routes. Exposes open()
 * for account menus and auto-opens once per browser on first signed-in visit.
 */

import {
  AP_ONBOARDING_DISMISSED_AT,
} from "@/components/onboarding-dialog";
import {
  AP_PRODUCT_GUIDE_DISMISSED_AT,
  ProductGuideDialog,
} from "@/components/product-guide-dialog";
import { useAdvisorProfileContextOptional } from "@/lib/advisor-profile-context";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ProductGuideContextValue {
  open: () => void;
  dismissAndClose: () => void;
}

const ProductGuideContext = createContext<ProductGuideContextValue | null>(null);

export function useProductGuide(): ProductGuideContextValue {
  const value = useContext(ProductGuideContext);
  if (!value) {
    throw new Error("useProductGuide must be used inside <ProductGuideProvider>");
  }
  return value;
}

/** Optional hook for legacy shell — provider may be absent in tests. */
export function useProductGuideOptional(): ProductGuideContextValue | null {
  return useContext(ProductGuideContext);
}

function isProductGuideDismissed(): boolean {
  if (typeof window === "undefined") return true;
  return Boolean(window.localStorage.getItem(AP_PRODUCT_GUIDE_DISMISSED_AT));
}

function markProductGuideDismissed(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AP_PRODUCT_GUIDE_DISMISSED_AT, new Date().toISOString());
}

/** Matches legacy-app-shell first-run onboarding heuristic. */
function shouldDeferForOnboarding(profile: {
  advisorName?: string | null;
  emailSignature?: string | null;
} | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(AP_ONBOARDING_DISMISSED_AT)) return false;
  const name = profile?.advisorName?.trim() ?? "";
  const sig = profile?.emailSignature?.trim() ?? "";
  return !name && !sig;
}

export function ProductGuideProvider({ children }: { children: ReactNode }) {
  const profileCtx = useAdvisorProfileContextOptional();
  const [open, setOpen] = useState(false);
  /** Bumps when the user explicitly reopens the guide so the dialog remounts at step 0. */
  const [sessionKey, setSessionKey] = useState(0);
  const autoDecidedRef = useRef(false);

  const dismissAndClose = useCallback(() => {
    markProductGuideDismissed();
    setOpen(false);
  }, []);

  const openGuide = useCallback(() => {
    setSessionKey((k) => k + 1);
    setOpen(true);
  }, []);

  const advisorEmail =
    profileCtx?.status === "ready"
      ? profileCtx.body?.profile?.ownerEmail ?? null
      : null;

  useEffect(() => {
    if (autoDecidedRef.current) return;
    if (profileCtx?.status !== "ready") return;
    if (!advisorEmail) return;

    autoDecidedRef.current = true;

    if (isProductGuideDismissed()) return;

    const profile = profileCtx.body?.profile;
    if (shouldDeferForOnboarding(profile)) return;

    queueMicrotask(() => setOpen(true));
  }, [profileCtx?.status, profileCtx?.body?.profile, advisorEmail]);

  return (
    <ProductGuideContext.Provider value={{ open: openGuide, dismissAndClose }}>
      {children}
      <ProductGuideDialog
        key={sessionKey}
        open={open}
        advisorEmail={advisorEmail}
        onDismiss={dismissAndClose}
        onFinish={dismissAndClose}
      />
    </ProductGuideContext.Provider>
  );
}

/** Open the guide if the user has not dismissed it (legacy onboarding chain). */
export function openProductGuideIfNotDismissed(
  openGuide: () => void
): void {
  if (isProductGuideDismissed()) return;
  openGuide();
}
