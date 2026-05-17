import type { Metadata } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AdvisorPilot",
  description: "Portfolio review assistant for financial advisors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `suppressHydrationWarning` on <html> + <body> is for third-party
    // browser extensions (Scribe recorder, Grammarly, dark-mode toggles,
    // etc.) that inject attributes like `data-scribe-recorder-ready`
    // BEFORE React hydrates. Without this, every advisor running such an
    // extension sees a noisy red console error on every page load. The
    // suppression is shallow — it only ignores attribute mismatches on
    // these two elements; any hydration mismatch INSIDE the app still
    // surfaces normally.
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
