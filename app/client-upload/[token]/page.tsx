"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ClientLinkIntakeForm } from "@/components/client-link-intake-form";
import {
  intakeIncompleteStepTitles,
  isIntakeComplete,
  normalizeIntakeClient,
  RISK_PROFILES,
  type IntakeClient,
} from "@/lib/intake-config";
import {
  computeRiskProfileFromQuiz,
  isRiskQuizComplete,
} from "@/lib/risk-questionnaire";
import type { RiskProfileId } from "@/lib/risk-profiles";

function normalizeRiskGateFromSnapshot(raw: unknown): IntakeClient {
  const n = normalizeIntakeClient(raw);
  if (n.riskIntakeScreen === "gate" && isRiskQuizComplete(n.riskQuizAnswers)) {
    const { profile } = computeRiskProfileFromQuiz(n.riskQuizAnswers);
    return {
      ...n,
      riskProfile: profile,
      riskProfileSuggested: profile,
      riskIntakeScreen: "result",
      riskIntakeKnown: "no",
    };
  }
  if (
    n.riskIntakeScreen === "gate" &&
    RISK_PROFILES.includes(n.riskProfile as RiskProfileId) &&
    Object.keys(n.riskQuizAnswers).length === 0
  ) {
    return { ...n, riskIntakeScreen: "known", riskIntakeKnown: "yes" };
  }
  return n;
}

export default function ClientMagicUploadPage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token : "";

  const [phase, setPhase] = useState<"profile" | "upload" | "done">("profile");
  const [contextLoading, setContextLoading] = useState(() => Boolean(token));
  const [contextError, setContextError] = useState("");
  const [linkExpiresAt, setLinkExpiresAt] = useState("");
  const [intake, setIntake] = useState<IntakeClient>(() => normalizeIntakeClient({}));

  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [validationHint, setValidationHint] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/client-upload-context/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setContextError(String(data.error || "This link is not valid."));
          return;
        }
        if (!cancelled) {
          setLinkExpiresAt(String(data.expiresAt || ""));
          setIntake(normalizeRiskGateFromSnapshot(data.intakeSnapshot ?? {}));
        }
      } catch {
        if (!cancelled) setContextError("Could not load this link. Check your connection.");
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  function retryLoad() {
    setContextLoading(true);
    setContextError("");
    void (async () => {
      try {
        const res = await fetch(`/api/client-upload-context/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setContextError(String(data.error || "This link is not valid."));
          return;
        }
        setLinkExpiresAt(String(data.expiresAt || ""));
        setIntake(normalizeRiskGateFromSnapshot(data.intakeSnapshot ?? {}));
      } catch {
        setContextError("Could not load this link. Check your connection.");
      } finally {
        setContextLoading(false);
      }
    })();
  }

  function goToUpload() {
    setError("");
    setValidationHint([]);
    if (!isIntakeComplete(intake)) {
      setValidationHint(intakeIncompleteStepTitles(intake));
      return;
    }
    setPhase("upload");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!isIntakeComplete(intake)) {
      setValidationHint(intakeIncompleteStepTitles(intake));
      setPhase("profile");
      setError("Please complete your profile before uploading.");
      return;
    }

    if (files.length === 0) {
      setError("Please choose at least one statement file (PDF or photo).");
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("token", token);
      files.forEach((file) => fd.append("files", file));
      fd.set("intakeJson", JSON.stringify(intake));

      const res = await fetch("/api/client-upload/ingest", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Something went wrong. You can try again.");
        if (Array.isArray(data.missingSteps) && data.missingSteps.length > 0) {
          setValidationHint(data.missingSteps.map(String));
          setPhase("profile");
        }
        return;
      }

      setMessage(data.message || "Upload received. You can close this page.");
      setFiles([]);
      setPhase("done");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <p className="text-slate-600">Invalid link.</p>
      </div>
    );
  }

  return (
    <div className="ap-app-bg min-h-screen px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 text-center">
          <p className="font-serif text-2xl font-bold text-slate-900">AdvisorPilot</p>
          <p className="mt-1 text-sm text-slate-600">Secure profile confirmation and statement upload</p>
          {linkExpiresAt ? (
            <p className="mt-2 text-xs text-slate-500">
              Link expires {new Date(linkExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          ) : null}
        </div>

        {contextLoading ? (
          <Card className="rounded-none border-slate-200 shadow-lg">
            <CardContent className="p-8 text-center text-slate-600">Loading your link…</CardContent>
          </Card>
        ) : contextError ? (
          <Card className="rounded-none border-slate-200 shadow-lg">
            <CardContent className="space-y-3 p-8">
              <p className="text-center text-red-800">{contextError}</p>
              <Button type="button" variant="outline" className="h-11 w-full rounded-none" onClick={retryLoad}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {phase !== "done" ? (
              <div className="mb-6 flex rounded-none border border-slate-200 bg-white p-0 text-sm shadow-sm">
                <button
                  type="button"
                  className={`flex-1 rounded-none py-2.5 font-semibold transition ${phase === "profile" ? "ap-segment-active" : "text-slate-600"}`}
                  onClick={() => setPhase("profile")}
                >
                  1 · Profile
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-none py-2.5 font-semibold transition ${phase === "upload" ? "ap-segment-active" : "text-slate-600"}`}
                  onClick={() => goToUpload()}
                >
                  2 · Statements
                </button>
              </div>
            ) : null}

            {phase === "profile" ? (
              <Card className="rounded-none border-slate-200 shadow-lg">
                <CardContent className="space-y-5 p-6 md:p-8">
                  <div>
                    <h1 className="font-serif text-xl font-bold text-slate-900">Your profile</h1>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      Your advisor invited you here to verify your answers and securely send statement files. Everything below is submitted with your uploads so they can resume your review immediately.
                    </p>
                  </div>

                  <ClientLinkIntakeForm value={intake} onChange={setIntake} />

                  {validationHint.length > 0 ? (
                    <div className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                      <p className="font-semibold">Still needed:</p>
                      <ul className="mt-2 list-disc pl-5">
                        {validationHint.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    className="h-14 w-full rounded-none ap-cta-solid text-base touch-manipulation"
                    onClick={() => goToUpload()}
                  >
                    Continue to statements
                  </Button>
                  <p className="text-center text-xs text-slate-500">
                    For discussion with a financial professional only. Not a solicitation.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {phase === "upload" ? (
              <Card className="rounded-none border-slate-200 shadow-lg">
                <CardContent className="space-y-5 p-6 md:p-8">
                  <div>
                    <h1 className="font-serif text-xl font-bold text-slate-900">Upload your statement(s)</h1>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      Choose a PDF or clear photos of your statement. You can attach more than one file if your holdings span multiple statements.
                    </p>
                  </div>

                  <form className="space-y-4" onSubmit={onSubmit}>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Statement file(s)</label>
                      <Input
                        className="mt-1 min-h-12 rounded-none file:mr-3 file:rounded-none file:border-0 file:bg-[#0f6fde] file:px-3 file:py-2 file:text-sm file:text-white"
                        type="file"
                        accept=".pdf,image/*"
                        capture="environment"
                        multiple
                        onChange={(e) => setFiles(Array.from(e.target.files || []))}
                      />
                      <p className="mt-1 text-xs text-slate-500">PDF or photos (JPG/PNG). Max 25 MB per file.</p>
                      {files.length > 0 ? (
                        <p className="mt-2 text-xs text-slate-600">
                          Selected: {files.map((file) => file.name).join(", ")}
                        </p>
                      ) : null}
                    </div>

                    {error && (
                      <div className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
                    )}
                    {message ? (
                      <div className="rounded-none border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        {message}
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-2">
                      <Button
                        type="submit"
                        className="h-14 w-full rounded-none ap-cta-solid text-base touch-manipulation"
                        disabled={busy}
                      >
                        {busy ? "Uploading and reading statement…" : "Send profile and statements to advisor"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full rounded-none"
                        onClick={() => setPhase("profile")}
                        disabled={busy}
                      >
                        Back to profile
                      </Button>
                    </div>
                  </form>

                  <p className="text-center text-xs text-slate-500">
                    For discussion with a financial professional only. Not a solicitation.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {phase === "done" ? (
              <Card className="rounded-none border-slate-200 shadow-lg">
                <CardContent className="space-y-4 p-8 text-center">
                  <h2 className="font-serif text-xl font-bold text-slate-900">You&apos;re all set</h2>
                  <p className="text-sm text-slate-600">
                    {message || "Your advisor will open your confirmed profile and statement upload in AdvisorPilot."}
                  </p>
                  <p className="text-xs text-slate-500">You can close this browser tab anytime.</p>
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
