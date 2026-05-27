"use client";

/**
 * Single /api/advisor-profile fetch shared across /app/* (chat launcher,
 * CRM user menu, legacy shell). Avoids duplicate network calls on every page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { AdvisorProfileStatus } from "@/lib/chat/use-advisor-profile";

export interface AdvisorProfileApiBody {
  profile?: {
    ownerEmail?: string | null;
    advisorName?: string | null;
    advisorTitle?: string | null;
    advisorLicense?: string | null;
    calendarLink?: string | null;
    officeAddress?: string | null;
    officePhone?: string | null;
    cellPhone?: string | null;
    website?: string | null;
    logoUrl?: string | null;
    disclosuresText?: string | null;
    disclosuresImageUrl?: string | null;
    emailSignature?: string | null;
    llmProvider?: string | null;
    llmModelOverrides?: Record<string, string> | null;
    defaultResearchTier?: string | null;
  } | null;
  emailConnected?: boolean;
  emailProvider?: "gmail" | "outlook" | null;
}

interface AdvisorProfileContextValue {
  status: AdvisorProfileStatus;
  body: AdvisorProfileApiBody | null;
  refetch: () => Promise<AdvisorProfileApiBody | null>;
}

const AdvisorProfileContext = createContext<AdvisorProfileContextValue | null>(
  null
);

export function AdvisorProfileProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdvisorProfileStatus>("loading");
  const [body, setBody] = useState<AdvisorProfileApiBody | null>(null);

  const refetch = useCallback(async (): Promise<AdvisorProfileApiBody | null> => {
    try {
      const res = await advisorFetch("/api/advisor-profile", {
        method: "GET",
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        setStatus("unauthenticated");
        setBody(null);
        return null;
      }
      if (!res.ok) {
        setStatus("error");
        return null;
      }
      const next = (await res.json().catch(() => null)) as AdvisorProfileApiBody | null;
      const email = next?.profile?.ownerEmail?.trim();
      if (!email) {
        setStatus("unauthenticated");
        setBody(null);
        return null;
      }
      setBody(next);
      setStatus("ready");
      return next;
    } catch {
      setStatus("error");
      return null;
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo(
    () => ({ status, body, refetch }),
    [status, body, refetch]
  );

  return (
    <AdvisorProfileContext.Provider value={value}>
      {children}
    </AdvisorProfileContext.Provider>
  );
}

export function useAdvisorProfileContext(): AdvisorProfileContextValue {
  const ctx = useContext(AdvisorProfileContext);
  if (!ctx) {
    throw new Error(
      "useAdvisorProfileContext must be used within AdvisorProfileProvider"
    );
  }
  return ctx;
}

/** Optional hook for surfaces outside the provider (e.g. tests). */
export function useAdvisorProfileContextOptional(): AdvisorProfileContextValue | null {
  return useContext(AdvisorProfileContext);
}
