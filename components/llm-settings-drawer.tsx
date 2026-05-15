"use client";

/**
 * AI Models settings drawer — provider radio + per-pass model dropdowns.
 *
 * Self-contained: fetches /api/advisor-profile + /api/llm-providers on open,
 * persists via POST /api/advisor-profile. Never reads env vars or keys.
 *
 * The drawer mounts inside the existing advisor product (`app/app/page.tsx`)
 * via `<LlmSettingsButton />` — a floating pill in the top-right corner.
 * Keeps the giant single-file workflow component untouched aside from a
 * single mount-point.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MODEL_CATALOG, modelOptionsForProvider } from "@/lib/llm/model-catalog";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { LlmPass, LlmProvider, ResearchTier } from "@/lib/llm";

const PROVIDERS: { id: LlmProvider; label: string }[] = [
  { id: "openai", label: "ChatGPT (OpenAI)" },
  { id: "gemini", label: "Gemini (Google)" },
  { id: "grok", label: "Grok (xAI)" },
];

const RESEARCH_TIERS: { id: ResearchTier; label: string; hint: string }[] = [
  { id: "fast-grounded", label: "Fast", hint: "Single-call grounded search, under 30 seconds." },
  { id: "agentic-research", label: "Agentic (default)", hint: "Multi-step server-side research, 30s–3 min." },
  { id: "deep-research", label: "Deep", hint: "Background research, 5–60 minutes. Grok runs synchronously; OpenAI and Gemini run async via /api/research." },
];

interface ProvidersAPIResponse {
  providers: { id: LlmProvider; configured: boolean }[];
}

interface ProfileAPIResponse {
  profile: null | {
    llmProvider: LlmProvider | null;
    llmModelOverrides: Partial<Record<LlmPass, string>>;
    defaultResearchTier: ResearchTier | null;
    [k: string]: unknown;
  };
}

export interface LlmSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent (header pill) refreshes its label. */
  onSaved?: (provider: LlmProvider | null) => void;
}

export function LlmSettingsDrawer({ open, onClose, onSaved }: LlmSettingsDrawerProps) {
  const [configured, setConfigured] = useState<Record<LlmProvider, boolean>>({
    openai: false,
    gemini: false,
    grok: false,
  });
  const [provider, setProvider] = useState<LlmProvider | null>(null);
  const [overrides, setOverrides] = useState<Partial<Record<LlmPass, string>>>({});
  const [researchTier, setResearchTier] = useState<ResearchTier | null>(null);
  const [useProviderEverywhere, setUseProviderEverywhere] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providersRes, profileRes] = await Promise.all([
        fetch("/api/llm-providers", { cache: "no-store" }).then((r) => r.json()),
        advisorFetch("/api/advisor-profile", { method: "GET" }).then((r) => r.json()),
      ]);
      const p = providersRes as ProvidersAPIResponse;
      const map: Record<LlmProvider, boolean> = { openai: false, gemini: false, grok: false };
      for (const row of p.providers || []) map[row.id] = row.configured;
      setConfigured(map);

      const pr = profileRes as ProfileAPIResponse;
      const savedProvider = pr.profile?.llmProvider ?? null;
      const savedOverrides = pr.profile?.llmModelOverrides ?? {};
      const savedTier = pr.profile?.defaultResearchTier ?? null;
      setProvider(savedProvider);
      setOverrides(savedOverrides);
      setResearchTier(savedTier);
      setUseProviderEverywhere(Object.keys(savedOverrides).length === 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void loadAll();
  }, [open, loadAll]);

  const passes = useMemo(() => {
    if (!provider) return [];
    return modelOptionsForProvider(provider);
  }, [provider]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        llmProvider: provider,
        llmModelOverrides: useProviderEverywhere ? null : overrides,
        defaultResearchTier: researchTier,
      };
      const res = await advisorFetch("/api/advisor-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      setLastSavedAt(new Date().toLocaleTimeString());
      if (onSaved) onSaved(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetOverrides = () => {
    setOverrides({});
    setUseProviderEverywhere(true);
  };

  if (!open) return null;

  // Inline color + color-scheme: the host page sets a dark inherited text
  // color on its root container; without an explicit fence here the
  // drawer's nested labels render white-on-white. `color-scheme: light`
  // also fixes form controls (radio dot, checkbox check) being invisible
  // against the light panel.
  const panelStyle: React.CSSProperties = {
    color: "#0c1929",
    colorScheme: "light",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white text-slate-900 shadow-2xl"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">AI Models</h2>
            <p className="text-xs text-slate-500">
              Choose the AI provider and per-task models for this account.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">
            Loading…
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Provider</h3>
              <div className="flex flex-col gap-2">
                {PROVIDERS.map((p) => {
                  const ok = configured[p.id];
                  return (
                    <label
                      key={p.id}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                        ok
                          ? provider === p.id
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-slate-200 hover:bg-slate-50"
                          : "border-slate-200 opacity-60"
                      }`}
                    >
                      <span className="flex items-center gap-3 text-sm">
                        <input
                          type="radio"
                          name="llm-provider"
                          disabled={!ok}
                          checked={provider === p.id}
                          onChange={() => setProvider(p.id)}
                        />
                        <span>{p.label}</span>
                      </span>
                      <span className={`text-xs ${ok ? "text-emerald-700" : "text-slate-400"}`}>
                        {ok ? "configured" : "missing API key"}
                      </span>
                    </label>
                  );
                })}
                <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="llm-provider"
                    checked={provider === null}
                    onChange={() => setProvider(null)}
                  />
                  <span>Use the firm default</span>
                </label>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Default research tier</h3>
              <div className="flex flex-col gap-2">
                {RESEARCH_TIERS.map((tier) => (
                  <label
                    key={tier.id}
                    className={`flex flex-col gap-1 rounded-md border px-3 py-2 ${
                      researchTier === tier.id
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center gap-3 text-sm">
                      <input
                        type="radio"
                        name="research-tier"
                        checked={researchTier === tier.id}
                        onChange={() => setResearchTier(tier.id)}
                      />
                      <span>{tier.label}</span>
                    </span>
                    <span className="text-xs text-slate-500">{tier.hint}</span>
                  </label>
                ))}
                <label className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="research-tier"
                    checked={researchTier === null}
                    onChange={() => setResearchTier(null)}
                  />
                  <span>Use the firm default</span>
                </label>
              </div>
            </section>

            {provider && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">Per-task model overrides</h3>
                  {!useProviderEverywhere && (
                    <button
                      type="button"
                      onClick={handleResetOverrides}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Reset all to default
                    </button>
                  )}
                </div>
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useProviderEverywhere}
                    onChange={(e) => setUseProviderEverywhere(e.target.checked)}
                  />
                  <span>
                    Use my chosen provider for everything where possible
                    <span className="ml-1 text-xs text-slate-500">
                      (uncheck to mix per task)
                    </span>
                  </span>
                </label>

                {!useProviderEverywhere &&
                  passes.map((row) => {
                    const value = overrides[row.pass] ?? "";
                    const isCustom = value !== "" && !row.options.includes(value);
                    return (
                      <div key={row.pass} className="mb-2 flex items-center gap-3 text-sm">
                        <label className="w-1/2 text-slate-700">{row.label}</label>
                        <select
                          className="flex-1 rounded-md border border-slate-300 px-2 py-1"
                          value={isCustom ? "__custom__" : value}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") {
                              const next = { ...overrides };
                              delete next[row.pass];
                              setOverrides(next);
                            } else if (v === "__custom__") {
                              const custom = window.prompt(
                                `Custom model ID for ${row.label}`,
                                value || ""
                              );
                              if (custom !== null) {
                                const trimmed = custom.trim();
                                if (trimmed) {
                                  setOverrides({ ...overrides, [row.pass]: trimmed });
                                } else {
                                  const next = { ...overrides };
                                  delete next[row.pass];
                                  setOverrides(next);
                                }
                              }
                            } else {
                              setOverrides({ ...overrides, [row.pass]: v });
                            }
                          }}
                        >
                          <option value="">Firm default</option>
                          {row.options.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                          <option value="__custom__">Custom…</option>
                        </select>
                        {isCustom && (
                          <span className="text-xs text-slate-500">{value}</span>
                        )}
                      </div>
                    );
                  })}
                {/* Reference: provider catalog is in lib/llm/model-catalog.ts */}
                <p className="mt-3 text-xs text-slate-400">
                  Models available:{" "}
                  {Object.keys(MODEL_CATALOG[provider]).length} task surfaces.
                </p>
              </section>
            )}

            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <p className="text-xs text-slate-500">
                {lastSavedAt ? `Saved at ${lastSavedAt}` : "Voice features always use OpenAI in v1."}
              </p>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
