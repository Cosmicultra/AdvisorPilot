"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { Session } from "next-auth";
import { signIn, signOut } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Camera,
  CheckCircle,
  Download,
  FileText,
  Mail,
  Save,
  FolderOpen,
  Trash2,
  ShieldCheck,
  Target,
  TrendingUp,
  Upload,
  User,
  Wand2,
  MessageSquareText,
  BrainCircuit,
  Link2,
  Copy,
  Check,
} from "lucide-react";
import {
  INTAKE_STEPS,
  INTAKE_STEP_COUNT,
  type IntakeClient,
  normalizeIntakeClient,
  clientDisplayName,
  clientFirstNameSalutation,
} from "@/lib/intake-config";
import type { LiveIntakeHandoffAction } from "@/lib/live-intake-scripts";
import { LiveIntakeOverlay } from "../components/live-intake-overlay";

type Client = IntakeClient;

type EmailAuthUser = { email?: string | null };

type Holding = {
  rawName: string;
  suggested: string;
  confidence: number;
  assetClass: string;
  value: number;
  status: string;
  options: string[];
};

type AIAnalysis = {
  synopsis: string;
  portfolioHighlights?: string[];
  strategies: string[];
  redFlags?: string[];
  overlapInsights?: string[];
  displayWhatThisMeans?: string[];
  recommendations: string[];
  talkingPoints?: string[];
  advisorOpeningScript?: string;
  objectionHandling?: string[];
};

type SavedReview = {
  id: string;
  savedAt: string;
  client: Client;
  holdings: Holding[];
  meetingNotes: string;
  demoMode: boolean;
  analysis: AIAnalysis | null;
  status?: string;
  lastContactedAt?: string;
};

const ASSET_CLASSES = [
  "U.S. Large Cap Equity",
  "U.S. Mid Cap Equity",
  "U.S. Small Cap Equity",
  "International Equity",
  "Emerging Markets Equity",
  "ETF",
  "Mutual Fund",
  "Individual Stock",
  "Bond Fund",
  "Treasury / Government Bond",
  "Corporate Bond",
  "Municipal Bond",
  "Cash / Money Market",
  "Fixed Indexed Annuity",
  "MYGA / Fixed Annuity",
  "SPIA / Income Annuity",
  "Alternative / Other",
  "Unknown",
];

const demoHoldings: Holding[] = [
  {
    rawName: "VANG 500 IDX ADM",
    suggested: "VFIAX - Vanguard 500 Index Fund Admiral Shares",
    confidence: 96,
    assetClass: "U.S. Large Cap Equity",
    value: 145000,
    status: "matched",
    options: ["VFIAX - Vanguard 500 Index Fund Admiral Shares", "VOO - Vanguard S&P 500 ETF", "VFINX - Vanguard 500 Index Investor", "Manual ticker / CUSIP entry"],
  },
  {
    rawName: "PIMCO INCOME FD",
    suggested: "Needs advisor confirmation",
    confidence: 62,
    assetClass: "Bond Fund",
    value: 82000,
    status: "review",
    options: ["PONAX - PIMCO Income Fund Class A", "PIMIX - PIMCO Income Fund Institutional", "PONCX - PIMCO Income Fund Class C", "Manual ticker / CUSIP entry"],
  },
  {
    rawName: "APPLE INC",
    suggested: "AAPL - Apple Inc.",
    confidence: 99,
    assetClass: "Individual Stock",
    value: 42000,
    status: "matched",
    options: ["AAPL - Apple Inc.", "Manual ticker / CUSIP entry"],
  },
  {
    rawName: "CASH / MONEY MARKET",
    suggested: "Cash Equivalent",
    confidence: 91,
    assetClass: "Cash / Money Market",
    value: 21000,
    status: "matched",
    options: ["Cash Equivalent", "Money Market Fund", "Manual ticker / CUSIP entry"],
  },
];

const EXTRACT_PROGRESS_MESSAGES = [
  "Uploading statement…",
  "Reading the document and locating holdings…",
  "Building your confirmation table…",
] as const;

const ANALYSIS_PROGRESS_MESSAGES = [
  "Sending confirmed holdings to the analysis model…",
  "Scoring risk, diversification, and income readiness…",
  "Drafting synopsis, talking points, and meeting prep…",
] as const;

function currency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function getAgeFromDob(dob: string) {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function targetAllocation(age: number, riskProfile: string) {
  let equity = 100 - age;
  if (riskProfile === "conservative") equity -= 10;
  if (riskProfile === "moderate-conservative") equity -= 5;
  if (riskProfile === "moderate-growth") equity += 10;
  if (riskProfile === "aggressive") equity += 20;
  equity = Math.max(25, Math.min(85, equity));
  const fixedIncome = Math.max(10, 100 - equity - 5);
  const cash = 100 - equity - fixedIncome;
  return { equity, fixedIncome, cash };
}

function classifyBucket(assetClass: string) {
  const lower = assetClass.toLowerCase();
  if (lower.includes("cash") || lower.includes("money market")) return "cash";
  if (
    lower.includes("bond") ||
    lower.includes("treasury") ||
    lower.includes("municipal") ||
    lower.includes("fixed") ||
    lower.includes("annuity") ||
    lower.includes("myga") ||
    lower.includes("spia")
  ) {
    return "fixedIncome";
  }
  return "equity";
}

function allocationData(equity: number, fixedIncome: number, cash: number) {
  return [
    { label: "Equity", value: equity, color: "#0f766e" },
    { label: "Fixed income", value: fixedIncome, color: "#1d4ed8" },
    { label: "Cash", value: cash, color: "#c99700" },
  ];
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function portfolioScores(
  currentInput: { equity: number; fixedIncome: number; cash: number },
  targetInput: { equity: number; fixedIncome: number; cash: number }
) {
  const current = {
    equity: asNumber(currentInput?.equity),
    fixedIncome: asNumber(currentInput?.fixedIncome),
    cash: asNumber(currentInput?.cash),
  };

  const target = {
    equity: asNumber(targetInput?.equity, 60),
    fixedIncome: asNumber(targetInput?.fixedIncome, 35),
    cash: asNumber(targetInput?.cash, 5),
  };

  const equityGap = Math.abs(current.equity - target.equity);
  const fixedGap = Math.abs(current.fixedIncome - target.fixedIncome);
  const cashGap = Math.abs(current.cash - target.cash);

  const riskAlignment = clampScore(
    100 - equityGap * 1.7 - fixedGap * 1.0 - cashGap * 0.6
  );

  const totalAllocationGap = equityGap + fixedGap + cashGap;
  const diversification = clampScore(
    82 - totalAllocationGap * 0.5 - Math.max(0, current.equity - 65) * 0.5 - Math.max(0, 5 - current.cash) * 1.2
  );

  const fixedIncomeTarget = Math.max(target.fixedIncome, 1);
  const fixedIncomeProgress = Math.min(current.fixedIncome / fixedIncomeTarget, 1);
  const incomeReadiness = clampScore(
    20 + fixedIncomeProgress * 55 + Math.min(current.cash, 10) * 1.0 - Math.max(0, current.equity - target.equity) * 0.45
  );

  return {
    riskAlignment,
    diversification,
    incomeReadiness,
  };
}

function ScoreCard({ label, value, helper }: { label: string; value: number; helper: string }) {
  // Score-based tinting per advisor spec: 80-100 green, 50-79 amber, 0-49 red.
  const toneClass =
    value >= 80
      ? "ap-icon-tile-green"
      : value >= 50
        ? "ap-icon-tile-amber"
        : "ap-icon-tile-red";
  return (
    <Card className="rounded-3xl border-slate-200 bg-white/95 shadow-md shadow-blue-950/5">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-semibold text-slate-950 tabular-nums">{value}<span className="text-base font-medium text-slate-400">/100</span></p>
            <p className="mt-1 text-xs text-slate-500">{helper}</p>
          </div>
          <div className={`ap-icon-tile ${toneClass} flex h-14 w-14 items-center justify-center rounded-2xl text-base font-bold tabular-nums`}>
            {value}
          </div>
        </div>
        <Progress value={value} className="mt-4" />
      </CardContent>
    </Card>
  );
}


function calculateRetirementSuccessModel(params: {
  age: number | null;
  retirementAge: number;
  portfolioValue: number;
  equity: number;
  fixedIncome: number;
  cash: number;
  riskProfile: string;
}) {
  const age = Number(params.age || 62);
  const retirementAge = Number(params.retirementAge || 67);
  const yearsToRetirement = Math.max(retirementAge - age, 0);
  const retirementHorizon = Math.max(95 - retirementAge, 20);

  const equity = Math.max(0, Math.min(100, Number(params.equity || 0)));
  const fixedIncome = Math.max(0, Math.min(100, Number(params.fixedIncome || 0)));
  const cash = Math.max(0, Math.min(100, Number(params.cash || 0)));

  const riskProfile = params.riskProfile || "moderate";
  const assumedWithdrawalRate =
    riskProfile === "conservative" || riskProfile === "moderate-conservative"
      ? 0.04
      : riskProfile === "aggressive"
        ? 0.045
        : 0.0425;

  const weightedReturn =
    equity * 0.064 +
    fixedIncome * 0.039 +
    cash * 0.021;

  const weightedVolatility =
    equity * 0.155 +
    fixedIncome * 0.052 +
    cash * 0.012;

  const sequenceRiskPenalty =
    Math.max(0, equity - 60) * 0.62 +
    Math.max(0, fixedIncome < 25 ? 25 - fixedIncome : 0) * 0.42;

  const incomeSupportBonus =
    Math.min(fixedIncome, 45) * 0.22 +
    Math.min(cash, 8) * 0.18;

  const liquidityPenalty = cash < 3 ? (3 - cash) * 1.4 : Math.max(0, cash - 15) * 0.35;
  const timeBonus = Math.min(yearsToRetirement * 1.05, 11);
  const horizonPenalty = Math.max(0, retirementHorizon - 25) * 0.35;
  const returnSpread = weightedReturn / 100 - assumedWithdrawalRate;
  const returnSupport = Math.max(-8, Math.min(10, returnSpread * 850));
  const volatilityPenalty = Math.max(0, weightedVolatility - 7.5) * 1.65;

  const score = Math.round(
    68 +
      timeBonus +
      returnSupport +
      incomeSupportBonus -
      sequenceRiskPenalty -
      volatilityPenalty -
      liquidityPenalty -
      horizonPenalty
  );

  return Math.max(35, Math.min(96, score));
}
function successLabel(score: number) {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Moderate";
  return "Needs Review";
}

function computePortfolioContextFromReview(client: Client, holdings: Holding[], demoMode: boolean) {
  const totalValue = holdings.reduce((sum, h) => sum + Number(h.value || 0), 0);
  const reviewCount = holdings.filter((h) => h.confidence < 75 || h.status === "review").length;
  const canRunDeepAnalysis = demoMode || reviewCount === 0;
  const buckets = holdings.reduce(
    (acc, h) => {
      const bucket = classifyBucket(h.assetClass);
      acc[bucket] += Number(h.value || 0);
      return acc;
    },
    { equity: 0, fixedIncome: 0, cash: 0 }
  );
  const equity = totalValue ? Math.round((buckets.equity / totalValue) * 100) : 0;
  const fixedIncome = totalValue ? Math.round((buckets.fixedIncome / totalValue) * 100) : 0;
  const cash = totalValue ? Math.max(0, 100 - equity - fixedIncome) : 0;
  const currentAllocation = { equity, fixedIncome, cash };
  const derivedAge = client.age ? Number(client.age) : getAgeFromDob(client.dob);
  const target = targetAllocation(derivedAge || 62, client.riskProfile);
  const scores = portfolioScores(currentAllocation, target);
  const currentSuccessRate = calculateRetirementSuccessModel({
    age: derivedAge,
    retirementAge: Number(client.retirementAge || 67),
    portfolioValue: totalValue,
    equity: currentAllocation.equity,
    fixedIncome: currentAllocation.fixedIncome,
    cash: currentAllocation.cash,
    riskProfile: client.riskProfile,
  });
  const proposedSuccessRate = calculateRetirementSuccessModel({
    age: derivedAge,
    retirementAge: Number(client.retirementAge || 67),
    portfolioValue: totalValue,
    equity: target.equity,
    fixedIncome: target.fixedIncome,
    cash: target.cash,
    riskProfile: client.riskProfile,
  });
  const successImprovement = proposedSuccessRate - currentSuccessRate;
  const retirementModelInsights = [
    `Current allocation estimate: ${currentSuccessRate}/100 (${successLabel(currentSuccessRate)}).`,
    `Proposed allocation estimate: ${proposedSuccessRate}/100 (${successLabel(proposedSuccessRate)}).`,
    successImprovement >= 0
      ? `Illustrative improvement: +${successImprovement} points.`
      : `Illustrative change: ${successImprovement} points.`,
    "Model considers allocation mix, volatility, sequence risk, income support, liquidity, and retirement horizon.",
  ];
  return {
    totalValue,
    currentAllocation,
    target,
    scores,
    canRunDeepAnalysis,
    reviewCount,
    derivedAge,
    currentSuccessRate,
    proposedSuccessRate,
    successImprovement,
    retirementModelInsights,
  };
}

function LogoBlock({ compact = false }: { compact?: boolean }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="flex items-center gap-3">
        <div className="ap-icon-tile flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold md:h-16 md:w-16 md:text-xl">AP</div>
        {!compact && (
          <div>
            <p className="font-serif text-2xl font-bold tracking-tight text-slate-950 md:text-[1.7rem]">AdvisorPilot</p>
            <p className="text-sm text-slate-500">Portfolio review assistant</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <img
        src="/logo.png?v=3"
        alt="AdvisorPilot logo"
        className="h-16 w-auto rounded-xl object-contain drop-shadow-[0_8px_18px_rgba(14,116,235,0.18)] md:h-[4.5rem]"
        onError={() => setBroken(true)}
      />
      {!compact && (
        <div className="hidden sm:block">
          <p className="font-serif text-2xl font-bold tracking-tight text-slate-950 md:text-[1.7rem]">AdvisorPilot</p>
          <p className="text-sm text-slate-500">Portfolio review assistant</p>
        </div>
      )}
    </div>
  );
}

function ProfessionalDonutChart({ data, title, subtitle }: { data: { label: string; value: number; color: string }[]; title: string; subtitle?: string }) {
  const radius = 72;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm print:break-inside-avoid print:border-slate-300 print:shadow-none">
      <div className="mb-5">
        <h3 className="font-serif text-2xl font-bold text-slate-950">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-col items-center gap-6 md:flex-row">
        <svg width="190" height="190" viewBox="0 0 190 190" className="shrink-0 print:h-44 print:w-44">
          <circle cx="95" cy="95" r={radius} fill="transparent" stroke="#e5e7eb" strokeWidth={stroke} />
          {data.map((item, index) => {
            const dash = (item.value / 100) * circumference;
            const offset = data.slice(0, index).reduce((sum, d) => sum + (d.value / 100) * circumference, 0);
            return (
              <circle
                key={item.label}
                cx="95"
                cy="95"
                r={radius}
                fill="transparent"
                stroke={item.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 95 95)"
              />
            );
          })}
          <circle cx="95" cy="95" r="45" fill="#ffffff" />
          <text x="95" y="88" textAnchor="middle" className="fill-slate-500 text-xs font-medium">Total</text>
          <text x="95" y="110" textAnchor="middle" className="fill-slate-950 text-xl font-bold">100%</text>
        </svg>
        <div className="w-full space-y-3">
          {data.map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 print:bg-white">
              <div className="flex items-center gap-3">
                <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
              </div>
              <span className="font-semibold text-slate-950">{item.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepButton({ label, active, index, onClick }: { label: string; active: boolean; index: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "step" : undefined}
      className={`ap-step-btn min-h-[3rem] touch-manipulation rounded-2xl px-3 py-3.5 text-sm font-medium capitalize md:min-h-0 md:py-3 ${
        active ? "ap-step-btn-active" : ""
      }`}
    >
      <span className={`mr-1 text-xs ${active ? "text-sky-100/80" : "text-slate-400"}`}>{index}.</span>
      {label}
    </button>
  );
}

function MetricCard({ icon, label, value, helper }: { icon: React.ReactNode; label: string; value: string; helper?: string }) {
  return (
    <Card className="rounded-3xl border-slate-200 bg-white/95 shadow-md shadow-blue-950/5">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold capitalize text-slate-950">{value}</p>
            {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
          </div>
          <div className="flex ap-icon-tile h-11 w-11 items-center justify-center rounded-2xl">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function IntakeShell({
  progress,
  eyebrow,
  title,
  helper,
  children,
  onBack,
  onNext,
  nextLabel = "Continue",
  backDisabled = false,
  footerCenter,
}: {
  progress: number;
  eyebrow: string;
  title: string;
  helper: string;
  children: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  backDisabled?: boolean;
  footerCenter?: React.ReactNode;
}) {
  return (
    <Card className="rounded-[2rem] ap-glass border-0">
      <CardContent className="p-6 md:p-10">
        <div className="mx-auto max-w-3xl space-y-7">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-blue-700">{eyebrow}</Badge>
              <span className="text-sm text-slate-500">{progress}% complete</span>
            </div>
            <Progress value={progress} />
            <h2 className="font-serif text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">{title}</h2>
            <p className="text-lg text-slate-600">{helper}</p>
          </div>
          <div className="ap-soft-panel rounded-3xl p-5 md:p-7">{children}</div>
          {footerCenter ? (
            <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
              <div className="flex justify-start">
                <Button variant="outline" className="h-14 rounded-2xl px-5 md:h-12" onClick={onBack} disabled={backDisabled}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
              </div>
              <div className="order-first flex justify-center px-1 sm:order-none">{footerCenter}</div>
              <div className="flex justify-end">
                <Button className="h-14 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-6 md:h-12" onClick={onNext}>
                  {nextLabel} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" className="h-14 rounded-2xl px-5 md:h-12" onClick={onBack} disabled={backDisabled}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button className="h-14 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-6 md:h-12" onClick={onNext}>
                {nextLabel} <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdvisorPilotPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        setSession(data?.user ? data : null);
        if (data?.user?.email) await loadAdvisorProfile(data.user.email);
      } catch {
        setSession(null);
      } finally {
        setAuthLoaded(true);
      }
    }

    loadSession();
  }, []);
  const [step, setStep] = useState("intake");
  const [intakeStep, setIntakeStep] = useState(0);
  const [liveIntakeOpen, setLiveIntakeOpen] = useState(false);
  /** After live intake, scroll Statement Capture to client link vs advisor upload. */
  const [uploadSectionFocus, setUploadSectionFocus] = useState<"client_link" | "advisor_upload" | null>(null);

  useEffect(() => {
    if (step !== "upload" || !uploadSectionFocus) return;
    const id =
      uploadSectionFocus === "client_link"
        ? "upload-section-client-link"
        : "upload-section-advisor-upload";
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setUploadSectionFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [step, uploadSectionFocus]);

  const [client, setClient] = useState<Client>({
    firstName: "",
    lastName: "",
    dob: "",
    age: "",
    retirementAge: "67",
    riskProfile: "moderate-conservative",
    calibration: "risk-profile",
    goal: "Prepare for retirement income while reducing unnecessary downside risk.",
    advisorEmail: "",
  });
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>(demoHoldings);
  const [meetingNotes, setMeetingNotes] = useState("");
  const [demoMode, setDemoMode] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [followUpEmail, setFollowUpEmail] = useState("");
  const [emailCopied, setEmailCopied] = useState(false);
  const [savedReviews, setSavedReviews] = useState<SavedReview[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [emailSignature, setEmailSignature] = useState("");
  const [signatureDraft, setSignatureDraft] = useState("");
  const [showSignatureSetup, setShowSignatureSetup] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signatureTitle, setSignatureTitle] = useState("");
  const [signatureLicense, setSignatureLicense] = useState("");
  const [signatureCalendarLink, setSignatureCalendarLink] = useState("");
  const [signatureAddress, setSignatureAddress] = useState("");
  const [signatureOfficePhone, setSignatureOfficePhone] = useState("");
  const [signatureCellPhone, setSignatureCellPhone] = useState("");
  const [signatureWebsite, setSignatureWebsite] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [emailAuthUser, setEmailAuthUser] = useState<EmailAuthUser | null>(null);
  const [authMessage, setAuthMessage] = useState("");
  const [draftAutosaveStatus, setDraftAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [extractProgressIndex, setExtractProgressIndex] = useState(0);
  const [analysisProgressIndex, setAnalysisProgressIndex] = useState(0);
  const [magicLinkUrl, setMagicLinkUrl] = useState("");
  const [magicLinkExpiresAt, setMagicLinkExpiresAt] = useState("");
  const [magicLinkBusy, setMagicLinkBusy] = useState(false);
  const [magicLinkErr, setMagicLinkErr] = useState("");
  const [magicLinkCopied, setMagicLinkCopied] = useState(false);
  const [followUpEmailSendingId, setFollowUpEmailSendingId] = useState<string | null>(null);

  const advisorVoiceName = useMemo(() => {
    const fromProfile = signatureName.trim();
    if (fromProfile) return fromProfile;
    const googleName = String(session?.user?.name || "").trim();
    if (googleName) return googleName;
    const local = String(session?.user?.email || emailAuthUser?.email || "")
      .split("@")[0]
      .trim();
    if (local) return local;
    return "your advisor";
  }, [signatureName, session?.user?.name, session?.user?.email, emailAuthUser?.email]);

  const derivedAge = useMemo(() => (client.age ? Number(client.age) : getAgeFromDob(client.dob)), [client.age, client.dob]);
  const totalValue = useMemo(() => holdings.reduce((sum, h) => sum + Number(h.value || 0), 0), [holdings]);
  const reviewCount = holdings.filter((h) => h.confidence < 75 || h.status === "review").length;
  /** Real statements: no deep analysis until the confirmation table is clean. Demo mode keeps the sample path usable. */
  const canRunDeepAnalysis = demoMode || reviewCount === 0;

  const currentAllocation = useMemo(() => {
    const buckets = holdings.reduce((acc, h) => {
      const bucket = classifyBucket(h.assetClass);
      acc[bucket] += Number(h.value || 0);
      return acc;
    }, { equity: 0, fixedIncome: 0, cash: 0 });
    const equity = totalValue ? Math.round((buckets.equity / totalValue) * 100) : 0;
    const fixedIncome = totalValue ? Math.round((buckets.fixedIncome / totalValue) * 100) : 0;
    const cash = totalValue ? Math.max(0, 100 - equity - fixedIncome) : 0;
    return { equity, fixedIncome, cash };
  }, [holdings, totalValue]);

  const target = targetAllocation(derivedAge || 62, client.riskProfile);
  const currentPie = allocationData(currentAllocation.equity, currentAllocation.fixedIncome, currentAllocation.cash);
  const targetPie = allocationData(target.equity, target.fixedIncome, target.cash);
  const scores = portfolioScores(currentAllocation, target);

  const currentSuccessRate = calculateRetirementSuccessModel({
    age: derivedAge,
    retirementAge: Number(client.retirementAge || 67),
    portfolioValue: totalValue,
    equity: currentAllocation.equity,
    fixedIncome: currentAllocation.fixedIncome,
    cash: currentAllocation.cash,
    riskProfile: client.riskProfile,
  });

  const proposedSuccessRate = calculateRetirementSuccessModel({
    age: derivedAge,
    retirementAge: Number(client.retirementAge || 67),
    portfolioValue: totalValue,
    equity: target.equity,
    fixedIncome: target.fixedIncome,
    cash: target.cash,
    riskProfile: client.riskProfile,
  });

  const successImprovement = proposedSuccessRate - currentSuccessRate;

  const retirementModelInsights = [
    `Current allocation estimate: ${currentSuccessRate}/100 (${successLabel(currentSuccessRate)}).`,
    `Proposed allocation estimate: ${proposedSuccessRate}/100 (${successLabel(proposedSuccessRate)}).`,
    successImprovement >= 0
      ? `Illustrative improvement: +${successImprovement} points.`
      : `Illustrative change: ${successImprovement} points.`,
    "Model considers allocation mix, volatility, sequence risk, income support, liquidity, and retirement horizon.",
  ];

  const progress = Math.round(((intakeStep + 1) / INTAKE_STEP_COUNT) * 100);

  useEffect(() => {
    if (!isExtracting) return;
    const id = window.setInterval(() => {
      setExtractProgressIndex((i) => (i + 1) % EXTRACT_PROGRESS_MESSAGES.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [isExtracting]);

  useEffect(() => {
    if (!isAnalyzing) return;
    const id = window.setInterval(() => {
      setAnalysisProgressIndex((i) => (i + 1) % ANALYSIS_PROGRESS_MESSAGES.length);
    }, 3500);
    return () => window.clearInterval(id);
  }, [isAnalyzing]);

  useEffect(() => {
    if (step !== "confirm" || demoMode) return;
    const ownerEmail = String(session?.user?.email || emailAuthUser?.email || "")
      .trim()
      .toLowerCase();
    if (!ownerEmail) return;

    const handle = window.setTimeout(async () => {
      setDraftAutosaveStatus("saving");
      try {
        const res = await fetch("/api/client-database", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: activeReviewId,
            ownerEmail,
            client,
            holdings,
            meetingNotes,
            demoMode: false,
            analysis: null,
            totalValue,
            status: "Draft",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Draft save failed.");
        if (data?.client?.id) setActiveReviewId(data.client.id);
        setDraftAutosaveStatus("saved");
        window.setTimeout(() => {
          setDraftAutosaveStatus((s) => (s === "saved" ? "idle" : s));
        }, 2000);
      } catch {
        setDraftAutosaveStatus("error");
      }
    }, 2500);

    return () => window.clearTimeout(handle);
  }, [step, demoMode, holdings, client, meetingNotes, activeReviewId, totalValue, session, emailAuthUser]);

  const fallbackSynopsis = `Based on the client profile and confirmed holdings, the portfolio review focuses on whether the current allocation remains appropriate for the client’s age, retirement timeline, and risk profile. Current allocation appears to be approximately ${currentAllocation.equity}% equity, ${currentAllocation.fixedIncome}% fixed income, and ${currentAllocation.cash}% cash. The proposed allocation shown is ${target.equity}% equity, ${target.fixedIncome}% fixed income, and ${target.cash}% cash. Final recommendations should be reviewed by the advisor in the context of the client’s full financial plan, liquidity needs, tax situation, and income goals.`;

  const fallbackStrategies = [
    "Evaluate whether the portfolio should shift toward a more balanced growth-and-income posture.",
    "Review fixed income quality, duration, and role within the broader retirement plan.",
    "Consider whether income-oriented strategies should complement the market-based portfolio.",
  ];

  const fallbackRecommendations = [
    "Review the largest positions and funds for concentration before making any final recommendation.",
    "Compare the current equity-heavy posture against a more balanced income-aware allocation.",
    "Evaluate whether fixed income, dividend strategies, or protected income solutions are appropriate for the client’s objective.",
  ];

  const fallbackPortfolioHighlights = [
    "Portfolio is positioned primarily for growth based on the current allocation mix.",
    "Concentration and overlap should be reviewed where similar equity exposure appears across multiple holdings.",
    "Liquidity and stability should be evaluated against the client's retirement timeline and planning goals.",
  ];

  const clientNextSteps = [
    "Confirm goals, time horizon, liquidity needs, and income expectations.",
    "Review tax considerations before making any portfolio changes.",
    "Prepare an advisor-approved plan for the next discussion.",
  ];

  const displaySynopsis = analysis?.synopsis || fallbackSynopsis;
  const displayPortfolioHighlights = analysis?.portfolioHighlights?.length ? analysis.portfolioHighlights : fallbackPortfolioHighlights;
  const displayStrategies = analysis?.strategies?.length ? analysis.strategies : fallbackStrategies;
  const displayRecommendations = analysis?.recommendations?.length ? analysis.recommendations : fallbackRecommendations;
  const calculatedOverlapInsights = useMemo(() => {
    const insights: string[] = [];
    const normalizedHoldings = holdings.map((h) => `${h.rawName} ${h.suggested} ${h.assetClass}`.toLowerCase());

    const hasLargeCapIndex = normalizedHoldings.some((name) =>
      name.includes("s&p") ||
      name.includes("500") ||
      name.includes("vfiax") ||
      name.includes("voo") ||
      name.includes("spy") ||
      name.includes("large cap")
    );

    const individualTechNames = ["aapl", "apple", "msft", "microsoft", "amzn", "amazon", "nvda", "nvidia", "goog", "google", "meta", "tesla", "tsla"];
    const techHoldings = normalizedHoldings.filter((name) => individualTechNames.some((ticker) => name.includes(ticker)));
    const mutualFundCount = holdings.filter((h) => h.assetClass?.toLowerCase().includes("mutual fund") || h.assetClass?.toLowerCase().includes("etf")).length;
    const individualStockCount = holdings.filter((h) => h.assetClass?.toLowerCase().includes("individual stock")).length;

    if (hasLargeCapIndex && techHoldings.length >= 1) {
      insights.push(
        "Large-cap index exposure may overlap with individual stock holdings, meaning the portfolio could be more concentrated in the same mega-cap companies than it appears at first glance."
      );
    }

    if (techHoldings.length >= 2) {
      insights.push(
        "Multiple technology-oriented individual stock positions may create correlated downside risk if the same sector comes under pressure."
      );
    }

    if (currentAllocation.equity > target.equity + 15) {
      insights.push(
        `Equity exposure is ${currentAllocation.equity}%, which is meaningfully above the ${target.equity}% proposed allocation and may amplify portfolio volatility if those equity holdings are highly correlated.`
      );
    }

    if (mutualFundCount + individualStockCount >= 4 && currentAllocation.equity > 55) {
      insights.push(
        "The portfolio has several equity positions, but the underlying exposure should be reviewed to determine whether the holdings are truly diversified or simply different wrappers around similar market exposure."
      );
    }

    if (insights.length === 0) {
      insights.push(
        "No major overlap issue is obvious from the top-level holdings, but underlying fund holdings should still be reviewed for hidden concentration before final recommendations are made."
      );
    }

    return insights.slice(0, 4);
  }, [holdings, currentAllocation.equity, target.equity]);

  const displayRedFlags = analysis?.redFlags?.length ? analysis.redFlags : [
    `Portfolio equity exposure appears elevated at ${currentAllocation.equity}% compared with the proposed allocation of ${target.equity}%.`,
    "Large-cap U.S. equity concentration should be reviewed for overlap across funds and individual stock positions.",
    "Fixed income and income-oriented positioning may need to be evaluated against the client’s retirement timeline.",
  ];
  const displayOverlapInsights = analysis?.overlapInsights?.length ? analysis.overlapInsights : calculatedOverlapInsights;
  const displayWhatThisMeans = analysis?.displayWhatThisMeans?.length ? analysis.displayWhatThisMeans : [
    currentAllocation.equity > target.equity
      ? `The portfolio may experience larger swings than expected because equity exposure is ${currentAllocation.equity}%, compared with the proposed allocation of ${target.equity}%.`
      : "The current equity exposure appears closer to the proposed allocation, but the underlying holdings should still be reviewed for concentration and correlation risk.",
    currentAllocation.fixedIncome < target.fixedIncome
      ? `The portfolio may not have enough fixed income support for stability, with fixed income at ${currentAllocation.fixedIncome}% compared with the proposed allocation of ${target.fixedIncome}%.`
      : "The fixed income allocation appears closer to the proposed allocation, but the quality, duration, and income role of those holdings should still be reviewed.",
    scores.incomeReadiness < 55
      ? "Income readiness may be limited, which means the portfolio could need more stable income sources before retirement withdrawals begin."
      : "The portfolio has a stronger income-readiness foundation, but the advisor should still confirm liquidity, tax impact, and retirement withdrawal needs.",
  ];
  const displayTalkingPoints = analysis?.talkingPoints?.length ? analysis.talkingPoints : [
    "Confirm the client’s retirement timeline and income need.",
    "Explain current allocation versus the age/risk-profile proposed allocation.",
    "Identify holdings that may create concentration, overlap, or unnecessary volatility.",
    "Discuss potential rebalancing as a planning conversation, not a rushed trading decision.",
  ];

  const meetingQuestions = [
    "Are you still targeting retirement around the age currently listed in the profile?",
    "How important is stable income versus continued growth at this stage?",
    "If the portfolio dropped 15% to 20%, would that change your retirement plans or comfort level?",
    "Are there any major liquidity needs, tax concerns, or income needs we should plan around before making changes?",
  ];

  const whatToListenFor = [
    "If the client is worried about volatility, slow down and emphasize risk alignment, income stability, and sequence-of-return risk.",
    "If the client is focused on growth, frame rebalancing as reducing unnecessary concentration rather than abandoning growth.",
    "If the client wants income, connect the fixed income gap, income readiness score, and potential income-oriented strategies.",
    "If the client is hesitant to make changes, position the next step as a review and stress-test, not an immediate trading decision.",
  ];

  const meetingWalkthrough = [
    `Start with the portfolio scores: risk alignment ${scores.riskAlignment}/100, diversification ${scores.diversification}/100, and income readiness ${scores.incomeReadiness}/100.`,
    "Show the allocation chart and compare current positioning against the proposed allocation.",
    "Walk through the red flags first so the client understands the main concerns before hearing solutions.",
    "Use the overlap section to explain hidden concentration that may not be obvious from the number of holdings.",
    "Translate the analysis with the What This Means for You section before moving into strategy.",
  ];

  const closingScript = "The goal is not to make changes just for the sake of change. The next step is to review which adjustments may better align the portfolio with the client’s risk profile, retirement timeline, income needs, liquidity needs, and tax picture before making any final recommendation.";


  const positioningImpact = [
    `Equity: ${currentAllocation.equity}% current → ${target.equity}% proposed`,
    `Fixed: ${currentAllocation.fixedIncome}% current → ${target.fixedIncome}% proposed`,
    `Cash: ${currentAllocation.cash}% current → ${target.cash}% proposed`,
  ];

  const findings = [
    `Current portfolio appears to be approximately ${currentAllocation.equity}% equity, ${currentAllocation.fixedIncome}% fixed income, and ${currentAllocation.cash}% cash.`,
    `Based on the selected calibration, the proposed allocation is approximately ${target.equity}% equity, ${target.fixedIncome}% fixed income, and ${target.cash}% cash.`,
    reviewCount > 0 ? `${reviewCount} holding${reviewCount === 1 ? "" : "s"} require advisor confirmation before final analysis.` : "All holdings are currently matched above the confidence threshold.",
    demoMode ? "Demo mode is on. The current holdings are sample data until OCR + AI extraction is connected." : "Analysis is based on uploaded statement data.",
  ];

  function normalizeOptions(h: Holding) {
    const base = Array.isArray(h.options) ? h.options.filter(Boolean) : [];
    const values = [h.suggested, ...base, "Manual ticker / CUSIP entry"].filter(Boolean);
    return Array.from(new Set(values));
  }

  function updateHolding(index: number, updates: Partial<Holding>) {
    setHoldings((prev) => prev.map((h, i) => (i === index ? { ...h, ...updates } : h)));
    setAnalysis(null);
  }

  async function handleExtractHoldings() {
    if (!uploadedFile) {
      setExtractError("Please upload a PDF, screenshot, or photo first.");
      return;
    }

    try {
      setIsExtracting(true);
      setExtractProgressIndex(0);
      setExtractError("");
      setAnalysis(null);

      const formData = new FormData();
      formData.append("file", uploadedFile);
      formData.append("client", JSON.stringify(client));

      const response = await fetch("/api/analyze-statement", { method: "POST", body: formData });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Statement analysis failed.");
      }

      const data = await response.json();
      const extractedHoldings = Array.isArray(data.holdings) ? data.holdings : [];

      if (extractedHoldings.length === 0) {
        throw new Error("No holdings were extracted from the statement. Try a clearer image or PDF.");
      }

      const cleaned = extractedHoldings.map((h: Holding) => ({
        rawName: h.rawName || "Unknown holding",
        suggested: h.suggested || "Needs advisor confirmation",
        confidence: Number(h.confidence || 0),
        assetClass: h.assetClass || "Unknown",
        value: Number(h.value || 0),
        status: Number(h.confidence || 0) >= 75 ? "matched" : "review",
        options: Array.isArray(h.options) && h.options.length > 0 ? h.options : [h.suggested || "Needs advisor confirmation", "Manual ticker / CUSIP entry"],
      }));

      setHoldings(cleaned);
      setDemoMode(false);
      setStep("confirm");
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : "Something went wrong analyzing the statement.");
    } finally {
      setIsExtracting(false);
      setExtractProgressIndex(0);
    }
  }

  async function runAIAnalysis() {
    if (!canRunDeepAnalysis) {
      setAnalysisError(
        `Resolve every holding that still needs review (${reviewCount} left) before running the deep analysis.`
      );
      return;
    }

    try {
      setIsAnalyzing(true);
      setAnalysisProgressIndex(0);
      setAnalysisError("");

      const response = await fetch("/api/generate-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client,
          holdings,
          allocation: { current: currentAllocation, target },
          totalValue,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "AI analysis failed.");
      }

      const data = await response.json();
      setAnalysis({
        synopsis: data.synopsis || "",
        portfolioHighlights: Array.isArray(data.portfolioHighlights) ? data.portfolioHighlights : [],
        strategies: Array.isArray(data.strategies) ? data.strategies : [],
        redFlags: Array.isArray(data.redFlags) ? data.redFlags : [],
        overlapInsights: Array.isArray(data.overlapInsights) ? data.overlapInsights : [],
        displayWhatThisMeans: Array.isArray(data.displayWhatThisMeans) ? data.displayWhatThisMeans : [],
        recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        talkingPoints: Array.isArray(data.talkingPoints) ? data.talkingPoints : [],
        advisorOpeningScript: data.advisorOpeningScript || "",
        objectionHandling: Array.isArray(data.objectionHandling) ? data.objectionHandling : [],
      });
      setStep("analysis");
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Something went wrong generating the analysis.");
      setStep("analysis");
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgressIndex(0);
    }
  }

  function nextIntake() {
    setIntakeStep((current) => {
      if (current < INTAKE_STEP_COUNT - 1) return current + 1;
      setStep("upload");
      return current;
    });
  }

  type MintUploadLinkResult =
    | { ok: true; uploadUrl: string; expiresAt: string }
    | { ok: false; error: string };

  async function mintClientUploadLink(): Promise<MintUploadLinkResult> {
    const owner = getCurrentOwnerEmail();
    if (!owner) return { ok: false, error: "Sign in to create a client upload link." };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const at = typeof window !== "undefined" ? sessionStorage.getItem("ap_supabase_at") : null;
    if (at) headers.Authorization = `Bearer ${at}`;

    try {
      const res = await fetch("/api/client-upload-token", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: String(data.error || "Could not create link.") };
      }
      return {
        ok: true,
        uploadUrl: String(data.uploadUrl || ""),
        expiresAt: String(data.expiresAt || ""),
      };
    } catch {
      return { ok: false, error: "Could not create link." };
    }
  }

  async function completeLiveIntakeToUpload(handoff: LiveIntakeHandoffAction) {
    try {
      if (handoff === "digital_email") {
        const minted = await mintClientUploadLink();
        if (!minted.ok) {
          setMagicLinkErr(minted.error);
          setLiveIntakeOpen(false);
          setStep("upload");
          setUploadSectionFocus("client_link");
          return;
        }
        setMagicLinkUrl(minted.uploadUrl);
        setMagicLinkExpiresAt(minted.expiresAt);

        const to = client.advisorEmail?.trim();
        if (!to) {
          setMagicLinkErr("Add the client email on the intake form to send the upload link.");
          setLiveIntakeOpen(false);
          setStep("upload");
          setUploadSectionFocus("client_link");
          return;
        }

        const advisorNameForEmail =
          signatureName.trim() || String(session?.user?.name || "").trim() || "";

        const em = await fetch("/api/email-client-upload-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            uploadUrl: minted.uploadUrl,
            clientFirstName: clientFirstNameSalutation(client),
            advisorName: advisorNameForEmail,
          }),
        });
        const mailData = await em.json();
        if (!em.ok) {
          setMagicLinkErr(mailData.error || "Could not send email.");
          setLiveIntakeOpen(false);
          setStep("upload");
          setUploadSectionFocus("client_link");
          return;
        }
        setMagicLinkErr("");
        setLiveIntakeOpen(false);
        setStep("upload");
        setUploadSectionFocus("client_link");
        return;
      }

      setLiveIntakeOpen(false);
      setStep("upload");
      if (handoff === "advisor_upload") {
        setUploadSectionFocus("advisor_upload");
      } else {
        setUploadSectionFocus(null);
      }
    } catch {
      setMagicLinkErr("Something went wrong finishing live intake.");
      setLiveIntakeOpen(false);
      setStep("upload");
    }
  }

  function backIntake() {
    if (intakeStep > 0) setIntakeStep(intakeStep - 1);
  }

  const liveIntakeFooter = useMemo(
    () => (
      <button
        type="button"
        aria-label="Profile AutoPilot"
        onClick={() => setLiveIntakeOpen(true)}
        className="group inline-flex flex-col items-center gap-2 rounded-2xl bg-transparent px-2 py-1 text-center transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
      >
        <img
          src="/logo.png?v=3"
          alt=""
          aria-hidden
          className="h-16 w-auto rounded-xl object-contain drop-shadow-[0_8px_18px_rgba(14,116,235,0.18)] transition group-hover:drop-shadow-[0_12px_24px_rgba(14,116,235,0.32)] md:h-[4.5rem]"
        />
        <span className="font-serif text-sm font-semibold leading-tight tracking-tight text-blue-900 transition group-hover:text-blue-950">
          Profile AutoPilot
        </span>
      </button>
    ),
    []
  );

  async function loadSavedReviews() {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      setSavedReviews([]);
      setSaveMessage("Please log in before opening the Client Database.");
      return;
    }

    try {
      const res = await fetch(`/api/client-database?ownerEmail=${encodeURIComponent(ownerEmail)}`);
      const data = await res.json();

      if (!res.ok) {
        setSaveMessage(data.error || "Could not load client database.");
        setSavedReviews([]);
        return;
      }

      setSavedReviews(Array.isArray(data.clients) ? data.clients : []);
    } catch {
      setSaveMessage("Could not load client database.");
      setSavedReviews([]);
    }
  }

  async function saveCurrentReview() {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      setSaveMessage("Please log in before saving a client profile.");
      return;
    }

    try {
      const res = await fetch("/api/client-database", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: activeReviewId,
          ownerEmail,
          client,
          holdings,
          meetingNotes,
          demoMode,
          analysis,
          totalValue,
          status: analysis ? "Analyzed" : activeReviewId ? undefined : "Analyzed",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveMessage(data.error || "Could not save client profile.");
        return;
      }

      if (data?.client?.id) setActiveReviewId(data.client.id);
      setSaveMessage(`Saved ${clientDisplayName(client) || "Client"} client profile.`);
      setTimeout(() => setSaveMessage(""), 2500);
      await loadSavedReviews();
    } catch {
      setSaveMessage("Could not save client profile.");
    }
  }

  function openSavedReview(review: SavedReview) {
    setActiveReviewId(review.id);
    setClient(normalizeIntakeClient(review.client));
    setHoldings(review.holdings);
    setMeetingNotes(review.meetingNotes || "");
    setDemoMode(Boolean(review.demoMode));
    setAnalysis(review.analysis || null);
    setFollowUpEmail("");
    setEmailCopied(false);
    const resumeConfirm =
      String(review.status || "").trim().toLowerCase() === "draft" && !review.analysis;
    setStep(resumeConfirm ? "confirm" : "analysis");
  }


  async function sendFollowUpFromDatabase(review: SavedReview) {
    if (!session) {
      alert("Please sign in with Google first to send an automated follow-up email.");
      return;
    }

    const to = String(review.client?.advisorEmail || "").trim();
    if (!to) {
      alert("Add the client's email (snapshot recipient) on their profile before sending.");
      return;
    }

    const normalizedClient = normalizeIntakeClient(review.client);
    const reviewHoldings = Array.isArray(review.holdings) ? review.holdings : [];
    if (reviewHoldings.length === 0) {
      alert("This profile has no saved holdings. Open the profile and save statement holdings before sending a follow-up.");
      return;
    }

    const ctx = computePortfolioContextFromReview(normalizedClient, reviewHoldings, Boolean(review.demoMode));
    if (!ctx.canRunDeepAnalysis) {
      alert(
        `Resolve every holding that still needs review (${ctx.reviewCount} left) before sending. Open the profile and confirm holdings, or use Update Analysis from the client list.`
      );
      return;
    }

    setFollowUpEmailSendingId(review.id);
    try {
      const analysisRes = await fetch("/api/generate-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: normalizedClient,
          holdings: reviewHoldings,
          allocation: { current: ctx.currentAllocation, target: ctx.target },
          totalValue: ctx.totalValue,
        }),
      });

      if (!analysisRes.ok) {
        const errData = await analysisRes.json().catch(() => null);
        throw new Error(errData?.error || "Could not refresh analysis for this follow-up.");
      }

      const genData = await analysisRes.json();
      const freshAnalysis: AIAnalysis = {
        synopsis: genData.synopsis || "",
        portfolioHighlights: Array.isArray(genData.portfolioHighlights) ? genData.portfolioHighlights : [],
        strategies: Array.isArray(genData.strategies) ? genData.strategies : [],
        redFlags: Array.isArray(genData.redFlags) ? genData.redFlags : [],
        overlapInsights: Array.isArray(genData.overlapInsights) ? genData.overlapInsights : [],
        displayWhatThisMeans: Array.isArray(genData.displayWhatThisMeans) ? genData.displayWhatThisMeans : [],
        recommendations: Array.isArray(genData.recommendations) ? genData.recommendations : [],
        talkingPoints: Array.isArray(genData.talkingPoints) ? genData.talkingPoints : [],
        advisorOpeningScript: genData.advisorOpeningScript || "",
        objectionHandling: Array.isArray(genData.objectionHandling) ? genData.objectionHandling : [],
      };

      const analysisPayload = {
        synopsis: freshAnalysis.synopsis,
        portfolioHighlights: freshAnalysis.portfolioHighlights || [],
        strategies: freshAnalysis.strategies,
        redFlags: freshAnalysis.redFlags || [],
        overlapInsights: freshAnalysis.overlapInsights || [],
        displayWhatThisMeans: freshAnalysis.displayWhatThisMeans || [],
        recommendations: freshAnalysis.recommendations,
        talkingPoints: freshAnalysis.talkingPoints || [],
        positioningImpact: [
          `Equity: ${ctx.currentAllocation.equity}% current → ${ctx.target.equity}% proposed`,
          `Fixed: ${ctx.currentAllocation.fixedIncome}% current → ${ctx.target.fixedIncome}% proposed`,
          `Cash: ${ctx.currentAllocation.cash}% current → ${ctx.target.cash}% proposed`,
        ],
        advisorOpeningScript: freshAnalysis.advisorOpeningScript || "",
        objectionHandling: freshAnalysis.objectionHandling || [],
      };

      const emailRes = await fetch("/api/email-client-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailVariant: "follow_up",
          to,
          emailSignature: getCleanEmailSignature(),
          calendarLink: signatureCalendarLink,
          client: normalizedClient,
          analysis: analysisPayload,
          allocation: {
            current: ctx.currentAllocation,
            target: ctx.target,
          },
          scores: ctx.scores,
          retirementModel: {
            currentSuccessRate: ctx.currentSuccessRate,
            proposedSuccessRate: ctx.proposedSuccessRate,
            successImprovement: ctx.successImprovement,
            insights: ctx.retirementModelInsights,
          },
          totalValue: ctx.totalValue,
          holdings: reviewHoldings,
        }),
      });

      const emailText = await emailRes.text();
      let emailJson: Record<string, unknown> = {};
      try {
        emailJson = emailText ? JSON.parse(emailText) : {};
      } catch {
        emailJson = {};
      }

      if (!emailRes.ok) {
        throw new Error(String(emailJson.error || emailText || "Failed to send follow-up email."));
      }

      openSavedReview({ ...review, analysis: freshAnalysis });
      setAnalysis(freshAnalysis);
      setStep("report");
      setFollowUpEmail(typeof emailJson.plainTextBody === "string" ? emailJson.plainTextBody : "");
      setEmailCopied(false);

      const ownerEmail = getCurrentOwnerEmail();
      if (ownerEmail) {
        await fetch("/api/client-database", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: review.id,
            ownerEmail,
            client: normalizedClient,
            holdings: reviewHoldings,
            meetingNotes: review.meetingNotes || "",
            demoMode: Boolean(review.demoMode),
            analysis: freshAnalysis,
            totalValue: ctx.totalValue,
            status: "Report Sent",
            lastContactedAt: new Date().toISOString(),
          }),
        });
        await loadSavedReviews();
      }

      alert(String(emailJson.message || "Follow-up email with an updated Client Snapshot was sent."));
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Could not send follow-up email.");
    } finally {
      setFollowUpEmailSendingId(null);
    }
  }

  function updateAnalysisFromDatabase(review: SavedReview) {
    setActiveReviewId(review.id);
    setClient(normalizeIntakeClient(review.client));
    setHoldings(review.holdings);
    setMeetingNotes(review.meetingNotes || "");
    setDemoMode(Boolean(review.demoMode));
    setAnalysis(null);
    setFollowUpEmail("");
    setEmailCopied(false);
    setUploadedFile(null);
    setExtractError("");
    setStep("upload");
  }

  async function deleteSavedReview(id: string) {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      setSaveMessage("Please log in before deleting a client profile.");
      return;
    }

    try {
      const res = await fetch("/api/client-database", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ownerEmail,
          id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveMessage(data.error || "Could not delete client profile.");
        return;
      }

      setSavedReviews((prev) => prev.filter((review) => review.id !== id));
      setSaveMessage("Client profile deleted.");
      setTimeout(() => setSaveMessage(""), 2500);
    } catch {
      setSaveMessage("Could not delete client profile.");
    }
  }

  function formatSavedDate(value: string) {
    try {
      return new Date(value).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "Client profile";
    }
  }


  function getCurrentOwnerEmail() {
    return String(session?.user?.email || emailAuthUser?.email || "").trim().toLowerCase();
  }

  async function createClientUploadLink() {
    setMagicLinkErr("");
    setMagicLinkCopied(false);
    if (!getCurrentOwnerEmail()) {
      setMagicLinkErr("Sign in to create a client upload link.");
      return;
    }
    setMagicLinkBusy(true);
    try {
      const minted = await mintClientUploadLink();
      if (!minted.ok) {
        setMagicLinkErr(minted.error);
        return;
      }
      setMagicLinkUrl(minted.uploadUrl);
      setMagicLinkExpiresAt(minted.expiresAt);
    } finally {
      setMagicLinkBusy(false);
    }
  }

  async function copyMagicLink() {
    if (!magicLinkUrl) return;
    try {
      await navigator.clipboard.writeText(magicLinkUrl);
      setMagicLinkCopied(true);
      window.setTimeout(() => setMagicLinkCopied(false), 2000);
    } catch {
      setMagicLinkErr("Could not copy — select the link in the field and copy manually.");
    }
  }

  function composeEmailSignature() {
    return [
      signatureName,
      signatureTitle,
      signatureLicense,
      signatureCalendarLink ? "Book a time on my calendar" : "",
      signatureAddress,
      signatureOfficePhone ? `Office: ${signatureOfficePhone}` : "",
      signatureCellPhone ? `Cell: ${signatureCellPhone}` : "",
      signatureWebsite,
    ].filter(Boolean).join("\n");
  }

  function getCleanEmailSignature() {
    return emailSignature.trim() || composeEmailSignature().trim() || "[Email signature]";
  }

  async function loadAdvisorProfile(ownerEmail = getCurrentOwnerEmail()) {
    if (!ownerEmail) return;

    try {
      const res = await fetch(`/api/advisor-profile?ownerEmail=${encodeURIComponent(ownerEmail)}`);
      const data = await res.json();

      if (!res.ok) return;

      const profile = data?.profile || {};
      const savedSignature = profile.emailSignature || "";
      const savedCalendarLink = String(profile.calendarLink || "").trim();
      const inferredLinkFromSignature =
        !savedCalendarLink && typeof savedSignature === "string"
          ? (savedSignature.match(/https?:\/\/[^\s]+/i)?.[0] || "").trim()
          : "";

      setEmailSignature(savedSignature);
      setSignatureDraft(savedSignature);

      setSignatureName(profile.advisorName || "");
      setSignatureTitle(profile.advisorTitle || "");
      setSignatureLicense(profile.advisorLicense || "");
      setSignatureCalendarLink(savedCalendarLink || inferredLinkFromSignature);
      setSignatureAddress(profile.officeAddress || "");
      setSignatureOfficePhone(profile.officePhone || "");
      setSignatureCellPhone(profile.cellPhone || "");
      setSignatureWebsite(profile.website || "");

      setShowSignatureSetup(!savedSignature && !profile.advisorName);
    } catch {
      // Non-blocking. The app can still run without a saved advisor profile.
    }
  }

  async function saveAdvisorProfile() {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      setAuthMessage("Please log in before saving your advisor profile.");
      return;
    }

    try {
      const res = await fetch("/api/advisor-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ownerEmail,
          advisorName: signatureName,
          advisorTitle: signatureTitle,
          advisorLicense: signatureLicense,
          calendarLink: signatureCalendarLink,
          officeAddress: signatureAddress,
          officePhone: signatureOfficePhone,
          cellPhone: signatureCellPhone,
          website: signatureWebsite,
          emailSignature: composeEmailSignature(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthMessage(data.error || "Could not save advisor profile.");
        return;
      }

      setEmailSignature(data?.profile?.emailSignature || composeEmailSignature());
      setSignatureDraft(data?.profile?.emailSignature || composeEmailSignature());

      setSignatureName(data?.profile?.advisorName || signatureName);
      setSignatureTitle(data?.profile?.advisorTitle || signatureTitle);
      setSignatureLicense(data?.profile?.advisorLicense || signatureLicense);
      setSignatureCalendarLink(data?.profile?.calendarLink || signatureCalendarLink);
      setSignatureAddress(data?.profile?.officeAddress || signatureAddress);
      setSignatureOfficePhone(data?.profile?.officePhone || signatureOfficePhone);
      setSignatureCellPhone(data?.profile?.cellPhone || signatureCellPhone);
      setSignatureWebsite(data?.profile?.website || signatureWebsite);
      setShowSignatureSetup(false);
      setSaveMessage("Advisor email signature saved.");
      setTimeout(() => setSaveMessage(""), 2500);
    } catch {
      setAuthMessage("Could not save advisor profile.");
    }
  }

  async function markCurrentClientContacted() {
    const ownerEmail = getCurrentOwnerEmail();
    if (!ownerEmail) return;

    try {
      const res = await fetch("/api/client-database", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: activeReviewId,
          ownerEmail,
          client,
          holdings,
          meetingNotes,
          demoMode,
          analysis,
          totalValue,
          status: "Report Sent",
          lastContactedAt: new Date().toISOString(),
        }),
      });

      const data = await res.json();

      if (res.ok && data?.client?.id) {
        setActiveReviewId(data.client.id);
        await loadSavedReviews();
      }
    } catch {
      // Non-blocking.
    }
  }




async function handleEmailSignup() {
  try {
    setAuthMessage("");

    const res = await fetch("/api/auth/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
      headers: {
        "Content-Type": "application/json",
      },
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

    setEmailAuthUser(
      data.user && typeof data.user === "object" ? (data.user as EmailAuthUser) : null
    );
    setAuthMessage("Logged in successfully.");
    await loadAdvisorProfile(data.user?.email);
  } catch {
    setAuthMessage("Could not log in.");
  }
}

function handleEmailPasswordLogout() {
  setEmailAuthUser(null);
  setAuthEmail("");
  setAuthPassword("");
  if (typeof window !== "undefined") sessionStorage.removeItem("ap_supabase_at");
  setAuthMessage("Signed out.");
}

function handleEmailReport() {
  const to = client.advisorEmail || "";
  const subject = `AdvisorPilot Portfolio Review - ${clientDisplayName(client) || "Client"}`;

  const emailLines = [
    "Portfolio Review Snapshot",
    "",
    `Client: ${clientDisplayName(client) || "Client"}`,
    `Age: ${derivedAge || "N/A"}`,
    `Risk Profile: ${client.riskProfile.replace("-", " ")}`,
    "",
    "Current Allocation:",
    `Equity: ${currentAllocation.equity}%`,
    `Fixed Income: ${currentAllocation.fixedIncome}%`,
    `Cash: ${currentAllocation.cash}%`,
    "",
    "Proposed Allocation:",
    `Equity: ${target.equity}%`,
    `Fixed Income: ${target.fixedIncome}%`,
    `Cash: ${target.cash}%`,
    "",
    "Synopsis:",
    displaySynopsis,
    "",
    "Strategic Considerations:",
    ...displayStrategies.map((s) => `- ${s}`),
    "",
    "Advisor Example Recommendations:",
    ...displayRecommendations.map((r) => `- ${r}`),
    "",
    "Note: Use Download PDF Report to create and attach the PDF version.",
  ];

  const body = emailLines.join("\n");

  window.location.href =
    "mailto:" +
    to +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body);
}


async function sendClientSnapshotEmail() {
  try {
    if (!session) {
      alert("Please sign in with Google first.");
      return;
    }

    if (!client.advisorEmail) {
      alert("Add the client's email (snapshot recipient) before sending.");
      return;
    }

    const firstName = clientFirstNameSalutation(client);

    const shortSynopsis =
      displaySynopsis
        ?.split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(" ") || "";

    const clientStrategy =
      displayStrategies?.[0] ||
      "review your portfolio together and confirm it aligns with your goals.";

    const generatedEmailBody = [
      `Hi ${firstName},`,
      "",
      "Thank you again for taking the time to review your portfolio with me.",
      "",
      "I wanted to send over your Client Snapshot and briefly highlight a couple key takeaways.",
      "",
      shortSynopsis,
      "",
      `Next step: ${clientStrategy.charAt(0).toLowerCase() + clientStrategy.slice(1)}`,
      "",
      "The full breakdown is included in the attached Client Snapshot.",
      "",
      "Please take a look when you have a chance and let me know if any questions come up.",
      "",
      getCleanEmailSignature(),
    ].join("\n");

    const res = await fetch("/api/email-client-snapshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: client.advisorEmail,
        subject: `Next Steps from Our Portfolio Review - ${clientDisplayName(client) || "Client"}`,
        emailBody: generatedEmailBody,
        emailSignature: getCleanEmailSignature(),
        calendarLink: signatureCalendarLink,
        client,
        analysis: {
          synopsis: displaySynopsis,
          portfolioHighlights: displayPortfolioHighlights,
          strategies: displayStrategies,
          redFlags: displayRedFlags,
          overlapInsights: displayOverlapInsights,
          displayWhatThisMeans: displayWhatThisMeans,
          recommendations: displayRecommendations,
          talkingPoints: displayTalkingPoints,
          positioningImpact,
          advisorOpeningScript: analysis?.advisorOpeningScript || "",
          objectionHandling: analysis?.objectionHandling || [],
        },
        allocation: {
          current: currentAllocation,
          target,
        },
        scores,
        retirementModel: {
          currentSuccessRate,
          proposedSuccessRate,
          successImprovement,
          insights: retirementModelInsights,
        },
        totalValue,
        holdings,
      }),
    });

    const text = await res.text();
    let data: { error?: string } = {};

    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      data =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as { error?: string })
          : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      alert(data.error || text || "Failed to send email.");
      return;
    }

    await markCurrentClientContacted();
    alert("Client Snapshot sent successfully.");
  } catch (err) {
    console.error(err);
    alert("Error sending email.");
  }
}

async function downloadPDFReport(mode: "client" | "advisor") {
  try {
    const res = await fetch("/api/generate-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode, // 👈 NEW
        client,
        analysis: {
          synopsis: displaySynopsis,
          portfolioHighlights: displayPortfolioHighlights,
          strategies: displayStrategies,
          redFlags: displayRedFlags,
          overlapInsights: displayOverlapInsights,
          displayWhatThisMeans: displayWhatThisMeans,
          recommendations: displayRecommendations,
          talkingPoints: displayTalkingPoints,
          positioningImpact,
          advisorOpeningScript: analysis?.advisorOpeningScript || "",
          objectionHandling: analysis?.objectionHandling || [],
        },
        allocation: {
          current: currentAllocation || {},
          target: target || {},
        },
        scores,
        retirementModel: {
          currentSuccessRate,
          proposedSuccessRate,
          successImprovement,
          insights: retirementModelInsights,
        },
        totalValue: totalValue || 0,
        holdings, // 👈 future use
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("PDF SERVER ERROR:", errorText);
      alert("PDF server error: " + errorText);
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download =
      mode === "client"
        ? "Client_Snapshot.pdf"
        : "Advisor_Deep_Dive.pdf";

    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("PDF ERROR:", err);
    alert("Failed to generate PDF report.");
  }
}

  function openGmailWithFollowUp() {
    const emailText = followUpEmail || "";
    const subjectLine = "Next Steps from Our Portfolio Review";
    const body = emailText.replace(/^Subject:.*\n\n/, "");
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(client.advisorEmail || "")}&su=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    markCurrentClientContacted();
  }

  function openOutlookWithFollowUp() {
    const emailText = followUpEmail || "";
    const subjectLine = "Next Steps from Our Portfolio Review";
    const body = emailText.replace(/^Subject:.*\n\n/, "");
    const url = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(client.advisorEmail || "")}&subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    markCurrentClientContacted();
  }

  function buildFollowUpEmail() {
    const firstName = clientFirstNameSalutation(client);

    const shortSynopsis =
      displaySynopsis
        ?.split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(" ") || "The attached Client Snapshot provides a high-level overview of your current portfolio positioning and areas we may want to review together.";

    const primaryHighlight =
      displayPortfolioHighlights?.[0] ||
      "Your portfolio review includes a few key areas worth discussing together.";

    const primaryNextStep =
      clientNextSteps?.[0] ||
      "review the portfolio in more detail and prepare a final advisor-approved plan.";

    const email = [
      "Subject: Next Steps from Our Portfolio Review",
      "",
      `Hi ${firstName},`,
      "",
      "Thank you again for taking the time to review your portfolio with me.",
      "",
      "I wanted to send over your Client Snapshot and briefly highlight a couple key takeaways from the review.",
      "",
      shortSynopsis,
      "",
      `Key highlight: ${primaryHighlight.charAt(0).toLowerCase() + primaryHighlight.slice(1)}`,
      "",
      `Next step: I will ${primaryNextStep.charAt(0).toLowerCase() + primaryNextStep.slice(1)}`,
      "",
      "Please review the attached Client Snapshot when you have a chance, and let me know if any questions come up.",
      "",
      getCleanEmailSignature(),
    ].join("\n");

    setFollowUpEmail(email);
    setEmailCopied(false);
    markCurrentClientContacted();
  }

  async function copyFollowUpEmail() {
    if (!followUpEmail) return;

    try {
      await navigator.clipboard.writeText(followUpEmail);
      setEmailCopied(true);
      markCurrentClientContacted();
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = followUpEmail;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
      setEmailCopied(true);
      markCurrentClientContacted();
    }
  }

  const filteredSavedReviews = savedReviews.filter((review: SavedReview) => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return true;

    const name = clientDisplayName(review.client || {}).toLowerCase();
    const email = String(review.client?.advisorEmail || "").toLowerCase();

    return name.includes(query) || email.includes(query);
  });

  const isLoggedIn = Boolean(session || emailAuthUser);

  if (!authLoaded) {
    return (
      <div className="ap-app-bg min-h-screen p-4 text-slate-950 md:p-8">
        <div aria-hidden className="ap-orb ap-orb-1" />
        <div aria-hidden className="ap-orb ap-orb-2" />
        <div className="mx-auto flex min-h-[80vh] max-w-3xl items-center justify-center">
          <Card className="ap-glass ap-step-enter w-full rounded-[2rem] border-0">
            <CardContent className="p-8 text-center">
              <LogoBlock />
              <p className="mt-6 text-slate-600">Loading AdvisorPilot...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="ap-app-bg min-h-screen p-4 text-slate-950 md:p-8">
        <div aria-hidden className="ap-orb ap-orb-1" />
        <div aria-hidden className="ap-orb ap-orb-2" />
        <div className="mx-auto flex min-h-[88vh] max-w-5xl items-center justify-center">
          <Card className="ap-glass ap-step-enter w-full rounded-[2rem] border-0">
            <CardContent className="grid gap-8 p-6 md:grid-cols-[1fr_1.1fr] md:p-10">
              <div className="flex flex-col justify-center">
                <LogoBlock />
                <h1 className="mt-8 font-serif text-4xl font-bold tracking-tight text-slate-950 md:text-5xl">
                  Sign in to AdvisorPilot
                </h1>
                <p className="mt-4 text-lg leading-8 text-slate-600">
                  Analyze client statements, generate polished portfolio reports, and manage client reviews from one advisor workspace.
                </p>
                <div className="mt-6 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
                  Google sign-in enables direct Gmail sending. Email/password accounts can still use the app, download reports, and copy generated follow-up emails manually.
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
                <Button
                  className="h-12 w-full rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400"
                  onClick={() => signIn("google", { callbackUrl: "/" })}
                >
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
                    className="h-12 rounded-2xl"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                  />

                  <Input
                    type="password"
                    placeholder="Password"
                    className="h-12 rounded-2xl"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                  />

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button variant="outline" className="h-12 rounded-2xl" onClick={handleEmailLogin}>
                      Login
                    </Button>

                    <Button className="h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400" onClick={handleEmailSignup}>
                      Create Account
                    </Button>
                  </div>

                  {authMessage && (
                    <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      {authMessage}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="ap-app-bg min-h-screen p-4 text-slate-950 md:p-8 print:bg-white print:p-0">
      <div aria-hidden className="ap-orb ap-orb-1 print:hidden" />
      <div aria-hidden className="ap-orb ap-orb-2 print:hidden" />
      <style jsx global>{`
        @media print {
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          header, .app-nav, .no-print { display: none !important; }
          .print-card { border: none !important; box-shadow: none !important; padding: 0 !important; }
          .report-paper { border: none !important; box-shadow: none !important; padding: 24px !important; }
          svg, img { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="mx-auto max-w-7xl space-y-6 print:max-w-none print:space-y-0">
        <header className="ap-glass-strong flex items-center justify-between rounded-[2rem] border-0 px-5 py-4 md:px-7">
          <LogoBlock />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {demoMode && <Badge variant="outline" className="hidden rounded-full border-amber-200 bg-amber-50 text-amber-800 sm:inline-flex">Demo data</Badge>}
            {analysis && <Badge variant="outline" className="hidden rounded-full border-blue-200 bg-blue-50 text-blue-800 sm:inline-flex">Analysis ready</Badge>}
            {session && (
              <>
                <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-800">
                  Google: {session.user?.email}
                </Badge>
                <Button variant="outline" className="rounded-2xl" onClick={() => setShowSignatureSetup(true)}>
                  Email Signature
                </Button>
                <Button variant="outline" className="rounded-2xl" onClick={() => signOut({ callbackUrl: "/" })}>
                  Sign out Google
                </Button>
              </>
            )}
            {!session && emailAuthUser && (
              <>
                <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-800">
                  Email: {emailAuthUser.email}
                </Badge>
                <Button variant="outline" className="rounded-2xl" onClick={() => setShowSignatureSetup(true)}>
                  Email Signature
                </Button>
                <Button variant="outline" className="rounded-2xl" onClick={handleEmailPasswordLogout}>
                  Sign out
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="app-nav grid grid-cols-2 gap-2 md:grid-cols-7">
          {["intake", "upload", "confirm", "analysis", "meeting", "report", "saved"].map((item, i) => <StepButton key={item} label={item === "saved" ? "Client Database" : item} index={i + 1} active={step === item} onClick={() => { if (item === "saved") loadSavedReviews(); setStep(item); }} />)}
        </div>

        {saveMessage && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800">
            {saveMessage}
          </div>
        )}

        {showSignatureSetup && (
          <Card className="rounded-[2rem] ap-glass border-0">
            <CardContent className="space-y-5 p-6 md:p-8">
              <div>
                <h2 className="font-serif text-2xl font-bold text-slate-950">Set up your email signature</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Fill this out once. AdvisorPilot will add it to generated emails and client snapshot emails.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-slate-700">Advisor name</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder="Christopher Perussina" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Title</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureTitle} onChange={(e) => setSignatureTitle(e.target.value)} placeholder="President" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">License line</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureLicense} onChange={(e) => setSignatureLicense(e.target.value)} placeholder="License #0H38298" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Calendar booking link</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureCalendarLink} onChange={(e) => setSignatureCalendarLink(e.target.value)} placeholder="https://calendly.com/your-link" />
                  <p className="mt-1 text-xs text-slate-500">Clients will see this as “Book a time on my calendar.”</p>
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Office address</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureAddress} onChange={(e) => setSignatureAddress(e.target.value)} placeholder="1255 Treat Blvd Suite 300 Floor 3, Walnut Creek, CA 94597" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Office phone</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureOfficePhone} onChange={(e) => setSignatureOfficePhone(e.target.value)} placeholder="(415) 991-2800 X102" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Cell phone</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureCellPhone} onChange={(e) => setSignatureCellPhone(e.target.value)} placeholder="(925) 413-8100" />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Website</label>
                  <Input className="mt-2 h-12 rounded-2xl bg-white" value={signatureWebsite} onChange={(e) => setSignatureWebsite(e.target.value)} placeholder="www.AssuredWealthAdvisors.com" />
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-700">Signature preview</p>
                <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-white p-4 text-sm leading-6 text-slate-700">{composeEmailSignature() || "Your signature preview will appear here."}</pre>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button className="rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400" onClick={saveAdvisorProfile}>
                  Save Signature
                </Button>

                <Button variant="outline" className="rounded-2xl" onClick={() => setShowSignatureSetup(false)}>
                  Skip for now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "intake" && liveIntakeOpen && (
          <LiveIntakeOverlay
            intakeStep={intakeStep}
            client={client}
            setClient={setClient}
            advisorDisplayName={advisorVoiceName}
            onAdvanceStep={nextIntake}
            onCompleteToUpload={completeLiveIntakeToUpload}
            onClose={() => setLiveIntakeOpen(false)}
          />
        )}
        <div key={`${step}-${step === "intake" ? intakeStep : "main"}`} className="ap-step-enter">
        {step === "intake" && intakeStep === 0 && <IntakeShell progress={progress} eyebrow={INTAKE_STEPS[0].eyebrow} title={INTAKE_STEPS[0].title} helper={INTAKE_STEPS[0].helper} onBack={backIntake} backDisabled onNext={nextIntake} footerCenter={liveIntakeFooter}><div className="space-y-4">
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <div>
      <label className="text-sm font-semibold text-slate-700">First name</label>
      <Input className="mt-2 h-14 rounded-2xl border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.firstName} onChange={(e) => setClient({ ...client, firstName: e.target.value })} placeholder="Jane" autoFocus />
    </div>
    <div>
      <label className="text-sm font-semibold text-slate-700">Last name</label>
      <Input className="mt-2 h-14 rounded-2xl border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.lastName} onChange={(e) => setClient({ ...client, lastName: e.target.value })} placeholder="Smith" />
    </div>
  </div>
  <div>
    <label className="text-sm font-semibold text-slate-700">Client email (Client Snapshot recipient)</label>
    <Input className="mt-2 h-14 rounded-2xl border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="email" value={client.advisorEmail} onChange={(e) => setClient({ ...client, advisorEmail: e.target.value })} placeholder="client@email.com" />
    <p className="mt-2 text-sm text-slate-500">This is the client&apos;s inbox for the snapshot PDF / Gmail send — not your advisor login. Your identity comes from the account you&apos;re signed into and your email signature.</p>
  </div>
</div></IntakeShell>}
        {step === "intake" && intakeStep === 1 && <IntakeShell progress={progress} eyebrow={INTAKE_STEPS[1].eyebrow} title={INTAKE_STEPS[1].title} helper={INTAKE_STEPS[1].helper} onBack={backIntake} onNext={nextIntake} footerCenter={liveIntakeFooter}><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className="text-sm font-semibold text-slate-700">Date of birth</label><Input className="mt-2 h-14 rounded-2xl border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="date" value={client.dob} onChange={(e) => {
  const dob = e.target.value;
  const calculatedAge = getAgeFromDob(dob);
  setClient({
    ...client,
    dob,
    age: calculatedAge !== null ? String(calculatedAge) : client.age,
  });
}} /></div><div><label className="text-sm font-semibold text-slate-700">Or age</label><Input className="mt-2 h-14 rounded-2xl border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="number" value={client.age} onChange={(e) => setClient({ ...client, age: e.target.value })} placeholder="62" /></div></div></IntakeShell>}
        {step === "intake" && intakeStep === 2 && <IntakeShell progress={progress} eyebrow={INTAKE_STEPS[2].eyebrow} title={INTAKE_STEPS[2].title} helper={INTAKE_STEPS[2].helper} onBack={backIntake} onNext={nextIntake} footerCenter={liveIntakeFooter}><label className="text-sm font-semibold text-slate-700">Expected retirement age</label><Input className="mt-2 h-14 rounded-2xl border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="number" value={client.retirementAge} onChange={(e) => setClient({ ...client, retirementAge: e.target.value })} placeholder="67" /></IntakeShell>}
        {step === "intake" && intakeStep === 3 && <IntakeShell progress={progress} eyebrow={INTAKE_STEPS[3].eyebrow} title={INTAKE_STEPS[3].title} helper={INTAKE_STEPS[3].helper} onBack={backIntake} onNext={nextIntake} footerCenter={liveIntakeFooter}><div className="grid grid-cols-1 gap-3 md:grid-cols-2">{["conservative", "moderate-conservative", "moderate", "moderate-growth", "aggressive"].map((risk) => <button key={risk} onClick={() => setClient({ ...client, riskProfile: risk })} className={`rounded-2xl border p-4 text-left capitalize transition ${client.riskProfile === risk ? "border-sky-500 bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 text-white shadow-lg" : "border-slate-200 bg-white hover:bg-sky-50"}`}>{risk.replace("-", " ")}</button>)}</div></IntakeShell>}
        {step === "intake" && intakeStep === 4 && <IntakeShell progress={progress} eyebrow={INTAKE_STEPS[4].eyebrow} title={INTAKE_STEPS[4].title} helper={INTAKE_STEPS[4].helper} onBack={backIntake} onNext={nextIntake} footerCenter={liveIntakeFooter}><div className="grid grid-cols-1 gap-3">{[["risk-profile", "Use stated risk profile", "Best default for advisor-reviewed recommendations."], ["age-default", "Run default based on age", "Good if no risk questionnaire has been completed yet."], ["income-goal", "Retirement income goal", "Best for near-retirees who need income and lower volatility."], ["custom", "Custom advisor model", "Use your own allocation model later."]].map(([value, title, desc]) => <button key={value} onClick={() => setClient({ ...client, calibration: value })} className={`rounded-2xl border p-4 text-left transition ${client.calibration === value ? "border-sky-500 bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 text-white shadow-lg" : "border-slate-200 bg-white hover:bg-sky-50"}`}><div className="font-semibold">{title}</div><div className={`mt-1 text-sm ${client.calibration === value ? "text-blue-100" : "text-slate-500"}`}>{desc}</div></button>)}</div></IntakeShell>}
        {step === "intake" && intakeStep === 5 && <IntakeShell progress={progress} eyebrow={INTAKE_STEPS[5].eyebrow} title={INTAKE_STEPS[5].title} helper={INTAKE_STEPS[5].helper} onBack={backIntake} onNext={nextIntake} footerCenter={liveIntakeFooter}><Textarea className="min-h-40 rounded-2xl border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.goal} onChange={(e) => setClient({ ...client, goal: e.target.value })} placeholder="Example: Wants retirement income, less market risk, and tax-efficient withdrawals." /></IntakeShell>}

        {step === "upload" && (
          <Card className="rounded-[2rem] ap-glass border-0">
            <CardContent className="space-y-6 p-6 pb-28 md:p-8 md:pb-8">
              <div className="flex items-center gap-3"><div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl"><Upload className="h-6 w-6" /></div><div><h2 className="font-serif text-3xl font-bold">Statement Capture</h2><p className="text-sm text-slate-500">Upload a statement or take a picture from your phone.</p></div></div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3"><MetricCard icon={<User className="h-5 w-5" />} label="Client" value={clientDisplayName(client) || "Unnamed"} helper={derivedAge ? `Age ${derivedAge}` : "Age not set"} /><MetricCard icon={<Target className="h-5 w-5" />} label="Risk profile" value={client.riskProfile.replace("-", " ")} helper="Used for calibration" /><MetricCard icon={<BriefcaseBusiness className="h-5 w-5" />} label="Retirement age" value={client.retirementAge || "N/A"} helper="Timeline input" /></div>
              <div
                id="upload-section-client-link"
                className="ap-callout rounded-3xl p-5 md:p-6 scroll-mt-24"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <p className="ap-eyebrow">Option A — Have the client upload</p>
                    <p className="font-serif text-xl font-semibold text-blue-950">Client upload link</p>
                    <p className="text-sm text-slate-600">
                      Your client opens this on their phone and uploads their statement. The file is extracted and saved as a <strong>Draft</strong> on <strong>your</strong> Client Database only — not another advisor&apos;s.
                    </p>
                    {magicLinkExpiresAt ? (
                      <p className="text-xs text-slate-500">
                        Link expires: {new Date(magicLinkExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    ) : null}
                    {magicLinkErr ? <p className="text-sm text-red-700">{magicLinkErr}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" className="h-11 rounded-2xl touch-manipulation" onClick={createClientUploadLink} disabled={magicLinkBusy}>
                        <Link2 className="mr-2 h-4 w-4" />
                        {magicLinkBusy ? "Creating…" : magicLinkUrl ? "New link" : "Create link"}
                      </Button>
                      {magicLinkUrl ? (
                        <Button type="button" className="h-11 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 touch-manipulation hover:from-blue-950 hover:via-blue-800 hover:to-sky-400" onClick={copyMagicLink}>
                          {magicLinkCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                          {magicLinkCopied ? "Copied" : "Copy link"}
                        </Button>
                      ) : null}
                    </div>
                    {magicLinkUrl ? (
                      <Input readOnly className="mt-2 h-11 rounded-2xl bg-white font-mono text-xs" value={magicLinkUrl} onFocus={(e) => e.target.select()} />
                    ) : null}
                  </div>
                  {magicLinkUrl ? (
                    <div className="flex shrink-0 flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-medium text-slate-600">Optional QR (same link)</p>
                      {/* quickchart.io generates the QR image; link stays on your origin once opened */}
                      <img
                        alt=""
                        width={200}
                        height={200}
                        className="rounded-lg"
                        src={`https://quickchart.io/qr?text=${encodeURIComponent(magicLinkUrl)}&size=220&margin=2`}
                      />
                      <p className="max-w-[220px] text-center text-[10px] text-slate-400">Texting the link is usually easiest; QR is for clients who prefer to scan.</p>
                    </div>
                  ) : null}
                </div>
              </div>
              <div
                id="upload-section-advisor-upload"
                className="space-y-3 scroll-mt-24"
              >
                <p className="ap-eyebrow">Option B — Upload directly</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="cursor-pointer rounded-3xl border border-sky-200/60 bg-white/80 p-6 transition hover:-translate-y-1 hover:border-sky-400 hover:shadow-[0_18px_40px_-22px_rgba(14,165,233,0.45)] md:p-7"><div className="ap-icon-tile mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl"><FileText className="h-6 w-6" /></div><h3 className="text-lg font-semibold">Upload emailed or texted statement</h3><p className="mb-4 text-sm text-slate-500">PDF, JPG, PNG, or screenshot.</p><Input className="min-h-11" type="file" accept=".pdf,image/*" onChange={(e) => setUploadedFile(e.target.files?.[0] || null)} /></label>
                  <label className="cursor-pointer rounded-3xl border border-sky-200/60 bg-white/80 p-6 transition hover:-translate-y-1 hover:border-sky-400 hover:shadow-[0_18px_40px_-22px_rgba(14,165,233,0.45)] md:p-7"><div className="ap-icon-tile mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl"><Camera className="h-6 w-6" /></div><h3 className="text-lg font-semibold">Take a picture on phone</h3><p className="mb-4 text-sm text-slate-500">Uses your mobile camera when opened from a phone.</p><Input className="min-h-11" type="file" accept="image/*" capture="environment" onChange={(e) => setUploadedFile(e.target.files?.[0] || null)} /></label>
                </div>
              </div>
              {uploadedFile && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm">
                  <CheckCircle className="h-4 w-4 text-sky-600" />
                  <span className="font-medium text-blue-950">Selected file:</span>
                  <span className="truncate text-slate-700">{uploadedFile.name}</span>
                </div>
              )}
              <div className="rounded-3xl border border-blue-100 bg-blue-50/80 p-5 text-sm text-blue-950"><Wand2 className="mb-2 h-5 w-5" />Extraction sends your file to AI and builds a holdings table for you to confirm. Expect roughly <strong>20–60 seconds</strong> on a typical connection; large PDFs or slow Wi‑Fi can take longer.</div>
              {extractError && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{extractError}</div>}
              {isExtracting && (
                <p className="text-sm font-medium text-slate-700" aria-live="polite">
                  {EXTRACT_PROGRESS_MESSAGES[extractProgressIndex % EXTRACT_PROGRESS_MESSAGES.length]}
                </p>
              )}
              <div className="hidden items-center gap-3 border-t border-sky-100/60 pt-5 md:flex">
                <Button variant="outline" className="h-12 rounded-2xl px-5" onClick={() => setStep("intake")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
                <Button className="ml-auto h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-6" onClick={handleExtractHoldings} disabled={isExtracting}>{isExtracting ? EXTRACT_PROGRESS_MESSAGES[extractProgressIndex % EXTRACT_PROGRESS_MESSAGES.length] : "Extract holdings"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
              <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-sky-200/50 bg-white/85 p-4 shadow-[0_-8px_32px_rgba(15,58,122,0.12)] backdrop-blur-xl md:hidden">
                <div className="mx-auto flex max-w-3xl gap-3">
                  <Button variant="outline" className="h-14 flex-1 rounded-2xl touch-manipulation" onClick={() => setStep("intake")}>Back</Button>
                  <Button className="h-14 flex-[2] rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 touch-manipulation" onClick={handleExtractHoldings} disabled={isExtracting}>{isExtracting ? EXTRACT_PROGRESS_MESSAGES[extractProgressIndex % EXTRACT_PROGRESS_MESSAGES.length] : "Extract holdings"}</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "confirm" && (
          <Card className="rounded-[2rem] ap-glass border-0">
            <CardContent className="space-y-6 p-6 pb-28 md:p-8 md:pb-8">
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl"><ShieldCheck className="h-6 w-6" /></div><div><h2 className="font-serif text-3xl font-bold">Confirm Holdings</h2><p className="text-sm text-slate-500">Review matches, choose alternate matches, enter manual tickers, and select asset classes.</p></div></div><Badge className={`rounded-full ${reviewCount ? "bg-red-600" : "bg-emerald-600"}`}>{reviewCount} need review</Badge></div>
              {!demoMode && !String(session?.user?.email || emailAuthUser?.email || "").trim() && (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Sign in to auto-save this confirmation as a <strong>Draft</strong> in your Client Database (helps if the tab closes mid-meeting).</p>
              )}
              {!demoMode && String(session?.user?.email || emailAuthUser?.email || "").trim() && draftAutosaveStatus !== "idle" && (
                <p className="text-xs text-slate-500" aria-live="polite">
                  {draftAutosaveStatus === "saving" && "Saving draft…"}
                  {draftAutosaveStatus === "saved" && "Draft saved."}
                  {draftAutosaveStatus === "error" && "Could not save draft — check your connection and try editing again."}
                </p>
              )}
              {!canRunDeepAnalysis && !demoMode && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  Clear every row that still needs review before running the deep analysis ({reviewCount} remaining). This keeps AI output aligned with what you&apos;ve verified in the room.
                </div>
              )}
              <div className="space-y-4">
                {holdings.map((h, index) => {
                  const opts = normalizeOptions(h);
                  return (
                    <div key={`${h.rawName}-${index}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
                        <div className="lg:col-span-3"><p className="text-xs text-slate-500">Statement name</p><p className="font-semibold">{h.rawName}</p><p className="text-sm text-slate-500">{currency(h.value)}</p></div>
                        <div className="lg:col-span-4"><p className="mb-1 text-xs text-slate-500">Matched holding / multiple choice</p><Select value={h.suggested} onValueChange={(value) => updateHolding(index, { suggested: value, status: value.includes("Manual") ? "review" : "confirmed", confidence: value.includes("Manual") ? Math.min(h.confidence, 74) : Math.max(h.confidence, 85) })}><SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger><SelectContent>{opts.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
                        <div className="lg:col-span-3"><p className="mb-1 text-xs text-slate-500">Asset class</p><Select value={ASSET_CLASSES.includes(h.assetClass) ? h.assetClass : "Unknown"} onValueChange={(value) => updateHolding(index, { assetClass: value })}><SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger><SelectContent>{ASSET_CLASSES.map((asset) => <SelectItem key={asset} value={asset}>{asset}</SelectItem>)}</SelectContent></Select></div>
                        <div className="lg:col-span-2"><p className="text-xs text-slate-500">Confidence</p><Progress value={h.confidence} className="my-2" /><div className="flex items-center gap-2">{h.confidence >= 75 ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}<span className="text-sm font-medium">{h.confidence}%</span></div></div>
                      </div>
                      {(h.suggested.includes("Manual") || h.status === "review") && <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2"><div><p className="mb-1 text-xs text-slate-500">Manual ticker / CUSIP / corrected name</p><Input className="rounded-2xl" placeholder="Example: PIMIX or 912828XXXXX" onBlur={(e) => { if (e.target.value.trim()) updateHolding(index, { suggested: e.target.value.trim(), status: "confirmed", confidence: 85 }); }} /></div><div><p className="mb-1 text-xs text-slate-500">Value override</p><Input className="rounded-2xl" type="number" placeholder={String(h.value || 0)} onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && e.target.value !== "") updateHolding(index, { value: v }); }} /></div></div>}
                    </div>
                  );
                })}
              </div>
              <div className="hidden items-center gap-3 border-t border-sky-100/60 pt-5 md:flex">
                <Button variant="outline" className="h-12 rounded-2xl px-5" onClick={() => setStep("upload")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  className="ml-auto h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-6"
                  onClick={runAIAnalysis}
                  disabled={isAnalyzing || !canRunDeepAnalysis}
                >
                  {isAnalyzing ? ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length] : "Run AdvisorPilot Analysis"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
              {isAnalyzing && (
                <p className="hidden text-sm text-slate-600 md:block" aria-live="polite">
                  {ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length]} Deep analysis often takes <strong>30–90 seconds</strong>.
                </p>
              )}
              <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-sky-200/50 bg-white/85 p-4 shadow-[0_-8px_32px_rgba(15,58,122,0.12)] backdrop-blur-xl md:hidden">
                <div className="mx-auto flex max-w-3xl flex-col gap-2">
                  {isAnalyzing && (
                    <p className="text-center text-xs text-slate-600" aria-live="polite">
                      {ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length]} Usually 30–90s.
                    </p>
                  )}
                  <div className="flex gap-3">
                    <Button variant="outline" className="h-14 flex-1 rounded-2xl touch-manipulation" onClick={() => setStep("upload")} disabled={isAnalyzing}>Back</Button>
                    <Button
                      className="h-14 flex-[2] rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 touch-manipulation"
                      onClick={runAIAnalysis}
                      disabled={isAnalyzing || !canRunDeepAnalysis}
                    >
                      {isAnalyzing ? ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length] : "Run analysis"}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "analysis" && (
          <div className="space-y-4 pb-24 md:space-y-5 md:pb-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3"><MetricCard icon={<TrendingUp className="h-5 w-5" />} label="Total value" value={currency(totalValue)} /><MetricCard icon={<User className="h-5 w-5" />} label="Client age" value={derivedAge ? String(derivedAge) : "Not set"} /><MetricCard icon={<ShieldCheck className="h-5 w-5" />} label="Risk profile" value={client.riskProfile.replace("-", " ")} /></div>
            <Card className="rounded-[2rem] ap-glass border-0"><CardContent className="space-y-6 p-6 pb-8 md:p-8"><div className="flex items-center gap-3"><div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl"><BarChart3 className="h-6 w-6" /></div><div><h2 className="font-serif text-3xl font-bold">Portfolio Review</h2><p className="text-sm text-slate-500">Advisor-facing analysis based on confirmed holdings and selected calibration.</p></div></div>{analysisError && <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{analysisError}</div>}<div className="ap-callout rounded-3xl p-5 md:flex md:items-center md:justify-between md:gap-4"><div><p className="ap-eyebrow">Next up</p><p className="mt-1 font-serif text-xl font-semibold text-blue-950">Sit with the client</p><p className="mt-1 text-sm text-slate-600">Meeting Guide is the default path from here. PDFs and email are easiest as a wrap-up after the conversation.</p></div><Button className="mt-4 h-12 w-full rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 md:mt-0 md:w-auto md:shrink-0 md:px-8" onClick={() => setStep("meeting")}><MessageSquareText className="mr-2 h-4 w-4" />Start Meeting Guide<ArrowRight className="ml-2 h-4 w-4" /></Button></div><div className="grid grid-cols-1 gap-5 md:grid-cols-2"><ProfessionalDonutChart title="Current allocation" subtitle="Based on confirmed holdings" data={currentPie} /><ProfessionalDonutChart title="Proposed Allocation" subtitle="Age and risk-profile calibration" data={targetPie} /></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Portfolio Scores</h3><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><ScoreCard label="Risk Alignment" value={scores.riskAlignment} helper="How closely risk matches the proposed allocation" /><ScoreCard label="Diversification" value={scores.diversification} helper="Balance across major asset groups" /><ScoreCard label="Income Readiness" value={scores.incomeReadiness} helper="Support for retirement income stability" /></div></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Current vs Proposed Allocation</h3><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-slate-500">Current Allocation</p><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span>Equity</span><strong>{currentAllocation.equity}%</strong></div><div className="flex justify-between"><span>Fixed Income</span><strong>{currentAllocation.fixedIncome}%</strong></div><div className="flex justify-between"><span>Cash</span><strong>{currentAllocation.cash}%</strong></div></div></div><div className="rounded-3xl border border-sky-200 bg-sky-50/60 p-5"><p className="text-sm font-semibold text-blue-700">Proposed Allocation</p><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span>Equity</span><strong>{target.equity}%</strong></div><div className="flex justify-between"><span>Fixed Income</span><strong>{target.fixedIncome}%</strong></div><div className="flex justify-between"><span>Cash</span><strong>{target.cash}%</strong></div></div></div></div><ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">{positioningImpact.map((item) => <li key={item} className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-700">{item}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Retirement Success Model</h3><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-slate-500">Current Allocation</p><p className="mt-2 text-4xl font-bold text-slate-950">{currentSuccessRate}<span className="text-lg text-slate-400">/100</span></p><p className="mt-1 text-sm text-slate-500">{successLabel(currentSuccessRate)} estimated success</p><Progress value={currentSuccessRate} className="mt-4" /></div><div className="rounded-3xl border border-sky-200 bg-sky-50/60 p-5"><p className="text-sm font-semibold text-blue-700">Proposed Allocation</p><p className="mt-2 text-4xl font-bold text-slate-950">{proposedSuccessRate}<span className="text-lg text-slate-400">/100</span></p><p className="mt-1 text-sm text-slate-500">{successLabel(proposedSuccessRate)} estimated success</p><Progress value={proposedSuccessRate} className="mt-4" /></div></div><ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">{retirementModelInsights.map((item) => <li key={item} className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm leading-6 text-slate-700">{item}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Synopsis</h3><div className="rounded-2xl border bg-white p-5 text-sm leading-7 text-slate-700">{displaySynopsis}</div></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Portfolio Highlights</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-3">{displayPortfolioHighlights.slice(0, 3).map((item) => <li key={item} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm leading-6 text-slate-700">{item}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold text-red-900">Advisor Red Flags</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayRedFlags.map((flag) => <li key={flag} className="rounded-2xl border border-red-200 bg-red-50/60 p-4 text-sm leading-6 text-slate-700">{flag}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold text-indigo-900">Overlap & Concentration Insights</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayOverlapInsights.map((insight) => <li key={insight} className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-sm leading-6 text-slate-700">{insight}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold text-emerald-900">What This Means for You</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayWhatThisMeans.map((item) => <li key={item} className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm leading-6 text-slate-700">{item}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Strategic Considerations</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayStrategies.map((idea) => <li key={idea} className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-700">{idea}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Advisor Example Recommendations</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayRecommendations.map((rec) => <li key={rec} className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-sm leading-6 text-slate-700">{rec}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Key findings</h3><ul className="space-y-2 text-sm">{findings.map((f) => <li key={f} className="rounded-2xl border bg-white p-4">{f}</li>)}</ul></div><div className="hidden border-t border-sky-100/60 pt-5 md:flex md:flex-wrap md:items-center md:gap-3"><Button variant="outline" className="h-12 rounded-2xl" onClick={() => setStep("confirm")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button><Button variant="outline" className="h-12 rounded-2xl" onClick={runAIAnalysis} disabled={isAnalyzing || !canRunDeepAnalysis}><BrainCircuit className="mr-2 h-4 w-4" />{isAnalyzing ? ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length] : "Regenerate analysis"}</Button><Button className="h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-5 md:ml-auto" onClick={() => setStep("meeting")}><MessageSquareText className="mr-2 h-4 w-4" />Meeting Guide<ArrowRight className="ml-2 h-4 w-4" /></Button></div>{isAnalyzing && <p className="hidden text-sm text-slate-600 md:block" aria-live="polite">{ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length]} Often 30–90 seconds.</p>}</CardContent></Card>
          <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-sky-200/50 bg-white/85 p-4 shadow-[0_-8px_32px_rgba(15,58,122,0.12)] backdrop-blur-xl md:hidden">
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              {isAnalyzing && <p className="text-center text-xs text-slate-600" aria-live="polite">{ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length]}</p>}
              <Button className="h-14 w-full rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 touch-manipulation" onClick={() => setStep("meeting")}><MessageSquareText className="mr-2 h-4 w-4" />Meeting Guide</Button>
              <div className="flex gap-2">
                <Button variant="outline" className="h-12 flex-1 rounded-2xl text-sm touch-manipulation" onClick={() => setStep("confirm")}>Back</Button>
                <Button variant="outline" className="h-12 flex-1 rounded-2xl text-sm touch-manipulation" onClick={runAIAnalysis} disabled={isAnalyzing || !canRunDeepAnalysis}>Regenerate</Button>
              </div>
            </div>
          </div>
          </div>
        )}


        {step === "meeting" && (
          <Card className="rounded-[2rem] ap-glass border-0">
            <CardContent className="space-y-6 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl"><MessageSquareText className="h-6 w-6" /></div>
                  <div>
                    <h2 className="font-serif text-3xl font-bold">Meeting Guide</h2>
                    <p className="text-sm text-slate-500">A live advisor guide for walking through the analysis with the client.</p>
                  </div>
                </div>
                <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-800">Advisor-facing guide</Badge>
              </div>

              <div className="rounded-3xl border border-sky-100 bg-sky-50/60 p-5 leading-7 text-slate-700">
                <h3 className="mb-2 font-serif text-2xl font-bold text-slate-950">Opening Script</h3>
                <p>{analysis?.advisorOpeningScript || `Thanks for taking the time today. What I want to do is walk through how the portfolio is currently positioned, what risks or opportunities are showing up, and whether the current allocation still fits the retirement timeline, income goals, and comfort with market volatility.`}</p>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">Meeting Walkthrough</h3>
                <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {meetingWalkthrough.map((item, index) => (
                    <li key={item} className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-700">
                      <span className="ap-icon-tile mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold">{index + 1}</span>
                      <p>{item}</p>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-red-900">Key Items to Explain</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {displayRedFlags.slice(0, 4).map((flag) => <div key={flag} className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-slate-700">{flag}</div>)}
                  {displayWhatThisMeans.slice(0, 2).map((item) => <div key={item} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-slate-700">{item}</div>)}
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">Ask These Questions</h3>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {meetingQuestions.map((question) => <li key={question} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">{question}</li>)}
                </ul>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">What to Listen For</h3>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {whatToListenFor.map((item) => <li key={item} className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-slate-700">{item}</li>)}
                </ul>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">Client Pushback Responses</h3>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {(analysis?.objectionHandling?.length ? analysis.objectionHandling : [
                    "If the client asks why reduce stocks now: The goal is not to abandon growth, but to reduce unnecessary concentration and make sure the risk still fits the retirement timeline.",
                    "If the client asks why add fixed income: Fixed income can help create more stability and may reduce the impact of market downturns as retirement approaches.",
                    "If the client wants to wait: Waiting is an option, but we should still stress-test whether the current portfolio could handle a meaningful downturn.",
                  ]).map((item) => <li key={item} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">{item}</li>)}
                </ul>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 leading-7 text-slate-700">
                <h3 className="mb-2 font-serif text-2xl font-bold text-slate-950">Closing Script</h3>
                <p>{closingScript}</p>
              </div>

              <div className="flex flex-col gap-3 border-t border-sky-100/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" className="h-12 rounded-2xl touch-manipulation" onClick={() => setStep("analysis")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to analysis
                </Button>
                <p className="hidden text-center text-xs text-slate-500 sm:block">After the conversation, open Wrap-up for the Client Snapshot PDF, Gmail send, and follow-up copy.</p>
                <Button
                  className="h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-5 touch-manipulation"
                  onClick={() => setStep("report")}
                >
                  Wrap-up: PDFs and email
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-slate-500 sm:hidden">After the conversation, open Wrap-up for the Client Snapshot PDF, Gmail send, and follow-up copy.</p>
            </CardContent>
          </Card>
        )}


        {step === "saved" && (
          <Card className="rounded-[2rem] ap-glass border-0">
            <CardContent className="space-y-6 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl">
                    <FolderOpen className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-serif text-3xl font-bold">Client Database</h2>
                    <p className="text-sm text-slate-500">Search and manage client profiles saved to your AdvisorPilot account.</p>
                  </div>
                </div>
                <Button variant="outline" className="h-11 rounded-2xl" onClick={loadSavedReviews}>
                  Refresh List
                </Button>
              </div>

              <div className="ap-callout rounded-3xl p-4">
                <label className="ap-eyebrow">Search</label>
                <Input
                  className="mt-2 h-12 rounded-2xl border-sky-200 bg-white/90"
                  placeholder="Search by client name or email"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
              </div>

              {savedReviews.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center">
                  <p className="font-semibold text-slate-800">No client database yet.</p>
                  <p className="mt-2 text-sm text-slate-500">Run an analysis, then click Save Client Profile from the Analysis or Report screen.</p>
                </div>
              ) : filteredSavedReviews.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8 text-center">
                  <p className="font-semibold text-slate-800">No matching clients found.</p>
                  <p className="mt-2 text-sm text-slate-500">Try searching by a different name or email.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {filteredSavedReviews.map((review: SavedReview) => {
                    const reviewTotal = review.holdings.reduce((sum: number, h: Holding) => sum + Number(h.value || 0), 0);
                    const reviewAge = review.client.age || (review.client.dob ? String(getAgeFromDob(review.client.dob) || "N/A") : "N/A");

                    return (
                      <div key={review.id} className="ap-glass rounded-3xl p-5 transition-shadow hover:shadow-[0_28px_60px_-22px_rgba(15,58,122,0.32),0_0_0_1px_rgba(125,184,245,0.45)]">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
                          <div className="min-w-0 space-y-1.5">
                            <h3 className="font-serif text-2xl font-bold text-slate-950">
                              {clientDisplayName(review.client) || "Unnamed Client"}
                              {normalizeIntakeClient(review.client).magicLinkUpload ? (
                                <Badge variant="outline" className="ml-2 align-middle border-sky-200 bg-sky-50 text-xs font-normal text-blue-700">
                                  Client link upload
                                </Badge>
                              ) : null}
                            </h3>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                              <span>Saved {formatSavedDate(review.savedAt)}</span>
                              <span aria-hidden>·</span>
                              <span>Age {reviewAge}</span>
                              <span aria-hidden>·</span>
                              <span className="capitalize">Risk: {(review.client.riskProfile || "N/A").replace("-", " ")}</span>
                            </div>
                            <p className="text-sm text-slate-500">
                              <span className="font-medium text-slate-600">Status:</span> {review.status || "Analyzed"}
                              <span className="mx-2 text-slate-300" aria-hidden>·</span>
                              <span className="font-medium text-slate-600">Last contacted:</span> {review.lastContactedAt ? formatSavedDate(review.lastContactedAt) : "Not contacted yet"}
                            </p>
                            <p className="text-sm text-slate-500">
                              <span className="font-medium text-slate-600">Holdings:</span> {review.holdings.length}
                              <span className="mx-2 text-slate-300" aria-hidden>·</span>
                              <span className="font-medium text-slate-600">Approx. value:</span> {currency(reviewTotal)}
                            </p>
                            {review.client.advisorEmail && (
                              <p className="truncate text-sm text-slate-500">
                                <span className="font-medium text-slate-600">Snapshot email:</span> {review.client.advisorEmail}
                              </p>
                            )}
                          </div>
                          <Button
                            className="h-11 shrink-0 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-5"
                            onClick={() => openSavedReview(review)}
                          >
                            Open Profile
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sky-100/60 pt-4">
                          <Button
                            variant="outline"
                            className="h-10 rounded-2xl bg-white/80"
                            disabled={followUpEmailSendingId === review.id}
                            onClick={() => void sendFollowUpFromDatabase(review)}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            {followUpEmailSendingId === review.id ? "Sending…" : "Send Follow-Up Email"}
                          </Button>
                          <Button variant="outline" className="h-10 rounded-2xl bg-white/80" onClick={() => updateAnalysisFromDatabase(review)}>
                            <Upload className="mr-2 h-4 w-4" />
                            Update Analysis
                          </Button>
                          <Button
                            variant="outline"
                            className="ml-auto h-10 rounded-2xl border-red-200 bg-white/80 text-red-700 hover:bg-red-50"
                            onClick={() => deleteSavedReview(review.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === "report" && (
          <Card className="print-card rounded-[2rem] ap-glass border-0">
            <CardContent className="space-y-6 p-6 md:p-8 print:p-0">
              <div className="no-print space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl">
                      <Download className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="font-serif text-3xl font-bold">Client Review Report</h2>
                      <p className="text-sm text-slate-500">Clean report preview for PDF, email, or print.</p>
                    </div>
                  </div>
                  <Button
                    className="h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-5 touch-manipulation"
                    onClick={() => setStep("meeting")}
                  >
                    <MessageSquareText className="mr-2 h-4 w-4" />
                    Back to Meeting Guide
                  </Button>
                </div>

                <div className="ap-callout rounded-3xl p-5">
                  <p className="ap-eyebrow">Wrap-up actions</p>
                  <p className="mt-1 text-xs text-slate-500">Download, copy, or save once the conversation is done.</p>
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Button variant="outline" className="h-12 justify-start rounded-2xl bg-white/85 touch-manipulation" onClick={() => downloadPDFReport("client")}>
                      <Download className="mr-2 h-4 w-4" />
                      Client Snapshot PDF
                    </Button>
                    <Button variant="outline" className="h-12 justify-start rounded-2xl bg-white/85 touch-manipulation" onClick={() => downloadPDFReport("advisor")}>
                      <Download className="mr-2 h-4 w-4" />
                      Advisor Deep Dive PDF
                    </Button>
                    <Button variant="outline" className="h-12 justify-start rounded-2xl bg-white/85 touch-manipulation" onClick={buildFollowUpEmail}>
                      <Mail className="mr-2 h-4 w-4" />
                      Follow-up email (copy)
                    </Button>
                    <Button variant="outline" className="h-12 justify-start rounded-2xl bg-white/85 touch-manipulation" onClick={saveCurrentReview}>
                      <Save className="mr-2 h-4 w-4" />
                      Save Client Profile
                    </Button>
                  </div>
                </div>

                <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-sm font-semibold text-slate-800">Send Client Snapshot (Gmail)</p>
                  <p className="mt-1 text-xs text-slate-600">The address below is the <strong>client&apos;s inbox</strong> (To:). You send from your connected Google account — not from this field.</p>
                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
                    <div className="w-full md:max-w-md">
                      <label className="text-xs font-medium text-slate-600">Client email — snapshot recipient</label>
                      <Input
                        placeholder="client@email.com"
                        className="mt-1 h-12 rounded-2xl bg-white"
                        type="email"
                        value={client.advisorEmail}
                        onChange={(e) => setClient({ ...client, advisorEmail: e.target.value })}
                      />
                    </div>

                    {session ? (
                      <Button
                        className="h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 touch-manipulation md:shrink-0"
                        onClick={sendClientSnapshotEmail}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Send via Gmail
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="h-12 rounded-2xl bg-white touch-manipulation md:shrink-0"
                        onClick={() => signIn("google", { callbackUrl: "/" })}
                      >
                        Connect Google to send
                      </Button>
                    )}
                  </div>

                  {!session && (
                    <p className="mt-2 text-sm text-blue-900">
                      On email/password login, download the PDF above and paste follow-up copy — same recipient field applies when you send from your own mail app.
                    </p>
                  )}
                </div>
              </div>
              {followUpEmail && (
                <div className="no-print rounded-3xl border border-blue-100 bg-blue-50 p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-2xl font-bold text-slate-950">Generated Follow-Up Email</h3>
                      <p className="text-sm text-slate-600">Copy this into Gmail, then manually attach the Client Snapshot PDF.</p>
                    </div>
                    <Button className="rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400" onClick={copyFollowUpEmail}>
                      <Mail className="mr-2 h-4 w-4" />
                      {emailCopied ? "Copied" : "Copy Email"}
                    </Button>
                  </div>
                  <Textarea
                    className="min-h-80 rounded-2xl bg-white font-mono text-sm leading-6"
                    value={followUpEmail}
                    onChange={(e) => {
                      setFollowUpEmail(e.target.value);
                      setEmailCopied(false);
                    }}
                  />
                </div>
              )}
              <div className="report-paper space-y-6 rounded-3xl border bg-white p-8 text-black shadow-sm print:rounded-none">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5"><div><h1 className="font-serif text-4xl font-bold text-slate-950">Portfolio Review Snapshot</h1><p className="mt-2 text-sm text-slate-600">Prepared for {clientDisplayName(client) || "Client"} | Age {derivedAge || "N/A"} | Risk Profile: {client.riskProfile.replace("-", " ")}</p></div><LogoBlock compact /></div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 print:grid-cols-2"><ProfessionalDonutChart title="Current allocation" subtitle="Current statement" data={currentPie} /><ProfessionalDonutChart title="Proposed Allocation" subtitle="Calibration mix for discussion" data={targetPie} /></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Portfolio Scores</h2><div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 print:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-xs text-slate-500">Risk Alignment</p><p className="mt-1 text-2xl font-bold text-slate-950">{scores.riskAlignment}/100</p><p className="mt-1 text-xs text-slate-500">Risk vs proposed allocation</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-xs text-slate-500">Diversification</p><p className="mt-1 text-2xl font-bold text-slate-950">{scores.diversification}/100</p><p className="mt-1 text-xs text-slate-500">Asset balance</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-xs text-slate-500">Income Readiness</p><p className="mt-1 text-2xl font-bold text-slate-950">{scores.incomeReadiness}/100</p><p className="mt-1 text-xs text-slate-500">Income stability</p></div></div></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Retirement Success Model</h2><div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 print:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-sm font-semibold text-slate-700">Current Allocation</p><p className="mt-1 text-3xl font-bold text-slate-950">{currentSuccessRate}/100</p><p className="mt-1 text-xs text-slate-500">{successLabel(currentSuccessRate)} estimated success</p></div><div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 print:bg-white"><p className="text-sm font-semibold text-blue-700">Proposed Allocation</p><p className="mt-1 text-3xl font-bold text-slate-950">{proposedSuccessRate}/100</p><p className="mt-1 text-xs text-slate-500">{successLabel(proposedSuccessRate)} estimated success</p></div></div><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{retirementModelInsights.map((item) => <li key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{item}</li>)}</ul></div><div><h2 className="font-serif text-2xl font-bold text-slate-950">Current vs Proposed Allocation</h2><p className="mt-1 text-sm text-slate-500">Allocation change only.</p><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3 print:grid-cols-3">{positioningImpact.map((item) => <li key={item} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{item}</li>)}</ul></div><div><h2 className="font-serif text-2xl font-bold text-slate-950">Synopsis</h2><p className="mt-2 text-sm leading-7 text-slate-700">{displaySynopsis}</p></div>
                <div><h2 className="font-serif text-2xl font-bold text-red-900">Advisor Red Flags</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayRedFlags.map((flag) => <li key={flag} className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{flag}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-indigo-900">Overlap & Concentration Insights</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayOverlapInsights.map((insight) => <li key={insight} className="rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{insight}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-emerald-900">What This Means for You</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayWhatThisMeans.map((item) => <li key={item} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{item}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Strategic Considerations</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayStrategies.map((idea) => <li key={idea} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{idea}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Advisor Example Recommendations</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayRecommendations.map((rec) => <li key={rec} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{rec}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Potential Next Steps</h2><ul className="mt-2 list-disc pl-5 text-sm leading-7 text-slate-700">{clientNextSteps.map((step) => <li key={step}>{step}</li>)}</ul></div>
                {meetingNotes && <div><h2 className="font-serif text-2xl font-bold text-slate-950">Meeting Notes</h2><p className="mt-2 text-sm leading-7 text-slate-700">{meetingNotes}</p></div>}
                <p className="border-t border-slate-200 pt-3 text-xs text-gray-600">For discussion purposes only. This report is not a trade instruction and must be reviewed by a licensed financial professional before implementation. Investment recommendations should consider the client’s full financial situation, risk tolerance, time horizon, tax status, and objectives.</p>
              </div>
              <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-sky-100/60 pt-5">
                <Button variant="outline" className="h-12 rounded-2xl touch-manipulation" onClick={() => setStep("meeting")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Meeting Guide
                </Button>
                <Button
                  className="h-12 rounded-2xl bg-gradient-to-br from-blue-900 via-blue-700 to-sky-500 hover:from-blue-950 hover:via-blue-800 hover:to-sky-400 px-5 touch-manipulation"
                  onClick={() => { setIntakeStep(0); setActiveReviewId(null); setStep("intake"); }}
                >
                  Start new review
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
