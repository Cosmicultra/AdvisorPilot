import Link from "next/link";
import { LogoBlock } from "@/components/logo-block";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MarketingSiteHeader({ className }: { className?: string }) {
  const navLink =
    "text-sm font-semibold text-[var(--ap-navy-mid)] transition-colors hover:text-[var(--ap-royal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ap-royal)] focus-visible:ring-offset-2";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-[var(--ap-border)] bg-[#fafbfc]/95 backdrop-blur-sm",
        className
      )}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:min-h-[4.5rem] sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-2 md:min-h-[5rem] md:gap-6 md:px-8 md:py-3">
        <Link href="/" className="inline-flex max-w-full shrink-0 py-0.5">
          <LogoBlock size="large" />
        </Link>
        <nav
          className="flex flex-wrap items-center justify-start gap-x-4 gap-y-2 sm:shrink-0 sm:justify-end md:gap-6"
          aria-label="Marketing"
        >
          <Link href="/demo" className={navLink}>
            Demo
          </Link>
          <Link href="/pricing" className={navLink}>
            Pricing
          </Link>
          <Button
            asChild
            className="h-9 shrink-0 rounded-none bg-[var(--ap-navy)] px-3 text-sm font-semibold tracking-wide text-white hover:bg-[var(--ap-navy-mid)] sm:h-10 sm:px-5"
          >
            <Link href="/login">Advisor login</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
