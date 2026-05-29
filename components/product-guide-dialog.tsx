"use client";

/**
 * Multi-step beginner guide — what AdvisorPilot is and how to use it.
 * Separate from OnboardingDialog (profile / AI / signature setup).
 */

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getGuideCopy,
  type GuideStepCopy,
  type GuideStepId,
} from "@/lib/product-guide/guide-content";
import {
  PRODUCT_GUIDE_STEPS,
  resolveProductGuideShell,
} from "@/lib/product-guide/steps";

export const AP_PRODUCT_GUIDE_DISMISSED_AT = "ap_product_guide_dismissed_at";

export interface ProductGuideDialogProps {
  open: boolean;
  onDismiss: () => void;
  onFinish: () => void;
  advisorEmail?: string | null;
}

export function ProductGuideDialog({
  open,
  onDismiss,
  onFinish,
  advisorEmail,
}: ProductGuideDialogProps) {
  const pathname = usePathname() ?? "";
  const shell = resolveProductGuideShell(pathname);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onDismiss]);

  if (!open) return null;

  const isFirstStep = step === 0;
  const isLastStep = step === PRODUCT_GUIDE_STEPS.length - 1;
  const current = PRODUCT_GUIDE_STEPS[step];
  const Icon = current.icon;
  const copy = getGuideCopy(current.id as GuideStepId, shell);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-guide-title"
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
              Guide · {current.short} · step {step + 1} of {PRODUCT_GUIDE_STEPS.length}
            </p>
            <h2
              id="product-guide-title"
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
          {PRODUCT_GUIDE_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-full flex-1 transition-colors ${
                i <= step ? "bg-[var(--ap-royal)]" : "bg-transparent"
              }`}
            />
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-6">
          <div className="mb-4 flex h-10 w-10 items-center justify-center bg-[var(--ap-royal)]/10">
            <Icon className="h-5 w-5 text-[var(--ap-royal)]" strokeWidth={1.75} aria-hidden />
          </div>
          <GuideStepContent
            copy={copy}
            advisorEmail={current.id === "welcome" ? advisorEmail : undefined}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            className="rounded-none"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={isFirstStep}
          >
            Back
          </Button>
          <Button
            type="button"
            className="rounded-none ap-cta-solid px-6"
            onClick={isLastStep ? onFinish : () => setStep((s) => s + 1)}
          >
            {isLastStep ? "Done" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GuideStepContent({
  copy,
  advisorEmail,
}: {
  copy: GuideStepCopy;
  advisorEmail?: string | null;
}) {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-slate-700">
      <p>{copy.lead}</p>
      {copy.aiRecommendation ? (
        <GuideAiCallout>{copy.aiRecommendation}</GuideAiCallout>
      ) : null}
      {copy.bullets.length > 0 ? (
        <ul className="space-y-2 border-l-2 border-[var(--ap-royal)] pl-5">
          {copy.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {copy.tip ? <GuideTip>{copy.tip}</GuideTip> : null}
      {advisorEmail ? (
        <p className="text-slate-500">
          Signed in as <span className="font-mono text-slate-700">{advisorEmail}</span>.
        </p>
      ) : null}
    </div>
  );
}

function GuideAiCallout({ children }: { children: string }) {
  return (
    <p className="border-l-[3px] border-[var(--ap-royal)] bg-[rgba(36,99,235,0.06)] px-3 py-2.5 text-slate-800">
      {children}
    </p>
  );
}

function GuideTip({ children }: { children: string }) {
  return (
    <p className="rounded-none border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-slate-800">
      {children}
    </p>
  );
}
