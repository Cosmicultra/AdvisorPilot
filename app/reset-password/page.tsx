"use client";

import Link from "next/link";
import { useSyncExternalStore, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoBlock } from "@/components/logo-block";

function parseRecoveryTokenFromHash(): string | null {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  if (params.get("type") !== "recovery") return null;
  return params.get("access_token");
}

function useRecoveryAccessToken(): { isClient: boolean; accessToken: string | null } {
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const accessToken = useSyncExternalStore(
    () => () => {},
    () => parseRecoveryTokenFromHash(),
    () => null
  );
  return { isClient, accessToken };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const { isClient, accessToken } = useRecoveryAccessToken();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setError("");

    if (!accessToken) {
      setError("Invalid or expired reset link. Request a new one from the login page.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not reset password.");
        return;
      }
      router.replace("/login?reset=success");
    } catch {
      setError("Could not reset password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[var(--ap-navy)]">
      <header className="border-b border-[var(--ap-border)] bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 md:px-8">
          <Link href="/login" className="text-sm font-semibold text-[var(--ap-navy-mid)] hover:text-[var(--ap-royal)]">
            ← Back to login
          </Link>
        </div>
      </header>

      <div className="mx-auto flex min-h-[80vh] max-w-md items-center justify-center p-4">
        <div className="w-full rounded-none border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <LogoBlock />
          <h1 className="mt-6 font-serif text-2xl font-bold text-slate-950">Choose a new password</h1>
          <p className="mt-2 text-sm text-slate-600">Enter and confirm your new password below.</p>

          {!isClient ? (
            <p className="mt-6 text-sm text-slate-600" aria-live="polite">
              Checking your reset link…
            </p>
          ) : !accessToken ? (
            <p className="mt-6 rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
              This reset link is invalid or has expired.{" "}
              <Link href="/login" className="font-semibold underline">
                Request a new link
              </Link>
              .
            </p>
          ) : (
            <div className="mt-6 space-y-3">
              <Input
                type="password"
                placeholder="New password"
                className="h-12 rounded-none"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                className="h-12 rounded-none"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              {error ? (
                <p className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                className="h-12 w-full rounded-none ap-cta-solid"
                onClick={() => void handleSubmit()}
                disabled={busy}
              >
                {busy ? "Updating…" : "Update password"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
