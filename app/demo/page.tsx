import Link from "next/link";
import { BarChart3, FileText, MessageSquareText, MonitorPlay, Upload } from "lucide-react";
import { MarketingSiteFooter } from "@/components/marketing-site-footer";
import { MarketingSiteHeader } from "@/components/marketing-site-header";

const DEMO_CAPABILITIES = [
  {
    title: "Statement capture",
    description:
      "Advisor upload or secure client link. Extraction builds a holdings table you confirm before any analysis runs.",
    icon: Upload,
  },
  {
    title: "Confirm holdings & registration",
    description:
      "Qualified, Roth, and taxable context in one place so narrative and reports match how you already talk about buckets.",
    icon: FileText,
  },
  {
    title: "Portfolio review & analysis",
    description:
      "Advisor-facing synopsis, scores, stress framing, and talking points you edit before the client sees anything.",
    icon: BarChart3,
  },
  {
    title: "Meeting guide & deliverables",
    description:
      "Walk the conversation from your workspace, then export or draft follow-up materials under your disclosures.",
    icon: MessageSquareText,
  },
] as const;

export default function DemoPage() {
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
            <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">Product tour</p>
            <h1 className="mt-4 max-w-3xl font-serif text-3xl font-bold tracking-tight md:text-4xl">
              See how AdvisorPilot supports the work behind each review.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--ap-gray)]">
              Below is a walkthrough of the core workflow. Drop in product screenshots or a short video when you are ready
              (for example under <code className="rounded-none bg-slate-100 px-1.5 py-0.5 text-sm">public/demo/</code>).
            </p>
          </div>
        </section>

        <section className="border-b border-[var(--ap-border)] bg-[#f5f6f8]">
          <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">
                  Optional video
                </p>
                <h2 className="mt-2 font-serif text-2xl font-bold text-[var(--ap-navy)]">Walkthrough recording</h2>
                <p className="mt-2 max-w-xl text-sm text-[var(--ap-gray)]">
                  Embed a Loom, Vimeo, or YouTube video in this section when you have a narrator-led tour.
                </p>
              </div>
            </div>
            <div className="mt-8 flex aspect-video max-w-4xl items-center justify-center border-2 border-dashed border-[var(--ap-border)] bg-white px-6 text-center">
              <div className="flex flex-col items-center gap-3 py-12">
                <MonitorPlay className="h-12 w-12 text-[var(--ap-pilot-light-border)]" strokeWidth={1.25} aria-hidden />
                <p className="max-w-md text-sm text-[var(--ap-gray)]">
                  Video embed placeholder. Replace this block with an iframe or Next.js-friendly embed component.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
            <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">Screenshots</p>
            <h2 className="mt-3 font-serif text-2xl font-bold text-[var(--ap-navy)] md:text-3xl">
              Capability highlights
            </h2>
            <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-x-8 md:gap-y-12">
              {DEMO_CAPABILITIES.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="flex flex-col border border-[var(--ap-border)] bg-[#fafbfc]">
                    <div className="relative flex aspect-[16/10] items-center justify-center bg-[#eef1f6]">
                      <div className="flex max-w-sm flex-col items-center gap-2 px-6 text-center">
                        <Icon className="h-10 w-10 text-[var(--ap-navy-mid)] opacity-80" strokeWidth={1.25} aria-hidden />
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ap-gray)]">
                          Screenshot: {item.title}
                        </p>
                      </div>
                    </div>
                    <div className="border-t border-[var(--ap-border)] bg-white p-6">
                      <h3 className="font-serif text-xl font-bold text-[var(--ap-navy)]">{item.title}</h3>
                      <p className="mt-3 text-sm leading-relaxed text-[var(--ap-gray)]">{item.description}</p>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="mt-12 text-center text-sm text-[var(--ap-gray)]">
              Already onboard?{" "}
              <Link href="/login" className="font-semibold text-[var(--ap-royal)] hover:underline">
                Advisor login
              </Link>
              . Considering access?{" "}
              <Link href="/pricing" className="font-semibold text-[var(--ap-royal)] hover:underline">
                Pricing &amp; access
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
