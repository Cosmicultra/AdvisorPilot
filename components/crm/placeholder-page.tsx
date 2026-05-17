/**
 * Placeholder page used by Phase 0 routes that haven't been built yet.
 * Renders inside the CRM shell, shows the route's title + which phase will
 * fill it in + a fallback link back to the legacy workflow.
 *
 * Each Phase 0 placeholder route imports this with its own props; once the
 * route is built for real, the import is replaced with the actual UI.
 */

import Link from "next/link";
import { TopHeader } from "./top-header";

export type PlaceholderPageProps = {
  title: string;
  subtitle?: string;
  phase: string;
  description?: string;
  legacyHref?: string;
  legacyLabel?: string;
};

export function PlaceholderPage({
  title,
  subtitle,
  phase,
  description,
  legacyHref = "/app",
  legacyLabel = "Open the legacy workflow",
}: PlaceholderPageProps) {
  return (
    <>
      <TopHeader title={title} subtitle={subtitle} />

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div
          className="w-full max-w-[480px] border bg-white px-7 py-8"
          style={{ borderColor: "var(--ap-border)" }}
        >
          <p
            className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--ap-royal)" }}
          >
            {phase}
          </p>
          <h2
            className="mb-3 font-display text-[22px] font-semibold leading-tight"
            style={{ color: "var(--ap-navy)" }}
          >
            {title}
          </h2>
          <p
            className="mb-5 text-[13px] leading-snug"
            style={{ color: "var(--ap-gray)" }}
          >
            {description ??
              "This surface is part of the CRM rollout and isn't ready yet. Use the link below to keep working in the existing app while the new shell is built out."}
          </p>
          <Link
            href={legacyHref}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--ap-royal)" }}
          >
            {legacyLabel} →
          </Link>
        </div>
      </div>
    </>
  );
}
