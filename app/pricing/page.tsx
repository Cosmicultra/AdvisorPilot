import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MarketingSiteFooter } from "@/components/marketing-site-footer";
import { MarketingSiteHeader } from "@/components/marketing-site-header";
import { MARKETING_CONTACT_EMAIL } from "@/lib/marketing-constants";

function mailtoHref(subject: string) {
  const q = new URLSearchParams({ subject });
  return `mailto:${MARKETING_CONTACT_EMAIL}?${q.toString()}`;
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#fafbfc] text-[var(--ap-navy)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:text-[var(--ap-navy)]"
      >
        Skip to main content
      </a>
      <MarketingSiteHeader />

      <main id="main-content">
        <section className="border-b border-[var(--ap-border)] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
            <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">
              Pricing &amp; access
            </p>
            <h1 className="mt-4 max-w-3xl font-serif text-3xl font-bold tracking-tight md:text-[2.65rem] md:leading-tight">
              We are not publishing a public rate card while we onboard early firms.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--ap-gray)]">
              AdvisorPilot is priced for the value of running repeatable, reviewable client work: intake through
              documentation, with your firm retaining full control of advice and client communications. If you are
              evaluating fit for a solo practice, an ensemble, or a broader rollout, the next step is a short conversation,
              not a generic SKU.
            </p>
          </div>
        </section>

        <section className="border-b border-[var(--ap-border)] bg-[#f5f6f8]">
          <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
            <h2 className="font-serif text-2xl font-bold text-[var(--ap-navy)]">What we align on before quoting</h2>
            <ul className="mt-6 max-w-3xl space-y-3 text-sm leading-relaxed text-[var(--ap-gray)]">
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ap-royal)]" aria-hidden />
                <span>Number of seats, intake volume, and how reviews currently move through your stack.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ap-royal)]" aria-hidden />
                <span>Support expectations, onboarding timing, and any supervisory or documentation standards we should respect.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ap-royal)]" aria-hidden />
                <span>Pilot versus production terms so billing matches how your firm actually adopts software.</span>
              </li>
            </ul>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                asChild
                className="h-12 rounded-none bg-[var(--ap-navy)] px-8 text-base font-semibold text-white hover:bg-[var(--ap-navy-mid)]"
              >
                <a href={mailtoHref("AdvisorPilot access request")}>Request access</a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 rounded-none border-[var(--ap-navy)] bg-white px-8 text-base font-semibold text-[var(--ap-navy)] hover:bg-[var(--ap-navy)] hover:text-white"
              >
                <a href={mailtoHref("AdvisorPilot sales inquiry")}>Talk to sales</a>
              </Button>
            </div>
            <p className="mt-6 text-xs text-[var(--ap-gray)]">
              Messages open to{" "}
              <a className="font-medium text-[var(--ap-navy)] underline decoration-[var(--ap-border)] underline-offset-2" href={`mailto:${MARKETING_CONTACT_EMAIL}`}>
                {MARKETING_CONTACT_EMAIL}
              </a>
              . Set <code className="rounded-none bg-white px-1 py-0.5 text-[0.7rem]">NEXT_PUBLIC_CONTACT_EMAIL</code> in{" "}
              <code className="rounded-none bg-white px-1 py-0.5 text-[0.7rem]">.env.local</code> to use your firm&apos;s inbox.
            </p>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
            <p className="text-sm leading-relaxed text-[var(--ap-gray)]">
              Product walkthrough:{" "}
              <Link href="/demo" className="font-semibold text-[var(--ap-royal)] hover:underline">
                Demo
              </Link>
              . Returning user:{" "}
              <Link href="/login" className="font-semibold text-[var(--ap-royal)] hover:underline">
                Advisor login
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      <MarketingSiteFooter />
    </div>
  );
}
