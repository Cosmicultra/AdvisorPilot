export function MarketingSiteFooter() {
  return (
    <footer className="border-t border-[var(--ap-border)] bg-[var(--ap-navy)] text-slate-400">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <p className="max-w-3xl text-sm leading-relaxed">
          © {new Date().getFullYear()} AdvisorPilot. For professional workflow and discussion only. Not an offer,
          solicitation, or recommendation of securities or advisory services. Past software behavior does not guarantee
          regulatory compliance; your firm’s policies, supervisory procedures, and applicable rules govern client
          communications and advice.
        </p>
      </div>
    </footer>
  );
}
