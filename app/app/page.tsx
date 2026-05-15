"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { Session } from "next-auth";
import { signIn, signOut } from "next-auth/react";
import { DropdownMenu } from "radix-ui";
import { LogoBlock } from "@/components/logo-block";
import { LlmSettingsButton } from "@/components/llm-settings-button";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  Camera,
  Calculator,
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
  BookmarkPlus,
  BrainCircuit,
  Link2,
  Copy,
  Check,
  ChevronDown,
  RefreshCw,
  X,
  Landmark,
} from "lucide-react";
import {
  computeRiskProfileFromQuiz,
  RISK_PROFILE_DESCRIPTORS,
  RISK_QUIZ_LENGTH,
  RISK_QUIZ_QUESTIONS,
} from "@/lib/risk-questionnaire";
import {
  INTAKE_STEPS,
  INTAKE_STEP_COUNT,
  type IntakeClient,
  normalizeIntakeClient,
  clientDisplayName,
  clientFirstNameSalutation,
  canAdvanceIntakeStep,
  FEDERAL_TAX_BRACKET_IDS,
  RISK_PROFILES,
} from "@/lib/intake-config";
import { advisorFetch, AP_SUPABASE_AT, AP_SUPABASE_RT } from "@/lib/advisor-fetch";
import { GOOGLE_GMAIL_REAUTHORIZE_PARAMS, googleGmailReconnectCallbackUrl } from "@/lib/google-gmail-signin";
import {
  normalizeAiAnalysis,
  normalizeHoldingsForUi,
  normalizeSavedReviewRow,
  type NormalizedAiAnalysis as AIAnalysis,
  type SavedReviewNormalized as SavedReview,
  type UiHolding as Holding,
} from "@/lib/saved-review-normalize";
import {
  emptyRothWorksheet,
  normalizeRothWorksheet,
  parseMoneyInput as parseRothMoneyInput,
  rothIllustrationQualifiedBalance,
  type RothWorksheet,
} from "@/lib/roth-worksheet";
import { buildRothConversionModelForAdvisorUi } from "@/lib/roth-conversion-ui-model";
import {
  emptyFiaWorksheet,
  fiaInputValue,
  normalizeFiaWorksheet,
  type FiaWorksheet,
} from "@/lib/fia-worksheet";
import {
  appendFiaProductTemplate,
  applyFiaProductTemplate,
  applyFiaProductTemplateCarrierProductOnly,
  extractFiaProductTemplate,
  formatFiaTemplateDisplayName,
  isFiaProductTemplateSpecComplete,
  loadFiaProductTemplates,
  replaceFiaProductTemplateById,
  type FiaProductTemplateSaved,
} from "@/lib/fia-product-template-storage";
import {
  appendRothFicProductTemplate,
  applyRothFicProductTemplate,
  applyRothFicProductTemplateCarrierProductOnly,
  extractRothFicProductTemplate,
  formatRothFicTemplateDisplayName,
  isRothFicProductTemplateSpecComplete,
  loadRothFicProductTemplates,
  replaceRothFicProductTemplateById,
  type RothFicProductTemplateSaved,
} from "@/lib/roth-fic-template-storage";
import { buildFiaScenarioSummaries, defaultPremiumForWorksheet } from "@/lib/fia-illustration";
import { formatMatchedHoldingOptionLabel } from "@/lib/holding-option-display";
import { flagLikelyDuplicateHoldings } from "@/lib/holding-merge";
import { validateHoldingLocally } from "@/lib/holding-validation";
import { holdingAdvisorReviewBlocking } from "@/lib/holding-advisor-review";
import { SYNTHETIC_CASH_TICKER } from "@/lib/cash-holding-constants";
import {
  accountGroupKey,
  buildRegistrationSummaryForAnalysis,
  normalizeRegistrationType,
  registrationLabel,
  REGISTRATION_BUCKET_VALUES,
  rollupAccounts,
  sumNonQualifiedValue,
  sumTraditionalQualifiedValue,
  type RegistrationBucket,
} from "@/lib/holding-registration";
import type { LiveIntakeHandoffAction } from "@/lib/live-intake-scripts";
import { LiveIntakeOverlay } from "@/components/live-intake-overlay";
import { FiaScenarioReturnChart } from "@/components/fia-scenario-return-chart";
import { ASSET_CLASSES, classifyAllocationBucket, isCanonicalAssetClass } from "@/lib/asset-classes";
import { bucketValuesToPercents, allocationForRiskModel } from "@/lib/allocation-math";
import {
  TEN_YEAR_SCENARIOS,
  BIGGEST_DRAWDOWN_SCENARIO_YEAR,
  formatTenYearScenarioPercent,
  scenarioHoldingsPortfolioReturnDecimal,
  scenarioHoldingsPortfolioSingleYearReturnDecimal,
  scenarioProposedPortfolioReturnDecimal,
  scenarioProposedPortfolioSingleYearReturnDecimal,
} from "@/lib/ten-year-scenario-models";
import { buildRetirementIncomeProjection } from "@/lib/retirement-income-projection";
import {
  illustrativeSpouseMonthlyMaxOwnOrSpousal,
  illustrativeSsaRetirementBenefitMonthly,
  illustrativeWorkerPiaMonthly,
  parseBirthYearFromIsoDob,
} from "@/lib/social-security-benefit-estimate";
import { newStatementUploadId, type StatementUploadQueueItem } from "@/lib/statement-upload-queue";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Native file control (avoid wrapper quirks); matches `components/ui/input` file styling. */
const ADVISOR_STATEMENT_FILE_INPUT_CLASS =
  "min-h-11 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:rounded-none file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

const FIA_TEMPLATE_PICKER_NONE = "__none__";
/** Distinct from FIA picker value so Roth/FIA selects never collide. */
const ROTH_FIC_TEMPLATE_PICKER_NONE = "__none_roth_fic__";

type Client = IntakeClient;

type EmailAuthUser = { email?: string | null };

/** Fresh intake defaults for a new review (blank slate). */
const INITIAL_CLIENT_STATE: Client = {
  firstName: "",
  lastName: "",
  dob: "",
  age: "",
  federalTaxBracket: "22",
  adjustedGrossIncomeAnnual: "",
  retirementAge: "67",
  retirementSpendableIncomeAnnual: "",
  socialSecurityMonthlyClient: "",
  socialSecurityMonthlySpouse: "",
  riskProfile: "moderate-conservative",
  riskIntakeKnown: "unset",
  riskIntakeScreen: "gate",
  riskQuizAnswers: {},
  riskQuizStepIndex: 0,
  riskProfileSuggested: "",
  calibration: "risk-profile",
  goal: "Prepare for retirement income while reducing unnecessary downside risk.",
  advisorEmail: "",
  married: false,
  spouseFirstName: "",
  spouseLastName: "",
  spouseDob: "",
  spouseAge: "",
  spouseRetirementAge: "",
  takingSocialSecurity: false,
};


const demoHoldings: Holding[] = [
  {
    rawName: "VANG 500 IDX ADM",
    suggested: "VFIAX - Vanguard 500 Index Fund Admiral Shares",
    confidence: 96,
    assetClass: "U.S. Large Cap Equity",
    value: 145000,
    status: "matched",
    registrationType: "qualified",
    options: ["VFIAX - Vanguard 500 Index Fund Admiral Shares", "VOO - Vanguard S&P 500 ETF", "VFINX - Vanguard 500 Index Investor", "Manual ticker / CUSIP entry"],
  },
  {
    rawName: "PIMCO INCOME FD",
    suggested: "Needs advisor confirmation",
    confidence: 62,
    assetClass: "Bond Fund",
    value: 82000,
    status: "review",
    registrationType: "qualified",
    options: ["PONAX - PIMCO Income Fund Class A", "PIMIX - PIMCO Income Fund Institutional", "PONCX - PIMCO Income Fund Class C", "Manual ticker / CUSIP entry"],
  },
  {
    rawName: "APPLE INC",
    suggested: "AAPL - Apple Inc.",
    confidence: 99,
    assetClass: "Individual Stock",
    value: 42000,
    status: "matched",
    registrationType: "qualified",
    options: ["AAPL - Apple Inc.", "Manual ticker / CUSIP entry"],
  },
  {
    rawName: "CASH / MONEY MARKET",
    suggested: "Cash Equivalent",
    confidence: 91,
    assetClass: "Cash / Money Market",
    value: 21000,
    status: "matched",
    registrationType: "qualified",
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

function allocationData(equity: number, fixedIncome: number, cash: number) {
  return [
    { label: "Equity", value: equity, color: "#0f766e" },
    { label: "Fixed", value: fixedIncome, color: "#1d4ed8" },
    { label: "Cash", value: cash, color: "#c99700" },
  ];
}

function allocationDataCurrent(percents: { equity: number; fixedIncome: number; cash: number; other: number }) {
  const items = [
    { label: "Equity", value: percents.equity, color: "#0f766e" },
    { label: "Fixed", value: percents.fixedIncome, color: "#1d4ed8" },
    { label: "Cash", value: percents.cash, color: "#c99700" },
  ];
  if (percents.other > 0) {
    items.push({ label: "Unclassified", value: percents.other, color: "#64748b" });
  }
  return items;
}

function confirmHoldingRegistrationSurfaceClasses(
  registration: RegistrationBucket | undefined,
  needsAdvisorReview?: boolean
): string {
  const r = normalizeRegistrationType(registration);
  const attentive = Boolean(needsAdvisorReview);
  const ring = attentive
    ? "ring-2 ring-red-500/80 ring-offset-2 ring-offset-white shadow-[0_0_0_1px_rgba(248,113,113,0.25)] "
    : "shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)] ";
  const shell =
    "relative overflow-hidden rounded-sm border bg-white transition-[box-shadow] duration-200 ";
  switch (r) {
    case "qualified":
      return `${shell}${ring}border-emerald-200/90 border-l-4 border-l-emerald-600 bg-gradient-to-br from-emerald-50/60 via-white to-white`;
    case "roth":
      return `${shell}${ring}border-purple-200/90 border-l-4 border-l-violet-600 bg-gradient-to-br from-violet-50/55 via-white to-white`;
    case "non_qualified":
      return `${shell}${ring}border-blue-200/90 border-l-4 border-l-blue-600 bg-gradient-to-br from-sky-50/50 via-white to-white`;
    default:
      return `${shell}${ring}border-slate-200/90 border-l-4 border-l-slate-500 bg-gradient-to-br from-slate-50/55 via-white to-white`;
  }
}

function confirmHoldingFooterStripClass(
  registration: RegistrationBucket | undefined,
  needsAdvisorReview?: boolean
): string {
  const r = normalizeRegistrationType(registration);
  if (needsAdvisorReview) return "border-t border-red-200/85 bg-red-50/[0.18]";
  switch (r) {
    case "qualified":
      return "border-t border-emerald-200/80 bg-emerald-50/25";
    case "roth":
      return "border-t border-purple-200/80 bg-violet-50/25";
    case "non_qualified":
      return "border-t border-blue-200/80 bg-sky-50/25";
    default:
      return "border-t border-slate-200/85 bg-slate-50/35";
  }
}

function confirmHoldingRegistrationBadgeClasses(registration: RegistrationBucket | undefined): string {
  const r = normalizeRegistrationType(registration);
  switch (r) {
    case "qualified":
      return "border-emerald-200/90 bg-emerald-100/80 text-emerald-950";
    case "roth":
      return "border-violet-200/90 bg-violet-100/80 text-violet-950";
    case "non_qualified":
      return "border-blue-200/90 bg-sky-100/80 text-blue-950";
    default:
      return "border-slate-200/90 bg-slate-100/90 text-slate-800";
  }
}

const HOLDING_FIELD_LABEL_CLASS =
  "text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500";
const HOLDING_SELECT_TRIGGER_CLASS =
  "h-10 w-full rounded-sm border-slate-300/90 bg-white text-sm shadow-sm hover:bg-slate-50/90";
const HOLDING_INPUT_CLASS = "h-10 rounded-sm border-slate-300/90 bg-white text-sm shadow-sm placeholder:text-slate-400";

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
    <Card className="rounded-none border-slate-200 bg-white/95 shadow-md shadow-blue-950/5">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-3xl font-semibold text-slate-950 tabular-nums">{value}<span className="text-base font-medium text-slate-400">/100</span></p>
            <p className="mt-1 text-xs text-slate-500">{helper}</p>
          </div>
          <div className={`ap-icon-tile ${toneClass} flex h-14 w-14 items-center justify-center rounded-none text-base font-bold tabular-nums`}>
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

function computePortfolioContextFromReview(
  client: Client,
  holdings: Holding[],
  demoMode: boolean,
  opts?: { duplicatesAcknowledged?: boolean }
) {
  const totalValue = holdings.reduce((sum, h) => sum + Number(h.value || 0), 0);
  const reviewCount = holdings.filter((h) => holdingAdvisorReviewBlocking(h)).length;
  const duplicateCount = holdings.filter((h) => h.duplicateOfIndex !== undefined).length;
  const duplicateOk = demoMode || duplicateCount === 0 || opts?.duplicatesAcknowledged === true;
  const canRunDeepAnalysis = duplicateOk && (demoMode || reviewCount === 0);
  const buckets = holdings.reduce(
    (acc, h) => {
      const bucket = classifyAllocationBucket(h.assetClass, h.suggested, h.rawName);
      acc[bucket] += Number(h.value || 0);
      return acc;
    },
    { equity: 0, fixedIncome: 0, cash: 0, other: 0 }
  );
  const currentAllocation = bucketValuesToPercents(buckets, totalValue);
  const currentAllocationForModel = allocationForRiskModel(currentAllocation);
  const derivedAge = client.age ? Number(client.age) : getAgeFromDob(client.dob);
  const target = targetAllocation(derivedAge || 62, client.riskProfile);
  const scores = portfolioScores(currentAllocationForModel, target);
  const currentSuccessRate = calculateRetirementSuccessModel({
    age: derivedAge,
    retirementAge: Number(client.retirementAge || 67),
    portfolioValue: totalValue,
    equity: currentAllocationForModel.equity,
    fixedIncome: currentAllocationForModel.fixedIncome,
    cash: currentAllocationForModel.cash,
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

function advisorNavInitials(signatureName: string, sessionName?: string | null, email?: string | null) {
  const n = signatureName.trim() || String(sessionName || "").trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  const local = String(email || "").split("@")[0].trim();
  if (local.length >= 2) return local.slice(0, 2).toUpperCase();
  if (local.length === 1) return (local + local).toUpperCase();
  return "AP";
}

function wizardRailLabel(item: string) {
  if (item === "saved") return "Client Database";
  if (item === "intake") return "Client Profile";
  if (item === "fia") return "FIA calculator";
  if (item === "retIncome") return "Ret. Inc Calculator";
  return item.charAt(0).toUpperCase() + item.slice(1);
}

function AppTopNav({
  step,
  intakeStep,
  demoMode,
  setDemoMode,
  session,
  emailAuthUser,
  signatureName,
  advisorDisplayName,
  onNewReview,
  setShowSignatureSetup,
  handleEmailPasswordLogout,
  analysisReady,
}: {
  step: string;
  intakeStep: number;
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  session: Session | null;
  emailAuthUser: EmailAuthUser | null;
  signatureName: string;
  advisorDisplayName: string;
  onNewReview: () => void | Promise<void>;
  setShowSignatureSetup: (v: boolean) => void;
  handleEmailPasswordLogout: () => void;
  analysisReady: boolean;
}) {
  const navNewReview =
    (step === "intake" && intakeStep > 0) ||
    ["upload", "confirm", "analysis", "meeting", "fia", "roth", "retIncome", "report"].includes(step);

  const initials = advisorNavInitials(
    signatureName,
    session?.user?.name,
    session?.user?.email ?? emailAuthUser?.email
  );
  const trimmedAdvisor = advisorDisplayName.trim();
  const profileLabel =
    trimmedAdvisor && trimmedAdvisor.toLowerCase() !== "your advisor" ? trimmedAdvisor : "Advisor";

  const accountEmail = session?.user?.email || emailAuthUser?.email;

  return (
    <header className="ap-top-nav print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 md:px-8 md:py-3.5">
        <div className="flex min-w-0 shrink-0 items-center">
          <LogoBlock variant="nav" />
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-y-2 pl-2 sm:gap-x-2 sm:pl-0 md:gap-x-3">
          <nav className="flex min-w-0 flex-wrap items-center justify-end gap-2 pb-1" aria-label="Primary">
            <button
              type="button"
              className={`ap-nav-link ${navNewReview ? "ap-nav-link-active" : ""}`}
              onClick={() => void onNewReview()}
            >
              New review
            </button>
            <LlmSettingsButton />
          </nav>
          {analysisReady ? (
            <span className="hidden rounded-none border border-white/20 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-300 lg:inline">
              Analysis ready
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setDemoMode(!demoMode)}
            className={`rounded-none border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition sm:px-3 ${
              demoMode
                ? "border-[var(--ap-royal)] bg-[var(--ap-royal)]/15 text-[#b8d9ff]"
                : "border-white/25 text-slate-400 hover:border-white/40 hover:text-white"
            }`}
          >
            Demo
          </button>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex max-w-[min(22rem,72vw)] items-center gap-2 rounded-none border border-white/15 bg-black/20 py-1 pr-2 pl-2 hover:bg-black/30 data-[state=open]:border-white/25 data-[state=open]:bg-black/35"
                aria-label={accountEmail ? `Account menu, ${profileLabel}, ${accountEmail}` : `Account menu, ${profileLabel}`}
                aria-haspopup="menu"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--ap-royal)] text-xs font-bold text-white">
                  {initials}
                </span>
                <span className="hidden min-w-0 truncate text-left text-sm font-medium text-white sm:block">{profileLabel}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                sideOffset={6}
                align="end"
                className="z-[300] min-w-[13rem] overflow-hidden rounded-none border border-[var(--ap-border-strong)] bg-white py-1 text-slate-900 shadow-lg shadow-slate-900/15"
              >
                <DropdownMenu.Item
                  className="cursor-pointer px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-[#f0f4fa] data-[highlighted]:text-[var(--ap-navy)]"
                  onSelect={() => setShowSignatureSetup(true)}
                >
                  Email signature
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-[var(--ap-border)]" />
                <DropdownMenu.Item
                  className="cursor-pointer px-3 py-2.5 text-sm text-slate-800 outline-none data-[highlighted]:bg-red-50 data-[highlighted]:text-red-900"
                  onSelect={() => (session ? void signOut({ callbackUrl: "/login" }) : handleEmailPasswordLogout())}
                >
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </header>
  );
}

function WizardStepRail({
  wizardSteps,
  step,
  setStep,
  loadSavedReviews,
}: {
  wizardSteps: readonly string[];
  step: string;
  setStep: (s: string) => void;
  loadSavedReviews: () => void | Promise<void>;
}) {
  return (
    <div className="ap-wizard-rail print:hidden">
      <div className="ap-wizard-rail-inner mx-auto max-w-7xl px-4 md:px-8">
        {wizardSteps.map((item, i) => {
          const label = wizardRailLabel(item);
          const active = step === item;
          return (
            <button
              key={item}
              type="button"
              className={`ap-wizard-segment ${active ? "ap-wizard-segment-active" : ""}`}
              aria-current={active ? "step" : undefined}
              onClick={() => {
                if (item === "saved") void loadSavedReviews();
                setStep(item);
              }}
            >
              <span className="ap-wizard-segment-index">{String(i + 1).padStart(2, "0")}</span>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProfessionalDonutChart({ data, title, subtitle }: { data: { label: string; value: number; color: string }[]; title: string; subtitle?: string }) {
  const radius = 72;
  const stroke = 22;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="rounded-none border border-slate-200 bg-white p-6 shadow-sm print:break-inside-avoid print:border-slate-300 print:shadow-none">
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
            <div key={item.label} className="flex items-center justify-between rounded-none border border-slate-100 bg-slate-50 px-4 py-3 print:bg-white">
              <div className="flex items-center gap-3">
                <span className="h-3.5 w-3.5 rounded-none" style={{ backgroundColor: item.color }} />
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

function MetricCard({ icon, label, value, helper }: { icon: React.ReactNode; label: string; value: string; helper?: string }) {
  return (
    <Card className="rounded-none border-slate-200 bg-white/95 shadow-md shadow-blue-950/5">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold capitalize text-slate-950">{value}</p>
            {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
          </div>
          <div className="flex ap-icon-tile h-11 w-11 items-center justify-center rounded-none">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function IntakeShell({
  progress,
  portfolioStepCurrent,
  portfolioStepTotal,
  eyebrow,
  title,
  helper,
  children,
  onBack,
  onNext,
  nextLabel = "Continue",
  backDisabled = false,
  nextDisabled = false,
  footerCenter,
}: {
  progress: number;
  portfolioStepCurrent?: number;
  portfolioStepTotal?: number;
  eyebrow: string;
  title: string;
  helper: string;
  children: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  backDisabled?: boolean;
  nextDisabled?: boolean;
  footerCenter?: React.ReactNode;
}) {
  const showPortfolioMeta =
    portfolioStepCurrent != null &&
    portfolioStepTotal != null &&
    portfolioStepCurrent > 0 &&
    portfolioStepTotal > 0;

  return (
    <Card className="ap-intake-shell-card ap-glass rounded-b-xl rounded-t-none border-0 bg-white py-0 ring-0">
      <CardContent className="p-0">
        <div className="ap-intake-shell-accent">
          <div className="p-6 md:p-10">
            <div className="mx-auto max-w-3xl space-y-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-10">
                <div className="min-w-0 flex-1 space-y-3 md:space-y-4">
                  {showPortfolioMeta ? (
                    <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-[var(--ap-navy-mid)] uppercase">
                      Portfolio review · Step {portfolioStepCurrent} of {portfolioStepTotal}
                    </p>
                  ) : null}
                  <p className="font-serif text-lg italic text-[var(--ap-royal)] md:text-xl">{eyebrow}</p>
                  <h2 className="font-serif text-3xl font-bold tracking-tight text-slate-950 md:text-[2.35rem] md:leading-[1.1]">{title}</h2>
                  {helper ? <p className="text-lg text-slate-600">{helper}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-start gap-1 lg:items-end lg:pt-0.5">
                  <p className="text-5xl font-semibold tabular-nums tracking-tight text-slate-950 md:text-6xl">{progress}%</p>
                  <p className="text-[0.65rem] font-semibold tracking-[0.28em] text-slate-400 uppercase">Complete</p>
                  <Progress
                    value={progress}
                    className="mt-2 h-2.5 w-full min-w-[12rem] max-w-[15rem] rounded-full bg-slate-200 [&_[data-slot=progress-indicator]]:rounded-none"
                  />
                </div>
              </div>
              <div className="ap-soft-panel rounded-lg p-5 md:p-7">{children}</div>
              {footerCenter ? (
                <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
                  <div className="flex justify-start">
                    <Button variant="outline" className="h-14 rounded-none px-5 md:h-12" onClick={onBack} disabled={backDisabled}>
                      <ArrowLeft className="mr-2 h-4 w-4" /> Back
                    </Button>
                  </div>
                  <div className="order-first flex justify-center px-1 sm:order-none">{footerCenter}</div>
                  <div className="flex justify-end">
                    <Button className="h-14 rounded-none ap-cta-solid px-6 md:h-12" onClick={onNext} disabled={nextDisabled}>
                      {nextLabel} <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <Button variant="outline" className="h-14 rounded-none px-5 md:h-12" onClick={onBack} disabled={backDisabled}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <Button className="h-14 rounded-none ap-cta-solid px-6 md:h-12" onClick={onNext} disabled={nextDisabled}>
                    {nextLabel} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdvisorPilotPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

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

  const [client, setClient] = useState<Client>(() => ({
    ...INITIAL_CLIENT_STATE,
    riskQuizAnswers: { ...INITIAL_CLIENT_STATE.riskQuizAnswers },
  }));
  const [statementUploadQueue, setStatementUploadQueue] = useState<StatementUploadQueueItem[]>([]);
  /** Bump to remount file inputs after **remove** so a new pick always fires `change`. */
  const [statementFileInputRevision, setStatementFileInputRevision] = useState(0);
  const appendStatementFiles = useCallback((list: FileList | null) => {
    // `FileList` is live; clearing the input in the same `change` handler empties it before React runs the queued updater.
    const picked = list && list.length > 0 ? Array.from(list) : [];
    if (picked.length === 0) return;
    setStatementUploadQueue((prev) => [
      ...prev,
      ...picked.map((file) => ({
        id: newStatementUploadId(),
        file,
        holdingsPages: "",
      })),
    ]);
  }, []);
  const removeStatementFile = useCallback((id: string) => {
    setStatementUploadQueue((prev) => prev.filter((x) => x.id !== id));
    setStatementFileInputRevision((n) => n + 1);
  }, []);
  const setStatementHoldingsPages = useCallback((id: string, holdingsPages: string) => {
    setStatementUploadQueue((prev) => prev.map((x) => (x.id === id ? { ...x, holdingsPages } : x)));
  }, []);
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
  const [showSignatureSetup, setShowSignatureSetup] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signatureTitle, setSignatureTitle] = useState("");
  const [signatureLicense, setSignatureLicense] = useState("");
  const [signatureCalendarLink, setSignatureCalendarLink] = useState("");
  const [signatureAddress, setSignatureAddress] = useState("");
  const [signatureOfficePhone, setSignatureOfficePhone] = useState("");
  const [signatureCellPhone, setSignatureCellPhone] = useState("");
  const [signatureWebsite, setSignatureWebsite] = useState("");
  const [signatureLogoUrl, setSignatureLogoUrl] = useState("");
  const [signatureDisclosuresText, setSignatureDisclosuresText] = useState("");
  const [signatureDisclosuresImageUrl, setSignatureDisclosuresImageUrl] = useState("");
  const [signatureAssetErr, setSignatureAssetErr] = useState("");
  const [logoUploadBusy, setLogoUploadBusy] = useState(false);
  const [disclosuresImageUploadBusy, setDisclosuresImageUploadBusy] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const disclosuresFileInputRef = useRef<HTMLInputElement>(null);
  const [emailAuthUser, setEmailAuthUser] = useState<EmailAuthUser | null>(null);
  const [draftAutosaveStatus, setDraftAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [extractProgressIndex, setExtractProgressIndex] = useState(0);
  const [analysisProgressIndex, setAnalysisProgressIndex] = useState(0);
  const [magicLinkUrl, setMagicLinkUrl] = useState("");
  const [magicLinkExpiresAt, setMagicLinkExpiresAt] = useState("");
  const [magicLinkBusy, setMagicLinkBusy] = useState(false);
  const [magicLinkErr, setMagicLinkErr] = useState("");
  const [magicLinkCopied, setMagicLinkCopied] = useState(false);
  const [followUpEmailSendingId, setFollowUpEmailSendingId] = useState<string | null>(null);
  /** Visible status on Client Database (replaces easy-to-miss `alert()` and explains blocks). */
  const [clientDbNotice, setClientDbNotice] = useState<{ variant: "error" | "success" | "neutral"; message: string } | null>(
    null
  );
  /** Shown after Gmail send fails (expired token / revoked access); offers reconnect steps on wrap-up. */
  const [gmailReconnectHint, setGmailReconnectHint] = useState<string | null>(null);
  const [rothWorksheet, setRothWorksheet] = useState<RothWorksheet>(() => emptyRothWorksheet());
  /** After tax pre-check + "Roth Analysis", show year-by-year illustration (updates live as inputs change). */
  const [rothLiveAnalysisOpen, setRothLiveAnalysisOpen] = useState(false);
  const [rothAnalysisPrecheckMessages, setRothAnalysisPrecheckMessages] = useState<string[]>([]);
  const [rothAnalysisBusy, setRothAnalysisBusy] = useState(false);
  const [fiaWorksheet, setFiaWorksheet] = useState<FiaWorksheet>(() => emptyFiaWorksheet());
  const [fiaTemplateSaveOpen, setFiaTemplateSaveOpen] = useState(false);
  const [fiaTemplateNotice, setFiaTemplateNotice] = useState<{ variant: "success" | "error"; message: string } | null>(
    null
  );
  const [fiaTemplateListGen, setFiaTemplateListGen] = useState(0);
  const [fiaTemplatePickerValue, setFiaTemplatePickerValue] = useState<string>(FIA_TEMPLATE_PICKER_NONE);
  const [fiaTemplateLoadSpecConfirmOpen, setFiaTemplateLoadSpecConfirmOpen] = useState(false);
  const [fiaPendingLoadTemplate, setFiaPendingLoadTemplate] = useState<FiaProductTemplateSaved | null>(null);
  const [fiaTemplateRemapTargetId, setFiaTemplateRemapTargetId] = useState<string | null>(null);
  const [rothFicTemplatePickerValue, setRothFicTemplatePickerValue] = useState<string>(ROTH_FIC_TEMPLATE_PICKER_NONE);
  const [rothFicTemplateSaveOpen, setRothFicTemplateSaveOpen] = useState(false);
  const [rothFicTemplateNotice, setRothFicTemplateNotice] = useState<{ variant: "success" | "error"; message: string } | null>(
    null
  );
  const [rothFicTemplateListGen, setRothFicTemplateListGen] = useState(0);
  const [rothFicTemplateLoadSpecConfirmOpen, setRothFicTemplateLoadSpecConfirmOpen] = useState(false);
  const [rothFicPendingLoadTemplate, setRothFicPendingLoadTemplate] = useState<RothFicProductTemplateSaved | null>(null);
  const [rothFicTemplateRemapTargetId, setRothFicTemplateRemapTargetId] = useState<string | null>(null);
  /** Optional appendices merged into Client Snapshot / Advisor Deep Dive PDFs. */
  const [snapshotIncludeFiaAppendix, setSnapshotIncludeFiaAppendix] = useState(false);
  const [snapshotIncludeRothAppendix, setSnapshotIncludeRothAppendix] = useState(false);
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  /** Retirement income calculator — advisor-only inputs (not persisted on client JSON). */
  const [retIncClientEarnedAnnual, setRetIncClientEarnedAnnual] = useState("");
  const [retIncSpouseEarnedAnnual, setRetIncSpouseEarnedAnnual] = useState("");
  const [retIncPensionAnnual, setRetIncPensionAnnual] = useState("");
  const [retIncPensionColaPct, setRetIncPensionColaPct] = useState("");
  const [retIncOtherAnnual, setRetIncOtherAnnual] = useState("");
  const [retIncOtherGrowthPct, setRetIncOtherGrowthPct] = useState("");
  const [retIncNeedInflationPct, setRetIncNeedInflationPct] = useState("3");
  const [retIncSsColaPct, setRetIncSsColaPct] = useState("2");
  /** Calculator-only SS monthly amounts; prefilled from client profile when those fields are set (see sync effect). */
  const [retIncSsMonthlyClient, setRetIncSsMonthlyClient] = useState("");
  const [retIncSsMonthlySpouse, setRetIncSsMonthlySpouse] = useState("");
  /** When profile says not yet receiving SS: advisor picks known amount vs illustrative estimate. */
  const [retIncSsKnowBenefit, setRetIncSsKnowBenefit] = useState<"unset" | "yes" | "no">("unset");
  const [retIncSsEstClientAnnual, setRetIncSsEstClientAnnual] = useState("");
  const [retIncSsEstClientYears, setRetIncSsEstClientYears] = useState("");
  const [retIncSsEstClientClaimAge, setRetIncSsEstClientClaimAge] = useState("");
  const [retIncSsEstSpouseAnnual, setRetIncSsEstSpouseAnnual] = useState("");
  const [retIncSsEstSpouseYears, setRetIncSsEstSpouseYears] = useState("");
  const [retIncSsEstSpouseClaimAge, setRetIncSsEstSpouseClaimAge] = useState("");
  /** When estimating SS: compare spouse own retirement to illustrative spousal (50% × worker PIA). */
  const [retIncSsUseSpousalModel, setRetIncSsUseSpousalModel] = useState(true);
  const [retIncSpendNetOfTax, setRetIncSpendNetOfTax] = useState(true);
  /** Flat illustrative rate on ordinary-style cash flows when spend target is after-tax (0–100). */
  const [retIncEffectiveTaxPct, setRetIncEffectiveTaxPct] = useState("20");
  /** Optional override for SS benefit start on the timeline; blank = use claim-age estimate or retirement age. */
  const [retIncSsStartAgeClient, setRetIncSsStartAgeClient] = useState("");
  const [retIncSsStartAgeSpouse, setRetIncSsStartAgeSpouse] = useState("");
  const [retIncReturnMode, setRetIncReturnMode] = useState<"snapshot" | "proposed" | "custom">("snapshot");
  const [retIncCustomReturnPct, setRetIncCustomReturnPct] = useState("");

  /** Supabase `client` JSON: intake + nested FIA worksheet + advisor UI to restore (FIA lives separately in React state). */
  const buildClientJsonForDatabase = useCallback((): Client => {
    return {
      ...client,
      fiaWorksheet,
      persistedAdvisorUi: {
        rothLiveAnalysisOpen,
        snapshotIncludeFiaAppendix,
        snapshotIncludeRothAppendix,
      },
    };
  }, [client, fiaWorksheet, rothLiveAnalysisOpen, snapshotIncludeFiaAppendix, snapshotIncludeRothAppendix]);

  const handleEmailSessionExpired = useCallback(() => {
    setEmailAuthUser(null);
    setSaveMessage("Session expired. Sign in again.");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(AP_SUPABASE_AT);
      sessionStorage.removeItem(AP_SUPABASE_RT);
    }
  }, []);

  /** Full-page Google OAuth with consent so Gmail send scopes and tokens refresh. */
  const triggerGoogleGmailReconnect = useCallback(() => {
    setGmailReconnectHint(null);
    void signIn("google", { callbackUrl: googleGmailReconnectCallbackUrl() }, GOOGLE_GMAIL_REAUTHORIZE_PARAMS);
  }, []);

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
  const intakeContinueDisabled = !canAdvanceIntakeStep(intakeStep, client);
  // Roth UI: always visible for testing. Restore age gate: derivedAge != null && Number.isFinite(derivedAge) && derivedAge >= 60
  const showRothOptionReport = true;

  const wizardSteps = useMemo(() => {
    const head = ["intake", "upload", "confirm", "analysis", "meeting", "fia"] as const;
    return showRothOptionReport
      ? ([...head, "roth", "retIncome", "report", "saved"] as const)
      : ([...head, "retIncome", "report", "saved"] as const);
  }, [showRothOptionReport]);

  /** True when starting a new review could discard advisor work (prompt before reset). */
  const reviewHasUnsavedWork = useMemo(() => {
    const hasIdentity =
      client.firstName.trim() ||
      client.lastName.trim() ||
      client.advisorEmail.trim() ||
      client.dob.trim();
    const progressedWorkflow = step !== "intake" || intakeStep > 0;
    const hasAnalysis = analysis != null;
    const hasNotes = meetingNotes.trim().length > 0;
    const hasUploads = statementUploadQueue.length > 0;
    const onlyDefaultDemoPlayground =
      demoMode &&
      step === "intake" &&
      intakeStep === 0 &&
      !hasIdentity &&
      !hasAnalysis &&
      !hasNotes &&
      !hasUploads;
    if (onlyDefaultDemoPlayground) return false;
    return (
      hasIdentity ||
      progressedWorkflow ||
      hasAnalysis ||
      hasNotes ||
      hasUploads ||
      holdings.length > 0
    );
  }, [
    client.firstName,
    client.lastName,
    client.advisorEmail,
    client.dob,
    step,
    intakeStep,
    analysis,
    meetingNotes,
    statementUploadQueue.length,
    demoMode,
    holdings.length,
  ]);

  const totalValue = useMemo(() => holdings.reduce((sum, h) => sum + Number(h.value || 0), 0), [holdings]);
  const traditionalQualifiedTotal = useMemo(() => sumTraditionalQualifiedValue(holdings), [holdings]);
  const nonQualifiedTotal = useMemo(() => sumNonQualifiedValue(holdings), [holdings]);
  const rothPdfQualifiedTotal = useMemo(
    () => rothIllustrationQualifiedBalance(rothWorksheet, totalValue || 0, traditionalQualifiedTotal),
    [rothWorksheet, totalValue, traditionalQualifiedTotal]
  );
  const rothLiveIllustration = useMemo(() => {
    if (!rothLiveAnalysisOpen) return null;
    return buildRothConversionModelForAdvisorUi(client, rothWorksheet, rothPdfQualifiedTotal);
  }, [rothLiveAnalysisOpen, client, rothWorksheet, rothPdfQualifiedTotal]);
  const registrationTotals = useMemo(() => buildRegistrationSummaryForAnalysis(holdings), [holdings]);
  const accountRollups = useMemo(() => rollupAccounts(holdings), [holdings]);

  const reviewCount = holdings.filter((h) => holdingAdvisorReviewBlocking(h)).length;
  const duplicateCount = holdings.filter((h) => h.duplicateOfIndex !== undefined).length;
  const duplicateOk = demoMode || duplicateCount === 0 || duplicatesAcknowledged;
  const canRunDeepAnalysis = duplicateOk && (demoMode || reviewCount === 0);

  const duplicateHoldingsAdvisorCheck =
    duplicateCount > 0 ? (
      <div className="rounded-none border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 space-y-2 md:px-4 md:py-3 md:text-sm">
        <p className="leading-snug">
          Advisor check: {duplicateCount} possible duplicate holding{duplicateCount === 1 ? "" : "s"} appeared across
          uploaded files/pages. Confirm whether these are repeated pages or separate accounts before relying on totals.
        </p>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={duplicatesAcknowledged}
            onChange={(e) => setDuplicatesAcknowledged(e.target.checked)}
            className="mt-0.5 shrink-0 md:mt-1"
          />
          <span>I have reviewed possible duplicates and understand totals may need adjustment.</span>
        </label>
      </div>
    ) : null;

  const currentAllocation = useMemo(() => {
    const buckets = holdings.reduce(
      (acc, h) => {
        const bucket = classifyAllocationBucket(h.assetClass, h.suggested, h.rawName);
        acc[bucket] += Number(h.value || 0);
        return acc;
      },
      { equity: 0, fixedIncome: 0, cash: 0, other: 0 }
    );
    return bucketValuesToPercents(buckets, totalValue);
  }, [holdings, totalValue]);

  const currentAllocationForModel = useMemo(
    () => allocationForRiskModel(currentAllocation),
    [currentAllocation]
  );

  const target = targetAllocation(derivedAge || 62, client.riskProfile);
  const currentPie = allocationDataCurrent(currentAllocation);
  const targetPie = allocationData(target.equity, target.fixedIncome, target.cash);
  const scores = portfolioScores(currentAllocationForModel, target);

  const currentSuccessRate = calculateRetirementSuccessModel({
    age: derivedAge,
    retirementAge: Number(client.retirementAge || 67),
    portfolioValue: totalValue,
    equity: currentAllocationForModel.equity,
    fixedIncome: currentAllocationForModel.fixedIncome,
    cash: currentAllocationForModel.cash,
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

  const retIncomeScenarioYears = TEN_YEAR_SCENARIOS[2]?.years ?? TEN_YEAR_SCENARIOS[0]!.years;
  const retIncomeSnapshotReturnDec = useMemo(() => {
    const d = scenarioHoldingsPortfolioReturnDecimal(retIncomeScenarioYears, holdings);
    return Number.isFinite(d) ? d : 0.05;
  }, [holdings, retIncomeScenarioYears]);
  const retIncomeProposedReturnDec = useMemo(() => {
    const proposedAlloc = {
      equity: target.equity,
      fixedIncome: target.fixedIncome,
      cash: target.cash,
    };
    const d = scenarioProposedPortfolioReturnDecimal(retIncomeScenarioYears, proposedAlloc);
    return Number.isFinite(d) ? d : 0.05;
  }, [retIncomeScenarioYears, target.equity, target.fixedIncome, target.cash]);

  const retIncomeClientAgeStart = useMemo(() => {
    if (derivedAge != null && Number.isFinite(derivedAge)) return Math.max(0, Math.floor(derivedAge));
    const n = Number(client.age);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [derivedAge, client.age]);

  const retIncomeSpouseAgeStart = useMemo(() => {
    if (!client.married) return null;
    const n = Number(client.spouseAge);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    const d = getAgeFromDob(client.spouseDob);
    if (d != null && Number.isFinite(d)) return Math.floor(d);
    if (retIncomeClientAgeStart > 0) return retIncomeClientAgeStart;
    return 62;
  }, [client.married, client.spouseAge, client.spouseDob, retIncomeClientAgeStart]);

  const retIncomeClientBirthYear = useMemo(() => {
    const y = parseBirthYearFromIsoDob(client.dob);
    if (y != null) return y;
    const cy = typeof window !== "undefined" ? new Date().getFullYear() : 2026;
    if (derivedAge != null && Number.isFinite(derivedAge)) return cy - Math.floor(derivedAge);
    return null;
  }, [client.dob, derivedAge]);

  const retIncomeSpouseBirthYear = useMemo(() => {
    if (!client.married) return null;
    const y = parseBirthYearFromIsoDob(client.spouseDob);
    if (y != null) return y;
    const cy = typeof window !== "undefined" ? new Date().getFullYear() : 2026;
    const sa = Number(client.spouseAge);
    if (Number.isFinite(sa) && sa > 0) return cy - Math.floor(sa);
    const d = getAgeFromDob(client.spouseDob);
    if (d != null && Number.isFinite(d)) return cy - Math.floor(d);
    if (derivedAge != null && Number.isFinite(derivedAge)) return cy - Math.floor(derivedAge);
    return null;
  }, [client.married, client.spouseDob, client.spouseAge, derivedAge]);

  const retIncomeSsEstimatorClientMonthly = useMemo(() => {
    if (client.takingSocialSecurity || retIncSsKnowBenefit !== "no") return null;
    if (retIncomeClientBirthYear == null) return null;
    const annual = Number(String(retIncSsEstClientAnnual).replace(/[$,]/g, "")) || 0;
    const yearsIn = Number(String(retIncSsEstClientYears).replace(/[^0-9.]/g, "")) || 0;
    const ageNow = retIncomeClientAgeStart > 0 ? retIncomeClientAgeStart : null;
    const years =
      yearsIn > 0
        ? Math.min(35, Math.max(1, Math.floor(yearsIn)))
        : ageNow != null
          ? Math.min(35, Math.max(1, ageNow - 22))
          : 35;
    const claimDefault = Math.min(70, Math.max(62, Math.floor(Number(client.retirementAge) || 67)));
    const claim = Number(String(retIncSsEstClientClaimAge).replace(/[^0-9.]/g, ""));
    const claimAge = Number.isFinite(claim) && claim >= 62 && claim <= 70 ? Math.floor(claim) : claimDefault;
    return illustrativeSsaRetirementBenefitMonthly({
      birthYear: retIncomeClientBirthYear,
      annualCoveredEarnings: annual,
      yearsWorkedCapped35: years,
      benefitStartAge: claimAge,
    });
  }, [
    client.takingSocialSecurity,
    retIncSsKnowBenefit,
    retIncomeClientBirthYear,
    retIncSsEstClientAnnual,
    retIncSsEstClientYears,
    retIncSsEstClientClaimAge,
    client.retirementAge,
    retIncomeClientAgeStart,
  ]);

  const retIncomeSsWorkerPiaMonthly = useMemo(() => {
    if (client.takingSocialSecurity || retIncSsKnowBenefit !== "no") return null;
    if (retIncomeClientBirthYear == null) return null;
    const annual = Number(String(retIncSsEstClientAnnual).replace(/[$,]/g, "")) || 0;
    const yearsIn = Number(String(retIncSsEstClientYears).replace(/[^0-9.]/g, "")) || 0;
    const ageNow = retIncomeClientAgeStart > 0 ? retIncomeClientAgeStart : null;
    const years =
      yearsIn > 0
        ? Math.min(35, Math.max(1, Math.floor(yearsIn)))
        : ageNow != null
          ? Math.min(35, Math.max(1, ageNow - 22))
          : 35;
    return illustrativeWorkerPiaMonthly({
      birthYear: retIncomeClientBirthYear,
      annualCoveredEarnings: annual,
      yearsWorkedCapped35: years,
    });
  }, [
    client.takingSocialSecurity,
    retIncSsKnowBenefit,
    retIncomeClientBirthYear,
    retIncSsEstClientAnnual,
    retIncSsEstClientYears,
    retIncomeClientAgeStart,
  ]);

  const retIncomeSsEstimatorSpouseMonthly = useMemo(() => {
    if (!client.married) return null;
    if (client.takingSocialSecurity || retIncSsKnowBenefit !== "no") return null;
    if (retIncomeSpouseBirthYear == null) return null;
    const annual = Number(String(retIncSsEstSpouseAnnual).replace(/[$,]/g, "")) || 0;
    const yearsIn = Number(String(retIncSsEstSpouseYears).replace(/[^0-9.]/g, "")) || 0;
    const ageS = retIncomeSpouseAgeStart;
    const years =
      yearsIn > 0
        ? Math.min(35, Math.max(1, Math.floor(yearsIn)))
        : ageS != null
          ? Math.min(35, Math.max(1, ageS - 22))
          : 35;
    const claimDefault = Math.min(70, Math.max(62, Math.floor(Number(client.spouseRetirementAge) || 67)));
    const claim = Number(String(retIncSsEstSpouseClaimAge).replace(/[^0-9.]/g, ""));
    const claimAge = Number.isFinite(claim) && claim >= 62 && claim <= 70 ? Math.floor(claim) : claimDefault;
    return illustrativeSpouseMonthlyMaxOwnOrSpousal({
      workerPiaMonthly: retIncomeSsWorkerPiaMonthly,
      spouseInput: {
        birthYear: retIncomeSpouseBirthYear,
        annualCoveredEarnings: annual,
        yearsWorkedCapped35: years,
        benefitStartAge: claimAge,
      },
      useSpousalLayer: retIncSsUseSpousalModel,
    });
  }, [
    client.married,
    client.takingSocialSecurity,
    retIncSsKnowBenefit,
    retIncomeSpouseBirthYear,
    retIncSsEstSpouseAnnual,
    retIncSsEstSpouseYears,
    retIncSsEstSpouseClaimAge,
    client.spouseRetirementAge,
    retIncomeSpouseAgeStart,
    retIncomeSsWorkerPiaMonthly,
    retIncSsUseSpousalModel,
  ]);

  const retIncomeCalcSsAnnual = useMemo(() => {
    if (client.takingSocialSecurity || retIncSsKnowBenefit === "yes") {
      const c = Number(String(retIncSsMonthlyClient).replace(/[$,]/g, "")) || 0;
      const s = Number(String(retIncSsMonthlySpouse).replace(/[$,]/g, "")) || 0;
      return Math.max(0, (c + s) * 12);
    }
    if (retIncSsKnowBenefit === "no") {
      const cm = retIncomeSsEstimatorClientMonthly ?? 0;
      const sm = retIncomeSsEstimatorSpouseMonthly ?? 0;
      return Math.max(0, (cm + sm) * 12);
    }
    return 0;
  }, [
    client.takingSocialSecurity,
    retIncSsKnowBenefit,
    retIncSsMonthlyClient,
    retIncSsMonthlySpouse,
    retIncomeSsEstimatorClientMonthly,
    retIncomeSsEstimatorSpouseMonthly,
  ]);

  const retIncomeSsClientAnnualPart = useMemo(() => {
    if (client.takingSocialSecurity || retIncSsKnowBenefit === "yes") {
      return Math.max(0, (Number(String(retIncSsMonthlyClient).replace(/[$,]/g, "")) || 0) * 12);
    }
    if (retIncSsKnowBenefit === "no") {
      return Math.max(0, (retIncomeSsEstimatorClientMonthly ?? 0) * 12);
    }
    return 0;
  }, [client.takingSocialSecurity, retIncSsKnowBenefit, retIncSsMonthlyClient, retIncomeSsEstimatorClientMonthly]);

  const retIncomeSsSpouseAnnualPart = useMemo(() => {
    if (!client.married) return 0;
    if (client.takingSocialSecurity || retIncSsKnowBenefit === "yes") {
      return Math.max(0, (Number(String(retIncSsMonthlySpouse).replace(/[$,]/g, "")) || 0) * 12);
    }
    if (retIncSsKnowBenefit === "no") {
      return Math.max(0, (retIncomeSsEstimatorSpouseMonthly ?? 0) * 12);
    }
    return 0;
  }, [client.married, client.takingSocialSecurity, retIncSsKnowBenefit, retIncSsMonthlySpouse, retIncomeSsEstimatorSpouseMonthly]);

  const retIncomeResolvedSsStartClient = useMemo(() => {
    const fallbackRet = Math.min(70, Math.max(50, Math.floor(Number(client.retirementAge) || 67)));
    if (retIncSsKnowBenefit === "yes") {
      const raw = retIncSsStartAgeClient.trim();
      if (raw) {
        const n = Math.floor(Number(raw.replace(/[^0-9.]/g, "")));
        if (Number.isFinite(n) && n >= 50 && n <= 80) return n;
      }
    }
    const claim = Number(String(retIncSsEstClientClaimAge).replace(/[^0-9.]/g, ""));
    if (retIncSsKnowBenefit === "no" && Number.isFinite(claim) && claim >= 62 && claim <= 70) return Math.floor(claim);
    return fallbackRet;
  }, [retIncSsStartAgeClient, retIncSsEstClientClaimAge, retIncSsKnowBenefit, client.retirementAge]);

  const retIncomeResolvedSsStartSpouse = useMemo(() => {
    const fallbackRet = Math.min(70, Math.max(50, Math.floor(Number(client.spouseRetirementAge) || 67)));
    if (!client.married) return fallbackRet;
    if (retIncSsKnowBenefit === "yes") {
      const raw = retIncSsStartAgeSpouse.trim();
      if (raw) {
        const n = Math.floor(Number(raw.replace(/[^0-9.]/g, "")));
        if (Number.isFinite(n) && n >= 50 && n <= 80) return n;
      }
    }
    const claim = Number(String(retIncSsEstSpouseClaimAge).replace(/[^0-9.]/g, ""));
    if (retIncSsKnowBenefit === "no" && Number.isFinite(claim) && claim >= 62 && claim <= 70) return Math.floor(claim);
    return fallbackRet;
  }, [client.married, retIncSsStartAgeSpouse, retIncSsEstSpouseClaimAge, retIncSsKnowBenefit, client.spouseRetirementAge]);

  const retIncomeEffectiveTaxDec = useMemo(() => {
    if (!retIncSpendNetOfTax) return 0;
    const n = (Number(String(retIncEffectiveTaxPct).replace(/%/g, "")) || 0) / 100;
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(0.95, n);
  }, [retIncSpendNetOfTax, retIncEffectiveTaxPct]);

  /** When receiving benefits on profile, copy saved monthly amounts into this screen when non-blank. */
  useEffect(() => {
    if (step !== "retIncome") return;
    if (!client.takingSocialSecurity) return;
    const pc = String(client.socialSecurityMonthlyClient ?? "").trim();
    const ps = String(client.socialSecurityMonthlySpouse ?? "").trim();
    if (pc) setRetIncSsMonthlyClient(client.socialSecurityMonthlyClient);
    if (client.married) {
      if (ps) setRetIncSsMonthlySpouse(client.socialSecurityMonthlySpouse);
    } else {
      setRetIncSsMonthlySpouse("");
    }
  }, [step, client.takingSocialSecurity, client.socialSecurityMonthlyClient, client.socialSecurityMonthlySpouse, client.married]);

  const retIncomeBaseNeedAnnual = useMemo(() => {
    const raw = Number(String(client.retirementSpendableIncomeAnnual).replace(/[$,]/g, ""));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }, [client.retirementSpendableIncomeAnnual]);

  const retIncomePortfolioReturnDec = useMemo(() => {
    if (retIncReturnMode === "proposed") return retIncomeProposedReturnDec;
    if (retIncReturnMode === "custom") {
      const n = Number(String(retIncCustomReturnPct).replace(/%/g, "").trim());
      if (Number.isFinite(n) && n > -50 && n < 80) return n / 100;
    }
    return retIncomeSnapshotReturnDec;
  }, [retIncReturnMode, retIncCustomReturnPct, retIncomeProposedReturnDec, retIncomeSnapshotReturnDec]);

  /** Rows through client age 95 (inclusive). */
  const retIncomeHorizonYearsThroughAge95 = useMemo(() => {
    if (retIncomeClientAgeStart <= 0) return 1;
    return Math.max(1, 95 - retIncomeClientAgeStart + 1);
  }, [retIncomeClientAgeStart]);

  const retIncomeProjectionRows = useMemo(() => {
    const needInfl = (Number(String(retIncNeedInflationPct).replace(/%/g, "")) || 0) / 100;
    const ssCola = (Number(String(retIncSsColaPct).replace(/%/g, "")) || 0) / 100;
    const penCola = (Number(String(retIncPensionColaPct).replace(/%/g, "")) || 0) / 100;
    const othGr = (Number(String(retIncOtherGrowthPct).replace(/%/g, "")) || 0) / 100;
    const pension = Number(String(retIncPensionAnnual).replace(/[$,]/g, "")) || 0;
    const other = Number(String(retIncOtherAnnual).replace(/[$,]/g, "")) || 0;
    const earnedC = Number(String(retIncClientEarnedAnnual).replace(/[$,]/g, "")) || 0;
    const earnedS = Number(String(retIncSpouseEarnedAnnual).replace(/[$,]/g, "")) || 0;
    const cy = typeof window !== "undefined" ? new Date().getFullYear() : 2026;
    if (retIncomeClientAgeStart <= 0) return [];
    return buildRetirementIncomeProjection({
      clientAgeStart: retIncomeClientAgeStart,
      spouseAgeStart: retIncomeSpouseAgeStart,
      married: client.married,
      clientRetirementAge: Math.max(50, Math.floor(Number(client.retirementAge) || 67)),
      spouseRetirementAge: Math.max(50, Math.floor(Number(client.spouseRetirementAge) || 67)),
      earnedClientAnnual: earnedC,
      earnedSpouseAnnual: earnedS,
      baseRetirementNeedAnnual: retIncomeBaseNeedAnnual,
      needInflationAnnual: needInfl,
      baseSocialSecurityClientAnnual: retIncomeSsClientAnnualPart,
      baseSocialSecuritySpouseAnnual: retIncomeSsSpouseAnnualPart,
      clientSocialSecurityStartAge: retIncomeResolvedSsStartClient,
      spouseSocialSecurityStartAge: retIncomeResolvedSsStartSpouse,
      socialSecurityColaAnnual: ssCola,
      basePensionAnnual: pension,
      pensionColaAnnual: penCola,
      baseOtherIncomeAnnual: other,
      otherIncomeGrowthAnnual: othGr,
      initialTotalPortfolio: Math.max(0, totalValue),
      initialQualifiedPortfolio: Math.max(0, traditionalQualifiedTotal),
      portfolioReturnAnnual: retIncomePortfolioReturnDec,
      horizonYears: retIncomeHorizonYearsThroughAge95,
      startCalendarYear: cy,
      spendTargetNetOfTax: retIncSpendNetOfTax,
      effectiveTaxRateAnnual: retIncomeEffectiveTaxDec,
    });
  }, [
    retIncomeClientAgeStart,
    retIncomeSpouseAgeStart,
    client.married,
    client.retirementAge,
    client.spouseRetirementAge,
    retIncClientEarnedAnnual,
    retIncSpouseEarnedAnnual,
    retIncomeBaseNeedAnnual,
    retIncNeedInflationPct,
    retIncSsColaPct,
    retIncPensionAnnual,
    retIncPensionColaPct,
    retIncOtherAnnual,
    retIncOtherGrowthPct,
    retIncomeSsClientAnnualPart,
    retIncomeSsSpouseAnnualPart,
    retIncomeResolvedSsStartClient,
    retIncomeResolvedSsStartSpouse,
    retIncSpendNetOfTax,
    retIncomeEffectiveTaxDec,
    totalValue,
    traditionalQualifiedTotal,
    retIncomePortfolioReturnDec,
    retIncomeHorizonYearsThroughAge95,
  ]);

  const retirementModelInsights = [
    `Current allocation estimate: ${currentSuccessRate}/100 (${successLabel(currentSuccessRate)}).`,
    `Proposed allocation estimate: ${proposedSuccessRate}/100 (${successLabel(proposedSuccessRate)}).`,
    successImprovement >= 0
      ? `Illustrative improvement: +${successImprovement} points.`
      : `Illustrative change: ${successImprovement} points.`,
    "Model considers allocation mix, volatility, sequence risk, income support, liquidity, and retirement horizon.",
  ];

  const portfolioStressScenarioRows = useMemo(() => {
    const proposedAlloc = {
      equity: target.equity,
      fixedIncome: target.fixedIncome,
      cash: target.cash,
    };
    const decades = TEN_YEAR_SCENARIOS.map((scenario) => ({
      rowKey: scenario.id,
      title: scenario.label,
      subtitle: `${scenario.years[0]}–${scenario.years[9]} · CAGR`,
      currentLabel: formatTenYearScenarioPercent(
        scenarioHoldingsPortfolioReturnDecimal(scenario.years, holdings),
      ),
      proposedLabel: formatTenYearScenarioPercent(
        scenarioProposedPortfolioReturnDecimal(scenario.years, proposedAlloc),
      ),
    }));

    const drawdownCur = scenarioHoldingsPortfolioSingleYearReturnDecimal(
      BIGGEST_DRAWDOWN_SCENARIO_YEAR,
      holdings,
    );
    const drawdownProp = scenarioProposedPortfolioSingleYearReturnDecimal(BIGGEST_DRAWDOWN_SCENARIO_YEAR, proposedAlloc);

    return [
      ...decades,
      {
        rowKey: "biggest_drawdown_2008",
        title: "Biggest drawdown",
        subtitle: `${BIGGEST_DRAWDOWN_SCENARIO_YEAR} · calendar-year blend (firm S&P −36.55% in equities)`,
        currentLabel: formatTenYearScenarioPercent(drawdownCur),
        proposedLabel: formatTenYearScenarioPercent(drawdownProp),
      },
    ];
  }, [holdings, target.equity, target.fixedIncome, target.cash]);

  const fiaPremiumDefault = useMemo(
    () => defaultPremiumForWorksheet(fiaWorksheet, traditionalQualifiedTotal, nonQualifiedTotal),
    [fiaWorksheet, traditionalQualifiedTotal, nonQualifiedTotal]
  );

  const fiaClientAgeForIllustration =
    derivedAge != null && Number.isFinite(derivedAge) ? derivedAge : null;

  const fiaScenarioSummaries = useMemo(
    () => buildFiaScenarioSummaries(fiaWorksheet, fiaPremiumDefault, fiaClientAgeForIllustration),
    [fiaWorksheet, fiaPremiumDefault, fiaClientAgeForIllustration]
  );

  /** Uniform Lifetime RMD from age 73 on qualified premium only; column hidden if no RMD in any scenario window. */
  const fiaShowRmdColumns = useMemo(
    () => fiaScenarioSummaries.some((s) => s.totalRmdDuringWindow > 0.5),
    [fiaScenarioSummaries]
  );

  /** Summary + year-by-year tables only show rider columns when advisor selected Yes for income rider. */
  const fiaShowRiderInTables = fiaWorksheet.hasIncomeRider === true;

  const savedFiaTemplates = useMemo(() => {
    if (step !== "fia") return [];
    return loadFiaProductTemplates();
  }, [step, fiaTemplateListGen]);

  const savedRothFicTemplates = useMemo(() => {
    if (step !== "roth") return [];
    return loadRothFicProductTemplates();
  }, [step, rothFicTemplateListGen]);

  const progress = Math.round(((intakeStep + 1) / INTAKE_STEP_COUNT) * 100);

  useEffect(() => {
    if (step !== "fia") {
      setFiaTemplatePickerValue(FIA_TEMPLATE_PICKER_NONE);
      setFiaTemplateLoadSpecConfirmOpen(false);
      setFiaPendingLoadTemplate(null);
      setFiaTemplateRemapTargetId(null);
    }
  }, [step]);

  useEffect(() => {
    if (step !== "roth") {
      setRothFicTemplatePickerValue(ROTH_FIC_TEMPLATE_PICKER_NONE);
      setRothFicTemplateLoadSpecConfirmOpen(false);
      setRothFicPendingLoadTemplate(null);
      setRothFicTemplateRemapTargetId(null);
    }
  }, [step]);

  useEffect(() => {
    if (rothWorksheet.useFixedIndexContract !== true) {
      setRothFicTemplateRemapTargetId(null);
      setRothFicTemplateLoadSpecConfirmOpen(false);
      setRothFicPendingLoadTemplate(null);
    }
  }, [rothWorksheet.useFixedIndexContract]);

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
        const res = await advisorFetch("/api/client-database", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: activeReviewId,
            ownerEmail,
            client: buildClientJsonForDatabase(),
            holdings,
            meetingNotes,
            demoMode: false,
            analysis: null,
            totalValue,
            status: "Draft",
            rothWorksheet,
          }),
          onEmailSessionExpired: handleEmailSessionExpired,
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
  }, [
    step,
    demoMode,
    holdings,
    client,
    meetingNotes,
    activeReviewId,
    totalValue,
    session,
    emailAuthUser,
    handleEmailSessionExpired,
    rothWorksheet,
    fiaWorksheet,
    buildClientJsonForDatabase,
    rothLiveAnalysisOpen,
  ]);

  useEffect(() => {
    if (!showRothOptionReport && step === "roth") {
      const t = window.setTimeout(() => setStep("report"), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [showRothOptionReport, step]);

  const fallbackSynopsis = useMemo(() => {
    const analysisDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const first = String(client.firstName || "").trim();
    const opener = first
      ? `As of ${analysisDate}, based on ${first}'s confirmed holdings`
      : `As of ${analysisDate}, based on confirmed holdings`;

    const sorted = [...holdings].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    const top = sorted.slice(0, 4).filter((h) => Number(h.value || 0) > 0);
    const shortName = (raw: string) => {
      const n = String(raw || "")
        .trim()
        .split(/[;\n]/)[0]
        ?.trim();
      if (!n) return "Unnamed holding";
      return n.length > 52 ? `${n.slice(0, 49)}…` : n;
    };

    let holdingsSentence = "";
    if (top.length >= 2 && totalValue > 0) {
      const parts = top.map((h) => {
        const pct = Math.round((Number(h.value || 0) / totalValue) * 100);
        return `${shortName(h.rawName || h.suggested || "")} (about ${pct}% of statement value)`;
      });
      holdingsSentence = ` Notable line items include ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
    } else if (top.length === 1 && totalValue > 0) {
      const h = top[0]!;
      const pct = Math.round((Number(h.value || 0) / totalValue) * 100);
      holdingsSentence = ` The largest position is ${shortName(h.rawName || h.suggested || "")} (about ${pct}% of the statement).`;
    }

    const riskLabel = String(client.riskProfile || "moderate").replace(/-/g, " ");
    const retAge = Number(client.retirementAge || 67) || 67;
    const ageN = derivedAge != null && Number.isFinite(Number(derivedAge)) ? Number(derivedAge) : null;
    const timeline =
      ageN != null ? `age ${ageN}, with retirement around ${retAge}` : `retirement around ${retAge}`;
    const eqGap = target.equity - currentAllocation.equity;
    const fixGap = target.fixedIncome - currentAllocation.fixedIncome;
    const cashGap = target.cash - currentAllocation.cash;

    let rationale = "";
    if (Math.abs(eqGap) < 4 && Math.abs(fixGap) < 4 && Math.abs(cashGap) < 3) {
      rationale = ` The proposed mix stays close to the statement weights but follows the ${riskLabel} model so each sleeve has a clearer job for someone ${timeline}.`;
    } else if (fixGap >= 4 && eqGap <= -4) {
      rationale = ` Relative to the statement, the proposed tilt raises fixed and trims equity to better match a ${riskLabel} sleeve and to add drawdown ballast as the timeline moves toward retirement age ${retAge}.`;
    } else if (eqGap >= 4 && fixGap <= -4) {
      rationale = ` Relative to the statement, the proposed tilt retains more equity for growth runway while still mapping to the ${riskLabel} calibration for someone ${timeline}.`;
    } else {
      rationale = ` The proposed sleeves shift the statement mix toward the ${riskLabel} calibration for ${timeline}, balancing growth with stability as withdrawals eventually matter more than headline returns alone.`;
    }

    const closer = first
      ? `Final recommendations should be reviewed by the advisor in the context of ${first}'s full financial plan, liquidity needs, tax situation, and income goals.`
      : "Final recommendations should be reviewed by the advisor in the context of the full financial plan, liquidity needs, tax situation, and income goals.";

    return `${opener}, the statement is roughly ${currency(totalValue)} with about ${currentAllocation.equity}% equity, ${currentAllocation.fixedIncome}% fixed, and ${currentAllocation.cash}% cash.${holdingsSentence} For discussion, the calibrated mix is ${target.equity}% equity, ${target.fixedIncome}% fixed, and ${target.cash}% cash.${rationale} ${closer}`;
  }, [
    client.firstName,
    client.riskProfile,
    client.retirementAge,
    derivedAge,
    holdings,
    totalValue,
    currentAllocation.equity,
    currentAllocation.fixedIncome,
    currentAllocation.cash,
    target.equity,
    target.fixedIncome,
    target.cash,
  ]);

  const fallbackStrategies = [
    "Evaluate whether the portfolio should shift toward a more balanced growth-and-income posture.",
    "Review the quality, duration, and role of fixed sleeve positions within the broader retirement plan.",
    "Consider whether income-oriented strategies should complement the market-based portfolio.",
  ];

  const fallbackRecommendations = [
    "Review the largest positions and funds for concentration before making any final recommendation.",
    "Compare the current equity-heavy posture against a more balanced income-aware allocation.",
    "Evaluate whether adding or adjusting fixed positioning, dividend strategies, or protected income solutions are appropriate for the client’s objective.",
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

    if (currentAllocationForModel.equity > target.equity + 15) {
      insights.push(
        `Equity exposure is ${Math.round(currentAllocationForModel.equity)}%, which is meaningfully above the ${target.equity}% proposed allocation and may amplify portfolio volatility if those equity holdings are highly correlated.`
      );
    }

    if (mutualFundCount + individualStockCount >= 4 && currentAllocationForModel.equity > 55) {
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
  }, [holdings, currentAllocationForModel.equity, target.equity]);

  const displayRedFlags = analysis?.redFlags?.length ? analysis.redFlags : [
    `Portfolio equity exposure appears elevated at ${Math.round(currentAllocationForModel.equity)}% compared with the proposed allocation of ${target.equity}%.`,
    "Large-cap U.S. equity concentration should be reviewed for overlap across funds and individual stock positions.",
    "Fixed positioning and income-oriented positioning may need to be evaluated against the client’s retirement timeline.",
  ];
  const displayOverlapInsights = analysis?.overlapInsights?.length ? analysis.overlapInsights : calculatedOverlapInsights;
  const displayWhatThisMeans = analysis?.displayWhatThisMeans?.length ? analysis.displayWhatThisMeans : [
    currentAllocationForModel.equity > target.equity
      ? `The portfolio may experience larger swings than expected because equity exposure is ${Math.round(currentAllocationForModel.equity)}%, compared with the proposed allocation of ${target.equity}%.`
      : "The current equity exposure appears closer to the proposed allocation, but the underlying holdings should still be reviewed for concentration and correlation risk.",
    currentAllocationForModel.fixedIncome < target.fixedIncome
      ? `The portfolio may not have enough fixed exposure for stability, with fixed at ${Math.round(currentAllocationForModel.fixedIncome)}% compared with the proposed allocation of ${target.fixedIncome}%.`
      : "The fixed sleeve appears closer to the proposed allocation, but the quality, duration, and income role of those holdings should still be reviewed.",
    scores.incomeReadiness < 55
      ? "Income readiness may be limited, which means the portfolio could need more stable income sources before retirement withdrawals begin."
      : "The portfolio has a stronger income-readiness foundation, but the advisor should still confirm liquidity, tax impact, and retirement withdrawal needs.",
  ];
  const displayTalkingPoints = analysis?.talkingPoints?.length ? analysis.talkingPoints : [
    "Ground the conversation: confirm statement period, approximate total portfolio value, and any major accounts missing from uploads.",
    "Walk registration (tax wrappers) before debating allocation so the household sees where dollars live versus what they own.",
    "Use synopsis and holdings context from Portfolio Review, then sleeves (current versus proposed), before leaning on numeric scores.",
    "Close with illustrative stress and advisor concerns after the client understands roles, overlap versus red flags, and plain-language impact.",
  ];

  const meetingQuestions = [
    "Before we unpack the holdings: any major liquidity needs, tax events, or income changes we should plan around in the next year or two?",
    "Are you still targeting retirement around the age listed in your profile?",
    "How important is stable income versus continued growth at this stage?",
    "If the portfolio dropped roughly 15% to 20%, would that affect your timeline or peace of mind?",
  ];

  const whatToListenFor = [
    "If the client is worried about volatility, slow down and emphasize risk alignment, income stability, and sequence-of-return risk.",
    "If the client is focused on growth, frame rebalancing as reducing unnecessary concentration rather than abandoning growth.",
    "If the client wants income, connect the gap in fixed exposure, income readiness score, and potential income-oriented strategies.",
    "If the client is hesitant to make changes, position the next step as a review and stress-test, not an immediate trading decision.",
    "If the client confuses taxable versus IRA buckets, pause and re-map registration before proposing moves.",
  ];

  const registrationMeetingLine = demoMode
    ? `Orient on tax registration from confirmed holdings (demo: illustrative treatment; traditional tax-deferred ≈ ${currency(traditionalQualifiedTotal)}).`
    : `Orient on tax registration from confirmed holdings: traditional tax-deferred ≈ ${currency(registrationTotals.traditionalQualifiedValue)}; taxable ≈ ${currency(registrationTotals.nonQualifiedValue)}; Roth IRA ≈ ${currency(registrationTotals.rothValue)}${
        registrationTotals.unknownValue ? `; unknown wrappers ≈ ${currency(registrationTotals.unknownValue)}` : ""
      }. Call out any custodians or accounts not on this statement.`;

  const meetingWalkthrough = [
    "Open with purpose and pace: no decisions required today unless the client wants them; you are building a shared picture of what they own and where.",
    `Confirm facts: total portfolio is roughly ${currency(totalValue)} on the confirmed holdings; note statement as-of date and whether anything important is missing from uploads.`,
    registrationMeetingLine,
    "Use the Synopsis on Portfolio Review (or your own one-minute narrative) so the client hears a plain-English headline of positioning before charts and scores.",
    "Show the allocation chart: current versus proposed sleeves, and what each sleeve is trying to do (growth, ballast, liquidity).",
    `Then layer in portfolio scores as supporting context: risk alignment ${scores.riskAlignment}/100, diversification ${scores.diversification}/100, income readiness ${scores.incomeReadiness}/100, not as the opening headline.`,
    "Walk Hypothetical Allocation Stress on Portfolio Review verbally: illustrative only, not a forecast; three decade-window CAGRs plus the modeled 2008 calendar-year drawdown row.",
    "Review Advisor Red Flags as the primary concern list: specific portfolio issues to watch, distinct from fund-level overlap.",
    "Use Overlap & Concentration for duplicated exposure (multiple holdings, similar underlying bets), not the same as “many positions equal diversification.”",
    "Before strategy and recommendations, use What This Means for You to translate into outcomes the client can feel.",
  ];

  const closingScript =
    "The goal is not to change things for the sake of change. The next step is to review which adjustments, if any, better align the portfolio with your risk comfort, timeline, income needs, liquidity, and tax picture before any final recommendation.";


  const positioningImpact = [
    `Equity: ${currentAllocation.equity}% current → ${target.equity}% proposed`,
    `Fixed: ${currentAllocation.fixedIncome}% current → ${target.fixedIncome}% proposed`,
    `Cash: ${currentAllocation.cash}% current → ${target.cash}% proposed`,
    ...(currentAllocation.other > 0
      ? [
          `Unclassified: ${currentAllocation.other}% (refine ETF/Mutual Fund line items or narrow holding labels)`,
        ]
      : []),
  ];

  const findings = [
    `Current portfolio appears to be approximately ${currentAllocation.equity}% equity, ${currentAllocation.fixedIncome}% fixed, and ${currentAllocation.cash}% cash.`,
    `Based on the selected calibration, the proposed allocation is approximately ${target.equity}% equity, ${target.fixedIncome}% fixed, and ${target.cash}% cash.`,
    reviewCount > 0 ? `${reviewCount} holding${reviewCount === 1 ? "" : "s"} require advisor confirmation before final analysis.` : "All holdings are currently matched above the confidence threshold.",
    duplicateCount > 0 ? `${duplicateCount} possible duplicate holding${duplicateCount === 1 ? "" : "s"} detected across uploaded files/pages.` : "No likely duplicate holdings detected across uploaded files/pages.",
    !demoMode
      ? "Uncertain lines are not auto-verified with AI on this step—you confirm tickers, registrations, and values before analysis."
      : "Demo mode uses sample extractions; live reviews rely on your confirmation only.",
    demoMode
      ? "Demo mode is on. The sample holdings include illustrative tax registrations only."
      : "Analysis pulls both allocation and tax registration from your confirmed holdings (qualified vs taxable vs Roth).",
    ...(demoMode
      ? [`Illustrative tax-deferred aggregate in demo is ${currency(traditionalQualifiedTotal)} (entire demo balance marked traditional).`]
      : [
          `Registration mix: traditional tax-deferred ≈ ${currency(registrationTotals.traditionalQualifiedValue)}; non-qualified taxable ≈ ${currency(registrationTotals.nonQualifiedValue)}; Roth IRA ≈ ${currency(registrationTotals.rothValue)}${registrationTotals.unknownValue ? `; unknown wrappers ≈ ${currency(registrationTotals.unknownValue)}` : ""}.`,
        ]),
  ];

  function normalizeOptions(h: Holding, includeSyntheticCashTicker?: boolean) {
    const base = Array.isArray(h.options) ? h.options.filter(Boolean) : [];
    const manual = "Manual ticker / CUSIP entry";
    const tail = includeSyntheticCashTicker ? [SYNTHETIC_CASH_TICKER, manual] : [manual];
    const values = [h.suggested, ...base, ...tail].filter(Boolean);
    return Array.from(new Set(values));
  }

  function updateHolding(index: number, updates: Partial<Holding>) {
    setHoldings((prev) =>
      prev.map((h, i) => {
        if (i !== index) return h;
        let next = { ...h, ...updates };
        if (updates.registrationType !== undefined) {
          next = { ...next, registrationType: normalizeRegistrationType(updates.registrationType) };
        }
        return { ...next, ...validateHoldingLocally(next) };
      })
    );
    setAnalysis(null);
  }

  function removeHoldingAt(index: number) {
    setHoldings((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const filtered = prev.filter((_, i) => i !== index);
      const cleared: Holding[] = filtered.map((h) => {
        const next = { ...h };
        delete next.duplicateKey;
        delete next.duplicateOfIndex;
        return { ...next, ...validateHoldingLocally(next) };
      });
      return flagLikelyDuplicateHoldings(cleared);
    });
    setAnalysis(null);
    setDuplicatesAcknowledged(false);
  }

  function applyRegistrationForAccountKey(accountKey: string, registration: RegistrationBucket) {
    setHoldings((prev) =>
      prev.map((h) => {
        if (accountGroupKey(h) !== accountKey) return h;
        const next = { ...h, registrationType: registration };
        return { ...next, ...validateHoldingLocally(next) };
      })
    );
    setAnalysis(null);
  }

  async function handleExtractHoldings() {
    if (statementUploadQueue.length === 0) {
      setExtractError("Please upload at least one PDF, screenshot, or photo first.");
      return;
    }

    try {
      setIsExtracting(true);
      setExtractProgressIndex(0);
      setExtractError("");
      setAnalysis(null);

      const formData = new FormData();
      statementUploadQueue.forEach((item) => formData.append("files", item.file));
      formData.append(
        "filePageHints",
        JSON.stringify(statementUploadQueue.map((item) => item.holdingsPages.trim()))
      );
      formData.append("client", JSON.stringify(client));
      formData.append("demoMode", demoMode ? "true" : "false");

      const response = await advisorFetch("/api/analyze-statement", {
        method: "POST",
        body: formData,
        onEmailSessionExpired: handleEmailSessionExpired,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Statement analysis failed.");
      }

      const data = await response.json();
      const extractedHoldings = Array.isArray(data.holdings) ? data.holdings : [];

      if (extractedHoldings.length === 0) {
        throw new Error("No holdings were extracted from the statement. Try a clearer image or PDF.");
      }

      const normalizedExtracted: Holding[] = normalizeHoldingsForUi(extractedHoldings).map((h) => ({
        ...h,
        ...validateHoldingLocally(h),
      }));
      const cleaned = flagLikelyDuplicateHoldings(normalizedExtracted);

      setHoldings(cleaned);
      setDuplicatesAcknowledged(false);
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
      if (!duplicateOk) {
        setAnalysisError(
          "Confirm possible duplicate holdings before running deep analysis — use the checklist below the holdings table."
        );
      } else if (reviewCount > 0) {
        setAnalysisError(
          `Resolve every holding that still needs review (${reviewCount} left) before running the deep analysis.`
        );
      } else {
        setAnalysisError("Complete holdings confirmation before running the deep analysis.");
      }
      return;
    }

    try {
      setIsAnalyzing(true);
      setAnalysisProgressIndex(0);
      setAnalysisError("");

      const response = await advisorFetch("/api/generate-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client,
          holdings,
          allocation: { current: currentAllocation, target },
          totalValue,
          demoMode,
          clientId: activeReviewId,
        }),
        onEmailSessionExpired: handleEmailSessionExpired,
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

    try {
      const res = await advisorFetch("/api/client-upload-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intakeSnapshot: client }),
        onEmailSessionExpired: handleEmailSessionExpired,
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
    if (intakeStep === 7) {
      const screen = client.riskIntakeScreen;
      if (screen === "known") {
        setClient((c) => ({ ...c, riskIntakeScreen: "gate", riskIntakeKnown: "unset" }));
        return;
      }
      if (screen === "quiz") {
        if (client.riskQuizStepIndex > 0) {
          const i = client.riskQuizStepIndex;
          const qToClear = RISK_QUIZ_QUESTIONS[i - 1];
          setClient((c) => {
            const nextAnswers = { ...c.riskQuizAnswers };
            delete nextAnswers[qToClear.id];
            return { ...c, riskQuizStepIndex: i - 1, riskQuizAnswers: nextAnswers };
          });
          return;
        }
        setClient((c) => ({ ...c, riskIntakeScreen: "gate", riskIntakeKnown: "unset" }));
        return;
      }
      if (screen === "result") {
        const lastQ = RISK_QUIZ_QUESTIONS[RISK_QUIZ_LENGTH - 1];
        setClient((c) => {
          const nextAnswers = { ...c.riskQuizAnswers };
          delete nextAnswers[lastQ.id];
          return {
            ...c,
            riskIntakeScreen: "quiz",
            riskQuizStepIndex: RISK_QUIZ_LENGTH - 1,
            riskQuizAnswers: nextAnswers,
            riskProfileSuggested: "",
          };
        });
        return;
      }
      if (screen === "gate") {
        setIntakeStep(6);
        return;
      }
    }
    if (intakeStep > 0) setIntakeStep(intakeStep - 1);
  }

  const liveIntakeFooter = useMemo(
    () => (
      <button
        type="button"
        aria-label="Profile AutoPilot"
        onClick={() => setLiveIntakeOpen(true)}
        className="group inline-flex flex-col items-center gap-2 rounded-none bg-transparent px-2 py-1 text-center transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
      >
        <Image
          src="/logo.png"
          alt=""
          aria-hidden
          width={96}
          height={96}
          className="h-16 w-auto rounded-none object-contain drop-shadow-[0_8px_18px_rgba(14,116,235,0.18)] transition group-hover:drop-shadow-[0_12px_24px_rgba(14,116,235,0.32)] md:h-[4.5rem]"
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
      const res = await advisorFetch("/api/client-database", {
        headers: {},
        onEmailSessionExpired: handleEmailSessionExpired,
      });
      const data = await res.json();

      if (!res.ok) {
        setSaveMessage(data.error || "Could not load client database.");
        setSavedReviews([]);
        return;
      }

      setSavedReviews(
        (Array.isArray(data.clients) ? data.clients : []).map((row: unknown) =>
          normalizeSavedReviewRow(row)
        )
      );
    } catch {
      setSaveMessage("Could not load client database.");
      setSavedReviews([]);
    }
  }

  async function saveCurrentReview(): Promise<boolean> {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      setSaveMessage("Please log in before saving a client profile.");
      return false;
    }

    try {
      const res = await advisorFetch("/api/client-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeReviewId,
          ownerEmail,
          client: buildClientJsonForDatabase(),
          holdings,
          meetingNotes,
          demoMode,
          analysis,
          totalValue,
          status: analysis ? "Analyzed" : activeReviewId ? undefined : "Analyzed",
          rothWorksheet,
        }),
        onEmailSessionExpired: handleEmailSessionExpired,
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveMessage(data.error || "Could not save client profile.");
        return false;
      }

      if (data?.client?.id) setActiveReviewId(data.client.id);
      setSaveMessage(`Saved ${clientDisplayName(client) || "Client"} client profile.`);
      setTimeout(() => setSaveMessage(""), 2500);
      await loadSavedReviews();
      return true;
    } catch {
      setSaveMessage("Could not save client profile.");
      return false;
    }
  }

  const startBlankReview = useCallback(() => {
    setClient({ ...INITIAL_CLIENT_STATE, riskQuizAnswers: {} });
    setHoldings([]);
    setDemoMode(false);
    setMeetingNotes("");
    setAnalysis(null);
    setStatementUploadQueue([]);
    setStatementFileInputRevision(0);
    setActiveReviewId(null);
    setRothWorksheet(emptyRothWorksheet());
    setRothLiveAnalysisOpen(false);
    setRothAnalysisPrecheckMessages([]);
    setFiaWorksheet(emptyFiaWorksheet());
    setRothFicTemplatePickerValue(ROTH_FIC_TEMPLATE_PICKER_NONE);
    setRothFicTemplateSaveOpen(false);
    setRothFicTemplateNotice(null);
    setRothFicTemplateLoadSpecConfirmOpen(false);
    setRothFicPendingLoadTemplate(null);
    setRothFicTemplateRemapTargetId(null);
    setSnapshotIncludeFiaAppendix(false);
    setSnapshotIncludeRothAppendix(false);
    setRetIncClientEarnedAnnual("");
    setRetIncSpouseEarnedAnnual("");
    setRetIncPensionAnnual("");
    setRetIncPensionColaPct("");
    setRetIncOtherAnnual("");
    setRetIncOtherGrowthPct("");
    setRetIncNeedInflationPct("3");
    setRetIncSsColaPct("2");
    setRetIncSsMonthlyClient("");
    setRetIncSsMonthlySpouse("");
    setRetIncSsKnowBenefit("unset");
    setRetIncSsEstClientAnnual("");
    setRetIncSsEstClientYears("");
    setRetIncSsEstClientClaimAge("");
    setRetIncSsEstSpouseAnnual("");
    setRetIncSsEstSpouseYears("");
    setRetIncSsEstSpouseClaimAge("");
    setRetIncSsUseSpousalModel(true);
    setRetIncSpendNetOfTax(true);
    setRetIncEffectiveTaxPct("20");
    setRetIncSsStartAgeClient("");
    setRetIncSsStartAgeSpouse("");
    setRetIncReturnMode("snapshot");
    setRetIncCustomReturnPct("");
    setFollowUpEmail("");
    setEmailCopied(false);
    setDuplicatesAcknowledged(false);
    setIntakeStep(0);
    setStep("intake");
    setExtractError("");
    setAnalysisError("");
    setExtractProgressIndex(0);
    setAnalysisProgressIndex(0);
    setIsExtracting(false);
    setIsAnalyzing(false);
    setMagicLinkUrl("");
    setMagicLinkExpiresAt("");
    setMagicLinkErr("");
    setMagicLinkCopied(false);
    setLiveIntakeOpen(false);
    setUploadSectionFocus(null);
  }, []);

  async function handleNewReviewIntent() {
    if (!reviewHasUnsavedWork) {
      startBlankReview();
      return;
    }
    const shouldSave = window.confirm(
      "Save this client to your database before starting a new review?\n\nClick OK to save, or Cancel to continue without saving."
    );
    if (shouldSave) {
      const ok = await saveCurrentReview();
      if (!ok) return;
    }
    startBlankReview();
  }

  function openSavedReview(review: SavedReview) {
    setActiveReviewId(review.id);
    const loadedClient = normalizeIntakeClient(review.client);
    setRothLiveAnalysisOpen(loadedClient.persistedAdvisorUi?.rothLiveAnalysisOpen === true);
    setSnapshotIncludeFiaAppendix(loadedClient.persistedAdvisorUi?.snapshotIncludeFiaAppendix === true);
    setSnapshotIncludeRothAppendix(loadedClient.persistedAdvisorUi?.snapshotIncludeRothAppendix === true);
    setFiaWorksheet(normalizeFiaWorksheet(loadedClient.fiaWorksheet ?? emptyFiaWorksheet()));
    setClient({ ...loadedClient, fiaWorksheet: undefined, persistedAdvisorUi: undefined });
    const reviewDemo = Boolean(review.demoMode);
    const loaded: Holding[] = flagLikelyDuplicateHoldings(
      normalizeHoldingsForUi(review.holdings).map((h) => ({
        ...h,
        ...validateHoldingLocally(h),
      }))
    );
    setHoldings(loaded);
    setMeetingNotes(review.meetingNotes || "");
    setDemoMode(reviewDemo);
    setAnalysis(normalizeAiAnalysis(review.analysis));
    setRothWorksheet(normalizeRothWorksheet(review.rothWorksheet));
    setRothAnalysisPrecheckMessages([]);
    setFollowUpEmail("");
    setEmailCopied(false);
    const lc = String(loadedClient.socialSecurityMonthlyClient ?? "").trim();
    const ls = String(loadedClient.socialSecurityMonthlySpouse ?? "").trim();
    setRetIncSsMonthlyClient(lc ? loadedClient.socialSecurityMonthlyClient : "");
    setRetIncSsMonthlySpouse(loadedClient.married && ls ? loadedClient.socialSecurityMonthlySpouse : "");
    setRetIncSsKnowBenefit("unset");
    setRetIncSsEstClientAnnual("");
    setRetIncSsEstClientYears("");
    setRetIncSsEstClientClaimAge("");
    setRetIncSsEstSpouseAnnual("");
    setRetIncSsEstSpouseYears("");
    setRetIncSsEstSpouseClaimAge("");
    setRetIncSsUseSpousalModel(true);
    setRetIncSpendNetOfTax(true);
    setRetIncEffectiveTaxPct("20");
    setRetIncSsStartAgeClient("");
    setRetIncSsStartAgeSpouse("");
    const resumeConfirm =
      String(review.status || "").trim().toLowerCase() === "draft" && !review.analysis;
    setStep(resumeConfirm ? "confirm" : "analysis");
  }


  async function sendFollowUpFromDatabase(review: SavedReview) {
    setClientDbNotice(null);
    const ownerEmail = getCurrentOwnerEmail();
    if (!ownerEmail) {
      setClientDbNotice({
        variant: "error",
        message: "Sign in to refresh analysis and send a follow-up.",
      });
      return;
    }

    const to = String(review.client?.advisorEmail || "").trim();
    if (!to) {
      setClientDbNotice({
        variant: "error",
        message: "Add the client's email (snapshot recipient) on their profile before sending.",
      });
      return;
    }

    const normalizedClient = normalizeIntakeClient(review.client);
    const reviewHoldings = Array.isArray(review.holdings) ? review.holdings : [];
    if (reviewHoldings.length === 0) {
      setClientDbNotice({
        variant: "error",
        message: "This profile has no saved holdings. Open the profile and save holdings first.",
      });
      return;
    }

    // Saved profiles already passed advisor workflow; do not block follow-up on confirm-step gates
    // (review/duplicate flags) — those alerts were easy to miss and looked like a dead click.
    const ctx = computePortfolioContextFromReview(normalizedClient, reviewHoldings, Boolean(review.demoMode));

    setFollowUpEmailSendingId(review.id);
    try {
      const analysisRes = await advisorFetch("/api/generate-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: normalizedClient,
          holdings: reviewHoldings,
          allocation: { current: ctx.currentAllocation, target: ctx.target },
          totalValue: ctx.totalValue,
          demoMode: Boolean(review.demoMode),
          clientId: review.id,
        }),
        onEmailSessionExpired: handleEmailSessionExpired,
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

      const rothWsFollowUp = normalizeRothWorksheet(review.rothWorksheet);
      const tradQFollowUp = sumTraditionalQualifiedValue(reviewHoldings);
      const nonQFollowUp = sumNonQualifiedValue(reviewHoldings);
      const fiaWsFollowUp =
        normalizedClient.fiaWorksheet != null ? normalizedClient.fiaWorksheet : emptyFiaWorksheet();
      const fiaPremiumFollowUp = defaultPremiumForWorksheet(fiaWsFollowUp, tradQFollowUp, nonQFollowUp);
      const fiaAgeFollowUp =
        ctx.derivedAge != null && Number.isFinite(ctx.derivedAge) ? ctx.derivedAge : null;
      const rothPdfQFollowUp = rothIllustrationQualifiedBalance(
        rothWsFollowUp,
        ctx.totalValue || 0,
        tradQFollowUp
      );
      const persistUiFollowUp = normalizedClient.persistedAdvisorUi;

      let emailOk = false;
      let emailErrMsg = "";
      let emailPlainBody = "";
      try {
        const emailRes = await fetch("/api/email-client-snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            emailVariant: "follow_up",
            to,
            emailSignature: getCleanEmailSignature(),
            calendarLink: signatureCalendarLink,
            clientId: review.id,
            demoMode: Boolean(review.demoMode),
            client: { ...normalizedClient, fiaWorksheet: undefined, persistedAdvisorUi: undefined },
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
            includeFiaAppendix: persistUiFollowUp?.snapshotIncludeFiaAppendix === true,
            includeRothConversionAppendix: persistUiFollowUp?.snapshotIncludeRothAppendix === true,
            fiaWorksheet: fiaWsFollowUp,
            fiaPremiumDefault: fiaPremiumFollowUp,
            fiaClientAgeForIllustration: fiaAgeFollowUp,
            rothWorksheet: rothWsFollowUp,
            rothPdfQualifiedTotal: rothPdfQFollowUp || 0,
          }),
        });

        const emailText = await emailRes.text();
        let emailJson: Record<string, unknown> = {};
        try {
          emailJson = emailText ? JSON.parse(emailText) : {};
        } catch {
          emailJson = {};
        }

        if (emailRes.ok) {
          emailOk = true;
          emailPlainBody = typeof emailJson.plainTextBody === "string" ? emailJson.plainTextBody : "";
        } else {
          emailErrMsg = String(emailJson.error || emailText || "Failed to send follow-up email.");
          if (emailJson.needsGoogleReconnect && typeof window !== "undefined") {
            setGmailReconnectHint(
              "Google needs permission again to send mail. After reconnecting, try the follow-up send again from the client list."
            );
            if (
              window.confirm(
                `${emailErrMsg}\n\nOpen Google sign-in now to refresh Gmail access? (You will return to this page.)`
              )
            ) {
              void signIn(
                "google",
                { callbackUrl: googleGmailReconnectCallbackUrl() },
                GOOGLE_GMAIL_REAUTHORIZE_PARAMS
              );
            }
          }
        }
      } catch (emailNetworkErr) {
        emailErrMsg =
          emailNetworkErr instanceof Error ? emailNetworkErr.message : "Network error while sending email.";
      }

      const priorStatus = String(review.status || "").trim();
      const saveRes = await advisorFetch("/api/client-database", {
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
          status: emailOk ? "Report Sent" : priorStatus || "Analyzed",
          ...(emailOk ? { lastContactedAt: new Date().toISOString() } : {}),
          rothWorksheet: review.rothWorksheet ?? null,
        }),
        onEmailSessionExpired: handleEmailSessionExpired,
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        throw new Error(
          typeof saveData.error === "string" ? saveData.error : "Could not save refreshed profile after analysis."
        );
      }
      await loadSavedReviews();

      openSavedReview({ ...review, analysis: freshAnalysis });
      setAnalysis(freshAnalysis);
      setStep("report");
      setFollowUpEmail(emailPlainBody);
      setEmailCopied(false);

      if (emailOk) {
        setSaveMessage("Follow-up email sent. Analysis was refreshed for today's date and saved to this profile.");
        setTimeout(() => setSaveMessage(""), 10000);
      } else {
        setSaveMessage(
          `Analysis refreshed for today and saved. Email was not sent: ${emailErrMsg} Use Wrap-up below to send via Gmail (Google sign-in) or copy follow-up text.`
        );
        setTimeout(() => setSaveMessage(""), 12000);
      }
    } catch (e) {
      console.error(e);
      setClientDbNotice({
        variant: "error",
        message: e instanceof Error ? e.message : "Could not refresh analysis or send follow-up.",
      });
    } finally {
      setFollowUpEmailSendingId(null);
    }
  }

  function updateAnalysisFromDatabase(review: SavedReview) {
    setActiveReviewId(review.id);
    const loadedClient = normalizeIntakeClient(review.client);
    setRothLiveAnalysisOpen(loadedClient.persistedAdvisorUi?.rothLiveAnalysisOpen === true);
    setSnapshotIncludeFiaAppendix(loadedClient.persistedAdvisorUi?.snapshotIncludeFiaAppendix === true);
    setSnapshotIncludeRothAppendix(loadedClient.persistedAdvisorUi?.snapshotIncludeRothAppendix === true);
    setFiaWorksheet(normalizeFiaWorksheet(loadedClient.fiaWorksheet ?? emptyFiaWorksheet()));
    setClient({ ...loadedClient, fiaWorksheet: undefined, persistedAdvisorUi: undefined });
    setHoldings(normalizeHoldingsForUi(review.holdings));
    setMeetingNotes(review.meetingNotes || "");
    setDemoMode(Boolean(review.demoMode));
    setAnalysis(null);
    setFollowUpEmail("");
    setEmailCopied(false);
    setStatementUploadQueue([]);
    setStatementFileInputRevision(0);
    setExtractError("");
    setStep("upload");
    setRothWorksheet(normalizeRothWorksheet(review.rothWorksheet));
    setRothAnalysisPrecheckMessages([]);
  }

  async function deleteSavedReview(id: string) {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      setSaveMessage("Please log in before deleting a client profile.");
      return;
    }

    try {
      const res = await advisorFetch("/api/client-database", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerEmail,
          id,
        }),
        onEmailSessionExpired: handleEmailSessionExpired,
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
      setMagicLinkErr("Could not copy. Select the link in the field and copy manually.");
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

  const loadAdvisorProfile = useCallback(async (ownerEmailOverride?: string) => {
    const ownerEmail =
      ownerEmailOverride ||
      String(session?.user?.email || emailAuthUser?.email || "").trim().toLowerCase();
    if (!ownerEmail) return;

    try {
      const res = await advisorFetch("/api/advisor-profile", {
        headers: {},
        onEmailSessionExpired: handleEmailSessionExpired,
      });
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

      setSignatureName(profile.advisorName || "");
      setSignatureTitle(profile.advisorTitle || "");
      setSignatureLicense(profile.advisorLicense || "");
      setSignatureCalendarLink(savedCalendarLink || inferredLinkFromSignature);
      setSignatureAddress(profile.officeAddress || "");
      setSignatureOfficePhone(profile.officePhone || "");
      setSignatureCellPhone(profile.cellPhone || "");
      setSignatureWebsite(profile.website || "");
      setSignatureLogoUrl(profile.logoUrl || "");
      setSignatureDisclosuresText(profile.disclosuresText || "");
      setSignatureDisclosuresImageUrl(profile.disclosuresImageUrl || "");

      setShowSignatureSetup(!savedSignature && !profile.advisorName);
    } catch {
      // Non-blocking. The app can still run without a saved advisor profile.
    }
  }, [emailAuthUser?.email, handleEmailSessionExpired, session?.user?.email]);

  const uploadAdvisorSignatureAsset = useCallback(
    async (kind: "logo" | "disclosures", file: File) => {
      setSignatureAssetErr("");
      if (kind === "logo") setLogoUploadBusy(true);
      else setDisclosuresImageUploadBusy(true);
      try {
        const fd = new FormData();
        fd.append("kind", kind);
        fd.append("file", file);
        const res = await advisorFetch("/api/advisor-profile/upload", {
          method: "POST",
          body: fd,
          onEmailSessionExpired: handleEmailSessionExpired,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSignatureAssetErr(typeof data.error === "string" ? data.error : "Upload failed.");
          return;
        }
        const url = String(data.publicUrl || "").trim();
        if (!url) {
          setSignatureAssetErr("Upload did not return a URL.");
          return;
        }
        if (kind === "logo") setSignatureLogoUrl(url);
        else setSignatureDisclosuresImageUrl(url);
      } catch {
        setSignatureAssetErr("Upload failed.");
      } finally {
        if (kind === "logo") setLogoUploadBusy(false);
        else setDisclosuresImageUploadBusy(false);
      }
    },
    [handleEmailSessionExpired]
  );

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        setSession(data?.user ? data : null);
        if (data?.user?.email) await loadAdvisorProfile(data.user.email);
        if (!data?.user && typeof window !== "undefined") {
          const at = sessionStorage.getItem(AP_SUPABASE_AT);
          if (at) {
            const emailRes = await fetch("/api/auth/email-session", {
              headers: { Authorization: `Bearer ${at}` },
            });
            const emailData = await emailRes.json().catch(() => ({}));
            if (emailRes.ok && emailData?.user?.email) {
              setEmailAuthUser(emailData.user as EmailAuthUser);
              await loadAdvisorProfile(emailData.user.email);
            } else {
              sessionStorage.removeItem(AP_SUPABASE_AT);
              sessionStorage.removeItem(AP_SUPABASE_RT);
            }
          }
        }
      } catch {
        setSession(null);
      } finally {
        setAuthLoaded(true);
      }
    }

    loadSession();
  }, [loadAdvisorProfile]);

  useEffect(() => {
    if (!authLoaded) return;
    if (session || emailAuthUser) return;
    window.location.replace("/login");
  }, [authLoaded, session, emailAuthUser]);

  /** Leaving Client Database clears a stuck “Sending…” if navigation interrupted the request. */
  useEffect(() => {
    if (step !== "saved") {
      setFollowUpEmailSendingId(null);
    }
  }, [step]);

  /** Scroll follow-up / error banner into view when it appears. */
  useEffect(() => {
    if (!clientDbNotice) return;
    const t = window.setTimeout(() => {
      document.getElementById("client-db-followup-notice")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [clientDbNotice]);

  async function saveAdvisorProfile() {
    const ownerEmail = getCurrentOwnerEmail();

    if (!ownerEmail) {
      setSaveMessage("Please log in before saving your advisor profile.");
      return;
    }

    try {
      const res = await advisorFetch("/api/advisor-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          logoUrl: signatureLogoUrl || null,
          disclosuresText: signatureDisclosuresText,
          disclosuresImageUrl: signatureDisclosuresImageUrl || null,
          emailSignature: composeEmailSignature(),
        }),
        onEmailSessionExpired: handleEmailSessionExpired,
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveMessage(data.error || "Could not save advisor profile.");
        return;
      }

      setEmailSignature(data?.profile?.emailSignature || composeEmailSignature());

      setSignatureName(data?.profile?.advisorName || signatureName);
      setSignatureTitle(data?.profile?.advisorTitle || signatureTitle);
      setSignatureLicense(data?.profile?.advisorLicense || signatureLicense);
      setSignatureCalendarLink(data?.profile?.calendarLink || signatureCalendarLink);
      setSignatureAddress(data?.profile?.officeAddress || signatureAddress);
      setSignatureOfficePhone(data?.profile?.officePhone || signatureOfficePhone);
      setSignatureCellPhone(data?.profile?.cellPhone || signatureCellPhone);
      setSignatureWebsite(data?.profile?.website || signatureWebsite);
      setSignatureLogoUrl(data?.profile?.logoUrl || signatureLogoUrl);
      setSignatureDisclosuresText(data?.profile?.disclosuresText ?? signatureDisclosuresText);
      setSignatureDisclosuresImageUrl(data?.profile?.disclosuresImageUrl || signatureDisclosuresImageUrl);
      setShowSignatureSetup(false);
      setSaveMessage("Advisor email signature saved.");
      setTimeout(() => setSaveMessage(""), 2500);
    } catch {
      setSaveMessage("Could not save advisor profile.");
    }
  }

  async function markCurrentClientContacted() {
    const ownerEmail = getCurrentOwnerEmail();
    if (!ownerEmail) return;

    try {
      const res = await advisorFetch("/api/client-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeReviewId,
          ownerEmail,
          client: buildClientJsonForDatabase(),
          holdings,
          meetingNotes,
          demoMode,
          analysis,
          totalValue,
          status: "Report Sent",
          lastContactedAt: new Date().toISOString(),
          rothWorksheet,
        }),
        onEmailSessionExpired: handleEmailSessionExpired,
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



function handleEmailPasswordLogout() {
  setEmailAuthUser(null);
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(AP_SUPABASE_AT);
    sessionStorage.removeItem(AP_SUPABASE_RT);
    window.location.assign("/login");
  }
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
      credentials: "include",
      body: JSON.stringify({
        to: client.advisorEmail,
        subject: `Next Steps from Our Portfolio Review - ${clientDisplayName(client) || "Client"}`,
        emailBody: generatedEmailBody,
        emailSignature: getCleanEmailSignature(),
        calendarLink: signatureCalendarLink,
        clientId: activeReviewId,
        demoMode,
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
        includeFiaAppendix: snapshotIncludeFiaAppendix,
        includeRothConversionAppendix: snapshotIncludeRothAppendix,
        fiaWorksheet,
        fiaPremiumDefault,
        fiaClientAgeForIllustration,
        rothWorksheet,
        rothPdfQualifiedTotal: rothPdfQualifiedTotal || 0,
      }),
    });

    const text = await res.text();
    let data: { error?: string; needsGoogleReconnect?: boolean } = {};

    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      data =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as { error?: string; needsGoogleReconnect?: boolean })
          : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      if (data.needsGoogleReconnect) {
        setGmailReconnectHint(
          "Your Google connection for sending mail needs to be refreshed. Use the steps below, then try Send via Gmail again."
        );
      }
      alert(data.error || text || "Failed to send email.");
      return;
    }

    setGmailReconnectHint(null);
    await markCurrentClientContacted();
    alert("Client Snapshot sent successfully.");
  } catch (err) {
    console.error(err);
    alert("Error sending email.");
  }
}

async function runRothReportDownload(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/generate-roth-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client,
        totalValue: rothPdfQualifiedTotal || 0,
        rothWorksheet,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      let msg = errText;
      try {
        const j = JSON.parse(errText) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* use raw */
      }
      return { ok: false, error: msg || "Could not generate Roth Option PDF." };
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Roth_Option.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Failed to download Roth Option PDF." };
  }
}

async function downloadRothOptionPdf() {
  if (!showRothOptionReport) {
    alert("Roth Option is available for clients age 60 and older.");
    return;
  }
  if (!rothLiveAnalysisOpen) {
    alert("Run Roth Analysis first, then you can download the Roth Report PDF.");
    return;
  }
  const out = await runRothReportDownload();
  if (!out.ok) alert(out.error || "Could not generate Roth Option PDF.");
}

async function runRothAnalysisWithTaxPrecheck() {
  if (!showRothOptionReport) {
    alert("Roth Option is available for clients age 60 and older.");
    return;
  }
  setRothAnalysisBusy(true);
  try {
    const pre = await fetch("/api/roth-analysis", { method: "POST" });
    const j = (await pre.json().catch(() => ({}))) as {
      ok?: boolean;
      proceed?: boolean;
      error?: string;
      messages?: string[];
    };
    if (!pre.ok || !j.ok || j.proceed === false) {
      alert(String(j.error || "Roth analysis tax-parameter check did not complete."));
      return;
    }
    setRothAnalysisPrecheckMessages(Array.isArray(j.messages) ? j.messages : []);
    setRothLiveAnalysisOpen(true);
  } catch (e) {
    console.error(e);
    alert("Roth analysis failed.");
  } finally {
    setRothAnalysisBusy(false);
  }
}

async function downloadPDFReport(mode: "client" | "advisor") {
  try {
    const res = await advisorFetch("/api/generate-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode, // 👈 NEW
        client,
        clientId: activeReviewId,
        demoMode,
        includeFiaAppendix: snapshotIncludeFiaAppendix,
        includeRothConversionAppendix: snapshotIncludeRothAppendix,
        fiaWorksheet,
        fiaPremiumDefault,
        fiaClientAgeForIllustration,
        rothWorksheet,
        rothPdfQualifiedTotal: rothPdfQualifiedTotal || 0,
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
      onEmailSessionExpired: handleEmailSessionExpired,
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
          <Card className="ap-glass ap-step-enter w-full rounded-none border-0">
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
        <div className="mx-auto flex min-h-[80vh] max-w-lg items-center justify-center">
          <Card className="ap-glass ap-step-enter w-full rounded-none border-0">
            <CardContent className="p-8 text-center">
              <LogoBlock />
              <p className="mt-6 text-slate-600">Redirecting to sign in…</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="ap-app-bg min-h-screen text-slate-950 print:bg-white">
      <style jsx global>{`
        @media print {
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .ap-top-nav, .ap-wizard-rail, .no-print { display: none !important; }
          .print-card { border: none !important; box-shadow: none !important; padding: 0 !important; }
          .report-paper { border: none !important; box-shadow: none !important; padding: 24px !important; }
          svg, img { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <AppTopNav
        step={step}
        intakeStep={intakeStep}
        demoMode={demoMode}
        setDemoMode={setDemoMode}
        session={session}
        emailAuthUser={emailAuthUser}
        signatureName={signatureName}
        advisorDisplayName={advisorVoiceName}
        onNewReview={handleNewReviewIntent}
        setShowSignatureSetup={setShowSignatureSetup}
        handleEmailPasswordLogout={handleEmailPasswordLogout}
        analysisReady={Boolean(analysis)}
      />
      <WizardStepRail wizardSteps={wizardSteps} step={step} setStep={setStep} loadSavedReviews={loadSavedReviews} />

      <div className="mx-auto max-w-7xl space-y-6 px-4 pt-0 pb-6 md:px-8 md:pb-8 print:max-w-none print:space-y-0 print:p-0">
        {saveMessage && (
          <div className="rounded-none border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800">
            {saveMessage}
          </div>
        )}

        {showSignatureSetup && (
          <Card className="rounded-none ap-glass border-0">
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
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder="Christopher Perussina" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Title</label>
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureTitle} onChange={(e) => setSignatureTitle(e.target.value)} placeholder="President" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">License line</label>
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureLicense} onChange={(e) => setSignatureLicense(e.target.value)} placeholder="License #0H38298" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Calendar booking link</label>
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureCalendarLink} onChange={(e) => setSignatureCalendarLink(e.target.value)} placeholder="https://calendly.com/your-link" />
                  <p className="mt-1 text-xs text-slate-500">Clients will see this as “Book a time on my calendar.”</p>
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Office address</label>
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureAddress} onChange={(e) => setSignatureAddress(e.target.value)} placeholder="1255 Treat Blvd Suite 300 Floor 3, Walnut Creek, CA 94597" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Office phone</label>
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureOfficePhone} onChange={(e) => setSignatureOfficePhone(e.target.value)} placeholder="(415) 991-2800 X102" />
                </div>

                <div>
                  <label className="text-sm font-semibold text-slate-700">Cell phone</label>
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureCellPhone} onChange={(e) => setSignatureCellPhone(e.target.value)} placeholder="(925) 413-8100" />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Website</label>
                  <Input className="mt-2 h-12 rounded-none bg-white" value={signatureWebsite} onChange={(e) => setSignatureWebsite(e.target.value)} placeholder="www.AssuredWealthAdvisors.com" />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Email logo (optional)</label>
                  <p className="mt-1 text-xs text-slate-500">
                    Shown in HTML emails directly below your website line. Uploads are scaled to fit the signature (max width 220px in the message).
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadAdvisorSignatureAsset("logo", f);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-none"
                      disabled={logoUploadBusy}
                      onClick={() => logoFileInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" aria-hidden />
                      {logoUploadBusy ? "Uploading…" : "Upload logo"}
                    </Button>
                    {signatureLogoUrl ? (
                      <Button type="button" variant="ghost" className="rounded-none text-slate-600" onClick={() => setSignatureLogoUrl("")}>
                        Remove logo
                      </Button>
                    ) : null}
                  </div>
                  {signatureLogoUrl ? (
                    <img
                      src={signatureLogoUrl}
                      alt=""
                      className="mt-3 h-auto max-h-20 w-auto max-w-[220px] border border-slate-100 object-contain"
                    />
                  ) : null}
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Disclosures: text (optional)</label>
                  <p className="mt-1 text-xs text-slate-500">Appears at the bottom of your signature in a smaller font. Use this, the image below, or both.</p>
                  <Textarea
                    className="mt-2 min-h-[100px] rounded-none bg-white"
                    value={signatureDisclosuresText}
                    onChange={(e) => setSignatureDisclosuresText(e.target.value)}
                    placeholder="Required disclosures, regulatory text, or a short compliance note…"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Disclosures: image (optional)</label>
                  <p className="mt-1 text-xs text-slate-500">Upload a pre-made disclosure graphic if you use one. It is scaled to fit the email width (up to 480px).</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      ref={disclosuresFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadAdvisorSignatureAsset("disclosures", f);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-none"
                      disabled={disclosuresImageUploadBusy}
                      onClick={() => disclosuresFileInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" aria-hidden />
                      {disclosuresImageUploadBusy ? "Uploading…" : "Upload disclosure image"}
                    </Button>
                    {signatureDisclosuresImageUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="rounded-none text-slate-600"
                        onClick={() => setSignatureDisclosuresImageUrl("")}
                      >
                        Remove image
                      </Button>
                    ) : null}
                  </div>
                  {signatureDisclosuresImageUrl ? (
                    <img
                      src={signatureDisclosuresImageUrl}
                      alt="Disclosures"
                      className="mt-3 h-auto w-full max-w-lg border border-slate-100 object-contain"
                    />
                  ) : null}
                </div>
              </div>

              {signatureAssetErr ? (
                <p className="text-sm text-red-700" role="alert">
                  {signatureAssetErr}
                </p>
              ) : null}

              <div className="rounded-none border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-700">Signature preview</p>
                <pre className="mt-3 whitespace-pre-wrap rounded-none bg-white p-4 text-sm leading-6 text-slate-700">
                  {composeEmailSignature() || "Your signature preview will appear here."}
                </pre>
                {(signatureLogoUrl || signatureDisclosuresText.trim() || signatureDisclosuresImageUrl) && (
                  <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">How it appears in HTML email</p>
                    {signatureLogoUrl ? (
                      <img src={signatureLogoUrl} alt="" className="h-auto max-h-20 w-auto max-w-[220px] object-contain" />
                    ) : null}
                    {signatureDisclosuresText.trim() ? (
                      <p className="text-[11px] leading-snug text-slate-600">{signatureDisclosuresText.trim()}</p>
                    ) : null}
                    {signatureDisclosuresImageUrl ? (
                      <img
                        src={signatureDisclosuresImageUrl}
                        alt="Disclosures"
                        className="h-auto w-full max-w-lg object-contain"
                      />
                    ) : null}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button className="rounded-none ap-cta-solid" onClick={saveAdvisorProfile}>
                  Save Signature
                </Button>

                <Button variant="outline" className="rounded-none" onClick={() => setShowSignatureSetup(false)}>
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
        {step === "intake" && intakeStep === 0 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[0].eyebrow} title={INTAKE_STEPS[0].title} helper={INTAKE_STEPS[0].helper} onBack={backIntake} backDisabled onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div className="space-y-4">
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <div>
      <label className="text-sm font-semibold text-slate-700">First name</label>
      <Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.firstName} onChange={(e) => setClient({ ...client, firstName: e.target.value })} placeholder="Jane" autoFocus />
    </div>
    <div>
      <label className="text-sm font-semibold text-slate-700">Last name</label>
      <Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.lastName} onChange={(e) => setClient({ ...client, lastName: e.target.value })} placeholder="Smith" />
    </div>
  </div>
  <div>
    <label className="text-sm font-semibold text-slate-700">Client email</label>
    <Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="email" value={client.advisorEmail} onChange={(e) => setClient({ ...client, advisorEmail: e.target.value })} placeholder="client@email.com" />
  </div>
  <div className="flex items-center justify-between gap-4 rounded-none border border-blue-100 bg-white px-4 py-3">
    <span className="text-sm font-semibold text-slate-700">Married?</span>
    <button
      type="button"
      role="switch"
      aria-checked={client.married}
      onClick={() =>
        setClient((c) =>
          c.married
            ? {
                ...c,
                married: false,
                spouseFirstName: "",
                spouseLastName: "",
                spouseDob: "",
                spouseAge: "",
                spouseRetirementAge: "",
                socialSecurityMonthlySpouse: "",
              }
            : { ...c, married: true }
        )
      }
      className={`relative h-8 w-14 shrink-0 rounded-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-sky-500 ${client.married ? "bg-sky-500" : "bg-slate-200"}`}
    >
      <span className={`absolute top-1 left-1 block h-6 w-6 rounded-none bg-white shadow transition-transform ${client.married ? "translate-x-6" : "translate-x-0"}`} />
    </button>
  </div>
  {client.married ? (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <label className="text-sm font-semibold text-slate-700">Spouse first name</label>
        <Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.spouseFirstName} onChange={(e) => setClient({ ...client, spouseFirstName: e.target.value })} placeholder="Alex" />
      </div>
      <div>
        <label className="text-sm font-semibold text-slate-700">Spouse last name</label>
        <Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.spouseLastName} onChange={(e) => setClient({ ...client, spouseLastName: e.target.value })} placeholder="Smith" />
      </div>
    </div>
  ) : null}
</div></IntakeShell>}
        {step === "intake" && intakeStep === 1 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[1].eyebrow} title={INTAKE_STEPS[1].title} helper={INTAKE_STEPS[1].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div className="space-y-6"><div><p className="text-sm font-semibold text-slate-800">Client</p><div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className="text-sm font-semibold text-slate-700">Date of birth</label><Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="date" value={client.dob} onChange={(e) => {
  const dob = e.target.value;
  const calculatedAge = getAgeFromDob(dob);
  setClient({
    ...client,
    dob,
    age: calculatedAge !== null ? String(calculatedAge) : client.age,
  });
}} /></div><div><label className="text-sm font-semibold text-slate-700">Or age</label><Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="number" value={client.age} onChange={(e) => setClient({ ...client, age: e.target.value })} placeholder="62" /></div></div></div>{client.married ? (<div><p className="text-sm font-semibold text-slate-800">Spouse</p><div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className="text-sm font-semibold text-slate-700">Date of birth</label><Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="date" value={client.spouseDob} onChange={(e) => {
  const spouseDob = e.target.value;
  const calculatedAge = getAgeFromDob(spouseDob);
  setClient({
    ...client,
    spouseDob,
    spouseAge: calculatedAge !== null ? String(calculatedAge) : client.spouseAge,
  });
}} /></div><div><label className="text-sm font-semibold text-slate-700">Or age</label><Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="number" value={client.spouseAge} onChange={(e) => setClient({ ...client, spouseAge: e.target.value })} placeholder="60" /></div></div></div>) : null}</div></IntakeShell>}
        {step === "intake" && intakeStep === 2 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[2].eyebrow} title={INTAKE_STEPS[2].title} helper={INTAKE_STEPS[2].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div><label className="text-sm font-semibold text-slate-700">Adjusted Gross Income (AGI), most recent federal return</label><div className="mt-2 flex h-14 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-4 text-lg font-medium text-slate-600">$</span><Input className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 text-lg shadow-none focus-visible:ring-0" type="text" inputMode="decimal" value={client.adjustedGrossIncomeAnnual} onChange={(e) => setClient({ ...client, adjustedGrossIncomeAnnual: e.target.value })} placeholder="165432" /></div><p className="mt-2 text-sm text-slate-500">Use Form 1040 AGI for the latest filed year, for illustration only, not a tax determination.</p></div></IntakeShell>}
        {step === "intake" && intakeStep === 3 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[3].eyebrow} title={INTAKE_STEPS[3].title} helper={INTAKE_STEPS[3].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div><label className="text-sm font-semibold text-slate-700">Marginal federal tax bracket</label><Select value={FEDERAL_TAX_BRACKET_IDS.includes(client.federalTaxBracket as (typeof FEDERAL_TAX_BRACKET_IDS)[number]) ? client.federalTaxBracket : "22"} onValueChange={(value) => setClient({ ...client, federalTaxBracket: value })}><SelectTrigger className="mt-2 h-14 rounded-none"><SelectValue /></SelectTrigger><SelectContent>{FEDERAL_TAX_BRACKET_IDS.map((id) => <SelectItem key={id} value={id}>{id}% bracket</SelectItem>)}</SelectContent></Select><p className="mt-2 text-sm text-slate-500">Used for illustrative tax math in reports (not a tax determination).</p></div></IntakeShell>}
        {step === "intake" && intakeStep === 4 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[4].eyebrow} title={INTAKE_STEPS[4].title} helper={INTAKE_STEPS[4].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div className="space-y-4"><div><label className="text-sm font-semibold text-slate-700">Expected retirement age (client)</label><Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="number" value={client.retirementAge} onChange={(e) => setClient({ ...client, retirementAge: e.target.value })} placeholder="67" /></div>{client.married ? (<div><label className="text-sm font-semibold text-slate-700">Expected retirement age (spouse)</label><Input className="mt-2 h-14 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" type="number" value={client.spouseRetirementAge} onChange={(e) => setClient({ ...client, spouseRetirementAge: e.target.value })} placeholder="67" /></div>) : null}</div></IntakeShell>}
        {step === "intake" && intakeStep === 5 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[5].eyebrow} title={INTAKE_STEPS[5].title} helper={INTAKE_STEPS[5].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div><label className="text-sm font-semibold text-slate-700">Annual spendable income in retirement</label><div className="mt-2 flex h-14 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-4 text-lg font-medium text-slate-600">$</span><Input className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 text-lg shadow-none focus-visible:ring-0" type="text" inputMode="decimal" value={client.retirementSpendableIncomeAnnual} onChange={(e) => setClient({ ...client, retirementSpendableIncomeAnnual: e.target.value })} placeholder="85000" /></div></div></IntakeShell>}
        {step === "intake" && intakeStep === 6 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[6].eyebrow} title={INTAKE_STEPS[6].title} helper={INTAKE_STEPS[6].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div className="space-y-4"><div className="flex items-center justify-between gap-4 rounded-none border border-blue-100 bg-white px-4 py-3"><span className="text-sm font-semibold text-slate-700">Taking Social Security?</span><button type="button" role="switch" aria-checked={client.takingSocialSecurity} onClick={() => setClient((c) => (c.takingSocialSecurity ? { ...c, takingSocialSecurity: false, socialSecurityMonthlyClient: "", socialSecurityMonthlySpouse: "" } : { ...c, takingSocialSecurity: true }))} className={`relative h-8 w-14 shrink-0 rounded-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-sky-500 ${client.takingSocialSecurity ? "bg-sky-500" : "bg-slate-200"}`}><span className={`absolute top-1 left-1 block h-6 w-6 rounded-none bg-white shadow transition-transform ${client.takingSocialSecurity ? "translate-x-6" : "translate-x-0"}`} /></button></div>{client.takingSocialSecurity ? (<div className="space-y-4">{client.married ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className="text-sm font-semibold text-slate-700">Client monthly amount</label><div className="mt-2 flex h-14 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-4 text-lg font-medium text-slate-600">$</span><Input className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 text-lg shadow-none focus-visible:ring-0" type="text" inputMode="decimal" value={client.socialSecurityMonthlyClient} onChange={(e) => setClient({ ...client, socialSecurityMonthlyClient: e.target.value })} placeholder="2400" /></div></div><div><label className="text-sm font-semibold text-slate-700">Spouse monthly amount</label><div className="mt-2 flex h-14 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-4 text-lg font-medium text-slate-600">$</span><Input className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 text-lg shadow-none focus-visible:ring-0" type="text" inputMode="decimal" value={client.socialSecurityMonthlySpouse} onChange={(e) => setClient({ ...client, socialSecurityMonthlySpouse: e.target.value })} placeholder="1800" /></div></div></div> : <div><label className="text-sm font-semibold text-slate-700">Monthly Social Security amount</label><div className="mt-2 flex h-14 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-4 text-lg font-medium text-slate-600">$</span><Input className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 text-lg shadow-none focus-visible:ring-0" type="text" inputMode="decimal" value={client.socialSecurityMonthlyClient} onChange={(e) => setClient({ ...client, socialSecurityMonthlyClient: e.target.value })} placeholder="2400" /></div></div>}</div>) : <p className="text-sm text-slate-500">Leave this off if the household is not receiving benefits yet. You can continue without entering amounts.</p>}</div></IntakeShell>}
        {step === "intake" && intakeStep === 7 && (
          <IntakeShell
            portfolioStepCurrent={intakeStep + 1}
            portfolioStepTotal={INTAKE_STEP_COUNT}
            progress={progress}
            eyebrow={INTAKE_STEPS[7].eyebrow}
            title={INTAKE_STEPS[7].title}
            helper={INTAKE_STEPS[7].helper}
            onBack={backIntake}
            onNext={nextIntake}
            nextDisabled={intakeContinueDisabled}
            footerCenter={liveIntakeFooter}
          >
            {client.riskIntakeScreen === "gate" ? (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-slate-800">
                  Does the client already have a stated risk profile (for example from your firm questionnaire, an IPS, or prior onboarding)?
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() =>
                      setClient((c) => ({
                        ...c,
                        riskIntakeKnown: "yes",
                        riskIntakeScreen: "known",
                        riskQuizAnswers: {},
                        riskQuizStepIndex: 0,
                        riskProfileSuggested: "",
                      }))
                    }
                    className="rounded-none border border-slate-200 bg-white p-4 text-left font-semibold transition hover:bg-sky-50"
                  >
                    Yes: we know their profile
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setClient((c) => ({
                        ...c,
                        riskIntakeKnown: "no",
                        riskIntakeScreen: "quiz",
                        riskQuizAnswers: {},
                        riskQuizStepIndex: 0,
                        riskProfileSuggested: "",
                      }))
                    }
                    className="rounded-none border border-slate-200 bg-white p-4 text-left font-semibold transition hover:bg-sky-50"
                  >
                    No: use the short assessment
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  The assessment is illustrative for discussion in AdvisorPilot, not a replacement for your firm&apos;s full risk-tolerance process.
                </p>
              </div>
            ) : null}
            {client.riskIntakeScreen === "known" ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {RISK_PROFILE_DESCRIPTORS.map((tier) => {
                  const sel = client.riskProfile === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => setClient((c) => ({ ...c, riskProfile: tier.id }))}
                      className={`rounded-none border p-4 text-left transition ${
                        sel
                          ? "ap-choice-selected shadow-lg"
                          : "border-slate-200 bg-white hover:bg-sky-50"
                      }`}
                    >
                      <div className="font-semibold">{tier.label}</div>
                      <div className={`mt-1 text-sm ${sel ? "text-blue-100" : "text-slate-600"}`}>{tier.shortDescriptor}</div>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {client.riskIntakeScreen === "quiz"
              ? (() => {
                  const q = RISK_QUIZ_QUESTIONS[client.riskQuizStepIndex];
                  if (!q) return null;
                  return (
                    <div className="space-y-4">
                      <p className="text-xs font-medium text-slate-500">
                        Assessment {client.riskQuizStepIndex + 1} of {RISK_QUIZ_LENGTH}
                      </p>
                      <p className="text-sm font-semibold text-slate-800">{q.prompt}</p>
                      <div className="grid grid-cols-1 gap-2">
                        {q.options.map((opt, optIdx) => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() =>
                              setClient((c) => {
                                const answers = { ...c.riskQuizAnswers, [q.id]: optIdx };
                                const i = c.riskQuizStepIndex;
                                if (i >= RISK_QUIZ_LENGTH - 1) {
                                  const { profile } = computeRiskProfileFromQuiz(answers);
                                  return {
                                    ...c,
                                    riskQuizAnswers: answers,
                                    riskIntakeScreen: "result",
                                    riskProfileSuggested: profile,
                                    riskProfile: profile,
                                    riskQuizStepIndex: 0,
                                  };
                                }
                                return { ...c, riskQuizAnswers: answers, riskQuizStepIndex: i + 1 };
                              })
                            }
                            className="rounded-none border border-slate-200 bg-white px-4 py-3 text-left text-sm transition hover:border-sky-300 hover:bg-sky-50"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()
              : null}
            {client.riskIntakeScreen === "result"
              ? (() => {
                  const { profile: suggested, capNotes } = computeRiskProfileFromQuiz(client.riskQuizAnswers);
                  const sugLabel = RISK_PROFILE_DESCRIPTORS.find((t) => t.id === suggested)?.label ?? suggested;
                  return (
                    <div className="space-y-4">
                      <div className="rounded-none border border-blue-100 bg-blue-50/50 p-4">
                        <p className="text-sm font-semibold text-slate-800">Suggested profile</p>
                        <p className="mt-1 text-lg font-semibold text-slate-900">{sugLabel}</p>
                        {capNotes.length > 0 ? (
                          <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
                            {capNotes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        ) : null}
                        <p className="mt-2 text-xs text-slate-500">
                          You can accept this or pick a different tier if your judgment differs.
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-slate-800">Select profile for this review</p>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {RISK_PROFILES.map((id) => {
                          const meta = RISK_PROFILE_DESCRIPTORS.find((t) => t.id === id)!;
                          const sel = client.riskProfile === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setClient((c) => ({ ...c, riskProfile: id }))}
                              className={`rounded-none border p-4 text-left transition ${
                                sel
                                  ? "ap-choice-selected shadow-lg"
                                  : "border-slate-200 bg-white hover:bg-sky-50"
                              }`}
                            >
                              <div className="font-semibold">{meta.label}</div>
                              <div className={`mt-1 text-sm ${sel ? "text-blue-100" : "text-slate-600"}`}>
                                {meta.shortDescriptor}
                              </div>
                              {client.riskProfileSuggested === id ? (
                                <div className={`mt-1 text-xs ${sel ? "text-blue-200" : "text-sky-700"}`}>
                                  Matches quick assessment
                                </div>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              : null}
          </IntakeShell>
        )}
        {step === "intake" && intakeStep === 8 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[8].eyebrow} title={INTAKE_STEPS[8].title} helper={INTAKE_STEPS[8].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><div className="grid grid-cols-1 gap-3">{[["risk-profile", "Use stated risk profile", "Best default for advisor-reviewed recommendations."], ["age-default", "Run default based on age", "Uses age only; ignores the tier from Question 8. Consider if you want a pure age glidepath."], ["income-goal", "Retirement income goal", "Best for near-retirees who need income and lower volatility."], ["custom", "Custom advisor model", "Use your own allocation model later."]].map(([value, title, desc]) => <button key={value} onClick={() => setClient({ ...client, calibration: value })} className={`rounded-none border p-4 text-left transition ${client.calibration === value ? "ap-choice-selected shadow-lg" : "border-slate-200 bg-white hover:bg-sky-50"}`}><div className="font-semibold">{title}</div><div className={`mt-1 text-sm ${client.calibration === value ? "text-blue-100" : "text-slate-500"}`}>{desc}</div></button>)}</div></IntakeShell>}
        {step === "intake" && intakeStep === 9 && <IntakeShell portfolioStepCurrent={intakeStep + 1} portfolioStepTotal={INTAKE_STEP_COUNT} progress={progress} eyebrow={INTAKE_STEPS[9].eyebrow} title={INTAKE_STEPS[9].title} helper={INTAKE_STEPS[9].helper} onBack={backIntake} onNext={nextIntake} nextDisabled={intakeContinueDisabled} footerCenter={liveIntakeFooter}><Textarea className="min-h-40 rounded-none border-blue-100 bg-white text-lg focus-visible:ring-sky-500" value={client.goal} onChange={(e) => setClient({ ...client, goal: e.target.value })} placeholder="Example: Wants retirement income, less market risk, and tax-efficient withdrawals." /></IntakeShell>}

        {step === "upload" && (
          <Card className="rounded-none ap-glass border-0">
            <CardContent className="space-y-6 p-6 pb-28 md:p-8 md:pb-8">
              <div className="flex items-center gap-3"><div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none"><Upload className="h-6 w-6" /></div><div><h2 className="font-serif text-3xl font-bold">Statement Capture</h2><p className="text-sm text-slate-500">Queue one or many statement files, note which pages hold positions, then extract.</p></div></div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3"><MetricCard icon={<User className="h-5 w-5" />} label="Client" value={clientDisplayName(client) || "Unnamed"} helper={derivedAge ? `Age ${derivedAge}` : "Age not set"} /><MetricCard icon={<Target className="h-5 w-5" />} label="Risk profile" value={client.riskProfile.replace("-", " ")} helper="Used for calibration" /><MetricCard icon={<BriefcaseBusiness className="h-5 w-5" />} label="Retirement age" value={client.retirementAge || "N/A"} helper="Timeline input" /></div>
              <div
                id="upload-section-client-link"
                className="ap-callout rounded-none p-5 md:p-6 scroll-mt-24"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <p className="ap-eyebrow">Option A: Have the client upload</p>
                    <p className="font-serif text-xl font-semibold text-blue-950">Client upload link</p>
                    <p className="text-sm text-slate-600">
                      Your client opens this on their phone and uploads their statement. The file is extracted and saved as a <strong>Draft</strong> on <strong>your</strong> Client Database only, not another advisor&apos;s.
                    </p>
                    {magicLinkExpiresAt ? (
                      <p className="text-xs text-slate-500">
                        Link expires: {new Date(magicLinkExpiresAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    ) : null}
                    {magicLinkErr ? <p className="text-sm text-red-700">{magicLinkErr}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" className="h-11 rounded-none touch-manipulation" onClick={createClientUploadLink} disabled={magicLinkBusy}>
                        <Link2 className="mr-2 h-4 w-4" />
                        {magicLinkBusy ? "Creating…" : magicLinkUrl ? "New link" : "Create link"}
                      </Button>
                      {magicLinkUrl ? (
                        <Button type="button" className="h-11 rounded-none ap-cta-solid touch-manipulation" onClick={copyMagicLink}>
                          {magicLinkCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                          {magicLinkCopied ? "Copied" : "Copy link"}
                        </Button>
                      ) : null}
                    </div>
                    {magicLinkUrl ? (
                      <Input readOnly className="mt-2 h-11 rounded-none bg-white font-mono text-xs" value={magicLinkUrl} onFocus={(e) => e.target.select()} />
                    ) : null}
                  </div>
                  {magicLinkUrl ? (
                    <div className="flex shrink-0 flex-col items-center gap-2 rounded-none border border-slate-200 bg-white p-3">
                      <p className="text-xs font-medium text-slate-600">Optional QR (same link)</p>
                      <Image
                        alt=""
                        width={200}
                        height={200}
                        className="rounded-none"
                        src={`/api/qr?text=${encodeURIComponent(magicLinkUrl)}`}
                        unoptimized
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
                <p className="ap-eyebrow">Option B: Upload directly</p>
                <p className="text-sm text-slate-600">
                  Add one or more PDFs or images. Each picker <strong className="font-semibold text-slate-800">adds</strong> to the queue so you can upload statements in batches. Remove any row uploaded by mistake before extracting.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="cursor-pointer rounded-none border border-sky-200/60 bg-white/80 p-6 transition hover:-translate-y-1 hover:border-sky-400 hover:shadow-[0_18px_40px_-22px_rgba(14,165,233,0.45)] md:p-7"><div className="ap-icon-tile mb-4 inline-flex h-12 w-12 items-center justify-center rounded-none"><FileText className="h-6 w-6" /></div><h3 className="text-lg font-semibold">Upload emailed or texted statement</h3><p className="mb-4 text-sm text-slate-500">PDF, JPG, PNG, or screenshots—multi-select or use “Add more files” repeatedly.</p><input key={`stmt-q-pdf-${statementFileInputRevision}`} type="file" accept=".pdf,image/*" multiple className={ADVISOR_STATEMENT_FILE_INPUT_CLASS} onChange={(e) => { appendStatementFiles(e.currentTarget.files); e.currentTarget.value = ""; }} /></label>
                  <label className="cursor-pointer rounded-none border border-sky-200/60 bg-white/80 p-6 transition hover:-translate-y-1 hover:border-sky-400 hover:shadow-[0_18px_40px_-22px_rgba(14,165,233,0.45)] md:p-7"><div className="ap-icon-tile mb-4 inline-flex h-12 w-12 items-center justify-center rounded-none"><Camera className="h-6 w-6" /></div><h3 className="text-lg font-semibold">Take a picture on phone</h3><p className="mb-4 text-sm text-slate-500">Opens the camera on phones; you can still add more files afterward from this screen.</p><input key={`stmt-q-cam-${statementFileInputRevision}`} type="file" accept="image/*" capture="environment" multiple className={ADVISOR_STATEMENT_FILE_INPUT_CLASS} onChange={(e) => { appendStatementFiles(e.currentTarget.files); e.currentTarget.value = ""; }} /></label>
                </div>
              </div>
              {statementUploadQueue.length > 0 && (
                <div className="space-y-3 rounded-none border border-sky-200 bg-sky-50/70 p-4 md:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle className="h-4 w-4 shrink-0 text-sky-600" />
                    <span className="font-semibold text-blue-950">Queued files ({statementUploadQueue.length})</span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">
                    Please indicate which pages <strong className="font-semibold text-slate-800">specifically</strong> have
                    holdings on them for most accurate extraction (optional, 1-based page numbers). Examples:{" "}
                    <code className="rounded bg-white px-1 font-mono text-[0.8rem]">1-2</code>,{" "}
                    <code className="rounded bg-white px-1 font-mono text-[0.8rem]">1,3,5,9</code>, or{" "}
                    <code className="rounded bg-white px-1 font-mono text-[0.8rem]">1-3,5-6,10-11</code>. For{" "}
                    <strong className="font-semibold text-slate-800">PDFs</strong>, the server trims to those pages before
                    analysis. Leave blank to send the <strong className="font-semibold text-slate-800">whole</strong> file;{" "}
                    <strong className="font-semibold text-slate-800">images</strong> are not trimmed.
                  </p>
                  <ul className="space-y-3">
                    {statementUploadQueue.map((item, idx) => (
                      <li
                        key={item.id}
                        className="flex flex-col gap-3 rounded-none border border-sky-100/80 bg-white/90 p-3 md:flex-row md:items-end md:gap-4"
                      >
                        <div className="min-w-0 flex-1 md:max-w-[200px]">
                          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">File {idx + 1}</p>
                          <p className="truncate text-sm font-medium text-slate-900" title={item.file.name}>
                            {item.file.name}
                          </p>
                          <p className="text-xs tabular-nums text-slate-500">
                            {item.file.size >= 1024 * 1024
                              ? `${(item.file.size / (1024 * 1024)).toFixed(1)} MB`
                              : `${Math.max(1, Math.round(item.file.size / 1024))} KB`}
                          </p>
                        </div>
                        <div className="min-w-0 flex-[1.5]">
                          <label className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500" htmlFor={`holdings-pages-${item.id}`}>
                            Pages with holdings
                          </label>
                          <Input
                            id={`holdings-pages-${item.id}`}
                            className="mt-1 h-10 rounded-none font-mono text-sm"
                            placeholder="e.g. 1-2 · 1,3,9 · 1-3,5-6,10-11"
                            value={item.holdingsPages}
                            onChange={(e) => setStatementHoldingsPages(item.id, e.target.value)}
                            autoComplete="off"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 shrink-0 rounded-none border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 md:min-w-[7rem]"
                          onClick={() => removeStatementFile(item.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="rounded-none border border-blue-100 bg-blue-50/80 p-5 text-sm text-blue-950"><Wand2 className="mb-2 h-5 w-5" />Extraction sends your queued file(s) to AI and builds a combined holdings table for you to confirm. Expect roughly <strong>20–60 seconds</strong> on a typical connection; large PDFs or slow Wi‑Fi can take longer.</div>
              {extractError && <div className="rounded-none border border-red-200 bg-red-50 p-5 text-sm text-red-800">{extractError}</div>}
              {isExtracting && (
                <p className="text-sm font-medium text-slate-700" aria-live="polite">
                  {EXTRACT_PROGRESS_MESSAGES[extractProgressIndex % EXTRACT_PROGRESS_MESSAGES.length]}
                </p>
              )}
              <div className="hidden items-center gap-3 border-t border-sky-100/60 pt-5 md:flex">
                <Button variant="outline" className="h-12 rounded-none px-5" onClick={() => setStep("intake")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>
                <Button className="ml-auto h-12 rounded-none ap-cta-solid px-6" onClick={handleExtractHoldings} disabled={isExtracting}>{isExtracting ? EXTRACT_PROGRESS_MESSAGES[extractProgressIndex % EXTRACT_PROGRESS_MESSAGES.length] : "Extract holdings"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
              <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-sky-200/50 bg-white/85 p-4 shadow-[0_-8px_32px_rgba(15,58,122,0.12)] backdrop-blur-xl md:hidden">
                <div className="mx-auto flex max-w-3xl gap-3">
                  <Button variant="outline" className="h-14 flex-1 rounded-none touch-manipulation" onClick={() => setStep("intake")}>Back</Button>
                  <Button className="h-14 flex-[2] rounded-none ap-cta-solid touch-manipulation" onClick={handleExtractHoldings} disabled={isExtracting}>{isExtracting ? EXTRACT_PROGRESS_MESSAGES[extractProgressIndex % EXTRACT_PROGRESS_MESSAGES.length] : "Extract holdings"}</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "confirm" && (
          <Card className="rounded-none ap-glass border-0">
            <CardContent className="space-y-6 p-6 pb-28 md:p-8 md:pb-8">
              <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none"><ShieldCheck className="h-6 w-6" /></div><div><h2 className="font-serif text-3xl font-bold">Confirm Holdings</h2><p className="text-sm text-slate-500">Review matches, choose alternate matches, enter manual tickers, and select asset classes.</p><p className="mt-1 max-w-2xl text-xs text-slate-500">Broker cash and sweep lines without a visible ticker are labeled <code className="rounded bg-slate-100 px-1 font-mono text-[0.85rem]">{SYNTHETIC_CASH_TICKER}</code> (placeholder, not listed). Allocation uses the cash sleeve; scenario models use a Treasury-bill–style proxy for cash returns.</p></div></div><Badge className={`rounded-none ${reviewCount ? "bg-red-600" : "bg-emerald-600"}`}>{reviewCount} need review</Badge></div>
              {!demoMode && !String(session?.user?.email || emailAuthUser?.email || "").trim() && (
                <p className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Sign in to auto-save this confirmation as a <strong>Draft</strong> in your Client Database (helps if the tab closes mid-meeting).</p>
              )}
              {!demoMode && String(session?.user?.email || emailAuthUser?.email || "").trim() && draftAutosaveStatus !== "idle" && (
                <p className="text-xs text-slate-500" aria-live="polite">
                  {draftAutosaveStatus === "saving" && "Saving draft…"}
                  {draftAutosaveStatus === "saved" && "Draft saved."}
                  {draftAutosaveStatus === "error" && "Could not save draft. Check your connection and try editing again."}
                </p>
              )}
              {!demoMode && reviewCount > 0 && (
                <div className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                  Clear every row that still needs review before running the deep analysis ({reviewCount} remaining). This keeps AI output aligned with what you&apos;ve verified in the room.
                </div>
              )}
              {!demoMode && reviewCount > 0 && (
                <div className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Rows still marked for advisor review keep the Qualified / Roth / Taxable tint and gain a{" "}
                  <strong className="font-semibold">red outline</strong> until you correct the match, enter a manual identifier,
                  or use <strong className="font-semibold">Confirm Holding</strong>.
                </div>
              )}
              <div className="rounded-none border border-slate-200 bg-slate-50/90 p-5">
                <p className="text-sm font-semibold text-slate-900">Accounts & tax registration</p>
                <p className="mt-1 text-xs text-slate-600">
                  AI tags qualified (tax-deferred), Roth IRA, or taxable wrappers from statement headers. Tune each holding. Roth worksheets only sweep qualified balances ({currency(registrationTotals.traditionalQualifiedValue)} detected so far).
                </p>
                <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-none border border-emerald-200 bg-emerald-50/40 px-3 py-2">
                    <dt className="text-xs text-emerald-900/80">Qualified</dt>
                    <dd className="text-lg font-semibold tabular-nums text-emerald-950">{currency(registrationTotals.traditionalQualifiedValue)}</dd>
                  </div>
                  <div className="rounded-none border border-blue-200 bg-blue-50/40 px-3 py-2">
                    <dt className="text-xs text-blue-900/80">Non-qualified taxable</dt>
                    <dd className="text-lg font-semibold tabular-nums text-blue-950">{currency(registrationTotals.nonQualifiedValue)}</dd>
                  </div>
                  <div className="rounded-none border border-purple-200 bg-purple-50/40 px-3 py-2">
                    <dt className="text-xs text-purple-900/80">Roth IRA</dt>
                    <dd className="text-lg font-semibold tabular-nums text-purple-950">{currency(registrationTotals.rothValue)}</dd>
                  </div>
                  <div className="rounded-none border border-slate-200 bg-white px-3 py-2">
                    <dt className="text-xs text-slate-500">Unknown wrapper</dt>
                    <dd className="text-lg font-semibold tabular-nums text-slate-900">{currency(registrationTotals.unknownValue)}</dd>
                  </div>
                </dl>
                {accountRollups.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="mt-2 w-full min-w-[520px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="pb-2 pr-3 font-medium">Detected account grouping</th>
                          <th className="pb-2 pr-3 font-medium">Ending balance</th>
                          <th className="pb-2 font-medium">Bulk registration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountRollups.map((row) => {
                          const label =
                            row.accountNumber.trim() ||
                            (row.sourceFileIndex != null ? `Statement upload #${row.sourceFileIndex}` : "Same statement (no explicit account)");
                          const selectValue =
                            row.dominantRegistration === "mixed" ? "unknown" : row.dominantRegistration;
                          return (
                            <tr key={row.key} className="border-b border-slate-100 align-middle last:border-none">
                              <td className="py-3 pr-3">
                                <p className="font-medium text-slate-900">{label}</p>
                                {row.dominantRegistration === "mixed" && (
                                  <p className="text-xs text-amber-700">Mixed classifications: align all rows inside this grouping.</p>
                                )}
                              </td>
                              <td className="py-3 pr-3 tabular-nums font-semibold">{currency(row.totalValue)}</td>
                              <td className="py-3">
                                <Select
                                  value={selectValue}
                                  onValueChange={(value) =>
                                    applyRegistrationForAccountKey(row.key, normalizeRegistrationType(value))
                                  }
                                >
                                  <SelectTrigger className="w-full max-w-xs rounded-none">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {REGISTRATION_BUCKET_VALUES.map((r) => (
                                      <SelectItem key={r} value={r}>
                                        {registrationLabel(r)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
              <div className="space-y-5">
                {holdings.map((h, index) => {
                  const needsAdvisorReview = holdingAdvisorReviewBlocking(h);
                  const opts = normalizeOptions(h, needsAdvisorReview);
                  const regBucket = normalizeRegistrationType(h.registrationType);
                  return (
                    <div
                      key={`${h.rawName}-${index}`}
                      className={confirmHoldingRegistrationSurfaceClasses(h.registrationType, needsAdvisorReview)}
                    >
                      <div className="px-5 pt-5 pb-4">
                        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
                          <div className="lg:col-span-3">
                            <div className="flex gap-3">
                              <div className="flex w-9 shrink-0 flex-col items-center gap-1.5">
                                <div
                                  className="flex h-9 w-9 items-center justify-center rounded-sm border border-slate-200/90 bg-slate-50 text-[0.7rem] font-bold tabular-nums text-slate-600"
                                  aria-hidden
                                >
                                  {index + 1}
                                </div>
                                <button
                                  type="button"
                                  disabled={holdings.length <= 1}
                                  className="flex h-8 w-9 items-center justify-center rounded-sm border border-red-200/90 bg-white text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:pointer-events-none disabled:opacity-35"
                                  aria-label={`Remove holding row ${index + 1}`}
                                  title={
                                    holdings.length <= 1
                                      ? "At least one holding is required"
                                      : "Remove this holding (e.g. duplicate line)"
                                  }
                                  onClick={() => removeHoldingAt(index)}
                                >
                                  <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                                </button>
                              </div>
                              <div className="min-w-0 flex-1 space-y-2">
                                <p className={HOLDING_FIELD_LABEL_CLASS}>Statement position</p>
                                <p className="font-serif text-base font-semibold leading-snug text-slate-900">{h.rawName}</p>
                                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                  <Badge
                                    variant="outline"
                                    className={`h-6 max-w-full rounded-sm border px-2 py-0 text-xs font-semibold leading-none ${confirmHoldingRegistrationBadgeClasses(h.registrationType)}`}
                                  >
                                    {registrationLabel(regBucket)}
                                  </Badge>
                                  {needsAdvisorReview ? (
                                    <Badge
                                      variant="outline"
                                      className="h-6 rounded-sm border border-red-200 bg-red-50/90 px-2 py-0 text-xs font-semibold text-red-900"
                                    >
                                      Needs review
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className={`${HOLDING_FIELD_LABEL_CLASS} mt-3`}>Market value</p>
                                <p className="text-sm font-semibold tabular-nums text-slate-900">{currency(h.value)}</p>
                              </div>
                            </div>
                          </div>
                          <div className="lg:col-span-4 space-y-2">
                            <p className={HOLDING_FIELD_LABEL_CLASS}>Security / match</p>
                            <Select
                              value={h.suggested}
                              onValueChange={(value) =>
                                updateHolding(index, {
                                  suggested: value,
                                  confirmedMatchOverridesReview: false,
                                  status: value.includes("Manual") ? "review" : "confirmed",
                                  confidence: value.includes("Manual")
                                    ? Math.min(h.confidence, 74)
                                    : Math.max(h.confidence, 85),
                                })
                              }
                            >
                              <SelectTrigger className={HOLDING_SELECT_TRIGGER_CLASS}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {opts.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {formatMatchedHoldingOptionLabel(option)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="lg:col-span-3 space-y-2">
                            <p className={HOLDING_FIELD_LABEL_CLASS}>Asset class</p>
                            <Select
                              value={isCanonicalAssetClass(h.assetClass) ? h.assetClass : "Unknown"}
                              onValueChange={(value) => updateHolding(index, { assetClass: value })}
                            >
                              <SelectTrigger className={HOLDING_SELECT_TRIGGER_CLASS}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ASSET_CLASSES.map((asset) => (
                                  <SelectItem key={asset} value={asset}>
                                    {asset}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="lg:col-span-2">
                            <div className="rounded-sm border border-slate-200/80 bg-white/70 p-3 shadow-sm">
                              <p className={HOLDING_FIELD_LABEL_CLASS}>Match confidence</p>
                              <Progress value={h.confidence} className="my-2.5 h-2" />
                              <div className="flex items-center gap-2">
                                {h.confidence >= 75 ? (
                                  <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                                )}
                                <span className="text-sm font-semibold tabular-nums text-slate-900">{h.confidence}%</span>
                              </div>
                              {h.masterResolvedNote ? (
                                <p className="mt-2.5 text-[11px] font-medium leading-snug text-emerald-900">{h.masterResolvedNote}</p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        className={`space-y-4 px-5 py-4 ${confirmHoldingFooterStripClass(h.registrationType, needsAdvisorReview)}`}
                      >
                        {needsAdvisorReview ? (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 w-full shrink-0 rounded-sm border-emerald-400/70 bg-white px-4 text-sm font-semibold text-emerald-950 shadow-sm hover:bg-emerald-50/80 sm:w-auto"
                              onClick={() => updateHolding(index, { confirmedMatchOverridesReview: true })}
                            >
                              Confirm Holding
                            </Button>
                          </div>
                        ) : null}
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                          <div className="space-y-2">
                            <p className={HOLDING_FIELD_LABEL_CLASS}>Account # (custodian)</p>
                            <Input
                              key={`acct-${index}-${h.accountNumber ?? ""}`}
                              className={HOLDING_INPUT_CLASS}
                              placeholder="Masked / last digits"
                              defaultValue={h.accountNumber ?? ""}
                              onBlur={(e) => updateHolding(index, { accountNumber: e.target.value.trim() || undefined })}
                            />
                          </div>
                          <div className="space-y-2">
                            <p className={HOLDING_FIELD_LABEL_CLASS}>Registration</p>
                            <Select
                              value={regBucket}
                              onValueChange={(value) => updateHolding(index, { registrationType: value as RegistrationBucket })}
                            >
                              <SelectTrigger className={HOLDING_SELECT_TRIGGER_CLASS}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {REGISTRATION_BUCKET_VALUES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {registrationLabel(r)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <p className={HOLDING_FIELD_LABEL_CLASS}>Cost basis (if shown)</p>
                            <Input
                              key={`basis-${index}-${h.costBasis ?? ""}`}
                              className={HOLDING_INPUT_CLASS}
                              type="number"
                              placeholder="Taxable positions"
                              defaultValue={h.costBasis != null ? String(h.costBasis) : ""}
                              onBlur={(e) => {
                                if (e.target.value === "") {
                                  updateHolding(index, { costBasis: undefined });
                                  return;
                                }
                                const v = Number(e.target.value);
                                if (!Number.isNaN(v)) updateHolding(index, { costBasis: v > 0 ? v : undefined });
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      {(h.suggested.includes("Manual") || h.status === "review") && (
                        <div className="border-t border-slate-200/80 bg-white/50 px-5 py-4">
                          <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Manual resolution
                          </p>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <p className={HOLDING_FIELD_LABEL_CLASS}>Ticker / CUSIP / corrected name</p>
                              <Input
                                className={HOLDING_INPUT_CLASS}
                                placeholder="Example: PIMIX or 912828XXXXX"
                                onBlur={(e) => {
                                  if (e.target.value.trim())
                                    updateHolding(index, {
                                      suggested: e.target.value.trim(),
                                      status: "confirmed",
                                      confidence: 85,
                                      confirmedMatchOverridesReview: false,
                                    });
                                }}
                              />
                            </div>
                            <div className="space-y-2">
                              <p className={HOLDING_FIELD_LABEL_CLASS}>Value override</p>
                              <Input
                                className={HOLDING_INPUT_CLASS}
                                type="number"
                                placeholder={String(h.value || 0)}
                                onBlur={(e) => {
                                  const v = Number(e.target.value);
                                  if (!Number.isNaN(v) && e.target.value !== "") updateHolding(index, { value: v });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="hidden items-end gap-3 border-t border-sky-100/60 pt-5 md:flex md:w-full">
                <Button variant="outline" className="h-12 shrink-0 rounded-none px-5" onClick={() => setStep("upload")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <div className="min-w-0 flex-1">{duplicateHoldingsAdvisorCheck}</div>
                <Button
                  className="h-12 shrink-0 rounded-none ap-cta-solid px-6"
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
                  {duplicateHoldingsAdvisorCheck ? (
                    <div className="max-h-[min(40vh,260px)] overflow-y-auto">{duplicateHoldingsAdvisorCheck}</div>
                  ) : null}
                  {isAnalyzing && (
                    <p className="text-center text-xs text-slate-600" aria-live="polite">
                      {ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length]} Usually 30–90s.
                    </p>
                  )}
                  <div className="flex gap-3">
                    <Button variant="outline" className="h-14 flex-1 rounded-none touch-manipulation" onClick={() => setStep("upload")} disabled={isAnalyzing}>Back</Button>
                    <Button
                      className="h-14 flex-[2] rounded-none ap-cta-solid touch-manipulation"
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
            <Card className="rounded-none ap-glass border-0"><CardContent className="space-y-6 p-6 pb-8 md:p-8"><div className="flex items-center gap-3"><div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none"><BarChart3 className="h-6 w-6" /></div><div><h2 className="font-serif text-3xl font-bold">Portfolio Review</h2><p className="text-sm text-slate-500">Advisor-facing analysis based on confirmed holdings and selected calibration.</p></div></div>{analysisError && <div className="rounded-none border border-red-200 bg-red-50 p-5 text-sm text-red-800">{analysisError}</div>}<div className="ap-callout rounded-none p-5 md:flex md:items-center md:justify-between md:gap-4"><div><p className="ap-eyebrow">Next up</p><p className="mt-1 font-serif text-xl font-semibold text-blue-950">Sit with the client</p><p className="mt-1 text-sm text-slate-600">Meeting Guide is the default path from here. PDFs and email are easiest as a wrap-up after the conversation.</p></div><Button className="mt-4 h-12 w-full rounded-none ap-cta-solid md:mt-0 md:w-auto md:shrink-0 md:px-8" onClick={() => setStep("meeting")}><MessageSquareText className="mr-2 h-4 w-4" />Start Meeting Guide<ArrowRight className="ml-2 h-4 w-4" /></Button></div><div className="grid grid-cols-1 gap-5 md:grid-cols-2"><ProfessionalDonutChart title="Current allocation" subtitle="Based on confirmed holdings" data={currentPie} /><ProfessionalDonutChart title="Proposed Allocation" subtitle="Age and risk-profile calibration" data={targetPie} /></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Portfolio Scores</h3><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><ScoreCard label="Risk Alignment" value={scores.riskAlignment} helper="How closely risk matches the proposed allocation" /><ScoreCard label="Diversification" value={scores.diversification} helper="Balance across major asset groups" /><ScoreCard label="Income Readiness" value={scores.incomeReadiness} helper="Support for retirement income stability" /></div></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Synopsis</h3><div className="rounded-none border bg-white p-5 text-sm leading-7 text-slate-700">{displaySynopsis}</div></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Hypothetical Allocation Stress</h3><p className="mb-4 text-sm text-slate-600"><strong className="font-semibold text-slate-800">Annualized geometric return (CAGR):</strong> each window chains the sleeve’s calendar-year % returns across 10 years, then applies the tenth root, not a straight sum or a cumulative decade total %. Static sleeve weights approximate annual rebalancing; illustrative only, not a forecast. Current mix weights each confirmed holding into equity (S&P calibration when no ticker history row), bonds (Bloomberg US Aggregate / AGG proxy), or cash / MM (annual-average Treasury-bill proxy); unclassified sleeves use a 50/50 equity/bond-index blend. The <strong className="font-semibold text-slate-800">biggest drawdown</strong> row is <strong className="font-semibold text-slate-800">2008 only</strong>, a single calendar-year blend using the −36.55% equity calibration alongside bond and cash proxies; not a multi-year CAGR.</p><div className="overflow-x-auto rounded-none border border-slate-200 bg-white"><table className="min-w-full text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50"><th className="px-4 py-3 text-left font-semibold text-slate-700">Stress window</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Current</th><th className="px-4 py-3 text-right font-semibold text-slate-700">Proposed</th></tr></thead><tbody>{portfolioStressScenarioRows.map(({ rowKey, title, subtitle, currentLabel, proposedLabel }) => (<tr key={rowKey} className="border-b border-slate-100 last:border-0"><td className="px-4 py-3 align-top"><p className="font-semibold text-slate-900">{title}</p><p className="text-xs text-slate-500">{subtitle}</p></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{currentLabel}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-blue-900">{proposedLabel}</td></tr>))}</tbody></table></div><p className="mt-3 text-xs leading-relaxed text-slate-500">Ticker-specific equity histories can be added in code later; untouched tickers still assume the firm’s S&P calibration in each year. Bond roles use the Aggregate proxy; cash/MM uses the T-bill average proxy. Proposed path is the same index sleeves at target weights. First three rows: one CAGR each (10-year windows), read as “≈ % per year.” Biggest drawdown: modeled 2008 calendar-year blend only, not averaged over years.</p></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Retirement Success Model</h3><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="rounded-none border border-slate-200 bg-white p-5"><p className="text-sm font-semibold text-slate-500">Current Allocation</p><p className="mt-2 text-4xl font-bold text-slate-950">{currentSuccessRate}<span className="text-lg text-slate-400">/100</span></p><p className="mt-1 text-sm text-slate-500">{successLabel(currentSuccessRate)} estimated success</p><Progress value={currentSuccessRate} className="mt-4" /></div><div className="rounded-none border border-sky-200 bg-sky-50/60 p-5"><p className="text-sm font-semibold text-blue-700">Proposed Allocation</p><p className="mt-2 text-4xl font-bold text-slate-950">{proposedSuccessRate}<span className="text-lg text-slate-400">/100</span></p><p className="mt-1 text-sm text-slate-500">{successLabel(proposedSuccessRate)} estimated success</p><Progress value={proposedSuccessRate} className="mt-4" /></div></div><ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">{retirementModelInsights.map((item) => <li key={item} className="rounded-none border border-emerald-100 bg-emerald-50/60 p-4 text-sm leading-6 text-slate-700">{item}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Portfolio Highlights</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-3">{displayPortfolioHighlights.slice(0, 3).map((item) => <li key={item} className="rounded-none border border-slate-200 bg-slate-50/60 p-4 text-sm leading-6 text-slate-700">{item}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold text-red-900">Advisor Red Flags</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayRedFlags.map((flag) => <li key={flag} className="rounded-none border border-red-200 bg-red-50/60 p-4 text-sm leading-6 text-slate-700">{flag}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold text-indigo-900">Overlap & Concentration Insights</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayOverlapInsights.map((insight) => <li key={insight} className="rounded-none border border-indigo-200 bg-indigo-50/60 p-4 text-sm leading-6 text-slate-700">{insight}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold text-emerald-900">What This Means for You</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayWhatThisMeans.map((item) => <li key={item} className="rounded-none border border-emerald-200 bg-emerald-50/60 p-4 text-sm leading-6 text-slate-700">{item}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Strategic Considerations</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayStrategies.map((idea) => <li key={idea} className="rounded-none border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-700">{idea}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Advisor Example Recommendations</h3><ul className="grid grid-cols-1 gap-3 md:grid-cols-2">{displayRecommendations.map((rec) => <li key={rec} className="rounded-none border border-amber-100 bg-amber-50/60 p-4 text-sm leading-6 text-slate-700">{rec}</li>)}</ul></div><div><h3 className="mb-3 font-serif text-2xl font-bold">Key findings</h3><ul className="space-y-2 text-sm">{findings.map((f) => <li key={f} className="rounded-none border bg-white p-4">{f}</li>)}</ul></div><div className="hidden border-t border-sky-100/60 pt-5 md:flex md:flex-wrap md:items-center md:gap-3"><Button variant="outline" className="h-12 rounded-none" onClick={() => setStep("confirm")}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button><Button variant="outline" className="h-12 rounded-none" onClick={runAIAnalysis} disabled={isAnalyzing || !canRunDeepAnalysis}><BrainCircuit className="mr-2 h-4 w-4" />{isAnalyzing ? ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length] : "Regenerate analysis"}</Button><Button className="h-12 rounded-none ap-cta-solid px-5 md:ml-auto" onClick={() => setStep("meeting")}><MessageSquareText className="mr-2 h-4 w-4" />Meeting Guide<ArrowRight className="ml-2 h-4 w-4" /></Button></div>{isAnalyzing && <p className="hidden text-sm text-slate-600 md:block" aria-live="polite">{ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length]} Often 30–90 seconds.</p>}</CardContent></Card>
          <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-sky-200/50 bg-white/85 p-4 shadow-[0_-8px_32px_rgba(15,58,122,0.12)] backdrop-blur-xl md:hidden">
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              {isAnalyzing && <p className="text-center text-xs text-slate-600" aria-live="polite">{ANALYSIS_PROGRESS_MESSAGES[analysisProgressIndex % ANALYSIS_PROGRESS_MESSAGES.length]}</p>}
              <Button className="h-14 w-full rounded-none ap-cta-solid touch-manipulation" onClick={() => setStep("meeting")}><MessageSquareText className="mr-2 h-4 w-4" />Meeting Guide</Button>
              <div className="flex gap-2">
                <Button variant="outline" className="h-12 flex-1 rounded-none text-sm touch-manipulation" onClick={() => setStep("confirm")}>Back</Button>
                <Button variant="outline" className="h-12 flex-1 rounded-none text-sm touch-manipulation" onClick={runAIAnalysis} disabled={isAnalyzing || !canRunDeepAnalysis}>Regenerate</Button>
              </div>
            </div>
          </div>
          </div>
        )}


        {step === "meeting" && (
          <Card className="rounded-none ap-glass border-0">
            <CardContent className="space-y-6 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none"><MessageSquareText className="h-6 w-6" /></div>
                  <div>
                    <h2 className="font-serif text-3xl font-bold">Meeting Guide</h2>
                    <p className="text-sm text-slate-500">A live advisor guide for walking through the analysis with the client.</p>
                  </div>
                </div>
                <Badge variant="outline" className="rounded-none border-blue-200 bg-blue-50 text-blue-800">Advisor-facing guide</Badge>
              </div>

              <div className="rounded-none border border-sky-100 bg-sky-50/60 p-5 leading-7 text-slate-700">
                <h3 className="mb-2 font-serif text-2xl font-bold text-slate-950">Opening Script</h3>
                <p>{analysis?.advisorOpeningScript || `Thanks for taking the time today. What I want to do is walk through how the portfolio is currently positioned, what risks or opportunities are showing up, and whether the current allocation still fits the retirement timeline, income goals, and comfort with market volatility.`}</p>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">Meeting Walkthrough</h3>
                <ol className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {meetingWalkthrough.map((item, index) => (
                    <li key={item} className="rounded-none border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-slate-700">
                      <span className="ap-icon-tile mb-2 inline-flex h-7 w-7 items-center justify-center rounded-none text-xs font-bold">{index + 1}</span>
                      <p>{item}</p>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-red-900">Key Items to Explain</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {displayRedFlags.slice(0, 4).map((flag) => <div key={flag} className="rounded-none border border-red-200 bg-red-50 p-4 text-sm leading-6 text-slate-700">{flag}</div>)}
                  {displayWhatThisMeans.slice(0, 2).map((item) => <div key={item} className="rounded-none border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-slate-700">{item}</div>)}
                </div>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">Ask These Questions</h3>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {meetingQuestions.map((question) => <li key={question} className="rounded-none border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">{question}</li>)}
                </ul>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">What to Listen For</h3>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {whatToListenFor.map((item) => <li key={item} className="rounded-none border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-slate-700">{item}</li>)}
                </ul>
              </div>

              <div>
                <h3 className="mb-3 font-serif text-2xl font-bold text-slate-950">Client Pushback Responses</h3>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {(analysis?.objectionHandling?.length ? analysis.objectionHandling : [
                    "If the client asks why reduce stocks now: The goal is not to abandon growth, but to reduce unnecessary concentration and make sure the risk still fits the retirement timeline.",
                    "If the client asks why add fixed: Holding more in fixed can help create more stability and may reduce the impact of market downturns as retirement approaches.",
                    "If the client wants to wait: Waiting is an option, but we should still stress-test whether the current portfolio could handle a meaningful downturn.",
                  ]).map((item) => <li key={item} className="rounded-none border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">{item}</li>)}
                </ul>
              </div>

              <div className="rounded-none border border-slate-200 bg-slate-50 p-5 leading-7 text-slate-700">
                <h3 className="mb-2 font-serif text-2xl font-bold text-slate-950">Closing Script</h3>
                <p>{closingScript}</p>
              </div>

              <div className="flex flex-col gap-3 border-t border-sky-100/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="outline" className="h-12 rounded-none touch-manipulation" onClick={() => setStep("analysis")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to analysis
                </Button>
                <p className="hidden text-center text-xs text-slate-500 sm:block">
                  After the conversation, optionally use the FIA calculator, Roth worksheet, Ret. Inc Calculator, then Wrap-up for the Client Snapshot PDF, Gmail send, and follow-up copy.
                </p>
                <Button className="h-12 rounded-none ap-cta-solid px-5 touch-manipulation" onClick={() => setStep("fia")}>
                  <Calculator className="mr-2 h-4 w-4" />
                  FIA calculator
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-slate-500 sm:hidden">
                After the meeting, optionally use the FIA, Roth, and Ret. Inc screens, then open Wrap-up for PDFs and email.
              </p>
            </CardContent>
          </Card>
        )}


        {step === "fia" && (
          <Card className="rounded-none ap-glass border-0">
            <CardContent className="space-y-8 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none border-teal-200 bg-teal-50">
                    <Calculator className="h-6 w-6 text-teal-900" />
                  </div>
                  <div>
                    <h2 className="font-serif text-3xl font-bold">Fixed indexed annuity — hypothetical calculator</h2>
                    <p className="text-sm text-slate-500">
                      Advisor-entered contract terms. Index history matches Hypothetical Allocation Stress (firm S&P 500 calendar-year calibration). Down years credit 0%; up years credit the index return capped as entered. Not a carrier illustration.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-none border border-slate-200 bg-slate-50/80 p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">From client profile</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</p>
                    <p className="mt-1 text-sm text-slate-800">{clientDisplayName(client) || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current age</p>
                    <p className="mt-1 text-sm text-slate-800">{derivedAge != null && Number.isFinite(derivedAge) ? derivedAge : client.age || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AGI (questionnaire)</p>
                    <p className="mt-1 text-sm text-slate-800">
                      {client.adjustedGrossIncomeAnnual ? currency(Number(String(client.adjustedGrossIncomeAnnual).replace(/[$,]/g, "")) || 0) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated retirement income (annual)</p>
                    <p className="mt-1 text-sm text-slate-800">
                      {client.retirementSpendableIncomeAnnual
                        ? currency(Number(String(client.retirementSpendableIncomeAnnual).replace(/[$,]/g, "")) || 0)
                        : "—"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-slate-600">
                  Qualified (traditional tax-deferred) holdings total ~{currency(registrationTotals.traditionalQualifiedValue)} ·
                  Non-qualified ~{currency(registrationTotals.nonQualifiedValue)} — used as premium defaults below when you pick a source.
                </p>
              </div>

              <div className="space-y-5 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-sm font-semibold text-slate-800">Premium & product</p>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:max-w-xl sm:flex-row sm:items-end sm:justify-end sm:gap-3">
                    <div className="w-full min-w-0 sm:min-w-[12rem] sm:flex-1 sm:max-w-md">
                      <label className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                        Saved template
                      </label>
                      <Select
                        value={fiaTemplatePickerValue}
                        onValueChange={(id) => {
                          setFiaTemplatePickerValue(id);
                          if (id === FIA_TEMPLATE_PICKER_NONE) return;
                          const row = savedFiaTemplates.find((t) => t.id === id);
                          if (!row) return;
                          setFiaPendingLoadTemplate(row);
                          setFiaTemplateLoadSpecConfirmOpen(true);
                          window.setTimeout(() => setFiaTemplatePickerValue(FIA_TEMPLATE_PICKER_NONE), 0);
                        }}
                        disabled={savedFiaTemplates.length === 0}
                      >
                        <SelectTrigger className="mt-1 h-10 rounded-none" aria-label="Load saved FIA product template">
                          <SelectValue
                            placeholder={
                              savedFiaTemplates.length === 0
                                ? "No saved templates — save one first"
                                : "Load saved template…"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FIA_TEMPLATE_PICKER_NONE}>— Select —</SelectItem>
                          {savedFiaTemplates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.displayName.length > 80 ? `${t.displayName.slice(0, 77)}…` : t.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 shrink-0 rounded-none border-slate-300 bg-white sm:self-end"
                    onClick={() => {
                      const c = fiaWorksheet.carrierName.trim();
                      const p = fiaWorksheet.productName.trim();
                      if (!c || !p) {
                        setFiaTemplateNotice({
                          variant: "error",
                          message: "Enter carrier and product name before saving a template.",
                        });
                        return;
                      }
                      setFiaTemplateNotice(null);
                      setFiaTemplateSaveOpen(true);
                    }}
                  >
                    <BookmarkPlus className="mr-2 h-4 w-4" aria-hidden />
                    Save product template
                  </Button>
                  </div>
                </div>
                {fiaTemplateNotice ? (
                  <div
                    role="status"
                    className={
                      fiaTemplateNotice.variant === "success"
                        ? "rounded-none border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
                        : "rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950"
                    }
                  >
                    {fiaTemplateNotice.message}
                  </div>
                ) : null}
                {fiaTemplateRemapTargetId ? (
                  <div
                    role="region"
                    aria-label="Update saved template"
                    className="rounded-none border border-amber-300 bg-amber-50/90 px-4 py-3 text-sm text-amber-950"
                  >
                    <p className="font-semibold">Remapping template specs</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-950/90 sm:text-sm">
                      Carrier and product name stay as saved. Re-enter bonuses, cap, withdrawal terms, and rider options
                      below, then update the stored template. Premium source and amounts are unchanged.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="h-10 rounded-none ap-cta-solid"
                        onClick={() => {
                          const id = fiaTemplateRemapTargetId;
                          if (!id) return;
                          const origRow = savedFiaTemplates.find((t) => t.id === id);
                          if (!origRow) {
                            setFiaTemplateNotice({
                              variant: "error",
                              message: "That template is no longer in this browser. Choose cancel or load another template.",
                            });
                            setFiaTemplateRemapTargetId(null);
                            return;
                          }
                          const tpl = extractFiaProductTemplate(fiaWorksheet);
                          const origC = fiaInputValue(origRow.template.carrierName).trim();
                          const origP = fiaInputValue(origRow.template.productName).trim();
                          if (
                            fiaInputValue(tpl.carrierName).trim() !== origC ||
                            fiaInputValue(tpl.productName).trim() !== origP
                          ) {
                            setFiaTemplateNotice({
                              variant: "error",
                              message:
                                "Keep carrier and product name unchanged to update this template, or cancel remapping and load again.",
                            });
                            return;
                          }
                          if (!isFiaProductTemplateSpecComplete(tpl)) {
                            setFiaTemplateNotice({
                              variant: "error",
                              message:
                                "Fill in cap, premium bonus, surrender term, withdrawal %, income rider choice (and rider details if applicable, including trailing bonus years when trailing bonus is set). Then try Update again.",
                            });
                            return;
                          }
                          const display = formatFiaTemplateDisplayName(tpl.carrierName, tpl.productName);
                          const result = replaceFiaProductTemplateById(id, tpl, display);
                          if (!result.ok) {
                            setFiaTemplateNotice({ variant: "error", message: result.error });
                            return;
                          }
                          setFiaTemplateListGen((g) => g + 1);
                          setFiaTemplateRemapTargetId(null);
                          setFiaWorksheet((w) => applyFiaProductTemplate(w, tpl));
                          setFiaTemplateNotice({
                            variant: "success",
                            message: `Updated saved template "${display}" with the specifications you entered.`,
                          });
                        }}
                      >
                        Update template
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-none border-amber-400 bg-white"
                        onClick={() => {
                          setFiaTemplateRemapTargetId(null);
                          setFiaTemplateNotice({
                            variant: "success",
                            message: "Stopped remapping. Your worksheet was not saved as a template update.",
                          });
                        }}
                      >
                        Cancel remapping
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Premium source</label>
                    <Select
                      value={fiaWorksheet.premiumSource}
                      onValueChange={(value) =>
                        setFiaWorksheet((w) => ({
                          ...w,
                          premiumSource: value as FiaWorksheet["premiumSource"],
                          registrationPremiumOverride: "",
                        }))
                      }
                    >
                      <SelectTrigger className="mt-2 h-12 rounded-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualified">Qualified holdings total ({currency(traditionalQualifiedTotal)})</SelectItem>
                        <SelectItem value="non_qualified">Non-qualified holdings total ({currency(nonQualifiedTotal)})</SelectItem>
                        <SelectItem value="custom">Custom premium amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {fiaWorksheet.premiumSource === "custom" ? (
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Custom premium ($)</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        inputMode="decimal"
                        value={fiaInputValue(fiaWorksheet.premiumAmount)}
                        onChange={(e) => setFiaWorksheet((w) => ({ ...w, premiumAmount: e.target.value }))}
                        placeholder="250000"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Premium for illustration ($)</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          inputMode="decimal"
                          value={fiaInputValue(fiaWorksheet.registrationPremiumOverride)}
                          onChange={(e) =>
                            setFiaWorksheet((w) => ({ ...w, registrationPremiumOverride: e.target.value }))
                          }
                          placeholder={
                            fiaWorksheet.premiumSource === "qualified"
                              ? traditionalQualifiedTotal > 0
                                ? `Blank = full ${currency(traditionalQualifiedTotal)}`
                                : "Enter amount or confirm qualified holdings"
                              : nonQualifiedTotal > 0
                                ? `Blank = full ${currency(nonQualifiedTotal)}`
                                : "Enter amount or confirm non-qualified holdings"
                          }
                        />
                        <p className="mt-1 text-xs text-slate-500">
                          {fiaWorksheet.premiumSource === "qualified" ? (
                            <>
                              Qualified (traditional tax-deferred) total from Confirm Holdings:{" "}
                              <span className="font-medium text-slate-700">{currency(traditionalQualifiedTotal)}</span>
                              . Leave blank to use the full amount, or enter a smaller premium (cannot exceed this total).
                            </>
                          ) : (
                            <>
                              Non-qualified total from Confirm Holdings:{" "}
                              <span className="font-medium text-slate-700">{currency(nonQualifiedTotal)}</span>
                              . Leave blank to use the full amount, or enter a smaller premium (cannot exceed this total).
                            </>
                          )}
                        </p>
                      </div>
                      <div className="rounded-none border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-xs font-medium text-slate-500">Used in tables below</p>
                        <p className="text-sm font-semibold text-slate-900">{currency(fiaPremiumDefault)}</p>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Carrier name</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      value={fiaInputValue(fiaWorksheet.carrierName)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, carrierName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Product name</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      value={fiaInputValue(fiaWorksheet.productName)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, productName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Premium bonus %</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      inputMode="decimal"
                      value={fiaInputValue(fiaWorksheet.premiumBonusPct)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, premiumBonusPct: e.target.value }))}
                      placeholder="10"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Trailing bonus %</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      inputMode="decimal"
                      value={fiaInputValue(fiaWorksheet.trailingBonusPct)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, trailingBonusPct: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Trailing bonus years</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      inputMode="numeric"
                      value={fiaInputValue(fiaWorksheet.trailBonusYears)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, trailBonusYears: e.target.value }))}
                      placeholder="10"
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Bonus % is added to the capped index credit starting in contract year 1 through this many years (leave blank with a trailing % to apply all 10 years).
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Contract cap rate % (S&P-linked credit)</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      inputMode="decimal"
                      value={fiaInputValue(fiaWorksheet.contractCapRatePct)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, contractCapRatePct: e.target.value }))}
                      placeholder="10"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Penalty-free withdrawal % (reference)</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      inputMode="decimal"
                      value={fiaInputValue(fiaWorksheet.penaltyFreeWithdrawalPct)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, penaltyFreeWithdrawalPct: e.target.value }))}
                      placeholder="10"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Surrender period (years, reference)</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      inputMode="numeric"
                      value={fiaInputValue(fiaWorksheet.surrenderYears)}
                      onChange={(e) => setFiaWorksheet((w) => ({ ...w, surrenderYears: e.target.value }))}
                      placeholder="10"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">Income rider (illustrative)</p>
                <p className="text-sm text-slate-600">Is there an income rider on this contract?</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={fiaWorksheet.hasIncomeRider === true ? "default" : "outline"}
                    className="rounded-none"
                    onClick={() => setFiaWorksheet((w) => ({ ...w, hasIncomeRider: true }))}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={fiaWorksheet.hasIncomeRider === false ? "default" : "outline"}
                    className="rounded-none"
                    onClick={() => setFiaWorksheet((w) => ({ ...w, hasIncomeRider: false }))}
                  >
                    No
                  </Button>
                </div>
                {fiaWorksheet.hasIncomeRider === true ? (
                  <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Guaranteed roll-up on rider benefit base % (annual)</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        inputMode="decimal"
                        value={fiaInputValue(fiaWorksheet.incomeRiderGuaranteePct)}
                        onChange={(e) => setFiaWorksheet((w) => ({ ...w, incomeRiderGuaranteePct: e.target.value }))}
                        placeholder="4"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Income rider fee % (annual drag on account value)</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        inputMode="decimal"
                        value={fiaInputValue(fiaWorksheet.incomeRiderFeePct)}
                        onChange={(e) => setFiaWorksheet((w) => ({ ...w, incomeRiderFeePct: e.target.value }))}
                        placeholder="0.95"
                      />
                      <p className="mt-1 text-xs text-slate-500">Leave blank or 0 for no fee in this illustration.</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-sm font-semibold text-slate-700">Add contract interest credits to rider benefit base?</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={fiaWorksheet.contractEarningsAddToRiderBase === true ? "default" : "outline"}
                          className="rounded-none"
                          onClick={() => setFiaWorksheet((w) => ({ ...w, contractEarningsAddToRiderBase: true }))}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={fiaWorksheet.contractEarningsAddToRiderBase === false ? "default" : "outline"}
                          className="rounded-none"
                          onClick={() => setFiaWorksheet((w) => ({ ...w, contractEarningsAddToRiderBase: false }))}
                        >
                          No
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-none border border-amber-200 bg-amber-50/90 p-5 text-sm text-amber-950">
                <p className="font-semibold">Ten-year windows (same as Hypothetical Allocation Stress)</p>
                <p className="mt-2 text-xs leading-relaxed">
                  Lowest recent decade (2000–2009), highest recent decade (2010–2019), and most recent decade (2016–2025) use the same consecutive calendar years as the portfolio stress exhibit. Credited rates are geometrically annualized for the table; dollar path uses annual reset crediting on the account value shown.
                </p>
                {fiaShowRmdColumns ? (
                  <p className="mt-2 text-xs leading-relaxed">
                    When shown, the RMD column uses IRS Uniform Lifetime divisors from age 73 on the qualified (tax-deferred) premium path only; each year&apos;s amount is based on beginning-of-year FIA account value before the credited rate is applied, and distributions reduce the balance used for growth. Illustrative only, not tax advice.
                  </p>
                ) : null}
              </div>

              {fiaPremiumDefault <= 0 || !String(fiaWorksheet.contractCapRatePct || "").trim() ? (
                <div className="rounded-none border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
                  {fiaPremiumDefault <= 0 ? (
                    <p>Enter a premium: pick a holdings total with value or choose custom premium.</p>
                  ) : (
                    <p>Enter a contract cap rate % to run the illustration.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-none border border-slate-200">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="bg-slate-900 text-white">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Window</th>
                          <th className="px-4 py-3 font-semibold">Hypothetical annualized credited</th>
                          <th className="px-4 py-3 font-semibold">Ending contract value</th>
                          {fiaShowRmdColumns ? (
                            <th className="px-4 py-3 font-semibold">Total illustrative RMD (10 yr)</th>
                          ) : null}
                          {fiaShowRiderInTables ? (
                            <th className="px-4 py-3 font-semibold">Rider benefit base (illustrative)</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {fiaScenarioSummaries.map((row, idx) => (
                          <tr key={row.scenarioId} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                            <td className="px-4 py-3 font-medium text-slate-900">{row.label}</td>
                            <td className="px-4 py-3 tabular-nums text-slate-800">
                              {Number.isFinite(row.annualizedCreditedReturnPct)
                                ? `${row.annualizedCreditedReturnPct.toFixed(2)}%`
                                : "—"}
                            </td>
                            <td className="px-4 py-3 tabular-nums font-semibold text-slate-900">
                              {currency(row.endingContractValue)}
                            </td>
                            {fiaShowRmdColumns ? (
                              <td className="px-4 py-3 tabular-nums text-slate-800">
                                {currency(row.totalRmdDuringWindow)}
                              </td>
                            ) : null}
                            {fiaShowRiderInTables ? (
                              <td className="px-4 py-3 tabular-nums text-slate-800">
                                {currency(row.endingRiderBenefitBase)}
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div>
                    <p className="font-serif text-xl font-bold text-slate-950">Year-by-year hypothetical path</p>
                    <p className="mt-1 text-xs text-slate-500">
                      S&P 500 total return per year from firm calibration; credited rate applies 0% floor and your cap, then adds trailing bonus % for contract years 1 through the trailing bonus years you enter (year 1 is the first row). If you enter a trailing % but leave years blank, all 10 illustration years receive the bonus.
                      {fiaShowRmdColumns
                        ? " Age advances one year per row; illustrative RMD (qualified premium, age 73+) applies to start-of-year account value before interest credit."
                        : ""}
                    </p>
                    <Tabs defaultValue={fiaScenarioSummaries[0]?.scenarioId || "low_recent_2000_2009"} className="mt-4 w-full">
                      <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-1">
                        {fiaScenarioSummaries.map((s) => (
                          <TabsTrigger key={s.scenarioId} value={s.scenarioId} className="text-xs sm:text-sm">
                            {s.tabLabel}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                      {fiaScenarioSummaries.map((s) => (
                        <TabsContent key={s.scenarioId} value={s.scenarioId} className="mt-4">
                          <div className="overflow-x-auto rounded-none border border-slate-200">
                            <table className="w-full min-w-[720px] text-left text-xs sm:text-sm">
                              <thead className="bg-slate-800 text-white">
                                <tr>
                                  <th className="px-3 py-2">Year</th>
                                  {fiaShowRmdColumns ? <th className="px-3 py-2">Age</th> : null}
                                  <th className="px-3 py-2">S&P 500 %</th>
                                  <th className="px-3 py-2">Credited %</th>
                                  <th className="px-3 py-2">Start value</th>
                                  <th className="px-3 py-2">Interest</th>
                                  <th className="px-3 py-2">End value</th>
                                  {fiaShowRmdColumns ? <th className="px-3 py-2">RMD</th> : null}
                                  {fiaShowRiderInTables ? <th className="px-3 py-2">Rider base</th> : null}
                                </tr>
                              </thead>
                              <tbody>
                                {s.rows.map((r, i) => (
                                  <tr key={`${s.scenarioId}-${r.year}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                    <td className="px-3 py-2 font-medium">{r.year}</td>
                                    {fiaShowRmdColumns ? (
                                      <td className="px-3 py-2 tabular-nums text-slate-700">
                                        {r.contractAge != null ? r.contractAge : "—"}
                                      </td>
                                    ) : null}
                                    <td className="px-3 py-2 tabular-nums">{r.sp500TotalReturnPct.toFixed(2)}%</td>
                                    <td className="px-3 py-2 tabular-nums">{r.creditedRatePct.toFixed(2)}%</td>
                                    <td className="px-3 py-2 tabular-nums">{currency(r.startingContractValue)}</td>
                                    <td className="px-3 py-2 tabular-nums">{currency(r.interestCredit)}</td>
                                    <td className="px-3 py-2 tabular-nums font-semibold">{currency(r.endingContractValue)}</td>
                                    {fiaShowRmdColumns ? (
                                      <td className="px-3 py-2 tabular-nums">
                                        {r.rmdWithdrawal > 0 ? currency(r.rmdWithdrawal) : "—"}
                                      </td>
                                    ) : null}
                                    {fiaShowRiderInTables ? (
                                      <td className="px-3 py-2 tabular-nums">{currency(r.riderBenefitBase)}</td>
                                    ) : null}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <FiaScenarioReturnChart
                            rows={s.rows}
                            scenarioId={s.scenarioId}
                            windowLabel={
                              s.years.length === 10
                                ? `${s.years[0]}\u2013${s.years[9]}`
                                : s.label
                            }
                          />
                        </TabsContent>
                      ))}
                    </Tabs>
                  </div>
                </>
              )}

              {fiaTemplateLoadSpecConfirmOpen && fiaPendingLoadTemplate ? (
                <div
                  className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/55 p-4"
                  role="presentation"
                  onClick={() => {
                    setFiaTemplateLoadSpecConfirmOpen(false);
                    setFiaPendingLoadTemplate(null);
                  }}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="fia-template-load-spec-heading"
                    className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-none border border-slate-200 bg-white p-6 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="fia-template-load-spec-heading" className="font-serif text-xl font-bold text-slate-950">
                      Update product specifications?
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">
                      Do you need to update the product specifications for{" "}
                      <span className="font-semibold text-slate-800">{fiaPendingLoadTemplate.displayName}</span>?
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Choose <span className="font-medium text-slate-700">No</span> to load every saved term. Choose{" "}
                      <span className="font-medium text-slate-700">Yes</span> to keep carrier and product name only,
                      re-enter the rest on the form, then click <span className="font-medium text-slate-700">Update template</span>{" "}
                      to replace the saved copy. Premium source and amounts stay as they are on this review.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-none"
                        onClick={() => {
                          setFiaTemplateLoadSpecConfirmOpen(false);
                          setFiaPendingLoadTemplate(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-none border-slate-300"
                        onClick={() => {
                          const row = fiaPendingLoadTemplate;
                          setFiaTemplateLoadSpecConfirmOpen(false);
                          setFiaPendingLoadTemplate(null);
                          setFiaTemplateRemapTargetId(null);
                          setFiaWorksheet((w) => applyFiaProductTemplate(w, row.template));
                          setFiaTemplateNotice({
                            variant: "success",
                            message: `Loaded "${row.displayName}". Premium source and amounts were not changed.`,
                          });
                        }}
                      >
                        No, load as saved
                      </Button>
                      <Button
                        type="button"
                        className="h-11 rounded-none ap-cta-solid"
                        onClick={() => {
                          const row = fiaPendingLoadTemplate;
                          setFiaTemplateLoadSpecConfirmOpen(false);
                          setFiaPendingLoadTemplate(null);
                          setFiaWorksheet((w) => applyFiaProductTemplateCarrierProductOnly(w, row.template));
                          setFiaTemplateRemapTargetId(row.id);
                          setFiaTemplateNotice({
                            variant: "success",
                            message: `Carrier and product name are set from "${row.displayName}". Enter the remaining product terms, then click Update template.`,
                          });
                        }}
                      >
                        Yes, remap specs
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {fiaTemplateSaveOpen ? (
                <div
                  className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/55 p-4"
                  role="presentation"
                  onClick={() => setFiaTemplateSaveOpen(false)}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="fia-template-save-heading"
                    className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-none border border-slate-200 bg-white p-6 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="fia-template-save-heading" className="font-serif text-xl font-bold text-slate-950">
                      Save this product template?
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">
                      Only product terms are saved (carrier, product name, bonuses, cap, rider options, etc.). Premium source,
                      premium amounts, and client profile fields are not included. Templates are stored in this browser.
                    </p>
                    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Template name</p>
                    <p className="mt-1 rounded-none border border-slate-200 bg-slate-50 px-3 py-2.5 text-base font-semibold text-slate-900">
                      {formatFiaTemplateDisplayName(
                        fiaInputValue(fiaWorksheet.carrierName),
                        fiaInputValue(fiaWorksheet.productName)
                      )}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-none"
                        onClick={() => setFiaTemplateSaveOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="h-11 rounded-none ap-cta-solid"
                        onClick={() => {
                          const tpl = extractFiaProductTemplate(fiaWorksheet);
                          const display = formatFiaTemplateDisplayName(tpl.carrierName, tpl.productName);
                          const result = appendFiaProductTemplate(tpl, display);
                          setFiaTemplateSaveOpen(false);
                          if (!result.ok) {
                            setFiaTemplateNotice({ variant: "error", message: result.error });
                            return;
                          }
                          setFiaTemplateListGen((g) => g + 1);
                          setFiaTemplateNotice({
                            variant: "success",
                            message: `Saved product template "${display}" in this browser. Premium and client details were not stored.`,
                          });
                          window.setTimeout(() => {
                            setFiaTemplateNotice((n) => (n?.variant === "success" ? null : n));
                          }, 8000);
                        }}
                      >
                        Save template
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-sky-100/60 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <Button variant="outline" className="h-12 rounded-none touch-manipulation" onClick={() => setStep("meeting")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Meeting Guide
                </Button>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button variant="outline" className="h-12 rounded-none touch-manipulation" onClick={() => void saveCurrentReview()}>
                    <Save className="mr-2 h-4 w-4" />
                    Save client profile
                  </Button>
                  {showRothOptionReport ? (
                    <Button
                      variant="outline"
                      className="h-12 rounded-none border-amber-200 bg-amber-50/90 touch-manipulation hover:bg-amber-100/90"
                      onClick={() => setStep("roth")}
                    >
                      <Target className="mr-2 h-4 w-4" />
                      Roth worksheet
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    className="h-12 rounded-none border-sky-200 bg-sky-50/90 touch-manipulation hover:bg-sky-100/90"
                    onClick={() => setStep("retIncome")}
                  >
                    <Landmark className="mr-2 h-4 w-4" />
                    Ret. Inc Calculator
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}


        {step === "roth" && showRothOptionReport && (
          <Card className="rounded-none ap-glass border-0">
            <CardContent className="space-y-8 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="ap-icon-tile ap-icon-tile-amber flex h-12 w-12 items-center justify-center rounded-none">
                    <Target className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-serif text-3xl font-bold">Roth conversion worksheet</h2>
                    <p className="text-sm text-slate-500">
                      Capture Roth inputs for this case. Entries here are saved with the client profile; the Roth PDF uses your qualified balance below.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-5 rounded-none border border-slate-200 bg-slate-50/80 p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">Household</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client first name</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      value={client.firstName}
                      onChange={(e) => setClient({ ...client, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client last name</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      value={client.lastName}
                      onChange={(e) => setClient({ ...client, lastName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client current age</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      type="number"
                      value={client.age}
                      onChange={(e) => setClient({ ...client, age: e.target.value })}
                      placeholder="62"
                    />
                  </div>
                  {client.married ? (
                    <>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse first name</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          value={client.spouseFirstName}
                          onChange={(e) => setClient({ ...client, spouseFirstName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse last name</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          value={client.spouseLastName}
                          onChange={(e) => setClient({ ...client, spouseLastName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse current age</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          type="number"
                          value={client.spouseAge}
                          onChange={(e) => setClient({ ...client, spouseAge: e.target.value })}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">Married status is set during intake (Question 1).</p>
              </div>

              <div className="space-y-4 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">Qualified balance for conversion</p>
                <p className="text-sm text-slate-600">
                  “Qualified” here means traditional tax-deferred balances (Confirm step). Roth IRAs and taxable accounts never flow into this cap automatically.
                </p>
                <p className="text-sm text-slate-600">Are we using the entire qualified account balance for this illustration?</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={rothWorksheet.useEntireQualifiedBalance === true ? "default" : "outline"}
                    className="h-11 rounded-none"
                    onClick={() =>
                      setRothWorksheet((w) => {
                        const next = { ...w, useEntireQualifiedBalance: true as const };
                        if (traditionalQualifiedTotal > 0 && parseRothMoneyInput(w.qualifiedAssetValue) <= 0) {
                          next.qualifiedAssetValue =
                            Math.round(traditionalQualifiedTotal).toLocaleString("en-US");
                        }
                        return next;
                      })
                    }
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant={rothWorksheet.useEntireQualifiedBalance === false ? "default" : "outline"}
                    className="h-11 rounded-none"
                    onClick={() => setRothWorksheet((w) => ({ ...w, useEntireQualifiedBalance: false }))}
                  >
                    No
                  </Button>
                </div>
                {rothWorksheet.useEntireQualifiedBalance === true ? (
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Qualified asset value</label>
                    <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                      <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                      <Input
                        className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                        type="text"
                        inputMode="decimal"
                        value={rothWorksheet.qualifiedAssetValue}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, qualifiedAssetValue: e.target.value }))}
                        placeholder="500000"
                      />
                    </div>
                  </div>
                ) : null}
                {rothWorksheet.useEntireQualifiedBalance === false ? (
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Specific dollar amount</label>
                    <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                      <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                      <Input
                        className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                        type="text"
                        inputMode="decimal"
                        value={rothWorksheet.specificConversionAmount}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, specificConversionAmount: e.target.value }))}
                        placeholder="250000"
                      />
                    </div>
                  </div>
                ) : null}
                <p className="text-xs text-slate-500">
                  Statement total (all wrappers): {currency(totalValue)}. Traditional tax-deferred pool (Roth conversion sourcing):{" "}
                  <span className="font-semibold text-slate-800">{currency(traditionalQualifiedTotal)}</span>.
                  Roth illustration amount after caps:{" "}
                  <span className="font-semibold text-slate-700">{currency(rothPdfQualifiedTotal || 0)}</span>
                  {rothPdfQualifiedTotal <= 0
                    ? ". Choose Yes/No above and enter an amount so the PDF can run."
                    : ". Taxable and Roth IRA balances stay out of the conversion cap."}
                </p>
                <div className="flex items-center justify-between gap-4 rounded-none border border-blue-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-700">Protect initial investment</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rothWorksheet.fic.protectInitialInvestment}
                    onClick={() =>
                      setRothWorksheet((w) => ({
                        ...w,
                        fic: { ...w.fic, protectInitialInvestment: !w.fic.protectInitialInvestment },
                      }))
                    }
                    className={`relative h-8 w-14 shrink-0 rounded-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-sky-500 ${
                      rothWorksheet.fic.protectInitialInvestment ? "bg-sky-500" : "bg-slate-200"
                    }`}
                  >
                    <span className="sr-only">Protect initial investment</span>
                    <span
                      className={`absolute top-1 h-6 w-6 rounded-none bg-white shadow transition-[left] ${
                        rothWorksheet.fic.protectInitialInvestment ? "left-7" : "left-1"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {client.takingSocialSecurity ? (
                <div className="space-y-4 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                  <p className="text-sm font-semibold text-slate-800">Social Security (monthly)</p>
                  <p className="text-xs text-slate-500">From intake (&quot;taking Social Security&quot;). Updates here sync to the client profile.</p>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Client</label>
                      <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                        <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                        <Input
                          className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                          type="text"
                          inputMode="decimal"
                          value={client.socialSecurityMonthlyClient}
                          onChange={(e) => setClient({ ...client, socialSecurityMonthlyClient: e.target.value })}
                        />
                      </div>
                    </div>
                    {client.married ? (
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse</label>
                        <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                          <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                          <Input
                            className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                            type="text"
                            inputMode="decimal"
                            value={client.socialSecurityMonthlySpouse}
                            onChange={(e) => setClient({ ...client, socialSecurityMonthlySpouse: e.target.value })}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="space-y-3 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">Adjusted taxable income</p>
                <p className="text-xs text-slate-500">
                  Pulled from intake as AGI (Form 1040, line 11 on recent-year returns).
                </p>
                <div className="flex h-12 max-w-md items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                  <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                  <Input
                    className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                    type="text"
                    inputMode="decimal"
                    value={client.adjustedGrossIncomeAnnual}
                    onChange={(e) => setClient({ ...client, adjustedGrossIncomeAnnual: e.target.value })}
                    placeholder="165432"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">Estimated retirement income</p>
                <p className="text-xs text-slate-500">
                  From intake: how much spendable income the client needs in retirement annually. Edits here update the client profile.
                </p>
                <div className="flex h-12 max-w-md items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                  <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                  <Input
                    className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                    type="text"
                    inputMode="decimal"
                    value={client.retirementSpendableIncomeAnnual}
                    onChange={(e) =>
                      setClient({ ...client, retirementSpendableIncomeAnnual: e.target.value })
                    }
                    placeholder="85000"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">Max tax rate %</p>
                <p className="text-xs text-slate-500">Illustrative max tax rate percentage for this Roth worksheet.</p>
                <Input
                  className="h-12 max-w-md rounded-none border border-blue-100 bg-white focus-visible:ring-sky-500"
                  type="text"
                  inputMode="decimal"
                  value={rothWorksheet.fic.maxTaxRatePct}
                  onChange={(e) =>
                    setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, maxTaxRatePct: e.target.value } }))
                  }
                  placeholder="e.g. 22"
                />
              </div>

              <div className="space-y-4 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">Fixed indexed contract</p>
                <p className="text-sm text-slate-600">Are you using a fixed index contract to perform the conversion?</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={rothWorksheet.useFixedIndexContract === true ? "default" : "outline"}
                    className="h-11 rounded-none"
                    onClick={() => setRothWorksheet((w) => ({ ...w, useFixedIndexContract: true }))}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant={rothWorksheet.useFixedIndexContract === false ? "default" : "outline"}
                    className="h-11 rounded-none"
                    onClick={() => setRothWorksheet((w) => ({ ...w, useFixedIndexContract: false }))}
                  >
                    No
                  </Button>
                </div>
                {rothWorksheet.useFixedIndexContract === true ? (
                  <>
                    <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Roth FIC product templates</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Saved only in this browser. Separate list from FIA calculator templates.
                        </p>
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:max-w-xl sm:flex-row sm:items-end sm:justify-end sm:gap-3">
                        <div className="w-full min-w-0 sm:min-w-[12rem] sm:flex-1 sm:max-w-md">
                          <label className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                            Saved template
                          </label>
                          <Select
                            value={rothFicTemplatePickerValue}
                            onValueChange={(id) => {
                              setRothFicTemplatePickerValue(id);
                              if (id === ROTH_FIC_TEMPLATE_PICKER_NONE) return;
                              const row = savedRothFicTemplates.find((t) => t.id === id);
                              if (!row) return;
                              setRothFicPendingLoadTemplate(row);
                              setRothFicTemplateLoadSpecConfirmOpen(true);
                              window.setTimeout(() => setRothFicTemplatePickerValue(ROTH_FIC_TEMPLATE_PICKER_NONE), 0);
                            }}
                            disabled={savedRothFicTemplates.length === 0}
                          >
                            <SelectTrigger className="mt-1 h-10 rounded-none" aria-label="Load saved Roth FIC product template">
                              <SelectValue
                                placeholder={
                                  savedRothFicTemplates.length === 0
                                    ? "No Roth FIC templates — save one first"
                                    : "Load saved Roth FIC template…"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={ROTH_FIC_TEMPLATE_PICKER_NONE}>— Select —</SelectItem>
                              {savedRothFicTemplates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.displayName.length > 80 ? `${t.displayName.slice(0, 77)}…` : t.displayName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 shrink-0 rounded-none border-slate-300 bg-white sm:self-end"
                          onClick={() => {
                            const c = rothWorksheet.fic.carrierName.trim();
                            const p = rothWorksheet.fic.productName.trim();
                            if (!c || !p) {
                              setRothFicTemplateNotice({
                                variant: "error",
                                message: "Enter carrier and product name before saving a Roth FIC template.",
                              });
                              return;
                            }
                            setRothFicTemplateNotice(null);
                            setRothFicTemplateSaveOpen(true);
                          }}
                        >
                          <BookmarkPlus className="mr-2 h-4 w-4" aria-hidden />
                          Save Roth FIC template
                        </Button>
                      </div>
                    </div>
                    {rothFicTemplateNotice ? (
                      <div
                        role="status"
                        className={
                          rothFicTemplateNotice.variant === "success"
                            ? "rounded-none border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
                            : "rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950"
                        }
                      >
                        {rothFicTemplateNotice.message}
                      </div>
                    ) : null}
                    {rothFicTemplateRemapTargetId ? (
                      <div
                        role="region"
                        aria-label="Update saved Roth FIC template"
                        className="rounded-none border border-amber-300 bg-amber-50/90 px-4 py-3 text-sm text-amber-950"
                      >
                        <p className="font-semibold">Remapping Roth FIC template</p>
                        <p className="mt-1 text-xs leading-relaxed text-amber-950/90 sm:text-sm">
                          Carrier and product name stay as saved. Re-enter bonuses, estimated return, withdrawal terms, and
                          max tax rate below, then update the stored template. Qualified balance and other Roth worksheet
                          fields are unchanged.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            className="h-10 rounded-none ap-cta-solid"
                            onClick={() => {
                              const id = rothFicTemplateRemapTargetId;
                              if (!id) return;
                              const origRow = savedRothFicTemplates.find((t) => t.id === id);
                              if (!origRow) {
                                setRothFicTemplateNotice({
                                  variant: "error",
                                  message: "That template is no longer in this browser. Cancel or load another template.",
                                });
                                setRothFicTemplateRemapTargetId(null);
                                return;
                              }
                              const tpl = extractRothFicProductTemplate(rothWorksheet);
                              const origC = String(origRow.template.carrierName ?? "").trim();
                              const origP = String(origRow.template.productName ?? "").trim();
                              if (
                                String(tpl.carrierName ?? "").trim() !== origC ||
                                String(tpl.productName ?? "").trim() !== origP
                              ) {
                                setRothFicTemplateNotice({
                                  variant: "error",
                                  message:
                                    "Keep carrier and product name unchanged to update this template, or cancel remapping and load again.",
                                });
                                return;
                              }
                              if (!isRothFicProductTemplateSpecComplete(tpl)) {
                                setRothFicTemplateNotice({
                                  variant: "error",
                                  message:
                                    "Fill max tax rate (10–37%), estimated return %, premium bonus, surrender term, withdrawal %, and trail bonus years when trailing bonus is set. Then try Update again.",
                                });
                                return;
                              }
                              const display = formatRothFicTemplateDisplayName(tpl.carrierName, tpl.productName);
                              const result = replaceRothFicProductTemplateById(id, tpl, display);
                              if (!result.ok) {
                                setRothFicTemplateNotice({ variant: "error", message: result.error });
                                return;
                              }
                              setRothFicTemplateListGen((g) => g + 1);
                              setRothFicTemplateRemapTargetId(null);
                              setRothWorksheet((w) => applyRothFicProductTemplate(w, tpl));
                              setRothFicTemplateNotice({
                                variant: "success",
                                message: `Updated Roth FIC template "${display}" with the specifications you entered.`,
                              });
                            }}
                          >
                            Update template
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-none border-amber-400 bg-white"
                            onClick={() => {
                              setRothFicTemplateRemapTargetId(null);
                              setRothFicTemplateNotice({
                                variant: "success",
                                message: "Stopped remapping. Your worksheet was not saved as a template update.",
                              });
                            }}
                          >
                            Cancel remapping
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="text-sm font-semibold text-slate-700">Carrier name</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        value={rothWorksheet.fic.carrierName}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, carrierName: e.target.value } }))}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm font-semibold text-slate-700">Product name</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        value={rothWorksheet.fic.productName}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, productName: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Premium bonus %</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        type="text"
                        inputMode="decimal"
                        value={rothWorksheet.fic.premiumBonusPct}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, premiumBonusPct: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Trailing bonus %</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        type="text"
                        inputMode="decimal"
                        value={rothWorksheet.fic.trailingBonusPct}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, trailingBonusPct: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Trail bonus years</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        type="text"
                        inputMode="numeric"
                        value={rothWorksheet.fic.trailBonusYears}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, trailBonusYears: e.target.value } }))}
                        placeholder="e.g. 10"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Contract estimated rate of return %</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        type="text"
                        inputMode="decimal"
                        value={rothWorksheet.fic.contractEstimatedRateOfReturnPct}
                        onChange={(e) =>
                          setRothWorksheet((w) => ({
                            ...w,
                            fic: { ...w.fic, contractEstimatedRateOfReturnPct: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Penalty-free withdrawal amount from contract %</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        type="text"
                        inputMode="decimal"
                        value={rothWorksheet.fic.penaltyFreeWithdrawalPct}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, penaltyFreeWithdrawalPct: e.target.value } }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Surrender years of contract</label>
                      <Input
                        className="mt-2 h-12 rounded-none bg-white"
                        type="text"
                        inputMode="decimal"
                        value={rothWorksheet.fic.surrenderYears}
                        onChange={(e) => setRothWorksheet((w) => ({ ...w, fic: { ...w.fic, surrenderYears: e.target.value } }))}
                      />
                    </div>
                  </div>
                  </>
                ) : null}
              </div>

              {rothFicTemplateLoadSpecConfirmOpen && rothFicPendingLoadTemplate ? (
                <div
                  className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/55 p-4"
                  role="presentation"
                  onClick={() => {
                    setRothFicTemplateLoadSpecConfirmOpen(false);
                    setRothFicPendingLoadTemplate(null);
                  }}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="roth-fic-template-load-spec-heading"
                    className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-none border border-slate-200 bg-white p-6 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="roth-fic-template-load-spec-heading" className="font-serif text-xl font-bold text-slate-950">
                      Load Roth FIC template?
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">
                      Update product specifications for{" "}
                      <span className="font-semibold text-slate-800">{rothFicPendingLoadTemplate.displayName}</span>?
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      <span className="font-medium text-slate-700">No</span> loads every saved Roth FIC field (including max
                      tax rate and protect initial investment). <span className="font-medium text-slate-700">Yes</span> keeps
                      carrier and product name only so you can re-enter terms, then use <span className="font-medium text-slate-700">Update template</span>.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-none"
                        onClick={() => {
                          setRothFicTemplateLoadSpecConfirmOpen(false);
                          setRothFicPendingLoadTemplate(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-none border-slate-300"
                        onClick={() => {
                          const row = rothFicPendingLoadTemplate;
                          setRothFicTemplateLoadSpecConfirmOpen(false);
                          setRothFicPendingLoadTemplate(null);
                          setRothFicTemplateRemapTargetId(null);
                          setRothWorksheet((w) => applyRothFicProductTemplate(w, row.template));
                          setRothFicTemplateNotice({
                            variant: "success",
                            message: `Loaded Roth FIC template "${row.displayName}".`,
                          });
                        }}
                      >
                        No, load as saved
                      </Button>
                      <Button
                        type="button"
                        className="h-11 rounded-none ap-cta-solid"
                        onClick={() => {
                          const row = rothFicPendingLoadTemplate;
                          setRothFicTemplateLoadSpecConfirmOpen(false);
                          setRothFicPendingLoadTemplate(null);
                          setRothWorksheet((w) => applyRothFicProductTemplateCarrierProductOnly(w, row.template));
                          setRothFicTemplateRemapTargetId(row.id);
                          setRothFicTemplateNotice({
                            variant: "success",
                            message: `Carrier and product set from "${row.displayName}". Enter remaining Roth FIC terms, then Update template.`,
                          });
                        }}
                      >
                        Yes, remap specs
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {rothFicTemplateSaveOpen ? (
                <div
                  className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/55 p-4"
                  role="presentation"
                  onClick={() => setRothFicTemplateSaveOpen(false)}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="roth-fic-template-save-heading"
                    className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-none border border-slate-200 bg-white p-6 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 id="roth-fic-template-save-heading" className="font-serif text-xl font-bold text-slate-950">
                      Save this Roth FIC template?
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">
                      Saves Roth fixed-index contract fields only (carrier through surrender years, max tax rate %, protect
                      initial investment). Not saved: qualified balance, conversion amount, or client profile. Stored separately
                      from FIA calculator templates in this browser.
                    </p>
                    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Template name</p>
                    <p className="mt-1 rounded-none border border-slate-200 bg-slate-50 px-3 py-2.5 text-base font-semibold text-slate-900">
                      {formatRothFicTemplateDisplayName(
                        rothWorksheet.fic.carrierName.trim(),
                        rothWorksheet.fic.productName.trim()
                      )}
                    </p>
                    <div className="mt-6 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-none"
                        onClick={() => setRothFicTemplateSaveOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="h-11 rounded-none ap-cta-solid"
                        onClick={() => {
                          const tpl = extractRothFicProductTemplate(rothWorksheet);
                          const display = formatRothFicTemplateDisplayName(tpl.carrierName, tpl.productName);
                          const result = appendRothFicProductTemplate(tpl, display);
                          setRothFicTemplateSaveOpen(false);
                          if (!result.ok) {
                            setRothFicTemplateNotice({ variant: "error", message: result.error });
                            return;
                          }
                          setRothFicTemplateListGen((g) => g + 1);
                          setRothFicTemplateNotice({
                            variant: "success",
                            message: `Saved Roth FIC template "${display}" in this browser (Roth list only).`,
                          });
                          window.setTimeout(() => {
                            setRothFicTemplateNotice((n) => (n?.variant === "success" ? null : n));
                          }, 8000);
                        }}
                      >
                        Save template
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {rothLiveAnalysisOpen && rothLiveIllustration ? (
                <div className="space-y-5 rounded-none border border-amber-200 bg-amber-50/85 p-5 md:p-6">
                  <div>
                    <p className="font-serif text-xl font-bold text-slate-950">Illustrative Roth analysis</p>
                    <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-700">
                      Year-by-year view uses the same model as the Roth Option PDF. Change inputs above — values update live for client conversations. Illustrative only, not tax or investment advice.
                    </p>
                  </div>
                  {rothAnalysisPrecheckMessages.length > 0 ? (
                    <div className="rounded-none border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700" role="status">
                      <p className="font-semibold text-slate-800">Tax illustration reference</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4">
                        {rothAnalysisPrecheckMessages.map((msg, i) => (
                          <li key={`${i}-${msg}`}>{msg}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {rothLiveIllustration.ok ? (
                    (() => {
                      const model = rothLiveIllustration.model;
                      const stayRows = model.stayTraditional;
                      const stayLast = stayRows.length ? stayRows[stayRows.length - 1]! : null;
                      const rt = model.rothConversionTotals;
                      const st = model.stayTraditionalTotals;
                      const stayTotalIllustrativeFed = stayRows.reduce((sum, r) => sum + r.illustrativeFederalTax, 0);
                      const stayTotalTaxesPaid = stayTotalIllustrativeFed + st.totalIrmaaPaid;
                      const rothTotalTaxesPaid = rt.totalConversionTaxPaid + rt.totalIrmaaPaid;
                      const stayIncomeColumnSum = stayRows.reduce((sum, r) => sum + r.reportIncomeAnnual, 0);
                      const rothIncomeColumnSum = model.rothConversion.reduce((sum, r) => sum + r.reportIncomeAnnual, 0);
                      return (
                        <>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                            <div className="rounded-none border border-slate-200 bg-white p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stay path · ending balance</p>
                              <p className="mt-2 text-lg font-bold tabular-nums text-slate-900">{currency(stayLast?.endBalance ?? 0)}</p>
                              <p className="mt-1 text-xs text-slate-500">Age {stayLast?.age ?? "—"}</p>
                            </div>
                            <div className="rounded-none border border-slate-200 bg-white p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stay path · total RMD + IRMAA</p>
                              <p className="mt-2 text-lg font-bold tabular-nums text-slate-900">{currency(st.totalRmdWithdrawals)}</p>
                              <p className="mt-1 text-xs text-slate-500">IRMAA paid · {currency(st.totalIrmaaPaid)}</p>
                            </div>
                            <div className="rounded-none border border-teal-200 bg-teal-50/70 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">Roth path · ending Roth balance</p>
                              <p className="mt-2 text-lg font-bold tabular-nums text-teal-950">{currency(rt.endingTotalRothBalance)}</p>
                              <p className="mt-1 text-xs text-teal-900/85">Qualified illustration start · {currency(model.rothPathStartingQualifiedBalance)}</p>
                            </div>
                            <div className="rounded-none border border-teal-200 bg-teal-50/70 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">Roth path · conversions</p>
                              <p className="mt-2 text-lg font-bold tabular-nums text-teal-950">{currency(rt.totalGrossConversion)} gross</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="rounded-none border border-slate-200 bg-white p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Stay path · total illustrative taxes paid
                              </p>
                              <p className="mt-2 text-lg font-bold tabular-nums text-slate-900">{currency(stayTotalTaxesPaid)}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                Federal (illustrative) {currency(stayTotalIllustrativeFed)} + IRMAA {currency(st.totalIrmaaPaid)}
                              </p>
                            </div>
                            <div className="rounded-none border border-teal-200 bg-teal-50/70 p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                                Total Est. Taxes and IRMAA paid
                              </p>
                              <p className="mt-2 text-lg font-bold tabular-nums text-teal-950">{currency(rothTotalTaxesPaid)}</p>
                              <p className="mt-1 text-xs text-teal-900/85">
                                Tax on conversions {currency(rt.totalConversionTaxPaid)} + IRMAA {currency(rt.totalIrmaaPaid)}
                              </p>
                            </div>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-600">{model.rothGrowthAssumptionLabel}</p>
                          <Tabs defaultValue="stay" className="w-full">
                            <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-1">
                              <TabsTrigger value="stay" className="text-xs sm:text-sm">
                                Current allocation (traditional + RMDs)
                              </TabsTrigger>
                              <TabsTrigger value="roth" className="text-xs sm:text-sm">
                                Roth conversion path
                              </TabsTrigger>
                            </TabsList>
                            <TabsContent value="stay" className="mt-4 space-y-2">
                              <p className="text-xs font-semibold text-slate-700">
                                Current allocation · 10% annual growth with RMDs from age 73
                              </p>
                              <div className="max-h-[min(480px,55vh)] overflow-auto rounded-none border border-slate-200 bg-white">
                                <table className="w-full min-w-[860px] text-left text-xs sm:text-sm">
                                  <thead className="sticky top-0 bg-slate-900 text-white">
                                    <tr>
                                      <th className="px-3 py-2 font-semibold">Yr</th>
                                      <th className="px-3 py-2 font-semibold">Age</th>
                                      <th className="px-3 py-2 font-semibold">IRA balance</th>
                                      <th className="px-3 py-2 font-semibold">Income</th>
                                      <th className="px-3 py-2 font-semibold">Illust. tax</th>
                                      <th className="px-3 py-2 font-semibold">End bal</th>
                                      <th className="px-3 py-2 font-semibold">RMD</th>
                                      <th className="px-3 py-2 font-semibold">IRMAA</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stayRows.map((r, i) => (
                                      <tr key={`stay-${r.age}-${r.calendarYearOffset}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                        <td className="px-3 py-2 tabular-nums text-slate-600">{r.calendarYearOffset}</td>
                                        <td className="px-3 py-2 font-medium">{r.age}</td>
                                        <td className="px-3 py-2 tabular-nums">{currency(r.yearStartBalance)}</td>
                                        <td className="px-3 py-2 tabular-nums">{currency(r.reportIncomeAnnual)}</td>
                                        <td className="px-3 py-2 tabular-nums">{currency(r.illustrativeFederalTax)}</td>
                                        <td className="px-3 py-2 tabular-nums font-semibold">{currency(r.endBalance)}</td>
                                        <td className="px-3 py-2 tabular-nums">{currency(r.rmd)}</td>
                                        <td className="px-3 py-2 tabular-nums">{currency(r.irmaaSurchargeAnnual)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t-2 border-slate-900 bg-slate-100 font-semibold text-slate-950">
                                      <td className="px-3 py-2">Total</td>
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2 tabular-nums">{currency(stayIncomeColumnSum)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(st.totalTaxAttributableToRmds)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(stayLast?.endBalance ?? 0)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(st.totalRmdWithdrawals)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(st.totalIrmaaPaid)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </TabsContent>
                            <TabsContent value="roth" className="mt-4 space-y-2">
                              <p className="text-xs font-semibold text-slate-700">Roth conversion path</p>
                              <div className="max-h-[min(480px,55vh)] overflow-auto rounded-none border border-slate-200 bg-white">
                                <table className="w-full min-w-[980px] text-left text-xs sm:text-sm">
                                  <thead className="sticky top-0 bg-slate-900 text-white">
                                    <tr>
                                      <th className="px-3 py-2 font-semibold">Yr</th>
                                      <th className="px-3 py-2 font-semibold">Age</th>
                                      <th className="px-3 py-2 font-semibold">Taxable IRA</th>
                                      <th className="px-3 py-2 font-semibold">Income</th>
                                      <th className="px-3 py-2 font-semibold">Gross conv</th>
                                      <th className="px-3 py-2 font-semibold">Tax</th>
                                      <th className="px-3 py-2 font-semibold">Net conv</th>
                                      <th className="px-3 py-2 font-semibold">Total Roth</th>
                                      <th className="px-3 py-2 font-semibold">RMD</th>
                                      <th className="px-3 py-2 font-semibold">IRMAA</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {model.rothConversion.map((r, i) => {
                                      const z = r.rothOnlyPhase;
                                      return (
                                        <tr key={`roth-${r.sequence}`} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                          <td className="px-3 py-2 tabular-nums text-slate-600">{r.sequence}</td>
                                          <td className="px-3 py-2 font-medium">{r.age}</td>
                                          <td className="px-3 py-2 tabular-nums">{z ? currency(0) : currency(r.yearStartTraditional)}</td>
                                          <td className="px-3 py-2 tabular-nums">{currency(r.reportIncomeAnnual)}</td>
                                          <td className="px-3 py-2 tabular-nums">{z ? currency(0) : currency(r.grossConversion)}</td>
                                          <td className="px-3 py-2 tabular-nums">{z ? currency(0) : currency(r.illustrativeTaxOnConversion)}</td>
                                          <td className="px-3 py-2 tabular-nums">{z ? currency(0) : currency(r.netConversionToRoth)}</td>
                                          <td className="px-3 py-2 tabular-nums font-semibold">{currency(r.totalRothBalance)}</td>
                                          <td className="px-3 py-2 tabular-nums">{z ? currency(0) : currency(r.rmdTraditional)}</td>
                                          <td className="px-3 py-2 tabular-nums">{z ? currency(0) : currency(r.irmaaSurchargeAnnual)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                  <tfoot>
                                    <tr className="border-t-2 border-slate-900 bg-slate-100 font-semibold text-slate-950">
                                      <td className="px-3 py-2">Total</td>
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2 tabular-nums">{currency(rothIncomeColumnSum)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(rt.totalGrossConversion)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(rt.totalConversionTaxPaid)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(rt.totalNetConversionToRoth)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(rt.endingTotalRothBalance)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(rt.totalRmdTraditional)}</td>
                                      <td className="px-3 py-2 tabular-nums">{currency(rt.totalIrmaaPaid)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </TabsContent>
                          </Tabs>
                          <details className="rounded-none border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
                            <summary className="cursor-pointer font-semibold text-slate-800">
                              {`Model assumptions (${model.federalBracketId}% bracket ceiling · ${
                                model.marriedFilingJointly ? "MFJ" : "Single"
                              } illustration)`}
                            </summary>
                            <ul className="mt-2 list-disc space-y-2 pl-4">
                              {model.assumptions.map((a, i) => (
                                <li key={i}>{a}</li>
                              ))}
                            </ul>
                          </details>
                        </>
                      );
                    })()
                  ) : (
                    <div className="rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950">
                      {rothLiveIllustration.error} Adjust the fields above or complete intake so the illustration can run.
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-sky-100/60 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <Button variant="outline" className="h-12 rounded-none touch-manipulation" onClick={() => setStep("fia")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to FIA calculator
                </Button>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button variant="outline" className="h-12 rounded-none touch-manipulation" onClick={saveCurrentReview}>
                    <Save className="mr-2 h-4 w-4" />
                    Save client profile
                  </Button>
                  {rothLiveAnalysisOpen ? (
                    <Button
                      className="h-12 rounded-none ap-cta-solid touch-manipulation"
                      onClick={() => void downloadRothOptionPdf()}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Roth Report
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    className="h-12 rounded-none border-slate-300 touch-manipulation"
                    onClick={() => setStep("retIncome")}
                  >
                    <Landmark className="mr-2 h-4 w-4" />
                    Ret. Inc Calculator
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-none border-slate-300 touch-manipulation"
                    onClick={() => setStep("report")}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Wrap-up: PDFs and email
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 rounded-none border-amber-200 bg-amber-50/90 touch-manipulation hover:bg-amber-100/90"
                    disabled={rothAnalysisBusy}
                    onClick={() => void runRothAnalysisWithTaxPrecheck()}
                  >
                    <BrainCircuit className="mr-2 h-4 w-4" />
                    {rothAnalysisBusy ? "Running…" : "Roth Analysis"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "retIncome" && (
          <Card className="rounded-none ap-glass border-0">
            <CardContent className="space-y-8 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none border-sky-200 bg-sky-50">
                    <Landmark className="h-6 w-6 text-sky-900" />
                  </div>
                  <div>
                    <h2 className="font-serif text-3xl font-bold">Ret. Inc Calculator</h2>
                    <p className="text-sm text-slate-500">
                      Illustrative year-by-year bridge: retirement spending vs. earned income, Social Security, other recurring
                      income, RMDs on traditional balances, and portfolio draws. Assumptions are for discussion only, not tax or
                      legal advice.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-none border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
                <p className="font-semibold">Model limits</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900">
                  RMD uses IRS Uniform Lifetime divisors from age 73 on the traditional tax-deferred total from Confirm. Return
                  mode uses the firm&apos;s decade CAGR blend (most recent 10-year scenario) for either current holdings or the
                  proposed allocation from the Portfolio Review target mix. Social Security uses monthly amounts you enter,
                  profile amounts when marked &quot;receiving&quot;, or the illustrative estimator when you choose that path
                  below — not an SSA record match. Benefits apply on the timeline from each person&apos;s SS start age (defaults
                  below). When &quot;Spend target&quot; is after-tax, an illustrative flat tax rate scales earned income, SS,
                  pension, other income, RMDs, and additional withdrawals as ordinary income for residual draw math only — not
                  tax advice.
                </p>
              </div>

              <div className="space-y-5 rounded-none border border-slate-200 bg-slate-50/80 p-5 md:p-6">
                <p className="text-sm font-semibold text-slate-800">From client profile (editable)</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client first name</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      value={client.firstName}
                      onChange={(e) => setClient({ ...client, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client last name</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      value={client.lastName}
                      onChange={(e) => setClient({ ...client, lastName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client current age</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      type="number"
                      value={client.age}
                      onChange={(e) => setClient({ ...client, age: e.target.value })}
                      placeholder="62"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client retirement age</label>
                    <Input
                      className="mt-2 h-12 rounded-none bg-white"
                      type="number"
                      value={client.retirementAge}
                      onChange={(e) => setClient({ ...client, retirementAge: e.target.value })}
                    />
                  </div>
                  {client.married ? (
                    <>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse first name</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          value={client.spouseFirstName}
                          onChange={(e) => setClient({ ...client, spouseFirstName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse last name</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          value={client.spouseLastName}
                          onChange={(e) => setClient({ ...client, spouseLastName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse current age</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          type="number"
                          value={client.spouseAge}
                          onChange={(e) => setClient({ ...client, spouseAge: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Spouse retirement age</label>
                        <Input
                          className="mt-2 h-12 rounded-none bg-white"
                          type="number"
                          value={client.spouseRetirementAge}
                          onChange={(e) => setClient({ ...client, spouseRetirementAge: e.target.value })}
                        />
                      </div>
                    </>
                  ) : null}
                  <div className="md:col-span-2">
                    <label className="text-sm font-semibold text-slate-700">Annual spendable income need in retirement</label>
                    <div className="mt-2 flex h-12 max-w-md items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                      <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                      <Input
                        className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                        type="text"
                        inputMode="decimal"
                        value={client.retirementSpendableIncomeAnnual}
                        onChange={(e) => setClient({ ...client, retirementSpendableIncomeAnnual: e.target.value })}
                        placeholder="85000"
                      />
                    </div>
                  </div>
                  <div className="md:col-span-2 flex flex-col gap-4 rounded-none border border-slate-200 bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Spend target net of income taxes?</p>
                        <p className="text-xs text-slate-500">
                          After-tax: the table treats the spend target as cash after tax and applies the illustrative rate below
                          to earned income, SS, pension, other income, RMDs, and extra portfolio draws. Gross: same sources
                          without that adjustment.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={retIncSpendNetOfTax ? "default" : "outline"}
                          className="h-10 rounded-none"
                          onClick={() => setRetIncSpendNetOfTax(true)}
                        >
                          Yes (after-tax)
                        </Button>
                        <Button
                          type="button"
                          variant={!retIncSpendNetOfTax ? "default" : "outline"}
                          className="h-10 rounded-none"
                          onClick={() => setRetIncSpendNetOfTax(false)}
                        >
                          No (gross)
                        </Button>
                      </div>
                    </div>
                    {retIncSpendNetOfTax ? (
                      <div className="max-w-xs space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Illustrative effective tax rate (%)
                        </label>
                        <Input
                          className="h-11 rounded-none border border-blue-100 bg-white"
                          type="text"
                          inputMode="decimal"
                          value={retIncEffectiveTaxPct}
                          onChange={(e) => setRetIncEffectiveTaxPct(e.target.value)}
                          placeholder="20"
                        />
                        <p className="text-xs text-slate-500">Flat rate for discussion only (not bracket or NIIT modeling).</p>
                      </div>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-slate-500">Married status is set during intake (Question 1).</p>
              </div>

              <div className="space-y-5 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Social Security</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Combined annual benefit at full payment (both receiving):{" "}
                      <span className="font-semibold text-slate-800">{currency(retIncomeCalcSsAnnual)}</span>
                      {retIncSsKnowBenefit === "unset" && !client.takingSocialSecurity ? (
                        <span> — answer the question below to include benefits.</span>
                      ) : retIncSsKnowBenefit === "yes" ? (
                        <span>
                          {" "}
                          · Client / spouse components can start in different years — set ages below the monthly amounts.
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <a
                    href="https://www.ssa.gov/OACT/quickcalc/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs font-semibold text-sky-800 underline decoration-sky-300 underline-offset-2 hover:text-sky-950"
                  >
                    SSA Quick Calculator (reference)
                  </a>
                </div>

                {client.takingSocialSecurity ? (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-600">
                      Client Profile marks this household as <strong>receiving</strong> benefits. Monthly amounts below sync
                      from Question 7 when saved; edit here for this illustration only.
                    </p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-sm font-semibold text-slate-700">Client (monthly)</label>
                        <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                          <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                          <Input
                            className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                            type="text"
                            inputMode="decimal"
                            value={retIncSsMonthlyClient}
                            onChange={(e) => setRetIncSsMonthlyClient(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                      </div>
                      {client.married ? (
                        <div>
                          <label className="text-sm font-semibold text-slate-700">Spouse (monthly)</label>
                          <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                            <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                            <Input
                              className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                              type="text"
                              inputMode="decimal"
                              value={retIncSsMonthlySpouse}
                              onChange={(e) => setRetIncSsMonthlySpouse(e.target.value)}
                              placeholder="0"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <p className="text-xs text-slate-600">
                      Client Profile does <strong>not</strong> mark benefits as receiving yet. Choose how to represent Social
                      Security in this run.
                    </p>
                    <div className="rounded-none border border-slate-200 bg-slate-50/90 p-4 md:p-5">
                      <p className="text-sm font-semibold text-slate-900">Do you know the estimated monthly retirement benefit?</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={retIncSsKnowBenefit === "yes" ? "default" : "outline"}
                          className="h-10 rounded-none"
                          onClick={() => setRetIncSsKnowBenefit("yes")}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          variant={retIncSsKnowBenefit === "no" ? "default" : "outline"}
                          className="h-10 rounded-none"
                          onClick={() => setRetIncSsKnowBenefit("no")}
                        >
                          No — estimate
                        </Button>
                      </div>
                    </div>

                    {retIncSsKnowBenefit === "yes" ? (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-600">Enter the monthly retirement benefit to use in the table (today&apos;s dollars).</p>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="text-sm font-semibold text-slate-700">Client (monthly)</label>
                            <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                              <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                              <Input
                                className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                                type="text"
                                inputMode="decimal"
                                value={retIncSsMonthlyClient}
                                onChange={(e) => setRetIncSsMonthlyClient(e.target.value)}
                                placeholder="0"
                              />
                            </div>
                          </div>
                          {client.married ? (
                            <div>
                              <label className="text-sm font-semibold text-slate-700">Spouse (monthly)</label>
                              <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                                <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                                <Input
                                  className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                                  type="text"
                                  inputMode="decimal"
                                  value={retIncSsMonthlySpouse}
                                  onChange={(e) => setRetIncSsMonthlySpouse(e.target.value)}
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-4 rounded-none border border-slate-100 bg-slate-50/80 p-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700">SS benefit start age — client (timeline)</label>
                            <Input
                              className="h-11 rounded-none border border-blue-100 bg-white"
                              type="text"
                              inputMode="numeric"
                              value={retIncSsStartAgeClient}
                              onChange={(e) => setRetIncSsStartAgeClient(e.target.value)}
                              placeholder="Blank = auto"
                            />
                            <p className="text-xs text-slate-500">
                              Resolved for this table:{" "}
                              <span className="font-semibold text-slate-800">{retIncomeResolvedSsStartClient}</span>. Leave blank
                              to use client retirement age from the profile.
                            </p>
                          </div>
                          {client.married ? (
                            <div className="space-y-2">
                              <label className="text-sm font-semibold text-slate-700">SS benefit start age — spouse (timeline)</label>
                              <Input
                                className="h-11 rounded-none border border-blue-100 bg-white"
                                type="text"
                                inputMode="numeric"
                                value={retIncSsStartAgeSpouse}
                                onChange={(e) => setRetIncSsStartAgeSpouse(e.target.value)}
                                placeholder="Blank = auto"
                              />
                              <p className="text-xs text-slate-500">
                                Resolved: <span className="font-semibold text-slate-800">{retIncomeResolvedSsStartSpouse}</span> —
                                blank uses spouse retirement age from the profile.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {retIncSsKnowBenefit === "no" ? (
                      <div className="space-y-4 rounded-none border border-sky-200/80 bg-sky-50/40 p-4 md:p-5">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Illustrative benefit estimate</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600">
                            Same idea as the SSA Quick Calculator: no earnings record is loaded. We approximate average indexed
                            earnings from your covered annual amount and years worked, apply SSA-style bend points for 2026
                            eligibility, then adjust for benefit start age. For a married spouse, you can optionally compare their
                            own benefit to an illustrative spousal amount (50% of the worker&apos;s PIA, using the same claiming-age
                            factor as the spouse retirement path — not identical to SSA spousal reductions). For a certified
                            estimate, use{" "}
                            <a
                              href="https://www.ssa.gov/OACT/quickcalc/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-sky-900 underline decoration-sky-400 underline-offset-2"
                            >
                              ssa.gov/quickcalc
                            </a>
                            .
                          </p>
                        </div>
                        <div className={`grid grid-cols-1 gap-4 ${client.married ? "lg:grid-cols-2" : ""}`}>
                          <div className="space-y-3 rounded-none border border-white bg-white p-4 shadow-sm">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client</p>
                            <p className="text-xs text-slate-600">
                              DOB (profile): <span className="font-medium text-slate-900">{client.dob?.trim() || "—"}</span>
                              {retIncomeClientBirthYear != null ? (
                                <span className="text-slate-500"> · birth year {retIncomeClientBirthYear}</span>
                              ) : (
                                <span className="text-amber-800"> · add date of birth on Client Profile for an estimate</span>
                              )}
                            </p>
                            <div>
                              <label className="text-xs font-semibold text-slate-700">Annual covered earnings (SS wages)</label>
                              <div className="mt-1 flex h-11 items-center overflow-hidden rounded-none border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                                <span className="pl-3 text-sm font-medium text-slate-600">$</span>
                                <Input
                                  className="h-full flex-1 border-0 bg-transparent pl-1 pr-3 text-sm shadow-none focus-visible:ring-0"
                                  type="text"
                                  inputMode="decimal"
                                  value={retIncSsEstClientAnnual}
                                  onChange={(e) => setRetIncSsEstClientAnnual(e.target.value)}
                                  placeholder="e.g. 85000"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-semibold text-slate-700">Years worked (1–35)</label>
                                <Input
                                  className="mt-1 h-11 rounded-none border border-slate-200 bg-white text-sm"
                                  type="text"
                                  inputMode="numeric"
                                  value={retIncSsEstClientYears}
                                  onChange={(e) => setRetIncSsEstClientYears(e.target.value)}
                                  placeholder={`Auto ${Math.min(35, Math.max(1, retIncomeClientAgeStart - 22))}`}
                                />
                              </div>
                              <div>
                                <label className="text-xs font-semibold text-slate-700">Start benefits (age)</label>
                                <Input
                                  className="mt-1 h-11 rounded-none border border-slate-200 bg-white text-sm"
                                  type="text"
                                  inputMode="numeric"
                                  value={retIncSsEstClientClaimAge}
                                  onChange={(e) => setRetIncSsEstClientClaimAge(e.target.value)}
                                  placeholder={`Default ${Math.min(70, Math.max(62, Math.floor(Number(client.retirementAge) || 67)))}`}
                                />
                              </div>
                            </div>
                            <div className="border-t border-slate-100 pt-3">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated monthly</p>
                              <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-slate-900">
                                {retIncomeSsEstimatorClientMonthly != null
                                  ? currency(retIncomeSsEstimatorClientMonthly)
                                  : "—"}
                              </p>
                              <p className="mt-1 text-[0.65rem] text-slate-500">Rounded; illustrative only.</p>
                            </div>
                          </div>

                          {client.married ? (
                            <div className="space-y-3 rounded-none border border-white bg-white p-4 shadow-sm">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Spouse</p>
                              <p className="text-xs text-slate-600">
                                DOB (profile):{" "}
                                <span className="font-medium text-slate-900">{client.spouseDob?.trim() || "—"}</span>
                                {retIncomeSpouseBirthYear != null ? (
                                  <span className="text-slate-500"> · birth year {retIncomeSpouseBirthYear}</span>
                                ) : (
                                  <span className="text-amber-800"> · add spouse DOB or age for an estimate</span>
                                )}
                              </p>
                              <div>
                                <label className="text-xs font-semibold text-slate-700">Annual covered earnings (SS wages)</label>
                                <div className="mt-1 flex h-11 items-center overflow-hidden rounded-none border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                                  <span className="pl-3 text-sm font-medium text-slate-600">$</span>
                                  <Input
                                    className="h-full flex-1 border-0 bg-transparent pl-1 pr-3 text-sm shadow-none focus-visible:ring-0"
                                    type="text"
                                    inputMode="decimal"
                                    value={retIncSsEstSpouseAnnual}
                                    onChange={(e) => setRetIncSsEstSpouseAnnual(e.target.value)}
                                    placeholder="e.g. 72000"
                                  />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="text-xs font-semibold text-slate-700">Years worked (1–35)</label>
                                  <Input
                                    className="mt-1 h-11 rounded-none border border-slate-200 bg-white text-sm"
                                    type="text"
                                    inputMode="numeric"
                                    value={retIncSsEstSpouseYears}
                                    onChange={(e) => setRetIncSsEstSpouseYears(e.target.value)}
                                    placeholder={
                                      retIncomeSpouseAgeStart != null
                                        ? `Auto ${Math.min(35, Math.max(1, retIncomeSpouseAgeStart - 22))}`
                                        : "Auto"
                                    }
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-semibold text-slate-700">Start benefits (age)</label>
                                  <Input
                                    className="mt-1 h-11 rounded-none border border-slate-200 bg-white text-sm"
                                    type="text"
                                    inputMode="numeric"
                                    value={retIncSsEstSpouseClaimAge}
                                    onChange={(e) => setRetIncSsEstSpouseClaimAge(e.target.value)}
                                    placeholder={`Default ${Math.min(70, Math.max(62, Math.floor(Number(client.spouseRetirementAge) || 67)))}`}
                                  />
                                </div>
                              </div>
                              <div className="flex flex-col gap-2 rounded-none border border-slate-100 bg-slate-50/90 px-3 py-2.5">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold text-slate-800">Spousal benefit check</p>
                                    <p className="text-[0.65rem] leading-snug text-slate-600">
                                      Uses max(spouse&apos;s own retirement, 50% × worker PIA × spouse claiming factor). Off = own
                                      record only.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={retIncSsUseSpousalModel}
                                    onClick={() => setRetIncSsUseSpousalModel((v) => !v)}
                                    className={`relative h-8 w-14 shrink-0 rounded-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-sky-500 ${
                                      retIncSsUseSpousalModel ? "bg-sky-500" : "bg-slate-200"
                                    }`}
                                  >
                                    <span className="sr-only">Include spousal benefit comparison</span>
                                    <span
                                      className={`absolute top-1 h-6 w-6 rounded-none bg-white shadow transition-[left] ${
                                        retIncSsUseSpousalModel ? "left-7" : "left-1"
                                      }`}
                                    />
                                  </button>
                                </div>
                                {retIncSsUseSpousalModel ? (
                                  <p className="text-[0.65rem] text-slate-600">
                                    Worker PIA (illustrative, for 50% test):{" "}
                                    <span className="font-semibold tabular-nums text-slate-900">
                                      {retIncomeSsWorkerPiaMonthly != null ? currency(retIncomeSsWorkerPiaMonthly) : "—"}
                                    </span>
                                  </p>
                                ) : null}
                              </div>
                              <div className="border-t border-slate-100 pt-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated monthly</p>
                                <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-slate-900">
                                  {retIncomeSsEstimatorSpouseMonthly != null
                                    ? currency(retIncomeSsEstimatorSpouseMonthly)
                                    : "—"}
                                </p>
                                <p className="mt-1 text-[0.65rem] text-slate-500">
                                  {retIncSsUseSpousalModel
                                    ? "Survivor, deeming, family max, and SSA spousal reduction tables not modeled."
                                    : "Own earnings record only; turn on spousal check to compare to 50% of worker PIA."}
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-4 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                  <p className="text-sm font-semibold text-slate-800">Earned income (annual, pre-retirement)</p>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Client</label>
                    <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                      <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                      <Input
                        className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                        type="text"
                        inputMode="decimal"
                        value={retIncClientEarnedAnnual}
                        onChange={(e) => setRetIncClientEarnedAnnual(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  {client.married ? (
                    <div>
                      <label className="text-sm font-semibold text-slate-700">Spouse</label>
                      <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                        <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                        <Input
                          className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                          type="text"
                          inputMode="decimal"
                          value={retIncSpouseEarnedAnnual}
                          onChange={(e) => setRetIncSpouseEarnedAnnual(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4 rounded-none border border-slate-200 bg-white p-5 md:p-6">
                  <p className="text-sm font-semibold text-slate-800">Pension and other long-term income</p>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Pension (annual start)</label>
                    <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                      <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                      <Input
                        className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                        type="text"
                        inputMode="decimal"
                        value={retIncPensionAnnual}
                        onChange={(e) => setRetIncPensionAnnual(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Pension COLA (% per year)</label>
                    <Input
                      className="mt-2 h-12 rounded-none border border-blue-100 bg-white"
                      type="text"
                      inputMode="decimal"
                      value={retIncPensionColaPct}
                      onChange={(e) => setRetIncPensionColaPct(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Other long-term income (annual start)</label>
                    <div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">
                      <span className="pl-4 text-lg font-medium text-slate-600">$</span>
                      <Input
                        className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 shadow-none focus-visible:ring-0"
                        type="text"
                        inputMode="decimal"
                        value={retIncOtherAnnual}
                        onChange={(e) => setRetIncOtherAnnual(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Other income growth (% per year)</label>
                    <Input
                      className="mt-2 h-12 rounded-none border border-blue-100 bg-white"
                      type="text"
                      inputMode="decimal"
                      value={retIncOtherGrowthPct}
                      onChange={(e) => setRetIncOtherGrowthPct(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2 rounded-none border border-slate-200 bg-white p-4">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inflation on spending need</label>
                  <Input
                    className="h-11 rounded-none border border-blue-100 bg-white"
                    value={retIncNeedInflationPct}
                    onChange={(e) => setRetIncNeedInflationPct(e.target.value)}
                    placeholder="3"
                  />
                  <p className="text-xs text-slate-500">Default 3% per year after both retire.</p>
                </div>
                <div className="space-y-2 rounded-none border border-slate-200 bg-white p-4">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">SS COLA</label>
                  <Input
                    className="h-11 rounded-none border border-blue-100 bg-white"
                    value={retIncSsColaPct}
                    onChange={(e) => setRetIncSsColaPct(e.target.value)}
                    placeholder="2"
                  />
                  <p className="text-xs text-slate-500">Default 2% on benefits while in pay status.</p>
                </div>
                <div className="space-y-2 rounded-none border border-slate-200 bg-white p-4">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portfolio return</label>
                  <Select
                    value={retIncReturnMode}
                    onValueChange={(v) => setRetIncReturnMode(v as "snapshot" | "proposed" | "custom")}
                  >
                    <SelectTrigger className="h-11 rounded-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="snapshot">
                        Current holdings ({formatTenYearScenarioPercent(retIncomeSnapshotReturnDec)} CAGR)
                      </SelectItem>
                      <SelectItem value="proposed">
                        Proposed mix ({formatTenYearScenarioPercent(retIncomeProposedReturnDec)} CAGR)
                      </SelectItem>
                      <SelectItem value="custom">Custom annual %</SelectItem>
                    </SelectContent>
                  </Select>
                  {retIncReturnMode === "custom" ? (
                    <Input
                      className="h-11 rounded-none border border-blue-100 bg-white"
                      placeholder="e.g. 5.5"
                      value={retIncCustomReturnPct}
                      onChange={(e) => setRetIncCustomReturnPct(e.target.value)}
                    />
                  ) : null}
                  <p className="text-xs text-slate-500">Table runs through client age 95.</p>
                </div>
              </div>

              <div className="rounded-none border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="font-semibold text-slate-800">Starting balances (from Confirm)</span>
                <span className="mx-2">·</span>
                Total portfolio {currency(totalValue)} · Traditional (RMD base) {currency(traditionalQualifiedTotal)}
              </div>

              {retIncomeClientAgeStart <= 0 ? (
                <div className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Enter the client&apos;s current age (or date of birth on Client Profile) so the projection can run.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-none border border-slate-200 bg-white shadow-sm">
                  <table className="min-w-[1040px] w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <th className="px-3 py-3">Year</th>
                        <th className="px-3 py-3">Age (C / S)</th>
                        <th className="px-3 py-3 text-right">Income need</th>
                        <th className="px-3 py-3 text-right">Earned</th>
                        <th className="px-3 py-3 text-right">Soc Sec</th>
                        <th className="px-3 py-3 text-right">Pension</th>
                        <th className="px-3 py-3 text-right">Other</th>
                        <th className="px-3 py-3 text-right">RMD</th>
                        <th className="px-3 py-3 text-right">Income Gap W/D</th>
                        <th className="px-3 py-3 text-right">Total W/D Pre-Tax</th>
                        <th className="px-3 py-3 text-right">Portfolio end</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retIncomeProjectionRows.map((r) => (
                        <tr key={r.yearOffset} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/60">
                          <td className="px-3 py-2 tabular-nums text-slate-800">{r.calendarYear}</td>
                          <td className="px-3 py-2 text-slate-700">
                            {r.clientAge}
                            {r.spouseAge != null ? ` / ${r.spouseAge}` : ""}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{currency(r.incomeNeed)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{currency(r.earnedIncome)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{currency(r.socialSecurity)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{currency(r.pension)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{currency(r.otherIncome)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.rmd > 0 ? currency(r.rmd) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.portfolioWithdrawalBeyondRmd > 0 ? currency(r.portfolioWithdrawalBeyondRmd) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                            {r.totalPortfolioWithdrawal > 0 ? currency(r.totalPortfolioWithdrawal) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                            {currency(r.endingPortfolio)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-sky-100/60 pt-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <Button
                  variant="outline"
                  className="h-12 rounded-none touch-manipulation"
                  onClick={() => setStep(showRothOptionReport ? "roth" : "fia")}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {showRothOptionReport ? "Back to Roth worksheet" : "Back to FIA calculator"}
                </Button>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Button variant="outline" className="h-12 rounded-none touch-manipulation" onClick={() => void saveCurrentReview()}>
                    <Save className="mr-2 h-4 w-4" />
                    Save client profile
                  </Button>
                  <Button className="h-12 rounded-none ap-cta-solid touch-manipulation" onClick={() => setStep("report")}>
                    <Download className="mr-2 h-4 w-4" />
                    Wrap-up: PDFs and email
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "report" && (
          <Card className="print-card rounded-none ap-glass border-0">
            <CardContent className="space-y-6 p-6 md:p-8 print:p-0">
              <div className="no-print space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none">
                      <Download className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="font-serif text-3xl font-bold">Client Review Report</h2>
                      <p className="text-sm text-slate-500">Clean report preview for PDF, email, or print.</p>
                    </div>
                  </div>
                  <Button
                    className="h-12 rounded-none ap-cta-solid px-5 touch-manipulation"
                    onClick={() => setStep("meeting")}
                  >
                    <MessageSquareText className="mr-2 h-4 w-4" />
                    Back to Meeting Guide
                  </Button>
                </div>

                <div className="ap-callout rounded-none p-5">
                  <p className="ap-eyebrow">Wrap-up actions</p>
                  <p className="mt-1 text-xs text-slate-500">Download, copy, or save once the conversation is done.</p>
                  <div className="mt-4 space-y-3 rounded-none border border-slate-200 bg-slate-50/80 p-4">
                    <p className="text-xs font-semibold text-slate-800">Extra exhibits in the PDF (optional)</p>
                    <p className="text-xs text-slate-600">
                      Add hypothetical FIA calculator tables and/or Roth comparison charts and tables into the same Client Snapshot or Advisor Deep Dive PDF, before the Disclosures section. Related FIA and Roth disclosure language is included in Disclosures at the end of that file. If inputs are missing (FIA premium/cap, or Roth age 60+ with retirement income and qualified balance), that exhibit is skipped and you still get the main report.
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-none border border-slate-200 bg-white px-3 py-2">
                        <span className="text-sm font-medium text-slate-800">Include FIA calculator in PDF</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={snapshotIncludeFiaAppendix}
                          onClick={() => setSnapshotIncludeFiaAppendix((v) => !v)}
                          className={`relative h-8 w-14 shrink-0 rounded-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-sky-500 ${
                            snapshotIncludeFiaAppendix ? "bg-teal-600" : "bg-slate-200"
                          }`}
                        >
                          <span className="sr-only">Include FIA calculator in PDF</span>
                          <span
                            className={`absolute top-1 h-6 w-6 rounded-none bg-white shadow transition-[left] ${
                              snapshotIncludeFiaAppendix ? "left-7" : "left-1"
                            }`}
                          />
                        </button>
                      </div>
                      {showRothOptionReport ? (
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-none border border-slate-200 bg-white px-3 py-2">
                          <span className="text-sm font-medium text-slate-800">Include Roth comparison in PDF</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={snapshotIncludeRothAppendix}
                            onClick={() => setSnapshotIncludeRothAppendix((v) => !v)}
                            className={`relative h-8 w-14 shrink-0 rounded-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-sky-500 ${
                              snapshotIncludeRothAppendix ? "bg-amber-500" : "bg-slate-200"
                            }`}
                          >
                            <span className="sr-only">Include Roth comparison in PDF</span>
                            <span
                              className={`absolute top-1 h-6 w-6 rounded-none bg-white shadow transition-[left] ${
                                snapshotIncludeRothAppendix ? "left-7" : "left-1"
                              }`}
                            />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className={`mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4`}>
                    <Button variant="outline" className="h-12 justify-start rounded-none bg-white/85 touch-manipulation" onClick={() => downloadPDFReport("client")}>
                      <Download className="mr-2 h-4 w-4" />
                      Client Snapshot PDF
                    </Button>
                    <Button variant="outline" className="h-12 justify-start rounded-none bg-white/85 touch-manipulation" onClick={() => downloadPDFReport("advisor")}>
                      <Download className="mr-2 h-4 w-4" />
                      Advisor Deep Dive PDF
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 justify-start rounded-none border-teal-200 bg-teal-50/90 touch-manipulation hover:bg-teal-100/90"
                      onClick={() => setStep("fia")}
                    >
                      <Calculator className="mr-2 h-4 w-4" />
                      FIA calculator
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    {showRothOptionReport ? (
                      <Button
                        variant="outline"
                        className="h-12 justify-start rounded-none border-amber-200 bg-amber-50/90 touch-manipulation hover:bg-amber-100/90"
                        onClick={() => setStep("roth")}
                      >
                        <Target className="mr-2 h-4 w-4" />
                        Roth worksheet
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      className="h-12 justify-start rounded-none border-sky-200 bg-sky-50/90 touch-manipulation hover:bg-sky-100/90"
                      onClick={() => setStep("retIncome")}
                    >
                      <Landmark className="mr-2 h-4 w-4" />
                      Ret. Inc Calculator
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Button variant="outline" className="h-12 justify-start rounded-none bg-white/85 touch-manipulation" onClick={buildFollowUpEmail}>
                      <Mail className="mr-2 h-4 w-4" />
                      Follow-up email (copy)
                    </Button>
                    <Button variant="outline" className="h-12 justify-start rounded-none bg-white/85 touch-manipulation" onClick={saveCurrentReview}>
                      <Save className="mr-2 h-4 w-4" />
                      Save Client Profile
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 justify-start rounded-none bg-white/85 touch-manipulation"
                      onClick={() => {
                        void loadSavedReviews();
                        setStep("saved");
                      }}
                    >
                      <FolderOpen className="mr-2 h-4 w-4" />
                      Client Database
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="rounded-none border border-blue-100 bg-blue-50 p-4">
                  <p className="text-sm font-semibold text-slate-800">Send Client Snapshot (Gmail)</p>
                  <p className="mt-1 text-xs text-slate-600">The address below is the <strong>client&apos;s inbox</strong> (To:). You send from your connected Google account, not from this field.</p>

                  {session && gmailReconnectHint ? (
                    <div className="mt-3 rounded-none border border-amber-200 bg-amber-50/95 p-3 text-sm text-amber-950">
                      <p className="font-semibold text-amber-950">Reconnect Google for Gmail</p>
                      <p className="mt-1 text-xs text-amber-900">{gmailReconnectHint}</p>
                      <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-amber-900">
                        <li>Click <strong>Reconnect Google for Gmail</strong> below (your browser opens Google&apos;s sign-in/consent).</li>
                        <li>Choose your work Google account if prompted, and allow AdvisorPilot to send email on your behalf.</li>
                        <li>When you return to this page, press <strong>Send via Gmail</strong> again.</li>
                      </ol>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-10 rounded-none border-amber-400 bg-white text-amber-950 touch-manipulation hover:bg-amber-100/80"
                          onClick={triggerGoogleGmailReconnect}
                        >
                          <RefreshCw className="mr-2 h-4 w-4 shrink-0" />
                          Reconnect Google for Gmail
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-10 rounded-none text-amber-900 hover:bg-amber-100/60"
                          onClick={() => setGmailReconnectHint(null)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
                    <div className="w-full md:max-w-md">
                      <label className="text-xs font-medium text-slate-600">Client email: snapshot recipient</label>
                      <Input
                        placeholder="client@email.com"
                        className="mt-1 h-12 rounded-none bg-white"
                        type="email"
                        value={client.advisorEmail}
                        onChange={(e) => setClient({ ...client, advisorEmail: e.target.value })}
                      />
                    </div>

                    {session ? (
                      <Button
                        className="h-12 rounded-none ap-cta-solid touch-manipulation md:shrink-0"
                        onClick={sendClientSnapshotEmail}
                      >
                        <Mail className="mr-2 h-4 w-4" />
                        Send via Gmail
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="h-12 rounded-none bg-white touch-manipulation md:shrink-0"
                        onClick={() =>
                          signIn("google", { callbackUrl: googleGmailReconnectCallbackUrl() })
                        }
                      >
                        Connect Google to send
                      </Button>
                    )}
                  </div>

                  {session ? (
                    <p className="mt-3 text-xs text-slate-600">
                      If a send fails or Google says access expired,{" "}
                      <button
                        type="button"
                        className="font-medium text-blue-900 underline decoration-blue-700/50 underline-offset-2 hover:text-blue-950"
                        onClick={triggerGoogleGmailReconnect}
                      >
                        reconnect Google for Gmail
                      </button>{" "}
                      (full-page sign-in), then try <strong>Send via Gmail</strong> again.
                    </p>
                  ) : null}

                  {!session && (
                    <p className="mt-2 text-sm text-blue-900">
                      On email/password login, download the PDF above and paste follow-up copy. The same recipient field applies when you send from your own mail app.
                    </p>
                  )}
                </div>
              </div>
              {followUpEmail && (
                <div className="no-print rounded-none border border-blue-100 bg-blue-50 p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-2xl font-bold text-slate-950">Generated Follow-Up Email</h3>
                      <p className="text-sm text-slate-600">Copy this into Gmail, then manually attach the Client Snapshot PDF.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button className="rounded-none ap-cta-solid" onClick={copyFollowUpEmail}>
                        <Mail className="mr-2 h-4 w-4" />
                        {emailCopied ? "Copied" : "Copy Email"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 shrink-0 rounded-none border-slate-300 bg-white px-3 text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          setFollowUpEmail("");
                          setEmailCopied(false);
                        }}
                        aria-label="Close generated follow-up email"
                      >
                        <X className="h-4 w-4" aria-hidden />
                        <span className="ml-1.5 text-sm font-semibold">Close</span>
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    className="min-h-80 rounded-none bg-white font-mono text-sm leading-6"
                    value={followUpEmail}
                    onChange={(e) => {
                      setFollowUpEmail(e.target.value);
                      setEmailCopied(false);
                    }}
                  />
                </div>
              )}
              <div className="report-paper space-y-6 rounded-none border bg-white p-8 text-black shadow-sm print:rounded-none">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5"><div><h1 className="font-serif text-4xl font-bold text-slate-950">Portfolio Review Snapshot</h1><p className="mt-2 text-sm text-slate-600">Prepared for {clientDisplayName(client) || "Client"} | Age {derivedAge || "N/A"} | Risk Profile: {client.riskProfile.replace("-", " ")}</p></div><LogoBlock compact /></div>
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 print:grid-cols-2"><ProfessionalDonutChart title="Current allocation" subtitle="Current statement" data={currentPie} /><ProfessionalDonutChart title="Proposed Allocation" subtitle="Calibration mix for discussion" data={targetPie} /></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Portfolio Scores</h2><div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 print:grid-cols-3"><div className="rounded-none border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-xs text-slate-500">Risk Alignment</p><p className="mt-1 text-2xl font-bold text-slate-950">{scores.riskAlignment}/100</p><p className="mt-1 text-xs text-slate-500">Risk vs proposed allocation</p></div><div className="rounded-none border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-xs text-slate-500">Diversification</p><p className="mt-1 text-2xl font-bold text-slate-950">{scores.diversification}/100</p><p className="mt-1 text-xs text-slate-500">Asset balance</p></div><div className="rounded-none border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-xs text-slate-500">Income Readiness</p><p className="mt-1 text-2xl font-bold text-slate-950">{scores.incomeReadiness}/100</p><p className="mt-1 text-xs text-slate-500">Income stability</p></div></div></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Synopsis</h2><p className="mt-2 text-sm leading-7 text-slate-700">{displaySynopsis}</p></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Retirement Success Model</h2><div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 print:grid-cols-2"><div className="rounded-none border border-slate-200 bg-slate-50 p-4 print:bg-white"><p className="text-sm font-semibold text-slate-700">Current Allocation</p><p className="mt-1 text-3xl font-bold text-slate-950">{currentSuccessRate}/100</p><p className="mt-1 text-xs text-slate-500">{successLabel(currentSuccessRate)} estimated success</p></div><div className="rounded-none border border-sky-200 bg-sky-50 p-4 print:bg-white"><p className="text-sm font-semibold text-blue-700">Proposed Allocation</p><p className="mt-1 text-3xl font-bold text-slate-950">{proposedSuccessRate}/100</p><p className="mt-1 text-xs text-slate-500">{successLabel(proposedSuccessRate)} estimated success</p></div></div><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{retirementModelInsights.map((item) => <li key={item} className="rounded-none border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{item}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-red-900">Advisor Red Flags</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayRedFlags.map((flag) => <li key={flag} className="rounded-none border border-red-200 bg-red-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{flag}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-indigo-900">Overlap & Concentration Insights</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayOverlapInsights.map((insight) => <li key={insight} className="rounded-none border border-indigo-200 bg-indigo-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{insight}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-emerald-900">What This Means for You</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayWhatThisMeans.map((item) => <li key={item} className="rounded-none border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{item}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Strategic Considerations</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayStrategies.map((idea) => <li key={idea} className="rounded-none border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{idea}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Advisor Example Recommendations</h2><ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 print:grid-cols-2">{displayRecommendations.map((rec) => <li key={rec} className="rounded-none border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 print:bg-white">{rec}</li>)}</ul></div>
                <div><h2 className="font-serif text-2xl font-bold text-slate-950">Potential Next Steps</h2><ul className="mt-2 list-disc pl-5 text-sm leading-7 text-slate-700">{clientNextSteps.map((step) => <li key={step}>{step}</li>)}</ul></div>
                {meetingNotes && <div><h2 className="font-serif text-2xl font-bold text-slate-950">Meeting Notes</h2><p className="mt-2 text-sm leading-7 text-slate-700">{meetingNotes}</p></div>}
                <p className="border-t border-slate-200 pt-3 text-xs text-gray-600">For discussion purposes only. This report is not a trade instruction and must be reviewed by a licensed financial professional before implementation. Investment recommendations should consider the client’s full financial situation, risk tolerance, time horizon, tax status, and objectives.</p>
              </div>
              <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-sky-100/60 pt-5">
                <Button variant="outline" className="h-12 rounded-none touch-manipulation" onClick={() => setStep("meeting")}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Meeting Guide
                </Button>
                <Button
                  className="h-12 rounded-none ap-cta-solid px-5 touch-manipulation"
                  onClick={() => void handleNewReviewIntent()}
                >
                  Start new review
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {step === "saved" && (
          <Card className="rounded-none ap-glass border-0">
            <CardContent className="space-y-6 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="ap-icon-tile flex h-12 w-12 items-center justify-center rounded-none">
                    <FolderOpen className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-serif text-3xl font-bold">Client Database</h2>
                    <p className="text-sm text-slate-500">Search and manage client profiles saved to your AdvisorPilot account.</p>
                  </div>
                </div>
                <Button variant="outline" className="h-11 rounded-none" type="button" onClick={loadSavedReviews}>
                  Refresh List
                </Button>
              </div>

              {clientDbNotice ? (
                <div
                  id="client-db-followup-notice"
                  role="alert"
                  className={
                    clientDbNotice.variant === "success"
                      ? "rounded-none border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-950"
                      : clientDbNotice.variant === "error"
                        ? "rounded-none border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-950"
                        : "rounded-none border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900"
                  }
                >
                  {clientDbNotice.message}
                </div>
              ) : null}

              <div className="ap-callout rounded-none p-4">
                <label className="ap-eyebrow">Search</label>
                <Input
                  className="mt-2 h-12 rounded-none border-sky-200 bg-white/90"
                  placeholder="Search by client name or email"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                />
              </div>

              {emailAuthUser && !session?.user?.email ? (
                <div className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <strong className="font-semibold">Send Follow-Up Email</strong> runs a <strong className="font-semibold">fresh deep analysis</strong> for the current calendar day, saves it to the profile, then sends through <strong className="font-semibold">Gmail</strong> when you use Google sign-in. On email/password only, analysis still refreshes and saves — use the report&apos;s Wrap-up to send or copy manually after signing in with Google.
                </div>
              ) : (
                <div className="rounded-none border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm text-slate-800">
                  <strong className="font-semibold">Send Follow-Up Email</strong> refreshes the AI portfolio analysis for <strong className="font-semibold">today&apos;s date</strong>, saves it to the client record, then emails the client snapshot when Gmail is connected.
                </div>
              )}

              {savedReviews.length === 0 ? (
                <div className="rounded-none border border-slate-200 bg-slate-50 p-8 text-center">
                  <p className="font-semibold text-slate-800">No client database yet.</p>
                  <p className="mt-2 text-sm text-slate-500">Run an analysis, then click Save Client Profile from the Analysis or Report screen.</p>
                </div>
              ) : filteredSavedReviews.length === 0 ? (
                <div className="rounded-none border border-slate-200 bg-slate-50 p-8 text-center">
                  <p className="font-semibold text-slate-800">No matching clients found.</p>
                  <p className="mt-2 text-sm text-slate-500">Try searching by a different name or email.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {filteredSavedReviews.map((review: SavedReview) => {
                    const reviewTotal = review.holdings.reduce((sum: number, h: Holding) => sum + Number(h.value || 0), 0);
                    const reviewAge = review.client.age || (review.client.dob ? String(getAgeFromDob(review.client.dob) || "N/A") : "N/A");

                    return (
                      <div key={review.id} className="ap-glass rounded-none p-5 transition-shadow hover:shadow-[0_28px_60px_-22px_rgba(15,58,122,0.32),0_0_0_1px_rgba(125,184,245,0.45)]">
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
                            type="button"
                            className="h-11 shrink-0 rounded-none ap-cta-solid px-5"
                            onClick={() => openSavedReview(review)}
                          >
                            Open Profile
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-sky-100/60 pt-4">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-none bg-white/80"
                            disabled={followUpEmailSendingId === review.id}
                            onClick={() => void sendFollowUpFromDatabase(review)}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            {followUpEmailSendingId === review.id ? "Sending…" : "Send Follow-Up Email"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 rounded-none bg-white/80"
                            onClick={() => updateAnalysisFromDatabase(review)}
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            Update Analysis
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="ml-auto h-10 rounded-none border-red-200 bg-white/80 text-red-700 hover:bg-red-50"
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

        </div>
      </div>
    </div>
  );
}
