import { NextResponse } from "next/server";
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { Buffer } from "buffer";
import fs from "fs/promises";
import path from "path";
import { clientDisplayName } from "@/lib/intake-config";
import type { ScenarioHoldingLike } from "@/lib/ten-year-scenario-models";
import {
  TEN_YEAR_SCENARIOS,
  BIGGEST_DRAWDOWN_SCENARIO_YEAR,
  formatTenYearScenarioPercent,
  scenarioHoldingsPortfolioReturnDecimal,
  scenarioHoldingsPortfolioSingleYearReturnDecimal,
  scenarioProposedPortfolioReturnDecimal,
  scenarioProposedPortfolioSingleYearReturnDecimal,
} from "@/lib/ten-year-scenario-models";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";

type ReportMode = "client" | "advisor";

type RGB = ReturnType<typeof rgb>;
type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as LooseRecord) : {};
}

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\x00-\x7F]/g, "")
    .trim();
}

function money(value: unknown) {
  const n = Number(value || 0);
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function uniqueItems(items: unknown[], limit = 4) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of Array.isArray(items) ? items : []) {
    const cleaned = cleanText(item).trim();
    const key = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 80);

    if (cleaned && !seen.has(key)) {
      seen.add(key);
      output.push(cleaned);
    }

    if (output.length >= limit) break;
  }

  return output;
}

function stringItems(value: unknown, limit = 12) {
  return uniqueItems(Array.isArray(value) ? value : [], limit);
}

function donutPathFmt(n: number) {
  return String(Number(Math.round(n * 10_000) / 10_000));
}

/**
 * Must match `ProfessionalDonutChart` in app/page.tsx (viewBox 190×190, rotate -90, stroke arcs).
 * pdf-lib fills SVG arcs unreliably here; we use the same stroke-ring technique as the app.
 */
const SNAPSHOT_DONUT = {
  view: 190,
  cx: 95,
  cy: 95,
  r: 72,
  stroke: 22,
  holeR: 45,
} as const;

function snapshotDonutPt(radius: number, degCwFromTop: number) {
  const rad = (degCwFromTop * Math.PI) / 180;
  return {
    x: SNAPSHOT_DONUT.cx + radius * Math.sin(rad),
    y: SNAPSHOT_DONUT.cy - radius * Math.cos(rad),
  };
}

/** Open stroke path along outer circle from degStart → degEnd (clockwise from top). */
function snapshotDonutStrokeArcPath(degStart: number, degEnd: number): string {
  const { r } = SNAPSHOT_DONUT;
  const d = ((degEnd - degStart) % 360 + 360) % 360;
  if (d < 0.000_1) return "";
  const p1 = snapshotDonutPt(r, degStart);
  const p2 = snapshotDonutPt(r, degEnd);
  const large = d > 180 ? 1 : 0;
  const f = donutPathFmt;
  return `M ${f(p1.x)} ${f(p1.y)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(p2.x)} ${f(p2.y)}`;
}

/** Full circle as two half-arcs (grey track). */
function snapshotDonutFullRingPath(): string {
  const { cx, cy, r } = SNAPSHOT_DONUT;
  const f = donutPathFmt;
  const top = f(cy - r);
  const bot = f(cy + r);
  return `M ${f(cx)} ${top} A ${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${bot} A ${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${top}`;
}

export async function POST(req: Request) {
  try {
    const body = asRecord(await req.json());

    const mode: ReportMode = body?.mode === "client" ? "client" : "advisor";
    const client = asRecord(body.client);
    const analysis = asRecord(body.analysis);
    const allocation = asRecord(body.allocation);
    const currentAllocation = asRecord(allocation.current);
    const targetAllocation = asRecord(allocation.target);
    const scoresInput = asRecord(body.scores);
    const totalValue = Number(body?.totalValue || 0);
    const holdings = Array.isArray(body?.holdings) ? body.holdings : [];

    const demoMode = Boolean(body?.demoMode);
    const identity = await resolveAdvisorIdentity(req);
    if (!demoMode && !identity) {
      return NextResponse.json({ error: "Sign in to generate PDF reports." }, { status: 401 });
    }

    const clientIdForAudit = typeof body?.clientId === "string" ? body.clientId : null;
    const auditOwnerEmail = identity?.email ?? "unauthenticated.demo";
    const auditOwnerUserId = identity?.userId ?? null;

    function asNumber(value: unknown, fallback = 0) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function clampScore(value: number) {
      if (!Number.isFinite(value)) return 50;
      return Math.max(1, Math.min(100, Math.round(value)));
    }

    function calculatePortfolioScores() {
      const current = {
        equity: asNumber(currentAllocation.equity),
        fixedIncome: asNumber(currentAllocation.fixedIncome),
        cash: asNumber(currentAllocation.cash),
      };

      const target = {
        equity: asNumber(targetAllocation.equity, 60),
        fixedIncome: asNumber(targetAllocation.fixedIncome, 35),
        cash: asNumber(targetAllocation.cash, 5),
      };

      const equityGap = Math.abs(current.equity - target.equity);
      const fixedGap = Math.abs(current.fixedIncome - target.fixedIncome);
      const cashGap = Math.abs(current.cash - target.cash);
      const totalAllocationGap = equityGap + fixedGap + cashGap;

      const riskAlignment = clampScore(100 - equityGap * 1.7 - fixedGap * 1.0 - cashGap * 0.6);
      const diversification = clampScore(
        82 - totalAllocationGap * 0.5 - Math.max(0, current.equity - 65) * 0.5 - Math.max(0, 5 - current.cash) * 1.2
      );
      const fixedIncomeTarget = Math.max(target.fixedIncome, 1);
      const fixedIncomeProgress = Math.min(current.fixedIncome / fixedIncomeTarget, 1);
      const incomeReadiness = clampScore(
        20 + fixedIncomeProgress * 55 + Math.min(current.cash, 10) * 1.0 - Math.max(0, current.equity - target.equity) * 0.45
      );

      return { riskAlignment, diversification, incomeReadiness };
    }

    const calculatedScores = calculatePortfolioScores();
    const scores = {
      riskAlignment: asNumber(scoresInput?.riskAlignment, calculatedScores.riskAlignment) || calculatedScores.riskAlignment,
      diversification: asNumber(scoresInput?.diversification, calculatedScores.diversification) || calculatedScores.diversification,
      incomeReadiness: asNumber(scoresInput?.incomeReadiness, calculatedScores.incomeReadiness) || calculatedScores.incomeReadiness,
    };

    function calculateOverlapInsights() {
      const insights: string[] = [];
      const holdingText = holdings
        .map((holding) => {
          const h = asRecord(holding);
          return `${h.rawName || ""} ${h.suggested || ""} ${h.assetClass || ""}`.toLowerCase();
        })
        .join(" ");

      const currentEquity = asNumber(currentAllocation.equity);
      const currentFixed = asNumber(currentAllocation.fixedIncome);
      const targetFixed = asNumber(targetAllocation.fixedIncome, 35);

      const hasSp500OrLargeCap =
        holdingText.includes("s&p") || holdingText.includes("500") || holdingText.includes("vfiax") ||
        holdingText.includes("voo") || holdingText.includes("spy") || holdingText.includes("large cap");
      const hasGrowthFund = holdingText.includes("fcntx") || holdingText.includes("contrafund") || holdingText.includes("growth");
      const bigTechNames = ["aapl", "apple", "msft", "microsoft", "amzn", "amazon", "nvda", "nvidia", "goog", "google", "meta", "tesla", "tsla"];
      const bigTechCount = bigTechNames.filter((name) => holdingText.includes(name)).length;
      const hasDividend = holdingText.includes("schd") || holdingText.includes("dividend") || holdingText.includes("equity income");
      const hasMultipleBondFunds =
        (holdingText.includes("ponax") || holdingText.includes("pimco income")) &&
        (holdingText.includes("agg") || holdingText.includes("aggregate bond") || holdingText.includes("treasury"));

      if (hasSp500OrLargeCap && (hasGrowthFund || bigTechCount >= 2)) {
        insights.push("The portfolio may look diversified across several positions, but underlying exposure should be reviewed for overlap between large-cap index funds, growth funds, and individual technology stocks.");
      }
      if (bigTechCount >= 2) {
        insights.push("Individual technology holdings may be adding concentrated exposure on top of any technology exposure already held inside broad-market or growth-oriented mutual funds.");
      }
      if (currentEquity >= 70) {
        insights.push(`Equity exposure at ${currentEquity}% may cause multiple equity holdings to move together during broad market declines, reducing the practical benefit of holding many separate positions.`);
      }
      if (currentFixed < targetFixed && hasMultipleBondFunds) {
        insights.push("Fixed-position holdings should be reviewed for role clarity, because bond funds, aggregate bond exposure, and Treasury positions may behave differently across rate environments.");
      }
      if (hasDividend && currentEquity > 60) {
        insights.push("Dividend-oriented equity exposure may help with income, but it should still be reviewed as equity risk rather than being treated as a substitute for fixed or guaranteed income.");
      }
      if (!insights.length) {
        insights.push("No major overlap pattern was automatically detected, but underlying fund holdings should still be reviewed for hidden concentration before making final recommendations.");
      }
      return insights.slice(0, 4);
    }

    const overlapInsightItems =
      Array.isArray(analysis?.overlapInsights) && analysis.overlapInsights.length
        ? stringItems(analysis.overlapInsights, 4)
        : calculateOverlapInsights();

    const whatThisMeansItems =
      Array.isArray(analysis?.displayWhatThisMeans) && analysis.displayWhatThisMeans.length
        ? uniqueItems(analysis.displayWhatThisMeans, 3)
        : Array.isArray(analysis?.whatThisMeans) && analysis.whatThisMeans.length
          ? uniqueItems(analysis.whatThisMeans, 3)
          : [
              "The portfolio may feel more volatile than the client expects during market pullbacks.",
              "The current positioning may not provide enough stability for a retirement income conversation.",
              "A more balanced approach may help the client stay invested with greater confidence.",
            ];

    const strategyItems = stringItems(analysis?.strategies, 6);
    const redFlagItems = stringItems(analysis?.redFlags, 6);
    const recommendationItems = stringItems(analysis?.recommendations, 6);
    const meetingItems = stringItems(analysis?.talkingPoints, 6);

    const portfolioHighlightItems =
      Array.isArray(analysis?.portfolioHighlights) && analysis.portfolioHighlights.length
        ? uniqueItems(analysis.portfolioHighlights, 3)
        : [
            "Portfolio is positioned primarily for growth based on the current allocation mix.",
            "Concentration and overlap should be reviewed where similar equity exposure appears across multiple holdings.",
            "Liquidity and stability should be evaluated against the client's retirement timeline and planning goals.",
          ];



    function createSeededRandom(seed: number) {
      let s = seed >>> 0;
      return function random() {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
    }

    function normalRandom(random: () => number) {
      // Box-Muller transform
      const u1 = Math.max(random(), 1e-12);
      const u2 = Math.max(random(), 1e-12);
      return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }

    function calculateRetirementSuccessModel(input: {
      age: number;
      retirementAge: number;
      equity: number;
      fixedIncome: number;
      cash: number;
      riskProfile: string;
      portfolioValue?: number;
      trials?: number;
    }) {
      const age = asNumber(input.age, 62);
      const retirementAge = asNumber(input.retirementAge, 67);
      const yearsToRetirement = Math.max(retirementAge - age, 0);
      const retirementEndAge = 95;
      const retirementYears = Math.max(retirementEndAge - retirementAge, 20);

      const equity = Math.max(0, Math.min(100, asNumber(input.equity)));
      const fixedIncome = Math.max(0, Math.min(100, asNumber(input.fixedIncome)));
      const cash = Math.max(0, Math.min(100, asNumber(input.cash)));

      const totalAllocation = Math.max(equity + fixedIncome + cash, 1);
      const equityWeight = equity / totalAllocation;
      const fixedWeight = fixedIncome / totalAllocation;
      const cashWeight = cash / totalAllocation;

      const startingPortfolio = Math.max(asNumber(input.portfolioValue, totalValue), 1);
      const trials = Math.max(1000, Math.min(15000, Math.round(asNumber(input.trials, 5000))));

      // Long-term capital market assumptions. These are intentionally conservative
      // and should be replaced later with your own firm assumptions if desired.
      const equityMean = 0.068;
      const fixedMean = 0.040;
      const cashMean = 0.023;

      const equityVol = 0.165;
      const fixedVol = 0.060;
      const cashVol = 0.012;

      const inflationMean = 0.026;
      const inflationVol = 0.012;

      const assumedWithdrawalRate =
        input.riskProfile === "conservative" || input.riskProfile === "moderate-conservative"
          ? 0.038
          : input.riskProfile === "aggressive"
            ? 0.045
            : 0.041;

      const seed =
        Math.round(age * 101) +
        Math.round(retirementAge * 211) +
        Math.round(equity * 307) +
        Math.round(fixedIncome * 401) +
        Math.round(cash * 503) +
        (input.riskProfile || "moderate").length * 997;

      const random = createSeededRandom(seed);
      let successfulTrials = 0;

      for (let trial = 0; trial < trials; trial++) {
        let balance = startingPortfolio;

        for (let year = 0; year < yearsToRetirement; year++) {
          const equityReturn = equityMean + equityVol * normalRandom(random);
          const fixedReturn = fixedMean + fixedVol * normalRandom(random);
          const cashReturn = cashMean + cashVol * normalRandom(random);

          const portfolioReturn =
            equityWeight * equityReturn +
            fixedWeight * fixedReturn +
            cashWeight * cashReturn;

          balance *= 1 + portfolioReturn;
          if (balance <= 0) break;
        }

        let annualWithdrawal = startingPortfolio * assumedWithdrawalRate;

        for (let year = 0; year < retirementYears; year++) {
          const inflation = Math.max(-0.01, inflationMean + inflationVol * normalRandom(random));
          if (year > 0) annualWithdrawal *= 1 + inflation;

          // Withdraw at start of year to stress sequence-of-return risk.
          balance -= annualWithdrawal;
          if (balance <= 0) break;

          const equityReturn = equityMean + equityVol * normalRandom(random);
          const fixedReturn = fixedMean + fixedVol * normalRandom(random);
          const cashReturn = cashMean + cashVol * normalRandom(random);

          // Extra sequence risk pressure for equity-heavy portfolios in early retirement.
          const sequenceShock =
            year < 5 && equityWeight > 0.7 && random() < 0.14
              ? -0.12 * (equityWeight - 0.7) / 0.3
              : 0;

          const portfolioReturn =
            equityWeight * equityReturn +
            fixedWeight * fixedReturn +
            cashWeight * cashReturn +
            sequenceShock;

          balance *= 1 + portfolioReturn;
        }

        if (balance > 0) successfulTrials += 1;
      }

      return Math.max(1, Math.min(99, Math.round((successfulTrials / trials) * 100)));
    }
    function successLabel(score: number) {
      if (score >= 85) return "Strong";
      if (score >= 70) return "Moderate";
      return "Needs Review";
    }

    const modelInput = asRecord(body?.retirementModel);
    const currentSuccessRate =
      asNumber(modelInput?.currentSuccessRate) ||
      calculateRetirementSuccessModel({
        age: asNumber(client?.age, 62),
        retirementAge: asNumber(client?.retirementAge, 67),
        equity: asNumber(currentAllocation.equity),
        fixedIncome: asNumber(currentAllocation.fixedIncome),
        cash: asNumber(currentAllocation.cash),
        riskProfile: String(client?.riskProfile || "moderate"),
        portfolioValue: totalValue,
        trials: 5000,
      });

    const proposedSuccessRate =
      asNumber(modelInput?.proposedSuccessRate) ||
      calculateRetirementSuccessModel({
        age: asNumber(client?.age, 62),
        retirementAge: asNumber(client?.retirementAge, 67),
        equity: asNumber(targetAllocation.equity, 60),
        fixedIncome: asNumber(targetAllocation.fixedIncome, 35),
        cash: asNumber(targetAllocation.cash, 5),
        riskProfile: String(client?.riskProfile || "moderate"),
        portfolioValue: totalValue,
        trials: 5000,
      });

    const fileName = mode === "client" ? "Client_Snapshot.pdf" : "Advisor_Deep_Dive.pdf";

    const reportDateStr = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]);

    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let logoImage: PDFImage | null = null;
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.png");
      const logoBytes = await fs.readFile(logoPath);
      logoImage = await pdfDoc.embedPng(logoBytes);
    } catch {
      logoImage = null;
    }

    /** McKinsey-style financial report palette: disciplined navy, single gold accent, minimal saturation. */
    const navy = rgb(0.03, 0.12, 0.22);
    const navyLight = rgb(0.07, 0.18, 0.32);
    const ink = rgb(0.16, 0.18, 0.2);
    const stayBar = rgb(0.12, 0.36, 0.55);
    const stayBarSoft = rgb(0.75, 0.84, 0.92);
    const accentSecondary = navyLight;
    const goldAccent = rgb(0.78, 0.62, 0.28);
    const red = rgb(0.70, 0.14, 0.16);
    const muted = rgb(0.38, 0.4, 0.44);
    const surface = rgb(0.97, 0.98, 0.99);
    const softBlue = rgb(0.92, 0.96, 1.0);
    const softTeal = stayBarSoft;
    const softRed = rgb(1.0, 0.94, 0.94);
    const rule = rgb(0.78, 0.8, 0.84);
    const ruleStrong = rgb(0.55, 0.58, 0.62);
    const white = rgb(1, 1, 1);
    /** Allocation donut — match app `allocationData` / `allocationDataCurrent` (ProfessionalDonutChart). */
    const donutEquity = rgb(15 / 255, 118 / 255, 110 / 255);
    const donutFixed = rgb(29 / 255, 78 / 255, 216 / 255);
    const donutCash = rgb(201 / 255, 151 / 255, 0);
    const donutOther = rgb(100 / 255, 116 / 255, 139 / 255);
    /** #e5e7eb — same as ProfessionalDonutChart base stroke. */
    const donutTrack = rgb(229 / 255, 231 / 255, 235 / 255);

    const MARGIN = 44;
    const CONTENT_W = 612 - MARGIN * 2;
    /** Typography: prose right edge aligns with section title rule (x = MARGIN + CONTENT_W). */
    const synopsisTextX = MARGIN + 12;
    const synopsisWrapWidthPt = MARGIN + CONTENT_W - synopsisTextX;
    /** Gold-bar synopsis runs slightly larger than appendix body (appendix sizing unchanged). */
    const synopsisFontSize = 8.2;
    const synopsisLineGap = 3.55;
    const boxedTextInsetX = MARGIN + 14;
    const boxedTextWrapWidthPt = CONTENT_W - 28;
    const cardListTextX = MARGIN + 22;
    const cardListWrapWidthPt = MARGIN + CONTENT_W - cardListTextX;
    const appendixWrapWidthPt = CONTENT_W;

    let exhibitCounter = 0;

    /** Minimum y for body content (points above page bottom); keeps text clear of footer rule and disclaimer. */
    const FOOTER_SAFE_Y = 74;

    let y = 740;
    let pageNumber = 1;

    function pageTitle() {
      return mode === "client" ? "Portfolio review  |  Client snapshot" : "Portfolio review  |  Advisor deep dive";
    }

    function pageTitleShort() {
      return mode === "client" ? "Client snapshot" : "Advisor deep dive";
    }

    function drawTopAccentLine(pg: PDFPage, topY: number, w = 612) {
      pg.drawRectangle({ x: 0, y: topY - 3, width: w, height: 3, color: goldAccent });
    }

    function drawFooter(pageRef: PDFPage, pageNum: number, totalPages: number) {
      const footer =
        "For discussion purposes only. Not a recommendation to buy or sell securities. Review with a licensed financial professional. Investment and insurance strategies should be evaluated based on the client's full financial situation, objectives, time horizon, liquidity needs, tax status, and risk tolerance.";
      const leftRun = `AdvisorPilot  |  ${pageTitleShort()}`;
      pageRef.drawLine({
        start: { x: MARGIN, y: 52 },
        end: { x: 612 - MARGIN, y: 52 },
        thickness: 0.4,
        color: rule,
      });
      pageRef.drawText(cleanText(leftRun), {
        x: MARGIN,
        y: 44,
        size: 5.8,
        font: regular,
        color: muted,
      });
      const rightTxt = `Page ${pageNum} of ${totalPages}`;
      const rw = regular.widthOfTextAtSize(rightTxt, 5.8);
      pageRef.drawText(rightTxt, {
        x: 612 - MARGIN - rw,
        y: 44,
        size: 5.8,
        font: regular,
        color: muted,
      });

      const text = cleanText(footer);
      const maxChars = 118;
      const words = text.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        if ((line + word).length > maxChars) {
          lines.push(line.trim());
          line = word + " ";
        } else {
          line += word + " ";
        }
      }
      if (line.trim()) lines.push(line.trim());
      let fy = 34 + (lines.length - 1) * 5;
      for (const l of lines) {
        const w = regular.widthOfTextAtSize(l, 5);
        pageRef.drawText(l, { x: (612 - w) / 2, y: fy, size: 5, font: regular, color: muted });
        fy -= 5;
      }
    }

    function drawHeader() {
      page.drawRectangle({ x: 0, y: 722, width: 612, height: 72, color: navy });
      drawTopAccentLine(page, 794);
      page.drawText(cleanText(pageTitle()), { x: MARGIN, y: 762, size: 18, font: bold, color: white });
      page.drawText("WEALTH AND ASSET MANAGEMENT", {
        x: MARGIN,
        y: 746,
        size: 6.2,
        font: bold,
        color: rgb(0.65, 0.72, 0.82),
      });
      const subLine = `${clientDisplayName(client) || "Client"}  |  Age ${client.age || "N/A"}  |  ${mode === "client" ? "Client summary" : "Advisor working session"}`;
      page.drawText(cleanText(subLine), {
        x: MARGIN,
        y: 728,
        size: 8.8,
        font: regular,
        color: rgb(0.82, 0.87, 0.93),
      });
      const metaLine = `Risk profile: ${String(client.riskProfile || "N/A").replace("-", " ")}  |  Portfolio value: ${money(totalValue)}  |  Prepared: ${reportDateStr}`;
      page.drawText(cleanText(metaLine), {
        x: MARGIN,
        y: 712,
        size: 8,
        font: regular,
        color: rgb(0.7, 0.78, 0.88),
      });

      if (logoImage) {
        page.drawRectangle({
          x: 526,
          y: 728,
          width: 48,
          height: 36,
          color: white,
          opacity: 0.94,
          borderColor: rgb(0.18, 0.36, 0.54),
          borderWidth: 0.6,
        });
        page.drawImage(logoImage, { x: 533, y: 732, width: 34, height: 28 });
      } else {
        page.drawText("AdvisorPilot", { x: 498, y: 732, size: 10, font: bold, color: white });
      }

      y = 688;
    }

    function drawSmallHeader() {
      drawTopAccentLine(page, 792);
      /* Full-width rule sits above the subtitle so caps (above baseline) are not struck through. */
      page.drawRectangle({ x: 0, y: 762, width: 612, height: 1, color: ruleStrong });
      page.drawText("AdvisorPilot", { x: MARGIN, y: 770, size: 10, font: bold, color: navyLight });
      page.drawText(cleanText(pageTitle()), { x: MARGIN, y: 746, size: 7.2, font: regular, color: muted });
      const rightTxt = `Page ${pageNumber}`;
      const rw = regular.widthOfTextAtSize(rightTxt, 7.2);
      page.drawText(rightTxt, { x: 612 - MARGIN - rw, y: 770, size: 7.2, font: regular, color: muted });
      /* Closer to header band so body sections are not visually “pushed down” on continuation pages. */
      /* Continuation pages: start body closer to mini-header for tighter editorial rhythm */
      y = 732;
    }

    /** All-caps section eyebrow (McKinsey-style section labels). */
    function drawSectionEyebrow(label: string) {
      page.drawText(cleanText(label.toUpperCase()), {
        x: MARGIN,
        y,
        size: 6.4,
        font: bold,
        color: stayBar,
      });
      y -= 14;
    }

    function newPage() {
      page = pdfDoc.addPage([612, 792]);
      pageNumber += 1;
      drawSmallHeader();
    }

    function availableHeight() {
      return y - FOOTER_SAFE_Y;
    }

    /** Page 1 only: synopsis must not push content past floorY (stays above footer band). */
    function drawSynopsisOnPageOne(text: unknown, floorY: number) {
      const size = synopsisFontSize;
      const gap = synopsisLineGap;
      const lineH = size + gap;
      let t = cleanText(text) || "No analysis available.";
      const maxLines = Math.max(3, Math.floor((y - floorY - 6) / lineH));

      const truncateToMaxLines = (s: string): string => {
        let cur = s;
        while (wrapLinesToWidth(cur, regular, size, synopsisWrapWidthPt).length > maxLines && cur.length > 40) {
          cur = cur.slice(0, cur.length - 6).trim();
          const cut = cur.replace(/\s+\S*$/, "");
          cur = cut + "...";
        }
        const truncatedLines = wrapLinesToWidth(cur, regular, size, synopsisWrapWidthPt);
        if (truncatedLines.length <= maxLines) return cur;
        const joined = truncatedLines.slice(0, maxLines).join(" ");
        return joined.slice(0, Math.max(20, joined.length - 12)).replace(/\s+\S*$/, "") + "...";
      };

      t = truncateToMaxLines(t);
      const lines = wrapLinesToWidth(t, regular, size, synopsisWrapWidthPt);
      const barH = Math.max(lines.length * lineH + 4, lineH + 4);
      page.drawRectangle({
        x: MARGIN,
        y: y - barH,
        width: 2.5,
        height: barH,
        color: goldAccent,
      });
      y = drawWrappedTextToWidth(t, synopsisTextX, y, synopsisWrapWidthPt, size, ink, regular, gap) - 5;
    }

    function wrapLinesToWidth(text: unknown, font: PDFFont, fontSize: number, maxWidthPt: number): string[] {
      const raw = cleanText(text);
      const words = raw.split(/\s+/).filter(Boolean);
      if (!words.length) return [""];

      const linesOut: string[] = [];
      let current = "";
      const widthOf = (s: string) => font.widthOfTextAtSize(s, fontSize);

      const flush = () => {
        if (current) {
          linesOut.push(current);
          current = "";
        }
      };

      for (const word of words) {
        const trial = current ? `${current} ${word}` : word;
        if (widthOf(trial) <= maxWidthPt) {
          current = trial;
          continue;
        }

        flush();

        if (widthOf(word) <= maxWidthPt) {
          current = word;
          continue;
        }

        let piece = "";
        for (let i = 0; i < word.length; i++) {
          const ch = word[i]!;
          const nextPiece = piece + ch;
          if (widthOf(nextPiece) <= maxWidthPt) piece = nextPiece;
          else {
            if (piece) linesOut.push(piece);
            piece = ch;
          }
        }
        current = piece;
      }

      flush();
      return linesOut.length ? linesOut : [""];
    }

    function estimateLinesToWidth(text: unknown, font: PDFFont, fontSize: number, maxWidthPt: number): number {
      return Math.max(1, wrapLinesToWidth(text, font, fontSize, maxWidthPt).length);
    }

    function drawWrappedTextToWidth(
      text: unknown,
      x: number,
      startY: number,
      maxWidthPt: number,
      size: number,
      color: RGB,
      font = regular,
      lineGap = 5.2,
    ) {
      const linesOut = wrapLinesToWidth(text, font, size, maxWidthPt);
      let yy = startY;
      for (const line of linesOut) {
        page.drawText(line, { x, y: yy, size, font, color });
        yy -= size + lineGap;
      }
      return yy;
    }

    function sectionBlockHeight(items: string[], subtitle = "") {
      // Conservative estimate so a section does not start at the bottom of one page
      // and continue onto the next unless it is truly too large to fit on one page.
      const header = subtitle ? 64 : 50;
      const rowGap = 12;
      let total = header;

      for (const item of items) {
        const lines = estimateLinesToWidth(item, regular, 8.4, cardListWrapWidthPt);
        total += Math.max(54, 34 + lines * 13.2) + rowGap;
      }

      return total + 20;
    }

    function paragraphBlockHeight(text: unknown, subtitle = "") {
      const lines = estimateLinesToWidth(text, regular, 8.6, boxedTextWrapWidthPt);
      return (subtitle ? 50 : 38) + lines * 14.2 + 26;
    }

    function ensureBlock(height: number) {
      // If a section can fit on a fresh page, never let it begin unless it has room
      // to finish on the current page. This keeps Client Snapshot sections clean.
      const freshPageCapacity = 640;
      if (height <= freshPageCapacity && availableHeight() < height) newPage();
    }

    function sectionTitle(title: string, subtitle?: string, opts?: { exhibit?: boolean }) {
      if (opts?.exhibit) {
        exhibitCounter += 1;
        page.drawText(`Exhibit ${exhibitCounter}`, {
          x: MARGIN,
          y,
          size: 6.5,
          font: bold,
          color: muted,
        });
        y -= 11;
      }
      page.drawRectangle({ x: MARGIN, y: y - 11, width: 3, height: 13, color: stayBar });
      page.drawText(cleanText(title), { x: MARGIN + 10, y, size: 11, font: bold, color: navyLight });
      y -= 19;
      page.drawLine({
        start: { x: MARGIN, y: y + 9 },
        end: { x: MARGIN + CONTENT_W, y: y + 9 },
        thickness: 0.45,
        color: rule,
      });
      y -= 11;
      if (subtitle) {
        page.drawText(cleanText(subtitle), { x: MARGIN, y, size: 7.6, font: regular, color: muted });
        y -= 13;
      } else {
        y -= 5;
      }
    }

    function drawTextSection(title: string, subtitle: string, text: unknown) {
      const fs = 8.6;
      const lineGap = 5;
      const padT = 10;
      const padB = 11;
      const lines = wrapLinesToWidth(text, regular, fs, boxedTextWrapWidthPt);
      const textBodyH = lines.length * (fs + lineGap) - lineGap + padT + padB;
      const h = paragraphBlockHeight(text, subtitle);
      ensureBlock(Math.max(h, textBodyH + 80));
      sectionTitle(title, subtitle);
      const gapBelowTitle = 6;
      const boxTop = y - gapBelowTitle;
      const boxBottom = boxTop - textBodyH;

      page.drawRectangle({
        x: MARGIN,
        y: boxBottom,
        width: CONTENT_W,
        height: textBodyH,
        color: surface,
        borderColor: rule,
        borderWidth: 0.4,
      });
      page.drawRectangle({
        x: MARGIN,
        y: boxBottom,
        width: 2,
        height: textBodyH,
        color: goldAccent,
      });
      y = drawWrappedTextToWidth(text, boxedTextInsetX, boxTop - padT, boxedTextWrapWidthPt, fs, ink, regular, lineGap);
      y = y - padB - 8;
    }

    function drawCardSection(title: string, subtitle: string, items: string[], _accent: RGB = stayBar, _fill: RGB = surface) {
      if (!items.length) return;

      const sectionHeight = sectionBlockHeight(items, subtitle);
      ensureBlock(sectionHeight);
      sectionTitle(title, subtitle);

      const lineGap = 4.4;
      for (let idx = 1; idx <= items.length; idx++) {
        const item = items[idx - 1]!;
        const lines = estimateLinesToWidth(item, regular, 8.4, cardListWrapWidthPt);
        const blockH = Math.max(28, lines * (8.4 + lineGap) + 20);
        if (blockH + 40 > availableHeight()) newPage();

        const itemTop = y;
        page.drawText(`${idx}.`, {
          x: MARGIN,
          y: itemTop,
          size: 8.5,
          font: bold,
          color: stayBar,
        });
        const textBottom = drawWrappedTextToWidth(
          item,
          cardListTextX,
          itemTop,
          cardListWrapWidthPt,
          8.4,
          ink,
          regular,
          lineGap,
        );
        const dividerY = textBottom - 5;
        page.drawLine({
          start: { x: MARGIN, y: dividerY },
          end: { x: MARGIN + CONTENT_W, y: dividerY },
          thickness: 0.3,
          color: rgb(0.88, 0.9, 0.93),
        });
        y = dividerY - 11;
      }
      y -= 5;
    }

    function drawHistoricalDecadeScenarios() {
      const rowCount = TEN_YEAR_SCENARIOS.length + 1;
      const sectionHeight = 80 + 22 + rowCount * 26 + 30;
      ensureBlock(sectionHeight);
      sectionTitle(
        "Hypothetical Allocation Stress",
        "Decade rows: CAGR vs proposed sleeve. Bottom row: 2008 modeled calendar-year blend (worst calibrated S&P year).",
        { exhibit: true }
      );

      const targetSlice = {
        equity: asNumber(targetAllocation.equity, 60),
        fixedIncome: asNumber(targetAllocation.fixedIncome, 35),
        cash: asNumber(targetAllocation.cash, 5),
      };

      const tableX = MARGIN;
      const tableW = CONTENT_W;
      const headerH = 22;
      const rowH = 26;
      const rows = [
        ...TEN_YEAR_SCENARIOS.map((scenario) => {
          const cur = scenarioHoldingsPortfolioReturnDecimal(scenario.years, holdings as ScenarioHoldingLike[]);
          const prop = scenarioProposedPortfolioReturnDecimal(scenario.years, targetSlice);
          return {
            label: `${scenario.label} (${scenario.years[0]}-${scenario.years[9]}, CAGR)`,
            current: formatTenYearScenarioPercent(cur),
            proposed: formatTenYearScenarioPercent(prop),
          };
        }),
        {
          label: `Biggest drawdown (${BIGGEST_DRAWDOWN_SCENARIO_YEAR} calendar year)`,
          current: formatTenYearScenarioPercent(
            scenarioHoldingsPortfolioSingleYearReturnDecimal(BIGGEST_DRAWDOWN_SCENARIO_YEAR, holdings as ScenarioHoldingLike[]),
          ),
          proposed: formatTenYearScenarioPercent(
            scenarioProposedPortfolioSingleYearReturnDecimal(BIGGEST_DRAWDOWN_SCENARIO_YEAR, targetSlice),
          ),
        },
      ];

      const tableTop = y + 2;
      const tableBottom = tableTop - headerH - rows.length * rowH;

      page.drawRectangle({
        x: tableX,
        y: tableBottom,
        width: tableW,
        height: headerH + rows.length * rowH,
        color: white,
        borderColor: rule,
        borderWidth: 0.55,
      });
      page.drawRectangle({
        x: tableX,
        y: tableTop - headerH,
        width: tableW,
        height: headerH,
        color: navy,
      });
      page.drawText("Stress window", { x: tableX + 14, y: tableTop - 15, size: 7.5, font: bold, color: white });
      const cx = tableX + 330;
      const px = tableX + 446;
      const numW = 56;
      const wHc = bold.widthOfTextAtSize("Current", 7.5);
      const wHp = bold.widthOfTextAtSize("Proposed", 7.5);
      page.drawText("Current", { x: cx + numW - wHc, y: tableTop - 15, size: 7.5, font: bold, color: white });
      page.drawText("Proposed", { x: px + numW - wHp, y: tableTop - 15, size: 7.5, font: bold, color: white });

      let rowY = tableTop - headerH;
      rows.forEach((row, index) => {
        rowY -= rowH;
        const rowFill = index % 2 === 0 ? surface : white;
        page.drawRectangle({
          x: tableX,
          y: rowY,
          width: tableW,
          height: rowH,
          color: rowFill,
          borderColor: rgb(0.91, 0.94, 0.96),
          borderWidth: 0.22,
        });
        const baseline = rowY + rowH / 2 - 2;
        page.drawText(cleanText(row.label).slice(0, 58), {
          x: tableX + 12,
          y: baseline,
          size: 8,
          font: regular,
          color: navy,
        });
        const wC = bold.widthOfTextAtSize(row.current, 9);
        const wP = bold.widthOfTextAtSize(row.proposed, 9);
        page.drawText(row.current, { x: cx + numW - wC, y: baseline, size: 9, font: bold, color: ink });
        page.drawText(row.proposed, { x: px + numW - wP, y: baseline, size: 9, font: bold, color: navy });
      });

      y = tableBottom - 14;
      page.drawText(
        cleanText(
          "Decades: CAGR (10-year geometric mean). Bottom row: 2008 modeled one-year blended return (firm S&P -36.55% on equities)."
        ),
        { x: MARGIN, y, size: 6.2, font: regular, color: muted }
      );
      y -= 12;
    }

    function drawScoreCard(
      title: string,
      value: number,
      helper: string,
      x: number,
      top: number,
      color: RGB,
      boxH = 76
    ) {
      const n = Math.max(0, Math.min(100, Number(value || 0)));
      const titleSize = boxH < 68 ? 8 : 8.6;
      const numSize = boxH < 68 ? 18 : 22;
      const titleY = top - (boxH < 68 ? 18 : 22);
      const numY = top - (boxH < 68 ? 36 : 50);
      const slashY = top - (boxH < 68 ? 34 : 47);
      const helperY = top - (boxH < 68 ? 52 : 64);
      const barY = top - (boxH < 68 ? 44 : 50);

      page.drawRectangle({ x, y: top - boxH, width: 168, height: boxH, color: white, borderColor: rule, borderWidth: 0.4 });
      page.drawRectangle({ x, y: top - 3, width: 168, height: 3, color });
      page.drawText(title, { x: x + 12, y: titleY, size: titleSize, font: bold, color: navy });
      page.drawText(`${Math.round(n)}`, { x: x + 12, y: numY, size: numSize, font: bold, color: navy });
      page.drawText("/100", { x: x + Math.round(numSize === 18 ? 38 : 46), y: slashY, size: 8.5, font: regular, color: muted });
      page.drawText(helper, { x: x + 12, y: helperY, size: 6.6, font: regular, color: muted });
      page.drawRectangle({ x: x + 78, y: barY, width: 76, height: 3, color: rgb(0.89, 0.92, 0.95) });
      page.drawRectangle({ x: x + 78, y: barY, width: 76 * (n / 100), height: 3, color: n >= 75 ? stayBar : n >= 55 ? goldAccent : red });
    }


    function drawRetirementSuccessModel() {
      const sectionHeight = 300;
      ensureBlock(sectionHeight);
      sectionTitle("Retirement success model", undefined, { exhibit: true });

      const boxX = MARGIN;
      const boxTop = y - 4;
      const boxW = CONTENT_W;
      /* Tall enough for second bar + delta band + padding above card bottom */
      const boxH = 156;
      const boxBottom = boxTop - boxH;

      page.drawRectangle({
        x: boxX,
        y: boxBottom,
        width: boxW,
        height: boxH,
        color: white,
        borderColor: rule,
        borderWidth: 0.4,
      });

      page.drawRectangle({
        x: boxX,
        y: boxTop - 3,
        width: boxW,
        height: 2.5,
        color: goldAccent,
      });

      function gradeColor(value: number) {
        if (value >= 85) return stayBar;
        if (value >= 70) return goldAccent;
        return red;
      }

      const innerX = boxX + 14;
      const barW = 274;
      const scoreX = innerX + barW + 14;
      const barH = 11;
      const markH = barH + 5;

      function drawSuccessBar(label: string, value: number, modelLabel: string, top: number) {
        const n = Math.max(0, Math.min(100, Number(value || 0)));
        const scoreColor = gradeColor(n);

        page.drawText(cleanText(label), {
          x: innerX,
          y: top,
          size: 9,
          font: bold,
          color: navy,
        });

        page.drawText(cleanText(modelLabel), {
          x: innerX,
          y: top - 12,
          size: 6.9,
          font: regular,
          color: muted,
        });

        page.drawRectangle({
          x: scoreX,
          y: top - 27,
          width: 90,
          height: 32,
          color: white,
          borderColor: scoreColor,
          borderWidth: 0.55,
        });

        page.drawText(`${Math.round(n)}/100`, {
          x: scoreX + 10,
          y: top - 11,
          size: 14,
          font: bold,
          color: navy,
        });

        page.drawText(successLabel(n), {
          x: scoreX + 10,
          y: top - 22,
          size: 6.8,
          font: regular,
          color: scoreColor,
        });

        page.drawRectangle({
          x: innerX,
          y: top - 38,
          width: barW,
          height: barH,
          color: rgb(0.90, 0.93, 0.96),
        });

        page.drawRectangle({
          x: innerX,
          y: top - 38,
          width: barW * (n / 100),
          height: barH,
          color: scoreColor,
        });

        page.drawRectangle({
          x: innerX + barW * 0.85,
          y: top - 40,
          width: 1,
          height: markH,
          color: navy,
        });
      }

      const rowTopCurrent = boxTop - 24;
      const rowTopProposed = boxTop - 90;
      drawSuccessBar("Current allocation", currentSuccessRate, "Based on current positioning", rowTopCurrent);
      drawSuccessBar("Proposed allocation", proposedSuccessRate, "Based on proposed allocation", rowTopProposed);

      const delta = proposedSuccessRate - currentSuccessRate;
      const deltaText = delta >= 0 ? `+${delta} points vs. current` : `${delta} points vs. current`;

      const deltaH = 20;
      /* Bar track y is the rectangle bottom edge in PDF coords */
      const secondBarBottomY = rowTopProposed - 38;
      const gapAboveDelta = 5;
      const deltaY = secondBarBottomY - gapAboveDelta - deltaH;
      page.drawRectangle({
        x: innerX,
        y: deltaY,
        width: 176,
        height: deltaH,
        color: delta >= 0 ? softTeal : softRed,
        borderColor: delta >= 0 ? stayBar : red,
        borderWidth: 0.45,
      });

      page.drawText(cleanText(deltaText), {
        x: innerX + 10,
        y: deltaY + 13,
        size: 8.2,
        font: bold,
        color: delta >= 0 ? stayBar : red,
      });

      y = boxBottom - 10;
    }

    /** Short cross-reference after the retirement exhibit; full methodology moves to appendix. */
    function drawRetirementSuccessMethodologyCue() {
      const lineA =
        mode === "client"
          ? "These scores illustrate sustainability under modeled scenarios only. They are not predictions of outcomes or suitability."
          : "Illustrative sustainability scores based on seeded Monte Carlo simulations. Not suitability, not predictive. Full methodology follows in Disclosures.";
      const lineB = "Details on assumptions, hypothetical stress paths, narrative sources, and limitations appear at the end of this document under Disclosures.";
      const fs = 6.5;
      const lineGap = 3.8;
      const cueH = 36;
      ensureBlock(cueH);
      y = drawWrappedTextToWidth(lineA, MARGIN, y, appendixWrapWidthPt, fs, muted, regular, lineGap);
      y = drawWrappedTextToWidth(lineB, MARGIN, y, appendixWrapWidthPt, fs, muted, regular, lineGap);
      y -= 8;
    }

    /** Terminal disclosures with client vs advisor depth; renders after holdings table (if any). */
    function drawImportantInformationAppendix() {
      newPage();
      drawSectionEyebrow("Disclosures");
      /** Tighter than `sectionTitle` so the full disclosures block fits on one page in advisor (long-form) mode. */
      function drawDisclosuresHead(title: string, subtitle: string) {
        page.drawRectangle({ x: MARGIN, y: y - 8, width: 2.5, height: 10, color: stayBar });
        page.drawText(cleanText(title), { x: MARGIN + 8, y, size: 10, font: bold, color: navyLight });
        y -= 14;
        page.drawLine({
          start: { x: MARGIN, y: y + 6 },
          end: { x: MARGIN + CONTENT_W, y: y + 6 },
          thickness: 0.4,
          color: rule,
        });
        y -= 8;
        page.drawText(cleanText(subtitle), { x: MARGIN, y, size: 6.9, font: regular, color: muted });
        y -= 9;
      }

      drawDisclosuresHead("Important information about this report", "Methodology, data, limitations, and supervisory context.");

      /** Slightly wider measure and lower floor recover vertical space without touching the footer band. */
      const disclosureFloorY = 66;
      const disclosureTextX = MARGIN - 7;
      const disclosureWrapW = CONTENT_W + 14;

      const riskKey = String(client?.riskProfile || "moderate").toLowerCase();
      const withdrawalRule =
        riskKey === "conservative" || riskKey === "moderate-conservative"
          ? "approximately 3.8% of the starting portfolio value per year (illustrative modeled input, not a spending recommendation)"
          : riskKey === "aggressive"
            ? "approximately 4.5% of the starting portfolio value per year (illustrative modeled input, not a spending recommendation)"
            : "approximately 4.1% of the starting portfolio value per year (illustrative modeled input, not a spending recommendation)";

      const clientName = clientDisplayName(client) || "Client";
      const clientAge = String(client?.age ?? "N/A");
      const retAge = String(client?.retirementAge ?? "N/A");

      type AppendixChunk = { title: string; paragraphs: string[] };
      const commonChunks: AppendixChunk[] = [
        {
          title: "Purpose and limits of this document",
          paragraphs: [
            "This report is for discussion and education only. It is not an offer, solicitation, or instruction to buy or sell securities, insurance, or other products.",
            "It does not cover your full financial picture (for example: other accounts not on the statement, employer plans, real estate, business interests, estate planning, health care, or legal matters).",
            mode === "advisor"
              ? "This advisor working-paper version may include internal notes and illustrative ideas for review. It is not a client deliverable without your supervision and any required firm approval."
              : "Any next steps should be reviewed with a licensed professional who knows your complete situation.",
          ],
        },
        {
          title: "Data used in this report",
          paragraphs: [
            `Prepared ${reportDateStr}. Portfolio value shown in the header reflects confirmed holdings in this review${totalValue > 0 ? ` (${money(totalValue)})` : ""}.`,
            `Household context on file: ${clientName}, age ${clientAge}, targeted retirement age ${retAge}, risk profile ${String(client?.riskProfile || "N/A").replace("-", " ")}.`,
            "Values, registrations, and classifications come from uploaded or entered statement data and advisor edits. Errors in source data flow into this output.",
          ],
        },
        {
          title: "Portfolio scores (alignment, diversification, income readiness)",
          paragraphs: [
            "The three scores summarize how the current allocation compares to the illustrative proposed mix and simple heuristics. They are directional indicators for conversation, not grades, ranks, or guarantees of future results.",
            mode === "advisor"
              ? "Scores may be supplied from the application or derived from allocation gaps in this engine. They should not be presented to clients as regulated risk scores or sole evidence of suitability."
              : "Your advisor can explain what each score is trying to reflect in plain language.",
          ],
        },
        {
          title: "Retirement success illustration (Monte Carlo-style)",
          paragraphs:
            mode === "client"
              ? [
                  "This section uses many computer-generated scenarios to stress-test whether a portfolio might still have assets left late in life under simplified rules. It includes random returns for stocks, fixed, and cash, inflation, withdrawals for living expenses, and the idea that bad markets early in retirement can be especially painful.",
                  "The vertical reference line on the chart is an illustrative band for discussion, not a promise that any result is likely or appropriate for you.",
                  "This is not a forecast of your retirement. Actual markets, taxes, spending, health events, and behavior will differ.",
                ]
              : [
                  "The Retirement Success Model runs 5,000 simulated paths per score using a deterministic seed derived from client age, retirement age, allocation weights, and risk profile label (reproducible for the same inputs).",
                  "Pre-retirement: each year applies random normal shocks to equity, fixed, and cash using illustrative means and volatilities. At retirement, an initial annual withdrawal is set as a percentage of the starting portfolio per risk bucket: conservative and moderate-conservative use a 3.8% starting rate, aggressive 4.5%, other profiles 4.1%. Withdrawals grow with simulated inflation. Withdrawals are modeled at the start of each retirement year to stress sequence risk.",
                  "Retirement phase length is modeled through age 95 from the stated retirement age. Additional modeled pressure may apply in early retirement years for equity-heavy allocations (sequence-of-return stress heuristic).",
                  "Illustrative capital market parameters in code: equity mean 6.8% annualized, fixed 4.0%, cash 2.3%; volatilities equity 16.5%, fixed 6.0%, cash 1.2%; inflation mean 2.6% with 1.2% volatility. These are simplified and not firm-specific capital market assumptions unless you replace them.",
                  `For this run, the withdrawal rule-of-thumb described above maps to: ${withdrawalRule}.`,
                  "The bar chart reference marker near 85 is an internal discussion band only, not a regulatory threshold. Results are not performance guarantees.",
                ],
        },
        {
          title: "Hypothetical allocation stress (historical windows)",
          paragraphs:
            mode === "client"
              ? [
                  "The decade rows show an approximate average annual return (CAGR) if the same broad mix had been held through that ten calendar year window, using firm index history for large-cap U.S. stocks, a broad bond index proxy, and Treasury-bill averages for cash. The last row is a single tough calendar year blend to show stress, not an average over many years.",
                  "These paths are backward-looking math on standardized proxies. They are not what your funds will earn next year or over the next decade.",
                ]
              : [
                  "Decade rows: ten-year geometric mean (CAGR) based on calendar-year returns. Current portfolio paths map each holding to equity (S&P 500 total return calibration when no resolved ticker history), fixed (Bloomberg US Aggregate / AGG proxy), or cash (annual-average 3-month T-bill proxy); unclassified sleeves use a 50/50 equity/bond blend in the scenario engine unless refined.",
                  "Proposed portfolio uses the same index proxies at target sleeve weights with static rebalancing logic as implemented in code.",
                  `The single-year drawdown row uses ${BIGGEST_DRAWDOWN_SCENARIO_YEAR} with the firm S&P equity calibration (-36.55% for that year on the equity sleeve) blended with bond and cash proxies for that year: one calendar year only, not a multi-year drawdown path.`,
                  "Limitation: actual funds, active management, fees, taxes, and timing differ from these mechanical blends.",
                ],
        },
        {
          title: "AI-assisted narrative and research",
          paragraphs: [
            "Synopsis, highlights, overlap notes, strategies, and related bullet sections may be generated or assisted by large language models. Market context may incorporate web-assisted research signals when enabled in the analysis pipeline.",
            "Generative text can be incorrect, generic, or misaligned with the statement. Narrative sections require human advisor review before client reliance.",
          ],
        },
        {
          title: "Hypothetical performance and supervisory note",
          paragraphs: [
            "Where this report illustrates hypothetical allocations, simulations, back-tests, or stress paths, outcomes depend on modeled assumptions rather than realized client-specific results.",
            "Illustrative output must be supervised under your firm's policies, including how hypothetical performance may be communicated and documented.",
          ],
        },
      ];

      const titleFs = 7.85;
      const titleLineLead = 2.35;
      const bodyFs = 6.05;
      const bodyGap = 2.45;
      const titleBottomMargin = 3;
      const paraGapBelow = 3.2;

      for (const chunk of commonChunks) {
        const titleLines = wrapLinesToWidth(chunk.title, bold, titleFs, disclosureWrapW);
        const titleBlockH = titleLines.length * (titleFs + titleLineLead);
        ensureBlock(titleBlockH + 10);
        let ty = y;
        for (const tl of titleLines) {
          page.drawText(cleanText(tl), { x: MARGIN, y: ty, size: titleFs, font: bold, color: navyLight });
          ty -= titleFs + titleLineLead;
        }
        y = ty - titleBottomMargin;

        for (const para of chunk.paragraphs) {
          const lines = wrapLinesToWidth(para, regular, bodyFs, disclosureWrapW);
          const blockH = lines.length * (bodyFs + bodyGap) + paraGapBelow;
          if (y - blockH < disclosureFloorY) {
            newPage();
          }
          y = drawWrappedTextToWidth(para, disclosureTextX, y, disclosureWrapW, bodyFs, ink, regular, bodyGap);
          y -= paraGapBelow;
        }
        y -= 2.5;
      }
    }

    function allocationCard(
      title: string,
      subtitle: string,
      x: number,
      top: number,
      data: unknown,
      accent: RGB,
      cardH = 130,
      opts?: { includeOther?: boolean }
    ) {
      const record = asRecord(data);
      const equity = asNumber(record.equity);
      const fixed = asNumber(record.fixedIncome);
      const cash = asNumber(record.cash);
      const other = opts?.includeOther ? asNumber(record.other) : 0;
      const cardW = Math.floor((CONTENT_W - 12) / 2);

      const segmentsRaw = [
        { label: "Equity", value: equity, color: donutEquity },
        { label: "Fixed", value: fixed, color: donutFixed },
        { label: "Cash", value: cash, color: donutCash },
        ...(other > 0 ? [{ label: "Unclassified", value: other, color: donutOther }] : []),
      ];
      let sum = segmentsRaw.reduce((s, it) => s + it.value, 0);
      if (sum <= 0) sum = 1;
      const segments = segmentsRaw.map((it) => ({ ...it, value: (it.value / sum) * 100 })).filter((it) => it.value > 0);

      const cardBottomY = top - cardH;
      page.drawRectangle({ x, y: cardBottomY, width: cardW, height: cardH, color: white, borderColor: rule, borderWidth: 0.35 });
      page.drawRectangle({ x, y: top - 2.5, width: cardW, height: 2.5, color: accent });

      page.drawText(title, { x: x + 12, y: top - 20, size: 10.5, font: bold, color: navyLight });
      page.drawText(subtitle, { x: x + 12, y: top - 34, size: 7, font: regular, color: muted });

      /** Match ProfessionalDonutChart geometry; scale sizes the ring on the page. */
      const scale = 0.4;
      const donutCx = x + 42;
      const donutCy = top - 72;
      const pathBaseX = donutCx - scale * SNAPSHOT_DONUT.cx;
      const pathBaseY = donutCy + scale * SNAPSHOT_DONUT.cy;
      /**
       * Stroke must stay in the same user units as the SVG path (see strokeWidth={22} in app).
       * Do not multiply by `scale`: pdf-lib already scales the path, and line width is transformed too —
       * using stroke * scale made the ring ~scale² thin on the page.
       */
      const strokeW = SNAPSHOT_DONUT.stroke * 1.08;

      page.drawSvgPath(snapshotDonutFullRingPath(), {
        x: pathBaseX,
        y: pathBaseY,
        scale,
        borderWidth: strokeW,
        borderColor: donutTrack,
      });

      let cumDeg = 0;
      for (const seg of segments) {
        const slice = (seg.value / 100) * 360;
        const path = snapshotDonutStrokeArcPath(cumDeg, cumDeg + slice);
        if (path) {
          page.drawSvgPath(path, {
            x: pathBaseX,
            y: pathBaseY,
            scale,
            borderWidth: strokeW,
            borderColor: seg.color,
            borderLineCap: LineCapStyle.Round,
          });
        }
        cumDeg += slice;
      }

      page.drawCircle({ x: donutCx, y: donutCy, size: SNAPSHOT_DONUT.holeR * scale, color: white });

      const totalLabel = "Total";
      const totalSize = 6.2;
      const totalW = regular.widthOfTextAtSize(totalLabel, totalSize);
      page.drawText(totalLabel, { x: donutCx - totalW / 2, y: donutCy + 9, size: totalSize, font: regular, color: muted });
      const pctLabel = "100%";
      const pctCenterSize = 11;
      const tw = bold.widthOfTextAtSize(pctLabel, pctCenterSize);
      page.drawText(pctLabel, { x: donutCx - tw / 2, y: donutCy - 6, size: pctCenterSize, font: bold, color: navy });

      const outerVisual = (SNAPSHOT_DONUT.r + strokeW / 2) * scale;
      const legendLeft = donutCx + outerVisual + 10;
      const pctColRight = x + cardW - 12;
      const labelSize = 7.6;
      const pctSize = 8;
      const rowStride = 22;
      let rowY = top - 50;
      for (const item of segmentsRaw) {
        const pctRounded = Math.round((item.value / sum) * 100);
        const sw = 3.2;
        page.drawRectangle({ x: legendLeft, y: rowY - 1, width: sw, height: sw + 4, color: item.color });
        page.drawText(item.label, { x: legendLeft + sw + 5, y: rowY, size: labelSize, font: regular, color: ink });
        const pct = `${pctRounded}%`;
        const pw = bold.widthOfTextAtSize(pct, pctSize);
        page.drawText(pct, { x: pctColRight - pw, y: rowY, size: pctSize, font: bold, color: navy });
        rowY -= rowStride;
      }
    }

    function drawPageOneAllocationScoresSynopsis() {
      drawHeader();

      sectionTitle("Allocation overview", undefined);
      y += 11;

      const cardGap = 12;
      const cardW = Math.floor((CONTENT_W - cardGap) / 2);
      const otherN = asNumber(currentAllocation.other);
      const cardH = otherN > 0 ? 136 : 130;
      const cardTopOffset = 0;
      const x1 = MARGIN;
      const x2 = MARGIN + cardW + cardGap;
      const cardTopY = y + cardTopOffset;
      allocationCard("Current allocation", "Based on confirmed holdings", x1, cardTopY, currentAllocation, stayBar, cardH, {
        includeOther: true,
      });
      allocationCard("Proposed allocation", "Illustrative target mix for discussion", x2, cardTopY, targetAllocation, accentSecondary, cardH);
      const cardBottomY = cardTopY - cardH;
      y = cardBottomY - 22;

      sectionTitle("Portfolio scores", "Alignment, diversification, income readiness.");
      y += 3;
      const cardPx = 168;
      const scoreGap = Math.max(8, Math.floor((CONTENT_W - cardPx * 3) / 2));
      const sx1 = MARGIN;
      const sx2 = MARGIN + cardPx + scoreGap;
      const sx3 = MARGIN + (cardPx + scoreGap) * 2;
      const scoreBoxH = 58;
      const scoreTopOffset = 4;
      const scoreTopY = y + scoreTopOffset;
      drawScoreCard("Risk alignment", scores.riskAlignment, "Versus proposed allocation", sx1, scoreTopY, stayBar, scoreBoxH);
      drawScoreCard("Diversification", scores.diversification, "Balance across sleeves", sx2, scoreTopY, accentSecondary, scoreBoxH);
      drawScoreCard("Income readiness", scores.incomeReadiness, "Stability for income needs", sx3, scoreTopY, goldAccent, scoreBoxH);
      y = scoreTopY - scoreBoxH - 21;

      sectionTitle("Synopsis", "Summary of the portfolio review.");
      y += 2;
      drawSynopsisOnPageOne(analysis?.synopsis || "No analysis available.", FOOTER_SAFE_Y);
    }

    function drawHoldingsAppendix() {
      if (!holdings.length || mode !== "advisor") return;
      newPage();
      drawSectionEyebrow("Appendix");
      sectionTitle("Holdings detail", "Extracted positions and advisor classifications.");

      const hx = MARGIN;
      const hW = CONTENT_W;
      page.drawRectangle({ x: hx, y: y - 16, width: hW, height: 20, color: navy });
      page.drawText("Holding", { x: hx + 10, y: y - 11, size: 7.5, font: bold, color: white });
      page.drawText("Selected match", { x: hx + 168, y: y - 11, size: 7.5, font: bold, color: white });
      page.drawText("Asset class", { x: hx + 330, y: y - 11, size: 7.5, font: bold, color: white });
      page.drawText("Value", { x: hx + hW - 62, y: y - 11, size: 7.5, font: bold, color: white });
      y -= 27;

      for (let i = 0; i < holdings.length; i++) {
        const h = asRecord(holdings[i]);
        if (y < 78) {
          newPage();
          sectionTitle("Holdings detail (continued)", "Remaining positions.");
        }
        const rowFill = i % 2 === 0 ? surface : white;
        page.drawRectangle({ x: hx, y: y - 13, width: hW, height: 17, color: rowFill, borderColor: rgb(0.91, 0.94, 0.96), borderWidth: 0.2 });
        page.drawText(cleanText(h?.rawName || "Unknown").slice(0, 32), { x: hx + 10, y: y - 7, size: 6.9, font: regular, color: ink });
        page.drawText(cleanText(h?.suggested || "Needs review").slice(0, 34), { x: hx + 168, y: y - 7, size: 6.9, font: regular, color: ink });
        page.drawText(cleanText(h?.assetClass || "Unknown").slice(0, 28), { x: hx + 330, y: y - 7, size: 6.9, font: regular, color: ink });
        const mv = money(h?.value || 0);
        const mw = regular.widthOfTextAtSize(mv, 6.9);
        page.drawText(mv, { x: hx + hW - 10 - mw, y: y - 7, size: 6.9, font: regular, color: ink });
        y -= 18;
      }
    }

    drawPageOneAllocationScoresSynopsis();

    newPage();
    drawRetirementSuccessModel();

    drawRetirementSuccessMethodologyCue();

    drawHistoricalDecadeScenarios();

    drawSectionEyebrow("Insights and implications");
    if (mode === "advisor") {
      drawCardSection("Advisor red flags", "Issues to resolve internally before client-facing recommendations.", redFlagItems, red, softRed);
    }

    drawCardSection("Overlap and concentration", "Where diversification may be weaker than position count suggests.", overlapInsightItems, accentSecondary, softBlue);
    drawCardSection(
      mode === "client" ? "What this means for you" : "Client-facing interpretation",
      "Plain-language impact.",
      mode === "client" ? whatThisMeansItems.slice(0, 3) : whatThisMeansItems,
      stayBar,
      stayBarSoft
    );
    drawCardSection("Strategic considerations", "Themes for the planning conversation.", mode === "client" ? strategyItems.slice(0, 3) : strategyItems, accentSecondary, surface);

    if (mode === "advisor") {
      drawCardSection("Illustrative recommendations", "Ideas for review only; not trade instructions.", recommendationItems, goldAccent, rgb(1.0, 0.985, 0.92));
    } else {
      drawCardSection("Potential next steps", "How a typical follow-up conversation may flow.", [
        "Review how the portfolio aligns with retirement timeline, income needs, and comfort with volatility.",
        "Discuss whether a clearer balance of growth, stability, and income supports your stated goals.",
        "Explore diversification across asset classes and income sources before any changes.",
        "Align any next actions with taxes, liquidity, risk tolerance, and your full financial picture.",
      ], stayBar, stayBarSoft);
    }

    if (mode === "advisor") {
      drawCardSection("Meeting overview", "Talking points for the next conversation.", meetingItems.slice(0, 4), navy, surface);
    }

    if (mode === "advisor" && analysis?.advisorOpeningScript) {
      drawTextSection("Advisor opening script", "Suggested meeting opener.", analysis.advisorOpeningScript);
    }

    if (mode === "advisor" && Array.isArray(analysis?.objectionHandling) && analysis.objectionHandling.length) {
      drawCardSection("Objection handling", "Framing for likely client concerns.", stringItems(analysis.objectionHandling, 6), red, softRed);
    }

    drawHoldingsAppendix();

    drawImportantInformationAppendix();

    const pages = pdfDoc.getPages();
    const totalP = pages.length;
    pages.forEach((p, i) => drawFooter(p, i + 1, totalP));
    const pdfBytes = await pdfDoc.save();

    await writeAuditEvent({
      ownerEmail: auditOwnerEmail,
      ownerUserId: auditOwnerUserId,
      actorEmail: identity?.email ?? null,
      action: "report.generated",
      entityType: "report",
      entityId: clientIdForAudit,
      metadata: {
        demoMode,
        mode,
        holdingsCount: holdings.length,
        totalValue,
        filename: fileName,
        unauthenticated: !identity,
      },
    });

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${fileName}`,
      },
    });
  } catch (err: unknown) {
    console.error("PDF REPORT ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate PDF report." },
      { status: 500 }
    );
  }
}
