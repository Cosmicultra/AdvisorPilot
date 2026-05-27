"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ForgotPasswordDialogProps = {
  open: boolean;
  onClose: () => void;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function ForgotPasswordDialog({ open, onClose }: ForgotPasswordDialogProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function resetForm() {
    setEmail("");
    setError("");
    setSuccess(false);
    setBusy(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit() {
    setError("");
    const trimmedEmail = email.trim();

    if (!isValidEmail(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send reset email.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Could not send reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="forgot-password-dialog-title"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-none border border-slate-200 bg-white shadow-2xl shadow-slate-950/30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 id="forgot-password-dialog-title" className="font-serif text-xl font-bold text-slate-950">
            Reset your password
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Enter the email for your account and we&apos;ll send a reset link.
          </p>
        </div>

        <div className="space-y-3 px-6 py-5">
          {success ? (
            <p className="rounded-none border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
              If an account exists for that email, we sent a reset link.
            </p>
          ) : (
            <>
              <Input
                type="email"
                placeholder="Email"
                className="h-12 rounded-none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              {error ? (
                <p className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-6 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-11 rounded-none" onClick={handleClose} disabled={busy}>
            {success ? "Close" : "Cancel"}
          </Button>
          {!success ? (
            <Button type="button" className="h-11 rounded-none ap-cta-solid" onClick={() => void handleSubmit()} disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
