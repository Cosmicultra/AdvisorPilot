"use client";

/**
 * First-run onboarding wizard.
 *
 * Multi-step modal walking the advisor through:
 *   0. Welcome
 *   1. AI provider + default research depth (saved to /api/advisor-profile)
 *   2. Email signature (full parity with the legacy in-page card: name, title,
 *      license, calendar link, address, office phone, cell phone, website)
 *   3. Branding & disclosures (logo upload, disclosures text, disclosures image)
 *   4. Done
 *
 * The signature text saved to `email_signature` matches the page's
 * `composeEmailSignature()` ordering so client snapshot emails render the
 * same way regardless of whether the user filled out the wizard or the
 * legacy card.
 *
 * Dismissal is per-browser (localStorage `AP_ONBOARDING_DISMISSED_AT`) — no DB
 * schema change. The parent (`app/app/page.tsx`) decides when to auto-open
 * based on profile state + the localStorage flag; this component owns the
 * step state, the load/save lifecycle, and its own form state.
 *
 * Power-user surfaces (per-task model overrides) remain on the
 * `LlmSettingsDrawer`. The legacy "Email signature" menu item also still
 * opens the in-page card for users who prefer the long-form edit surface.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { LlmProvider, ResearchTier } from "@/lib/llm";

export const AP_ONBOARDING_DISMISSED_AT = "ap_onboarding_dismissed_at";

interface StepMeta {
  short: string;
  title: string;
}

const STEPS: readonly StepMeta[] = [
  { short: "Welcome", title: "Welcome to AdvisorPilot" },
  { short: "AI Models", title: "Pick your AI provider" },
  { short: "Signature", title: "Set up your email signature" },
  { short: "Branding", title: "Logo and disclosures" },
  { short: "Done", title: "You're all set" },
] as const;

const STEP_WELCOME = 0;
const STEP_AI = 1;
const STEP_SIGNATURE = 2;
const STEP_BRANDING = 3;
const STEP_DONE = 4;

const PROVIDERS: { id: LlmProvider; label: string; hint: string }[] = [
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    hint: "Default. Highest-quality vision + research across statement types.",
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    hint: "Native PDF handling, long context, strong cost performance.",
  },
  {
    id: "grok",
    label: "Grok (xAI)",
    hint: "Fast research with X integration; PDFs are rasterized for vision.",
  },
];

const RESEARCH_TIERS: { id: ResearchTier; label: string; hint: string }[] = [
  {
    id: "fast-grounded",
    label: "Fast",
    hint: "Single-call grounded search, under 30 seconds.",
  },
  {
    id: "agentic-research",
    label: "Agentic — recommended",
    hint: "Multi-step server-side research, 30 seconds to 3 minutes.",
  },
  {
    id: "deep-research",
    label: "Deep",
    hint: "Background research, 5–60 minutes. Best for thorny reviews.",
  },
];

interface ProvidersAPIResponse {
  providers: { id: LlmProvider; configured: boolean }[];
}

interface ProfileAPIResponse {
  profile:
    | null
    | {
        llmProvider: LlmProvider | null;
        defaultResearchTier: ResearchTier | null;
        advisorName?: string;
        advisorTitle?: string;
        advisorLicense?: string;
        calendarLink?: string;
        officeAddress?: string;
        officePhone?: string;
        cellPhone?: string;
        website?: string;
        logoUrl?: string;
        disclosuresText?: string;
        disclosuresImageUrl?: string;
        emailSignature?: string;
        [k: string]: unknown;
      };
}

export interface OnboardingDialogProps {
  open: boolean;
  /** User dismissed via Skip / Esc / outside-click. Parent should set the localStorage flag + close. */
  onDismiss: () => void;
  /** User completed all steps. Parent should refresh profile state + close. */
  onFinish: () => void;
  /** Optional advisor email for the welcome screen. */
  advisorEmail?: string | null;
}

export function OnboardingDialog({
  open,
  onDismiss,
  onFinish,
  advisorEmail,
}: OnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [configured, setConfigured] = useState<Record<LlmProvider, boolean>>({
    openai: false,
    gemini: false,
    grok: false,
  });
  const [provider, setProvider] = useState<LlmProvider | null>(null);
  const [researchTier, setResearchTier] = useState<ResearchTier | null>("agentic-research");

  // Signature text fields — full parity with the legacy in-page card.
  const [signatureName, setSignatureName] = useState("");
  const [signatureTitle, setSignatureTitle] = useState("");
  const [signatureLicense, setSignatureLicense] = useState("");
  const [signatureCalendarLink, setSignatureCalendarLink] = useState("");
  const [signatureAddress, setSignatureAddress] = useState("");
  const [signatureOfficePhone, setSignatureOfficePhone] = useState("");
  const [signatureCellPhone, setSignatureCellPhone] = useState("");
  const [signatureWebsite, setSignatureWebsite] = useState("");

  // Branding & disclosures.
  const [signatureLogoUrl, setSignatureLogoUrl] = useState("");
  const [signatureDisclosuresText, setSignatureDisclosuresText] = useState("");
  const [signatureDisclosuresImageUrl, setSignatureDisclosuresImageUrl] = useState("");
  const [logoUploadBusy, setLogoUploadBusy] = useState(false);
  const [disclosuresImageUploadBusy, setDisclosuresImageUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // File-input refs so the labelled "Upload" buttons can trigger native pickers.
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);
  const disclosuresFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [providersJson, profileJson] = await Promise.all([
        fetch("/api/llm-providers", { cache: "no-store" }).then((r) => r.json()),
        advisorFetch("/api/advisor-profile", { method: "GET" }).then((r) => r.json()),
      ]);

      const p = providersJson as ProvidersAPIResponse;
      const map: Record<LlmProvider, boolean> = { openai: false, gemini: false, grok: false };
      for (const row of p.providers || []) map[row.id] = row.configured;
      setConfigured(map);

      const pr = profileJson as ProfileAPIResponse;
      const prof = pr.profile;
      if (prof) {
        setProvider(prof.llmProvider ?? null);
        setResearchTier(prof.defaultResearchTier ?? "agentic-research");
        setSignatureName(prof.advisorName || "");
        setSignatureTitle(prof.advisorTitle || "");
        setSignatureLicense(prof.advisorLicense || "");
        setSignatureCalendarLink(prof.calendarLink || "");
        setSignatureAddress(prof.officeAddress || "");
        setSignatureOfficePhone(prof.officePhone || "");
        setSignatureCellPhone(prof.cellPhone || "");
        setSignatureWebsite(prof.website || "");
        setSignatureLogoUrl(prof.logoUrl || "");
        setSignatureDisclosuresText(prof.disclosuresText || "");
        setSignatureDisclosuresImageUrl(prof.disclosuresImageUrl || "");
      } else {
        // First-time user: pick the first configured provider as a sensible default.
        if (map.openai) setProvider("openai");
        else if (map.gemini) setProvider("gemini");
        else if (map.grok) setProvider("grok");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load your account.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Mirrors `app/app/page.tsx → composeEmailSignature()` so the snapshot email
   * renders identically whether the user came through onboarding or the
   * legacy in-page card.
   */
  const composeEmailSignature = useCallback((): string => {
    return [
      signatureName,
      signatureTitle,
      signatureLicense,
      signatureCalendarLink ? "Book a time on my calendar" : "",
      signatureAddress,
      signatureOfficePhone ? `Office: ${signatureOfficePhone}` : "",
      signatureCellPhone ? `Cell: ${signatureCellPhone}` : "",
      signatureWebsite,
    ]
      .filter(Boolean)
      .join("\n");
  }, [
    signatureName,
    signatureTitle,
    signatureLicense,
    signatureCalendarLink,
    signatureAddress,
    signatureOfficePhone,
    signatureCellPhone,
    signatureWebsite,
  ]);

  /**
   * Upload helper — POSTs to /api/advisor-profile/upload and stores the
   * returned `publicUrl` in the matching state slot. Mirrors the page's
   * `uploadAdvisorSignatureAsset` (`kind`: "logo" | "disclosures"). 2 MB max,
   * JPG/PNG/GIF/WebP — those are enforced server-side; we only surface errors.
   */
  const uploadAsset = useCallback(
    async (kind: "logo" | "disclosures", file: File) => {
      setUploadError(null);
      if (kind === "logo") setLogoUploadBusy(true);
      else setDisclosuresImageUploadBusy(true);
      try {
        const fd = new FormData();
        fd.append("kind", kind);
        fd.append("file", file);
        const res = await advisorFetch("/api/advisor-profile/upload", {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setUploadError(
            typeof data.error === "string" ? data.error : "Upload failed."
          );
          return;
        }
        const url = String(data.publicUrl || "").trim();
        if (!url) {
          setUploadError("Upload did not return a URL.");
          return;
        }
        if (kind === "logo") setSignatureLogoUrl(url);
        else setSignatureDisclosuresImageUrl(url);
      } catch {
        setUploadError("Upload failed.");
      } finally {
        if (kind === "logo") setLogoUploadBusy(false);
        else setDisclosuresImageUploadBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    // Reset the wizard each time it (re)opens and kick off the profile load.
    // Same intentional pattern the LlmSettingsDrawer uses for its loadAll().
    /* eslint-disable react-hooks/set-state-in-effect */
    setStep(0);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void loadAll();
  }, [open, loadAll]);

  // Esc closes (treat as Skip; parent persists the dismissal flag).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onDismiss]);

  const saveAiPrefs = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await advisorFetch("/api/advisor-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider: provider,
          // Per-task overrides remain on the LlmSettingsDrawer for power users —
          // keep the onboarding choice simple.
          llmModelOverrides: null,
          defaultResearchTier: researchTier,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save AI preferences.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Save the text-only signature fields (no branding assets — those go up on
   * the Branding step). Uses `composeEmailSignature()` so the saved
   * `email_signature` matches the page's format byte-for-byte.
   */
  const saveSignature = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const emailSignature = composeEmailSignature();
      const res = await advisorFetch("/api/advisor-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advisorName: signatureName,
          advisorTitle: signatureTitle,
          advisorLicense: signatureLicense,
          calendarLink: signatureCalendarLink,
          officeAddress: signatureAddress,
          officePhone: signatureOfficePhone,
          cellPhone: signatureCellPhone,
          website: signatureWebsite,
          emailSignature,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your signature.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Save branding + disclosures. Uploads happen synchronously as the user
   * picks files; this step just persists the URLs (and the disclosures text)
   * to the profile row.
   */
  const saveBranding = async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await advisorFetch("/api/advisor-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Send the latest composed signature too so it stays in sync with
          // any text edits the user did on the Signature step before paging
          // back and forth.
          emailSignature: composeEmailSignature(),
          logoUrl: signatureLogoUrl || null,
          disclosuresText: signatureDisclosuresText,
          disclosuresImageUrl: signatureDisclosuresImageUrl || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save your branding."
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    if (step === STEP_AI) {
      const ok = await saveAiPrefs();
      if (!ok) return;
    } else if (step === STEP_SIGNATURE) {
      // Allow an "empty" signature step — only POST when at least one text
      // field was filled. Branding lives on the next step.
      const anyTextField =
        signatureName.trim() ||
        signatureTitle.trim() ||
        signatureLicense.trim() ||
        signatureCalendarLink.trim() ||
        signatureAddress.trim() ||
        signatureOfficePhone.trim() ||
        signatureCellPhone.trim() ||
        signatureWebsite.trim();
      if (anyTextField) {
        const ok = await saveSignature();
        if (!ok) return;
      }
    } else if (step === STEP_BRANDING) {
      // Only save when at least one branding field changed from "empty".
      // Otherwise skip the POST so we don't blow away an existing logo with
      // an empty string on edge cases.
      const anyBrandingField =
        signatureLogoUrl ||
        signatureDisclosuresText.trim() ||
        signatureDisclosuresImageUrl;
      if (anyBrandingField) {
        const ok = await saveBranding();
        if (!ok) return;
      }
    }
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  };

  if (!open) return null;

  const isFirstStep = step === 0;
  const isLastStep = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{ colorScheme: "light" }}
      onClick={onDismiss}
    >
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-none border border-slate-200 bg-white shadow-2xl shadow-slate-950/30"
        style={{ color: "#0c1929" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-semibold tracking-[0.18em] text-[var(--ap-navy-mid)] uppercase">
              Welcome · {current.short} · step {step + 1} of {STEPS.length}
            </p>
            <h2
              id="onboarding-title"
              className="mt-1 font-serif text-2xl font-bold text-slate-950"
            >
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-sm text-slate-500 hover:text-slate-900 hover:underline"
          >
            Skip for now
          </button>
        </div>

        <div className="flex h-1 bg-slate-100" aria-hidden>
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-full flex-1 transition-colors ${
                i <= step ? "bg-[var(--ap-royal)]" : "bg-transparent"
              }`}
            />
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-6">
          {loading ? (
            <p className="py-12 text-center text-sm text-slate-500">Loading your account…</p>
          ) : (
            <>
              {step === STEP_WELCOME && <WelcomeStep advisorEmail={advisorEmail} />}
              {step === STEP_AI && (
                <AiModelsStep
                  configured={configured}
                  provider={provider}
                  setProvider={setProvider}
                  researchTier={researchTier}
                  setResearchTier={setResearchTier}
                />
              )}
              {step === STEP_SIGNATURE && (
                <SignatureStep
                  signatureName={signatureName}
                  setSignatureName={setSignatureName}
                  signatureTitle={signatureTitle}
                  setSignatureTitle={setSignatureTitle}
                  signatureLicense={signatureLicense}
                  setSignatureLicense={setSignatureLicense}
                  signatureCalendarLink={signatureCalendarLink}
                  setSignatureCalendarLink={setSignatureCalendarLink}
                  signatureAddress={signatureAddress}
                  setSignatureAddress={setSignatureAddress}
                  signatureOfficePhone={signatureOfficePhone}
                  setSignatureOfficePhone={setSignatureOfficePhone}
                  signatureCellPhone={signatureCellPhone}
                  setSignatureCellPhone={setSignatureCellPhone}
                  signatureWebsite={signatureWebsite}
                  setSignatureWebsite={setSignatureWebsite}
                  preview={composeEmailSignature()}
                />
              )}
              {step === STEP_BRANDING && (
                <BrandingStep
                  signatureLogoUrl={signatureLogoUrl}
                  setSignatureLogoUrl={setSignatureLogoUrl}
                  signatureDisclosuresText={signatureDisclosuresText}
                  setSignatureDisclosuresText={setSignatureDisclosuresText}
                  signatureDisclosuresImageUrl={signatureDisclosuresImageUrl}
                  setSignatureDisclosuresImageUrl={setSignatureDisclosuresImageUrl}
                  logoFileInputRef={logoFileInputRef}
                  disclosuresFileInputRef={disclosuresFileInputRef}
                  logoUploadBusy={logoUploadBusy}
                  disclosuresImageUploadBusy={disclosuresImageUploadBusy}
                  uploadError={uploadError}
                  onUpload={(kind, file) => void uploadAsset(kind, file)}
                />
              )}
              {step === STEP_DONE && <DoneStep />}

              {error ? (
                <div
                  className="mt-5 rounded-none border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  role="alert"
                >
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={isFirstStep || saving || loading}
          >
            Back
          </Button>
          <Button
            type="button"
            className="rounded-none ap-cta-solid px-6"
            onClick={isLastStep ? onFinish : goNext}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : isLastStep ? "Get started" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WelcomeStep({ advisorEmail }: { advisorEmail?: string | null }) {
  return (
    <div className="space-y-5">
      <p className="text-base leading-relaxed text-slate-700">
        AdvisorPilot is the workflow your firm runs every client review through — from custodian
        statements to meeting-ready materials. Take a couple of minutes to set up the basics so
        the first review feels finished, not rough.
      </p>
      <ul className="space-y-3 border-l-2 border-[var(--ap-royal)] pl-5 text-sm text-slate-600">
        <li>
          <span className="font-semibold text-slate-900">Pick an AI provider + research depth.</span>{" "}
          ChatGPT, Gemini, or Grok — used for statement extraction, holdings research, and
          portfolio synthesis.
        </li>
        <li>
          <span className="font-semibold text-slate-900">Fill in your email signature.</span> Name,
          title, license, contact info — used on Client Snapshots and any message you send.
        </li>
        <li>
          <span className="font-semibold text-slate-900">Upload your logo + disclosures.</span>{" "}
          Branding and required compliance text that appear under your signature in HTML emails.
        </li>
      </ul>
      <p className="text-sm text-slate-500">
        You can change any of this later from the account menu (top right). Nothing here is locked in.
        {advisorEmail ? (
          <>
            {" "}Signed in as{" "}
            <span className="font-mono text-slate-700">{advisorEmail}</span>.
          </>
        ) : null}
      </p>
    </div>
  );
}

function AiModelsStep({
  configured,
  provider,
  setProvider,
  researchTier,
  setResearchTier,
}: {
  configured: Record<LlmProvider, boolean>;
  provider: LlmProvider | null;
  setProvider: (p: LlmProvider | null) => void;
  researchTier: ResearchTier | null;
  setResearchTier: (t: ResearchTier | null) => void;
}) {
  return (
    <div className="space-y-7">
      <section>
        <h3 className="font-serif text-base font-bold text-slate-900">AI provider</h3>
        <p className="mt-1 text-sm text-slate-500">
          Used for statement extraction, holdings enrichment, and portfolio synthesis. TTS and STT
          always use OpenAI in v1.
        </p>
        <div className="mt-3 space-y-2">
          {PROVIDERS.map((p) => {
            const ok = configured[p.id];
            const checked = provider === p.id;
            return (
              <label
                key={p.id}
                className={`flex cursor-pointer items-start gap-3 rounded-none border p-4 transition ${
                  ok
                    ? checked
                      ? "border-[var(--ap-royal)] bg-[var(--ap-royal)]/5"
                      : "border-slate-200 hover:bg-slate-50"
                    : "cursor-not-allowed border-slate-200 opacity-50"
                }`}
              >
                <input
                  type="radio"
                  name="onboarding-provider"
                  checked={checked}
                  disabled={!ok}
                  onChange={() => setProvider(p.id)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-900">{p.label}</span>
                    <span
                      className={`shrink-0 text-xs ${
                        ok ? "text-emerald-700" : "text-slate-400"
                      }`}
                    >
                      {ok ? "configured" : "missing API key"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{p.hint}</p>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="font-serif text-base font-bold text-slate-900">Default research depth</h3>
        <p className="mt-1 text-sm text-slate-500">
          Trades speed for thoroughness on per-holding and macro research.
        </p>
        <div className="mt-3 space-y-2">
          {RESEARCH_TIERS.map((t) => {
            const checked = researchTier === t.id;
            return (
              <label
                key={t.id}
                className={`flex cursor-pointer items-start gap-3 rounded-none border p-3 transition ${
                  checked
                    ? "border-[var(--ap-royal)] bg-[var(--ap-royal)]/5"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="onboarding-research"
                  checked={checked}
                  onChange={() => setResearchTier(t.id)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <span className="font-semibold text-slate-900">{t.label}</span>
                  <p className="mt-1 text-xs text-slate-600">{t.hint}</p>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Tip: per-task model overrides are available from the AI Models pill in the top nav after
        onboarding.
      </p>
    </div>
  );
}

function SignatureStep({
  signatureName,
  setSignatureName,
  signatureTitle,
  setSignatureTitle,
  signatureLicense,
  setSignatureLicense,
  signatureCalendarLink,
  setSignatureCalendarLink,
  signatureAddress,
  setSignatureAddress,
  signatureOfficePhone,
  setSignatureOfficePhone,
  signatureCellPhone,
  setSignatureCellPhone,
  signatureWebsite,
  setSignatureWebsite,
  preview,
}: {
  signatureName: string;
  setSignatureName: (s: string) => void;
  signatureTitle: string;
  setSignatureTitle: (s: string) => void;
  signatureLicense: string;
  setSignatureLicense: (s: string) => void;
  signatureCalendarLink: string;
  setSignatureCalendarLink: (s: string) => void;
  signatureAddress: string;
  setSignatureAddress: (s: string) => void;
  signatureOfficePhone: string;
  setSignatureOfficePhone: (s: string) => void;
  signatureCellPhone: string;
  setSignatureCellPhone: (s: string) => void;
  signatureWebsite: string;
  setSignatureWebsite: (s: string) => void;
  preview: string;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        These appear on Client Snapshots and any email you send from AdvisorPilot. Every field is
        optional — leave any of them blank and we&apos;ll skip writing it to your saved profile.
        Logo and disclosures live on the next step.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="text-sm font-semibold text-slate-700">Your name</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureName}
            onChange={(e) => setSignatureName(e.target.value)}
            placeholder="Christopher Perussina"
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-slate-700">Title</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureTitle}
            onChange={(e) => setSignatureTitle(e.target.value)}
            placeholder="President"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-semibold text-slate-700">License line</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureLicense}
            onChange={(e) => setSignatureLicense(e.target.value)}
            placeholder="License #0H38298"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-semibold text-slate-700">Calendar booking link</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureCalendarLink}
            onChange={(e) => setSignatureCalendarLink(e.target.value)}
            placeholder="https://calendly.com/your-link"
          />
          <p className="mt-1 text-xs text-slate-500">
            Clients see this as &ldquo;Book a time on my calendar.&rdquo;
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-semibold text-slate-700">Office address</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureAddress}
            onChange={(e) => setSignatureAddress(e.target.value)}
            placeholder="1255 Treat Blvd Suite 300 Floor 3, Walnut Creek, CA 94597"
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-slate-700">Office phone</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureOfficePhone}
            onChange={(e) => setSignatureOfficePhone(e.target.value)}
            placeholder="(415) 991-2800"
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-slate-700">Cell phone</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureCellPhone}
            onChange={(e) => setSignatureCellPhone(e.target.value)}
            placeholder="(925) 413-8100"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-semibold text-slate-700">Website</label>
          <Input
            className="mt-2 h-11 rounded-none bg-white"
            value={signatureWebsite}
            onChange={(e) => setSignatureWebsite(e.target.value)}
            placeholder="www.AssuredWealthAdvisors.com"
          />
        </div>
      </div>

      <div className="rounded-none border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Signature preview
        </p>
        <pre className="mt-2 whitespace-pre-wrap rounded-none bg-white p-3 text-sm leading-6 text-slate-700">
          {preview || "Your signature preview will appear here."}
        </pre>
      </div>
    </div>
  );
}

function BrandingStep({
  signatureLogoUrl,
  setSignatureLogoUrl,
  signatureDisclosuresText,
  setSignatureDisclosuresText,
  signatureDisclosuresImageUrl,
  setSignatureDisclosuresImageUrl,
  logoFileInputRef,
  disclosuresFileInputRef,
  logoUploadBusy,
  disclosuresImageUploadBusy,
  uploadError,
  onUpload,
}: {
  signatureLogoUrl: string;
  setSignatureLogoUrl: (s: string) => void;
  signatureDisclosuresText: string;
  setSignatureDisclosuresText: (s: string) => void;
  signatureDisclosuresImageUrl: string;
  setSignatureDisclosuresImageUrl: (s: string) => void;
  logoFileInputRef: React.RefObject<HTMLInputElement | null>;
  disclosuresFileInputRef: React.RefObject<HTMLInputElement | null>;
  logoUploadBusy: boolean;
  disclosuresImageUploadBusy: boolean;
  uploadError: string | null;
  onUpload: (kind: "logo" | "disclosures", file: File) => void;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Optional but recommended. The logo shows directly below your signature lines in HTML
        emails, and disclosures appear at the bottom in a smaller font. Images must be JPG, PNG,
        GIF, or WebP, up to 2&nbsp;MB.
      </p>

      {uploadError ? (
        <div
          className="rounded-none border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {uploadError}
        </div>
      ) : null}

      <section>
        <h3 className="font-serif text-base font-bold text-slate-900">Email logo</h3>
        <p className="mt-1 text-xs text-slate-500">
          Scaled to fit the signature (max width 220&nbsp;px in the message).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={logoFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload("logo", f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            disabled={logoUploadBusy}
            onClick={() => logoFileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" aria-hidden />
            {logoUploadBusy ? "Uploading…" : signatureLogoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {signatureLogoUrl ? (
            <Button
              type="button"
              variant="ghost"
              className="rounded-none text-slate-600"
              onClick={() => setSignatureLogoUrl("")}
            >
              Remove
            </Button>
          ) : null}
        </div>
        {signatureLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded preview; same pattern as the legacy in-page card.
          <img
            src={signatureLogoUrl}
            alt="Email logo preview"
            className="mt-3 h-auto max-h-20 w-auto max-w-[220px] border border-slate-100 object-contain"
          />
        ) : null}
      </section>

      <section>
        <h3 className="font-serif text-base font-bold text-slate-900">Disclosures: text</h3>
        <p className="mt-1 text-xs text-slate-500">
          Appears at the bottom of your signature in a smaller font. Use this, the image below, or
          both.
        </p>
        <Textarea
          className="mt-2 min-h-[100px] rounded-none bg-white"
          value={signatureDisclosuresText}
          onChange={(e) => setSignatureDisclosuresText(e.target.value)}
          placeholder="Required disclosures, regulatory text, or a short compliance note…"
        />
      </section>

      <section>
        <h3 className="font-serif text-base font-bold text-slate-900">Disclosures: image</h3>
        <p className="mt-1 text-xs text-slate-500">
          Pre-made disclosure graphic. Scaled to fit the email width (up to 480&nbsp;px).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={disclosuresFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload("disclosures", f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            disabled={disclosuresImageUploadBusy}
            onClick={() => disclosuresFileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" aria-hidden />
            {disclosuresImageUploadBusy
              ? "Uploading…"
              : signatureDisclosuresImageUrl
                ? "Replace image"
                : "Upload disclosure image"}
          </Button>
          {signatureDisclosuresImageUrl ? (
            <Button
              type="button"
              variant="ghost"
              className="rounded-none text-slate-600"
              onClick={() => setSignatureDisclosuresImageUrl("")}
            >
              Remove
            </Button>
          ) : null}
        </div>
        {signatureDisclosuresImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded preview; same pattern as the legacy in-page card.
          <img
            src={signatureDisclosuresImageUrl}
            alt="Disclosures preview"
            className="mt-3 h-auto w-full max-w-lg border border-slate-100 object-contain"
          />
        ) : null}
      </section>

      <p className="text-xs text-slate-500">
        Everything on this step is optional. You can also revisit it later from the account menu →{" "}
        <span className="font-semibold text-slate-900">Email signature</span>.
      </p>
    </div>
  );
}

function DoneStep() {
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);

  const enableCalendarSync = useCallback(async () => {
    setCalendarBusy(true);
    setCalendarStatus(null);
    try {
      const res = await advisorFetch("/api/calendar/google/watch/start", {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = String(json?.error || `Failed (${res.status}).`);
        setCalendarStatus(msg);
        return;
      }
      setCalendarStatus("Google Calendar sync enabled.");
    } catch (err) {
      setCalendarStatus(err instanceof Error ? err.message : "Failed to enable calendar sync.");
    } finally {
      setCalendarBusy(false);
    }
  }, []);

  const syncCalendarNow = useCallback(async () => {
    setCalendarBusy(true);
    setCalendarStatus(null);
    try {
      const res = await advisorFetch("/api/calendar/google/sync", {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = String(json?.error || json?.message || `Failed (${res.status}).`);
        setCalendarStatus(msg);
        return;
      }
      const updated = Number(json?.updatedClients ?? 0);
      const cleared = Number(json?.clearedClients ?? 0);
      setCalendarStatus(
        `Calendar synced. Updated ${updated} client${updated === 1 ? "" : "s"}, cleared ${cleared}.`,
      );
    } catch (err) {
      setCalendarStatus(err instanceof Error ? err.message : "Failed to sync calendar.");
    } finally {
      setCalendarBusy(false);
    }
  }, []);

  return (
    <div className="space-y-5 py-2">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center bg-emerald-100 text-emerald-700">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-5 w-5"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M16.704 5.293a1 1 0 010 1.414l-7.5 7.5a1 1 0 01-1.414 0L3.296 9.707a1 1 0 011.414-1.414l3.79 3.79 6.793-6.79a1 1 0 011.41 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div>
          <p className="font-serif text-lg font-bold text-slate-900">You&apos;re set up.</p>
          <p className="text-sm text-slate-600">
            You can change any of this from the account menu (top right) at any time.
          </p>
        </div>
      </div>
      <div className="rounded-none border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">What&apos;s next</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">
          <li>
            Upload a client statement from the <span className="font-semibold">Upload</span> step,
            or send the client a magic link to upload from their phone.
          </li>
          <li>
            Per-task model overrides live on the <span className="font-semibold">AI Models</span>{" "}
            pill in the top nav.
          </li>
          <li>
            Use the voice agent (⌘/Ctrl + Shift + V) to navigate and search clients hands-free.
          </li>
        </ul>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="font-semibold text-slate-900">Calendar sync (optional)</p>
          <p className="mt-1 text-xs text-slate-600">
            Enable Google Calendar sync to auto-populate <span className="font-semibold">Next meeting</span> in your CRM based
            on calendar invites matched by client email. Client vs advisor initiated is inferred from Google when possible. No AI involved.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              disabled={calendarBusy}
              onClick={() => void enableCalendarSync()}
            >
              {calendarBusy ? "Enabling…" : "Enable Google Calendar sync"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              disabled={calendarBusy}
              onClick={() => void syncCalendarNow()}
            >
              {calendarBusy ? "Syncing…" : "Sync calendar now"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="rounded-none text-slate-600"
              disabled={calendarBusy}
              onClick={() => setCalendarStatus(null)}
            >
              Clear
            </Button>
          </div>
          {calendarStatus ? (
            <p className="mt-2 text-xs text-slate-600" role="status">
              {calendarStatus}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
