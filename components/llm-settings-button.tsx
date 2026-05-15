"use client";

/**
 * Header pill + drawer launcher for the AI model picker. Mounts inside the
 * advisor product. Self-fetches the current saved provider on mount so the
 * label is always accurate.
 */

import { useCallback, useEffect, useState } from "react";
import { LlmSettingsDrawer } from "./llm-settings-drawer";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { LlmProvider } from "@/lib/llm";

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

export function LlmSettingsButton() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<LlmProvider | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await advisorFetch("/api/advisor-profile", { method: "GET" });
      if (!res.ok) {
        setLoaded(true);
        return;
      }
      const body = (await res.json()) as { profile?: { llmProvider?: LlmProvider | null } };
      setProvider(body.profile?.llmProvider ?? null);
    } catch {
      // Soft fail — pill just shows the firm default.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const label = provider ? PROVIDER_LABELS[provider] : "Default";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        aria-label="AI model settings"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span>Model: {loaded ? label : "…"}</span>
        <svg
          className="h-3 w-3 text-slate-400"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <LlmSettingsDrawer
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(next) => {
          setProvider(next);
        }}
      />
    </>
  );
}
