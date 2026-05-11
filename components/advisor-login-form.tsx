"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoBlock } from "@/components/logo-block";
import { AP_SUPABASE_AT, AP_SUPABASE_RT } from "@/lib/advisor-fetch";

export function AdvisorLoginForm() {
  const router = useRouter();
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  async function handleEmailSignup() {
    try {
      setAuthMessage("");
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          type: "signup",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthMessage(data.error || "Could not create account.");
        return;
      }
      setAuthMessage("Account created. You can now log in.");
    } catch {
      setAuthMessage("Could not create account.");
    }
  }

  async function handleEmailLogin() {
    try {
      setAuthMessage("");
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          type: "login",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthMessage(data.error || "Could not log in.");
        return;
      }
      if (typeof window !== "undefined" && data.session?.access_token) {
        sessionStorage.setItem(AP_SUPABASE_AT, data.session.access_token);
      }
      if (typeof window !== "undefined" && data.session?.refresh_token) {
        sessionStorage.setItem(AP_SUPABASE_RT, data.session.refresh_token);
      }
      router.replace("/app");
      router.refresh();
    } catch {
      setAuthMessage("Could not log in.");
    }
  }

  return (
    <div className="mx-auto flex min-h-[88vh] max-w-5xl items-center justify-center p-4 md:p-8">
      <div className="ap-glass ap-step-enter w-full rounded-none border border-[var(--ap-border)] shadow-sm">
        <div className="grid gap-8 p-6 md:grid-cols-[1fr_1.1fr] md:p-10">
          <div className="flex flex-col justify-center">
            <LogoBlock />
            <h1 className="mt-8 font-serif text-4xl font-bold tracking-tight text-slate-950 md:text-5xl">Sign in to AdvisorPilot</h1>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              Analyze client statements, generate polished portfolio reports, and manage client reviews from one advisor workspace.
            </p>
            <div className="mt-6 rounded-none border border-[var(--ap-pilot-light-border)] bg-[#f0f6fc] p-5 text-sm leading-6 text-[var(--ap-navy)]">
              Google sign-in enables direct Gmail sending. Email/password accounts can still use the app, download reports, and copy generated
              follow-up emails manually.
            </div>
          </div>

          <div className="rounded-none border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <Button className="h-12 w-full rounded-none ap-cta-solid" onClick={() => signIn("google", { callbackUrl: "/app" })}>
              Continue with Google
            </Button>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs uppercase tracking-wide text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="space-y-3">
              <Input
                type="email"
                placeholder="Email"
                className="h-12 rounded-none"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Password"
                className="h-12 rounded-none"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant="outline" className="h-12 rounded-none" onClick={() => void handleEmailLogin()}>
                  Login
                </Button>
                <Button className="h-12 rounded-none ap-cta-solid" onClick={() => void handleEmailSignup()}>
                  Create Account
                </Button>
              </div>
              {authMessage ? (
                <p className="rounded-none border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{authMessage}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
