import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { AdvisorLoginForm } from "@/components/advisor-login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect("/app");
  }

  const params = await searchParams;
  const resetSuccess = params.reset === "success";

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[var(--ap-navy)]">
      <header className="border-b border-[var(--ap-border)] bg-white">
        <div className="mx-auto flex h-14 max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 md:px-8">
          <Link href="/" className="text-sm font-semibold text-[var(--ap-navy-mid)] hover:text-[var(--ap-royal)]">
            ← Back to home
          </Link>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <Link href="/demo" className="text-[var(--ap-navy-mid)] hover:text-[var(--ap-royal)]">
              Demo
            </Link>
            <Link href="/pricing" className="text-[var(--ap-navy-mid)] hover:text-[var(--ap-royal)]">
              Pricing
            </Link>
          </div>
        </div>
      </header>
      <AdvisorLoginForm resetSuccess={resetSuccess} />
    </div>
  );
}
