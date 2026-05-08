import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage } from "pdf-lib";
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

    const MARGIN = 44;
    const CONTENT_W = 612 - MARGIN * 2;
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
      const maxChars = 100;
      const size = 7.6;
      const gap = 3.2;
      const lineH = size + gap;
      let t = cleanText(text) || "No analysis available.";
      const maxLines = Math.max(3, Math.floor((y - floorY - 6) / lineH));

      const truncateToMaxLines = (s: string): string => {
        let cur = s;
        while (wrapLines(cur, maxChars).length > maxLines && cur.length > 40) {
          cur = cur.slice(0, cur.length - 6).trim();
          const cut = cur.replace(/\s+\S*$/, "");
          cur = cut + "...";
        }
        const lines = wrapLines(cur, maxChars);
        if (lines.length <= maxLines) return cur;
        const joined = lines.slice(0, maxLines).join(" ");
        return joined.slice(0, Math.max(20, joined.length - 12)).replace(/\s+\S*$/, "") + "...";
      };

      t = truncateToMaxLines(t);
      const lines = wrapLines(t, maxChars);
      const barH = Math.max(lines.length * lineH + 4, lineH + 4);
      page.drawRectangle({
        x: MARGIN,
        y: y - barH,
        width: 2.5,
        height: barH,
        color: goldAccent,
      });
      y = drawWrappedText(t, MARGIN + 12, y, maxChars, size, ink, regular, gap) - 5;
    }

    function estimateLines(text: unknown, maxChars = 92) {
      const words = cleanText(text).split(" ");
      let lines = 0;
      let line = "";
      for (const word of words) {
        if ((line + word).length > maxChars) {
          lines += 1;
          line = word + " ";
        } else {
          line += word + " ";
        }
      }
      if (line.trim()) lines += 1;
      return Math.max(lines, 1);
    }

    function wrapLines(text: unknown, maxChars = 92) {
      const words = cleanText(text).split(" ");
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
      return lines.length ? lines : [""];
    }

    function drawWrappedText(text: unknown, x: number, startY: number, maxChars: number, size: number, color: RGB, font = regular, lineGap = 5.2) {
      const lines = wrapLines(text, maxChars);
      let yy = startY;
      for (const line of lines) {
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
        // Use a smaller wrap width than the renderer to intentionally over-estimate height.
        // This prevents ugly orphan cards and section splits.
        const lines = estimateLines(item, 72);
        total += Math.max(54, 34 + lines * 13.2) + rowGap;
      }

      return total + 20;
    }

    function paragraphBlockHeight(text: unknown, subtitle = "") {
      const lines = estimateLines(text, 118);
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
      const maxW = 98;
      const fs = 8.6;
      const lineGap = 5;
      const padT = 10;
      const padB = 11;
      const lines = wrapLines(text, maxW);
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
      y = drawWrappedText(text, MARGIN + 14, boxTop - padT, maxW, fs, ink, regular, lineGap);
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
        const lines = estimateLines(item, 88);
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
        const textBottom = drawWrappedText(item, MARGIN + 22, itemTop, 88, 8.4, ink, regular, lineGap);
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


    function drawMonteCarloExplanation() {
      const methodologyAddendum =
        "Illustrative Monte Carlo sustainability scores (not a guarantee). Vertical line: 85+ illustrative target band. Not a performance guarantee.";
      const explanation =
        mode === "client"
          ? `This model estimates how the portfolio may hold up under many different market environments. It uses 5,000 simulated scenarios that include market returns, fixed performance, cash reserves, inflation, withdrawals, sequence-of-return risk, and a retirement horizon to age 95. ${methodologyAddendum}`
          : `This Retirement Success Model is based on a Monte Carlo simulation designed to evaluate the long-term sustainability of a portfolio under a wide range of market conditions. The analysis runs 5,000 simulated scenarios incorporating equity returns, fixed performance, cash reserves, inflation, retirement withdrawals, sequence-of-return risk, and a retirement horizon to age 95. ${methodologyAddendum}`;

      const maxW = 98;
      const fs = 8.3;
      const lineGap = 4.8;
      const padT = 10;
      const padB = 10;
      const lines = wrapLines(explanation, maxW);
      const textBodyH = lines.length * (fs + lineGap) - lineGap + padT + padB;
      const sectionHeight = paragraphBlockHeight(explanation, "Methodology summary.");
      ensureBlock(Math.max(sectionHeight, textBodyH + 80));

      sectionTitle("How this analysis works", "Methodology summary.");

      const gapBelowTitle = 5;
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

      y = drawWrappedText(explanation, MARGIN + 14, boxTop - padT, maxW, fs, ink, regular, lineGap);
      y = y - padB - 6;
    }

    function allocationCard(
      title: string,
      subtitle: string,
      x: number,
      top: number,
      data: unknown,
      accent: RGB,
      cardH = 124
    ) {
      const record = asRecord(data);
      const equity = asNumber(record.equity);
      const fixed = asNumber(record.fixedIncome);
      const cash = asNumber(record.cash);
      const cardW = Math.floor((CONTENT_W - 12) / 2);
      const values = [
        { label: "Equity", value: equity, color: stayBar },
        { label: "Fixed", value: fixed, color: accentSecondary },
        { label: "Cash", value: cash, color: goldAccent },
      ];

      const cardBottomY = top - cardH;
      page.drawRectangle({ x, y: cardBottomY, width: cardW, height: cardH, color: white, borderColor: rule, borderWidth: 0.35 });
      page.drawRectangle({ x, y: top - 2.5, width: cardW, height: 2.5, color: accent });

      page.drawText(title, { x: x + 12, y: top - 20, size: 10.5, font: bold, color: navyLight });
      page.drawText(subtitle, { x: x + 12, y: top - 34, size: 7, font: regular, color: muted });

      const padSides = 12;
      const labelSize = 8;
      const pctSize = 8.2;
      const barH = 3;
      const barGapBelowLabel = 6;
      const rowStride = 26;
      const accentW = 2.5;
      const accentH = 10;

      const barTrackW = cardW - padSides * 2 - 8;
      const pctColX = x + cardW - padSides;

      let rowBaseline = top - 48;
      for (const item of values) {
        const barY = rowBaseline - barGapBelowLabel - barH;

        page.drawRectangle({
          x: x + padSides,
          y: rowBaseline - 2,
          width: accentW,
          height: accentH,
          color: item.color,
        });
        page.drawText(item.label, { x: x + padSides + accentW + 6, y: rowBaseline, size: labelSize, font: regular, color: ink });

        const pct = `${item.value}%`;
        const pw = bold.widthOfTextAtSize(pct, pctSize);
        page.drawText(pct, {
          x: pctColX - pw,
          y: rowBaseline,
          size: pctSize,
          font: bold,
          color: navy,
        });

        page.drawRectangle({
          x: x + padSides,
          y: barY,
          width: barTrackW,
          height: barH,
          color: rgb(0.9, 0.93, 0.96),
        });
        page.drawRectangle({
          x: x + padSides,
          y: barY,
          width: Math.max(barH, barTrackW * (item.value / 100)),
          height: barH,
          color: item.color,
        });

        rowBaseline -= rowStride;
      }
    }

    function drawPageOneAllocationScoresSynopsis() {
      drawHeader();

      sectionTitle("Allocation overview", undefined);
      y += 11;

      const cardGap = 12;
      const cardW = Math.floor((CONTENT_W - cardGap) / 2);
      const cardH = 124;
      const cardTopOffset = 0;
      const x1 = MARGIN;
      const x2 = MARGIN + cardW + cardGap;
      const cardTopY = y + cardTopOffset;
      allocationCard("Current allocation", "Based on confirmed holdings", x1, cardTopY, currentAllocation, stayBar, cardH);
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

    drawMonteCarloExplanation();

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

    const pages = pdfDoc.getPages();
    const totalP = pages.length;
    pages.forEach((p, i) => drawFooter(p, i + 1, totalP));
    const pdfBytes = await pdfDoc.save();

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
