"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export default function ClientMagicUploadPage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token : "";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (files.length === 0) {
      setError("Please choose at least one statement file (PDF or photo).");
      return;
    }

    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("token", token);
      files.forEach((file) => fd.append("files", file));
      if (firstName.trim()) fd.set("firstName", firstName.trim());
      if (lastName.trim()) fd.set("lastName", lastName.trim());
      if (email.trim()) fd.set("advisorEmail", email.trim());

      const res = await fetch("/api/client-upload/ingest", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Something went wrong. You can try again.");
        return;
      }

      setMessage(data.message || "Upload received. You can close this page.");
      setFiles([]);
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-teal-50/40 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 text-center">
          <p className="font-serif text-2xl font-bold text-slate-900">AdvisorPilot</p>
          <p className="mt-1 text-sm text-slate-600">Secure statement upload for your advisor</p>
        </div>

        <Card className="rounded-3xl border-slate-200 shadow-lg">
          <CardContent className="space-y-5 p-6 md:p-8">
            <div>
              <h1 className="font-serif text-xl font-bold text-slate-900">Upload your statement</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Your advisor sent you this private link. Upload a PDF or clear photos of your statement. Only your
                advisor can open what you send.
              </p>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700">First name (optional)</label>
                  <Input
                    className="mt-1 h-12 rounded-2xl"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Last name (optional)</label>
                  <Input
                    className="mt-1 h-12 rounded-2xl"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Your email (optional)</label>
                <Input
                  className="mt-1 h-12 rounded-2xl"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="If you want reports sent here later"
                  autoComplete="email"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Statement file(s)</label>
                <Input
                  className="mt-1 min-h-12 rounded-2xl file:mr-3 file:rounded-lg file:border-0 file:bg-teal-700 file:px-3 file:py-2 file:text-sm file:text-white"
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
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
              )}
              {message && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  {message}
                </div>
              )}

              <Button
                type="submit"
                className="h-14 w-full rounded-2xl bg-gradient-to-br from-teal-700 to-blue-800 text-base touch-manipulation"
                disabled={busy}
              >
                {busy ? "Uploading and reading statement…" : "Send to my advisor"}
              </Button>
            </form>

            <p className="text-center text-xs text-slate-500">
              For discussion with a financial professional only. Not a solicitation.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
