import { RISK_PROFILES, type RiskProfileId } from "@/lib/risk-profiles";

export type { RiskProfileId };

export type RiskQuizQuestionId = (typeof RISK_QUIZ_QUESTION_IDS)[number];

/** Stable IDs for persisted answers (voice + storage). */
export const RISK_QUIZ_QUESTION_IDS = [
  "horizon",
  "withdrawalNeed",
  "portfolioDependence",
  "liquidityMonths",
  "experience",
  "drawdown20",
  "drawdown35",
  "concentration",
] as const;

export type RiskQuizOption = { label: string; points: number };

export type RiskQuizQuestion = {
  id: RiskQuizQuestionId;
  prompt: string;
  options: RiskQuizOption[];
};

/** Multiple-choice questions; first seven sum to a score; concentration applies caps. */
export const RISK_QUIZ_QUESTIONS: RiskQuizQuestion[] = [
  {
    id: "horizon",
    prompt:
      "For the assets in this review, when does the household expect to lean on this portfolio for meaningful withdrawals (beyond small rebalancing)?",
    options: [
      { label: "Within 3 years, or already drawing heavily", points: 0 },
      { label: "3–7 years", points: 1 },
      { label: "8–15 years", points: 2 },
      { label: "16+ years, or mostly accumulation", points: 3 },
    ],
  },
  {
    id: "withdrawalNeed",
    prompt:
      "Over the next three years, what share of this portfolio might be needed for lifestyle, home, education, or business (lump sums, not normal income)?",
    options: [
      { label: "25% or more might be needed", points: 0 },
      { label: "10–24%", points: 1 },
      { label: "5–9%", points: 2 },
      { label: "Under 5%, or no meaningful lump-sum need", points: 3 },
    ],
  },
  {
    id: "portfolioDependence",
    prompt:
      "Roughly what share of essential yearly expenses must come from this portfolio (not wages, pensions-only, or SS covering essentials)?",
    options: [
      { label: "50% or more of essentials", points: 0 },
      { label: "25–49%", points: 1 },
      { label: "10–24%", points: 2 },
      { label: "Under 10%", points: 3 },
    ],
  },
  {
    id: "liquidityMonths",
    prompt:
      "Outside this invested portfolio, about how many months of essential expenses are in cash or cash equivalents?",
    options: [
      { label: "Under 3 months", points: 0 },
      { label: "3–5 months", points: 1 },
      { label: "6–11 months", points: 2 },
      { label: "12+ months", points: 3 },
    ],
  },
  {
    id: "experience",
    prompt: "How would you describe their experience with stocks, stock funds, and bond funds?",
    options: [
      { label: "Little or none; mostly cash and CDs", points: 0 },
      { label: "Some, often through a workplace plan", points: 1 },
      { label: "Comfortable reading statements and basic risk", points: 2 },
      { label: "Very comfortable; understands market ups and downs", points: 3 },
    ],
  },
  {
    id: "drawdown20",
    prompt:
      "If the plan is not to touch this money for 10+ years, how would they react if the portfolio dropped about 20% in six months?",
    options: [
      { label: "Would sell or cut risk substantially", points: 0 },
      { label: "Very uneasy; likely reduce risk some", points: 1 },
      { label: "Uncomfortable but willing to stay the course if the plan is unchanged", points: 2 },
      { label: "Accepts that as part of long-term investing", points: 3 },
    ],
  },
  {
    id: "drawdown35",
    prompt:
      "Same long-term plan, but a drop of about 35% over roughly a year, with no known change in job or health. How would they react?",
    options: [
      { label: "Cannot tolerate; needs much more stability", points: 0 },
      { label: "Hard to stay invested", points: 1 },
      { label: "Painful, but can hold if the horizon still holds", points: 2 },
      { label: "Understands severe downturns can happen", points: 3 },
    ],
  },
  {
    id: "concentration",
    prompt:
      "Does one stock, employer, or private position make up clearly more than about 15% of household financial wealth?",
    options: [
      { label: "Yes, and trimming is not planned soon", points: 0 },
      { label: "Yes, but diversification is planned", points: 1 },
      { label: "No, or already reasonably diversified", points: 3 },
    ],
  },
];

function pointsFor(id: RiskQuizQuestionId, optionIndex: number | undefined): number | undefined {
  if (optionIndex === undefined) return undefined;
  const q = RISK_QUIZ_QUESTIONS.find((x) => x.id === id);
  return q?.options[optionIndex]?.points;
}

function sumScoreForQuestions(answers: Partial<Record<RiskQuizQuestionId, number>>): number {
  const scoredIds: RiskQuizQuestionId[] = [
    "horizon",
    "withdrawalNeed",
    "portfolioDependence",
    "liquidityMonths",
    "experience",
    "drawdown20",
    "drawdown35",
  ];
  let sum = 0;
  for (const id of scoredIds) {
    const idx = answers[id];
    const q = RISK_QUIZ_QUESTIONS.find((x) => x.id === id);
    if (idx === undefined || !q?.options[idx]) continue;
    sum += q.options[idx]?.points ?? 0;
  }
  return sum;
}

function profileFromRawScore(score: number): RiskProfileId {
  if (score <= 5) return "conservative";
  if (score <= 9) return "moderate-conservative";
  if (score <= 13) return "moderate";
  if (score <= 17) return "moderate-growth";
  return "aggressive";
}

const RISK_ORDER: RiskProfileId[] = [...RISK_PROFILES];

function capProfileAtMax(profile: RiskProfileId, max: RiskProfileId): RiskProfileId {
  const pi = RISK_ORDER.indexOf(profile);
  const mi = RISK_ORDER.indexOf(max);
  if (pi === -1 || mi === -1) return profile;
  return RISK_ORDER[Math.min(pi, mi)];
}

/**
 * Maps quiz answers into a suggested risk tier with capacity-style caps.
 */
export function computeRiskProfileFromQuiz(
  answers: Partial<Record<RiskQuizQuestionId, number>>
): {
  profile: RiskProfileId;
  rawScore: number;
  capNotes: string[];
} {
  const capNotes: string[] = [];
  const rawScore = sumScoreForQuestions(answers);
  let profile = profileFromRawScore(rawScore);

  const horizonPts = pointsFor("horizon", answers.horizon);
  const depPts = pointsFor("portfolioDependence", answers.portfolioDependence);
  const liqPts = pointsFor("liquidityMonths", answers.liquidityMonths);
  const expPts = pointsFor("experience", answers.experience);
  const concPts = pointsFor("concentration", answers.concentration);

  if (horizonPts === 0 || depPts === 0 || liqPts === 0) {
    const before = profile;
    profile = capProfileAtMax(profile, "moderate-conservative");
    if (before !== profile) capNotes.push("Capped for short runway, portfolio dependence, or thin liquidity.");
  }

  if (horizonPts === 0 && depPts === 0) {
    const before = profile;
    profile = capProfileAtMax(profile, "conservative");
    if (before !== profile) capNotes.push("Further capped: near-term reliance and high portfolio dependence.");
  }

  if (expPts === 0) {
    const before = profile;
    profile = capProfileAtMax(profile, "moderate");
    if (before !== profile) capNotes.push("Capped for limited market experience.");
  }

  if (concPts === 0) {
    const before = profile;
    profile = capProfileAtMax(profile, "moderate-conservative");
    if (before !== profile) capNotes.push("Capped for concentrated wealth in one position.");
  }

  return { profile, rawScore, capNotes };
}

/** Yes-path tier labels + short lines (aligned to age-based baseline in targetAllocation). */
export const RISK_PROFILE_DESCRIPTORS: { id: RiskProfileId; label: string; shortDescriptor: string }[] = [
  {
    id: "conservative",
    label: "Conservative",
    shortDescriptor: "Lowest equity tilt versus age baseline.",
  },
  {
    id: "moderate-conservative",
    label: "Moderate conservative",
    shortDescriptor: "Below age baseline; more cushion.",
  },
  {
    id: "moderate",
    label: "Moderate",
    shortDescriptor: "Age-based default equity mix.",
  },
  {
    id: "moderate-growth",
    label: "Moderate growth",
    shortDescriptor: "Above age baseline; more growth tilt.",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    shortDescriptor: "Highest equity tilt in this scale.",
  },
];

export const RISK_QUIZ_LENGTH = RISK_QUIZ_QUESTION_IDS.length;

export function isRiskQuizComplete(answers: Record<string, number>): boolean {
  for (const id of RISK_QUIZ_QUESTION_IDS) {
    const idx = answers[id];
    const q = RISK_QUIZ_QUESTIONS.find((x) => x.id === id);
    if (idx === undefined || !q?.options[idx]) return false;
  }
  return true;
}

export type RiskIntakeScreen = "gate" | "known" | "quiz" | "result";

/** Typed flow: main Continue is only enabled on `known` or `result` with a valid tier. */
export function canAdvanceRiskIntake(c: {
  riskIntakeScreen: string;
  riskProfile: string;
}): boolean {
  switch (c.riskIntakeScreen) {
    case "gate":
    case "quiz":
      return false;
    case "known":
    case "result":
      return RISK_PROFILES.includes(c.riskProfile as RiskProfileId);
    default:
      return RISK_PROFILES.includes(c.riskProfile as RiskProfileId);
  }
}
