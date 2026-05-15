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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoaded(true);
        return;
      }
      const body = (await res.json()) as { profile?: { llmProvider?: LlmProvider | null } };
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProvider(body.profile?.llmProvider ?? null);
    } catch {
      // Soft fail — pill just shows the firm default.
    } finally {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const label = provider ? PROVIDER_LABELS[provider] : "Default";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80 transition hover:border-white/40 hover:bg-white/10 hover:text-white"
        aria-label="AI model settings"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span>Model: {loaded ? label : "…"}</span>
        <svg
          className="h-3 w-3 text-white/60"
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
