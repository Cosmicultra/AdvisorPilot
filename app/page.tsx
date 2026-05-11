import Image from "next/image";
import { CircleCheck, FileStack, FileText, LineChart } from "lucide-react";
import { MarketingSiteFooter } from "@/components/marketing-site-footer";
import { MarketingSiteHeader } from "@/components/marketing-site-header";

const HERO_FLOW_CARDS = [
  {
    icon: FileStack,
    title: "Ingest & confirm",
    description:
      "Bring custodian statements in through advisor upload or a secure client link. Reconcile positions before analysis depends on them.",
  },
  {
    icon: LineChart,
    title: "Analyze & narrate",
    description:
      "Structure risk, diversification, and scenario context into drafts your team edits, so meetings start from one narrative base.",
  },
  {
    icon: FileText,
    title: "Document & follow up",
    description:
      "Package meeting materials and correspondence for supervisory review, then release through the channels and disclosures you already use.",
  },
] as const;

const WHY_BULLETS = [
  "A single workflow replaces fragmented PDF, spreadsheet, and email drafts for recurring reviews.",
  "Traceability from intake to outbound materials supports supervision, not ad hoc heroics the night before a meeting.",
  "Separation of operational preparation from fiduciary judgment: software does not substitute advice or suitability.",
  "Built for independents and small ensembles that need wirehouse-grade discipline without wirehouse infrastructure.",
] as const;

const WORKFLOW_PILLARS = [
  {
    title: "Statement intelligence",
    subtitle: "From custodian PDFs to an auditable book of record",
    imageSrc:
      "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=900&q=80",
    imageAlt: "Advisor reviewing portfolio documents and statements at a desk",
    intro:
      "Portfolio reviews start with data integrity. AdvisorPilot ingests statements through advisor upload or a secure client link, extracts holdings and registration context, and presents them in one structured workspace, so your team is not reconciling three versions of the same account the night before a meeting.",
    bullets: [
      "Standardize symbols, account labels, and line items to prevent duplication or omission as reviews move from analyst to advisor.",
      "Surface registration and tax-location context early (qualified, Roth, taxable, and other buckets), before analysis and client messaging depend on it.",
      "Flag anomalies while the book is still editable: missing balances, unusual concentration, and line items that warrant a second look.",
    ],
  },
  {
    title: "Portfolio narrative",
    subtitle: "Analysis and language that match how you counsel clients",
    imageSrc:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=80",
    imageAlt: "Financial professionals reviewing portfolio charts and performance on a monitor",
    intro:
      "Once positions are confirmed, the work shifts to judgment: risk, diversification, income, tax location, and long-term outcomes. AdvisorPilot generates structured summaries, scenario framing, and advisor-facing prompts you refine. The output is not generic marketing language, but a coherent draft aligned to the household on your calendar.",
    bullets: [
      "Move from positions to themes clients can restate in their own words: risk budget, income reliability, diversification, and concentration.",
      "Produce meeting prep and talking points consistent with your firm’s voice, then edit before anything is shared externally.",
      "Preserve continuity across the team: analysts and lead advisors work from the same analysis and narrative base.",
    ],
  },
  {
    title: "Deliverables you can stand",
    subtitle: "Materials and correspondence ready for supervisory review",
    imageSrc:
      "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=900&q=80",
    imageAlt: "Overhead view of a planning desk with laptop, charts, and client-review documents",
    intro:
      "The review ends in artifacts: what the client sees, what the file shows, and what follows by email. Outputs are designed as editable drafts with clear disclosure space and firm-specific language, so internal approval is a checkpoint, not a rewrite cycle.",
    bullets: [
      "Export meeting-ready summaries and client-facing layouts suitable for print or archive from a single workflow.",
      "Draft follow-up communications that reflect the same facts and themes as the meeting, then apply your disclosures and send through your existing channels.",
      "Nothing is transmitted on your behalf without your action; you retain control of client communication and documentation standards.",
    ],
  },
] as const;

export default function HomePage() {
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
        {/* Hero: McKinsey-style typography + Fidelity-like secondary row of clear “paths” */}
        <section className="border-b border-[var(--ap-border)] bg-white">
          <div className="mx-auto max-w-6xl px-4 pt-16 pb-0 md:px-8 md:pt-20 lg:pt-24">
            <div className="grid gap-12 lg:grid-cols-12 lg:gap-16 lg:items-start">
              <div className="lg:col-span-7">
                <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">
                  Client review operations
                </p>
                <h1 className="mt-5 font-serif text-4xl font-bold leading-[1.1] tracking-tight text-[var(--ap-navy)] md:text-5xl lg:text-[3.35rem]">
                  Operational discipline for portfolio reviews, without adding headcount.
                </h1>
                <p className="mt-8 max-w-2xl text-lg leading-[1.65] text-[var(--ap-gray)] md:text-xl">
                  AdvisorPilot is purpose-built workflow software for independent advisors and small ensembles. It connects
                  custodian statements, internal analysis, and client-ready materials in one sequence, so your firm spends less
                  capacity on transcription and more on advice, supervision, and relationships.
                </p>
                <p className="mt-5 max-w-2xl border-l-2 border-[var(--ap-royal)] pl-5 text-base leading-[1.7] text-[var(--ap-gray)]">
                  Where reviews break is rarely the meeting. It is the handoffs: PDFs in email, positions in spreadsheets, and
                  narrative drafted in haste. We make that preparatory work explicit, repeatable, and reviewable, without
                  replacing your fiduciary judgment or regulatory obligations.
                </p>
              </div>

              <aside className="lg:col-span-5">
                <div className="border border-[var(--ap-border)] bg-[#f8f9fb] p-6 md:p-8">
                  <p className="text-[0.65rem] font-semibold tracking-[0.2em] text-[var(--ap-navy-mid)] uppercase">
                    What the platform covers
                  </p>
                  <p className="mt-3 font-serif text-xl font-bold leading-snug text-[var(--ap-navy)]">
                    Three layers beneath every client review.
                  </p>
                  <ul className="mt-6 space-y-5 border-t border-[var(--ap-border)] pt-6">
                    {[
                      {
                        n: "01",
                        t: "Data foundation",
                        d: "Structured intake, registration context, and a confirmed book of record.",
                      },
                      {
                        n: "02",
                        t: "Analysis & narrative",
                        d: "Drafted themes, scenarios, and meeting prep your team edits before delivery.",
                      },
                      { n: "03", t: "Governed outputs", d: "Materials and correspondence ready for internal approval." },
                    ].map((row) => (
                      <li key={row.n} className="flex gap-4">
                        <span
                          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--ap-navy)] text-[0.65rem] font-bold tracking-wide text-white"
                          aria-hidden
                        >
                          {row.n}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-[var(--ap-navy)]">{row.t}</p>
                          <p className="mt-1 text-sm leading-relaxed text-[var(--ap-gray)]">{row.d}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-6 border-t border-[var(--ap-border)] pt-5 text-xs leading-relaxed text-[var(--ap-gray)]">
                    Access is advisor-only via <span className="font-semibold text-[var(--ap-navy)]">Advisor login</span> in the
                    header (Google or email-based credentials).
                  </p>
                </div>
              </aside>
            </div>
          </div>

          <div className="mx-auto mt-14 max-w-6xl border-t border-[var(--ap-border)] px-4 pt-12 pb-14 md:mt-16 md:px-8 md:pt-14 md:pb-20">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">
                  From statement to meeting
                </p>
                <h2 className="mt-2 max-w-2xl font-serif text-2xl font-bold tracking-tight text-[var(--ap-navy)] md:text-[1.75rem]">
                  One continuous workflow, not three disconnected projects.
                </h2>
              </div>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-3 md:gap-5">
              {HERO_FLOW_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.title}
                    className="flex flex-col border border-[var(--ap-border)] bg-white p-6 shadow-sm shadow-slate-900/[0.03] md:min-h-[11.5rem]"
                  >
                    <div className="flex h-10 w-10 items-center justify-center border border-[var(--ap-pilot-light-border)] bg-[#f0f6fc] text-[var(--ap-navy)]">
                      <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                    </div>
                    <h3 className="mt-5 font-serif text-lg font-bold text-[var(--ap-navy)]">{card.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--ap-gray)]">{card.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* McKinsey-style full-bleed proof band */}
        <section className="border-b border-[var(--ap-border)] bg-[var(--ap-navy)] text-white">
          <div className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
            <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[#9ec9ff] uppercase">How we help advisors</p>
            <p className="mt-5 max-w-3xl font-serif text-2xl font-bold leading-snug md:text-[1.85rem]">
              Bring institutional rigor to the work behind every review, and keep responsibility for advice where it belongs.
            </p>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300 md:text-base">
              We focus on preparation: intake, confirmation, structured analysis, narrative drafting, and exportable materials.
              Your firm defines recommendations, disclosures, and what reaches the client.
            </p>
          </div>
        </section>

        <section className="border-b border-[var(--ap-border)] bg-[#fafbfc]">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24">
            <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">Capability model</p>
            <h2 className="mt-4 max-w-4xl font-serif text-3xl font-bold tracking-tight text-[var(--ap-navy)] md:text-[2.25rem] md:leading-tight">
              One workflow from intake through documentation, not three disconnected tools.
            </h2>
            <p className="mt-6 max-w-3xl text-base leading-[1.75] text-[var(--ap-gray)]">
              Enterprise-grade review processes depend on traceability: what entered the system, who confirmed it, what analysis
              assumed, and what left the building. AdvisorPilot sequences those stages in a single environment: client or advisor
              intake, advisor confirmation, structured analysis and narrative, then exportable summaries and correspondence
              drafts for your final review.
            </p>
            <p className="mt-5 max-w-3xl text-base leading-[1.75] text-[var(--ap-gray)]">
              The sections below map to how sophisticated RIAs already think about reviews: data foundation, analytical and
              communications layer, and governed outputs suitable for internal quality control.
            </p>

            <div className="mt-14 flex flex-col gap-16 md:gap-20">
              {WORKFLOW_PILLARS.map((item, index) => (
                <article
                  key={item.title}
                  className={`grid gap-8 md:grid-cols-2 md:items-start md:gap-12 ${index % 2 === 1 ? "md:[&>div:first-child]:order-2" : ""}`}
                >
                  <div className="overflow-hidden border border-[var(--ap-border)] bg-white shadow-sm shadow-slate-900/[0.04]">
                    <div className="relative aspect-[16/10] w-full bg-[var(--ap-navy)]">
                      <Image
                        src={item.imageSrc}
                        alt={item.imageAlt}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 50vw"
                      />
                    </div>
                  </div>
                  <div className="border-t-2 border-[var(--ap-royal)] bg-white px-1 pt-8 md:px-0">
                    <h3 className="font-serif text-2xl font-bold text-[var(--ap-navy)]">{item.title}</h3>
                    <p className="mt-2 text-[0.8rem] font-semibold tracking-wide text-[var(--ap-navy-mid)] uppercase">
                      {item.subtitle}
                    </p>
                    <p className="mt-5 text-base leading-[1.75] text-[var(--ap-gray)]">{item.intro}</p>
                    <ul className="mt-7 space-y-3.5 border-t border-[var(--ap-border)] pt-7">
                      {item.bullets.map((line) => (
                        <li key={line} className="flex gap-3 text-sm leading-[1.65] text-[var(--ap-gray)]">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ap-royal)]" aria-hidden />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Fidelity “Why choose” parity: scannable proof points */}
        <section className="border-b border-[var(--ap-border)] bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
            <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">Why AdvisorPilot</p>
            <h2 className="mt-4 max-w-3xl font-serif text-2xl font-bold text-[var(--ap-navy)] md:text-3xl">
              A managed process for firms that outgrew informal review routines.
            </h2>
            <ul className="mt-10 grid gap-6 md:grid-cols-2 md:gap-x-12 md:gap-y-6">
              {WHY_BULLETS.map((line) => (
                <li key={line} className="flex gap-3">
                  <CircleCheck
                    className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ap-royal)]"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="text-sm leading-relaxed text-[var(--ap-gray)]">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bg-[#fafbfc]">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
            <div className="border border-[var(--ap-border)] bg-white p-8 md:p-12">
              <p className="text-[0.7rem] font-semibold tracking-[0.22em] text-[var(--ap-navy-mid)] uppercase">Who it serves</p>
              <h2 className="mt-4 font-serif text-2xl font-bold text-[var(--ap-navy)] md:text-3xl">
                Designed for firms that treat reviews as a managed process, not an ad hoc project.
              </h2>
              <p className="mt-5 max-w-3xl text-base leading-[1.75] text-[var(--ap-gray)]">
                Ideal users are principals, lead advisors, and analysts at independent RIAs and small ensembles where review
                volume is growing but operations budget is not. AdvisorPilot aligns with firms that already separate{" "}
                <span className="font-medium text-[var(--ap-navy)]">investment judgment</span> from{" "}
                <span className="font-medium text-[var(--ap-navy)]">operational execution</span>, and want software that
                reinforces that line, not blurs it.
              </p>
              <p className="mt-5 max-w-3xl text-base leading-[1.75] text-[var(--ap-gray)]">
                Every insight, summary, and draft in the system is a starting point for human review. Suitability, regulatory
                language, product selection, and client-specific facts remain your responsibility. The value is speed,
                consistency, and a cleaner path to supervision, not automation of advice itself.
              </p>
            </div>
          </div>
        </section>
      </main>

      <MarketingSiteFooter />
    </div>
  );
}
