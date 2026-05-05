import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Buffer } from "buffer";
import fs from "fs/promises";
import path from "path";
import { clientDisplayName } from "@/lib/intake-config";

type ReportMode = "client" | "advisor";

type RGB = ReturnType<typeof rgb>;

function cleanText(value: any) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\x00-\x7F]/g, "")
    .trim();
}

function money(value: any) {
  const n = Number(value || 0);
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function firstSentences(value: any, count = 5) {
  return cleanText(value)
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function uniqueItems(items: any[], limit = 4) {
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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const mode: ReportMode = body?.mode === "client" ? "client" : "advisor";
    const client = body?.client || {};
    const analysis = body?.analysis || {};
    const allocation = body?.allocation || {};
    const scoresInput = body?.scores || {};
    const totalValue = body?.totalValue || 0;
    const holdings = Array.isArray(body?.holdings) ? body.holdings : [];

    function asNumber(value: any, fallback = 0) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function clampScore(value: number) {
      if (!Number.isFinite(value)) return 50;
      return Math.max(1, Math.min(100, Math.round(value)));
    }

    function calculatePortfolioScores() {
      const current = {
        equity: asNumber(allocation?.current?.equity),
        fixedIncome: asNumber(allocation?.current?.fixedIncome),
        cash: asNumber(allocation?.current?.cash),
      };

      const target = {
        equity: asNumber(allocation?.target?.equity, 60),
        fixedIncome: asNumber(allocation?.target?.fixedIncome, 35),
        cash: asNumber(allocation?.target?.cash, 5),
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
        .map((h: any) => `${h?.rawName || ""} ${h?.suggested || ""} ${h?.assetClass || ""}`.toLowerCase())
        .join(" ");

      const currentEquity = asNumber(allocation?.current?.equity);
      const currentFixed = asNumber(allocation?.current?.fixedIncome);
      const targetFixed = asNumber(allocation?.target?.fixedIncome, 35);

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
        insights.push("Fixed income holdings should be reviewed for role clarity, because bond funds, aggregate bond exposure, and Treasury positions may behave differently across rate environments.");
      }
      if (hasDividend && currentEquity > 60) {
        insights.push("Dividend-oriented equity exposure may help with income, but it should still be reviewed as equity risk rather than being treated as a substitute for fixed income or guaranteed income.");
      }
      if (!insights.length) {
        insights.push("No major overlap pattern was automatically detected, but underlying fund holdings should still be reviewed for hidden concentration before making final recommendations.");
      }
      return insights.slice(0, 4);
    }

    const overlapInsightItems =
      Array.isArray(analysis?.overlapInsights) && analysis.overlapInsights.length
        ? analysis.overlapInsights
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

    const strategyItems = Array.isArray(analysis?.strategies) ? analysis.strategies : [];
    const redFlagItems = Array.isArray(analysis?.redFlags) ? analysis.redFlags : [];
    const recommendationItems = Array.isArray(analysis?.recommendations) ? analysis.recommendations : [];
    const meetingItems = Array.isArray(analysis?.talkingPoints) ? analysis.talkingPoints : [];

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

    const modelInput = body?.retirementModel || {};
    const currentSuccessRate =
      asNumber(modelInput?.currentSuccessRate) ||
      calculateRetirementSuccessModel({
        age: asNumber(client?.age, 62),
        retirementAge: asNumber(client?.retirementAge, 67),
        equity: asNumber(allocation?.current?.equity),
        fixedIncome: asNumber(allocation?.current?.fixedIncome),
        cash: asNumber(allocation?.current?.cash),
        riskProfile: client?.riskProfile || "moderate",
        portfolioValue: totalValue,
        trials: 5000,
      });

    const proposedSuccessRate =
      asNumber(modelInput?.proposedSuccessRate) ||
      calculateRetirementSuccessModel({
        age: asNumber(client?.age, 62),
        retirementAge: asNumber(client?.retirementAge, 67),
        equity: asNumber(allocation?.target?.equity, 60),
        fixedIncome: asNumber(allocation?.target?.fixedIncome, 35),
        cash: asNumber(allocation?.target?.cash, 5),
        riskProfile: client?.riskProfile || "moderate",
        portfolioValue: totalValue,
        trials: 5000,
      });

    const successImprovement = proposedSuccessRate - currentSuccessRate;

    const retirementModelItems =
      Array.isArray(modelInput?.insights) && modelInput.insights.length
        ? modelInput.insights
        : [
            `Current allocation estimate: ${currentSuccessRate}/100 (${successLabel(currentSuccessRate)}).`,
            `Proposed baseline estimate: ${proposedSuccessRate}/100 (${successLabel(proposedSuccessRate)}).`,
            successImprovement >= 0
              ? `Illustrative improvement: +${successImprovement} points.`
              : `Illustrative change: ${successImprovement} points.`,
            "Monte Carlo model uses 5,000 trials and considers allocation mix, volatility, inflation, sequence risk, withdrawal pressure, liquidity, and retirement horizon.",
          ];

    const positioningImpactItems = [
      `Equity: ${asNumber(allocation?.current?.equity)}% current -> ${asNumber(allocation?.target?.equity, 60)}% proposed`,
      `Fixed: ${asNumber(allocation?.current?.fixedIncome)}% current -> ${asNumber(allocation?.target?.fixedIncome, 35)}% proposed`,
      `Cash: ${asNumber(allocation?.current?.cash)}% current -> ${asNumber(allocation?.target?.cash, 5)}% proposed`,
    ];

    const fileName = mode === "client" ? "Client_Snapshot.pdf" : "Advisor_Deep_Dive.pdf";

    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]);

    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const serif = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

    let logoImage: any = null;
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.png");
      const logoBytes = await fs.readFile(logoPath);
      logoImage = await pdfDoc.embedPng(logoBytes);
    } catch {
      logoImage = null;
    }

    const navy = rgb(0.02, 0.08, 0.18);
    const deep = rgb(0.015, 0.075, 0.16);
    const teal = rgb(0.0, 0.48, 0.52);
    const cyan = rgb(0.0, 0.62, 0.72);
    const blue = rgb(0.10, 0.30, 0.82);
    const indigo = rgb(0.20, 0.24, 0.62);
    const gold = rgb(0.80, 0.56, 0.00);
    const red = rgb(0.70, 0.14, 0.16);
    const slate = rgb(0.20, 0.24, 0.30);
    const muted = rgb(0.43, 0.48, 0.56);
    const soft = rgb(0.965, 0.976, 0.988);
    const softBlue = rgb(0.92, 0.96, 1.0);
    const softTeal = rgb(0.90, 0.975, 0.975);
    const softRed = rgb(1.0, 0.94, 0.94);
    const border = rgb(0.83, 0.88, 0.93);
    const white = rgb(1, 1, 1);

    let y = 740;
    let pageNumber = 1;

    function pageTitle() {
      return mode === "client" ? "Portfolio Review Snapshot" : "Advisor Deep Dive";
    }

    function drawFooter(pageRef: any) {
      const footer = "For discussion purposes only. Not a recommendation to buy or sell securities. Review with a licensed financial professional. Investment and insurance strategies should be evaluated based on the client's full financial situation, objectives, time horizon, liquidity needs, tax status, and risk tolerance.";
      const text = cleanText(footer);
      const maxChars = 150;
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
      let fy = 18 + (lines.length - 1) * 5.5;
      for (const l of lines) {
        const w = regular.widthOfTextAtSize(l, 5.2);
        pageRef.drawText(l, { x: (612 - w) / 2, y: fy, size: 5.2, font: regular, color: rgb(0.42, 0.45, 0.50) });
        fy -= 5.5;
      }
    }

    function drawHeader() {
      // high-tech top ribbon
      page.drawRectangle({ x: 0, y: 720, width: 612, height: 72, color: deep });
      page.drawRectangle({ x: 0, y: 720, width: 612, height: 5, color: teal });
      page.drawRectangle({ x: 0, y: 720, width: 220, height: 5, color: blue });
      page.drawCircle({ x: 500, y: 770, size: 58, color: rgb(0.03, 0.13, 0.26) });
      page.drawCircle({ x: 558, y: 736, size: 36, color: rgb(0.02, 0.20, 0.28) });

      page.drawText(pageTitle(), { x: 32, y: 756, size: 24, font: serif, color: white });
      page.drawText(mode === "client" ? "Client-facing summary" : "Advisor-only planning view", { x: 34, y: 739, size: 8.4, font: regular, color: rgb(0.75, 0.86, 0.96) });

      const meta = `Prepared for ${clientDisplayName(client) || "Client"} | Age ${client.age || "N/A"} | Risk Profile: ${(client.riskProfile || "N/A").replace("-", " ")} | Total Portfolio Value: ${money(totalValue)}`;
      page.drawText(cleanText(meta), { x: 32, y: 704, size: 8.2, font: regular, color: navy });

      if (logoImage) {
        page.drawRectangle({ x: 526, y: 735, width: 48, height: 36, color: white, opacity: 0.94, borderColor: rgb(0.18, 0.36, 0.54), borderWidth: 0.6 });
        page.drawImage(logoImage, { x: 533, y: 739, width: 34, height: 28 });
      } else {
        page.drawText("AdvisorPilot", { x: 500, y: 742, size: 10, font: bold, color: white });
      }

      y = 678;
    }

    function drawSmallHeader() {
      page.drawRectangle({ x: 0, y: 748, width: 612, height: 44, color: deep });
      page.drawRectangle({ x: 0, y: 748, width: 612, height: 4, color: teal });
      page.drawText("AdvisorPilot", { x: 32, y: 768, size: 13, font: serif, color: white });
      page.drawText(pageTitle(), { x: 32, y: 754, size: 7.5, font: regular, color: rgb(0.75, 0.86, 0.96) });
      page.drawText(`Page ${pageNumber}`, { x: 536, y: 754, size: 8, font: regular, color: rgb(0.75, 0.86, 0.96) });
      y = 716;
    }

    function newPage() {
      page = pdfDoc.addPage([612, 792]);
      pageNumber += 1;
      drawSmallHeader();
    }

    function availableHeight() {
      return y - 54;
    }

    function estimateLines(text: any, maxChars = 92) {
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

    function wrapLines(text: any, maxChars = 92) {
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

    function drawWrappedText(text: any, x: number, startY: number, maxChars: number, size: number, color: RGB, font = regular, lineGap = 5.2) {
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

    function paragraphBlockHeight(text: any, subtitle = "") {
      const lines = estimateLines(text, 118);
      return (subtitle ? 50 : 38) + lines * 14.2 + 26;
    }

    function ensureBlock(height: number) {
      // If a section can fit on a fresh page, never let it begin unless it has room
      // to finish on the current page. This keeps Client Snapshot sections clean.
      const freshPageCapacity = 640;
      if (height <= freshPageCapacity && availableHeight() < height) newPage();
    }

    function sectionTitle(title: string, subtitle?: string, color: RGB = navy) {
      page.drawRectangle({ x: 32, y: y - 4, width: 548, height: 1.2, color: border });
      y -= 24;
      page.drawText(cleanText(title), { x: 32, y, size: 17, font: serif, color });
      if (subtitle) {
        y -= 14;
        page.drawText(cleanText(subtitle), { x: 32, y, size: 7.8, font: regular, color: muted });
      }
      y -= 20;
    }

    function drawTextSection(title: string, subtitle: string, text: any) {
      const h = paragraphBlockHeight(text, subtitle);
      ensureBlock(h);
      sectionTitle(title, subtitle, navy);
      const boxHeight = Math.max(78, estimateLines(text, 118) * 13.8 + 26);
      page.drawRectangle({ x: 32, y: y - boxHeight + 12, width: 548, height: boxHeight, color: white, borderColor: border, borderWidth: 0.7 });
      page.drawRectangle({ x: 32, y: y - boxHeight + 12, width: 5, height: boxHeight, color: teal });
      y = drawWrappedText(text, 48, y - 8, 116, 8.4, slate, regular, 5.2) - 14;
    }

    function drawCardSection(title: string, subtitle: string, items: string[], color: RGB = teal, fill: RGB = soft) {
      if (!items.length) return;

      const sectionHeight = sectionBlockHeight(items, subtitle);
      ensureBlock(sectionHeight);
      sectionTitle(title, subtitle, color);

      for (const item of items) {
        const lines = estimateLines(item, 82);
        const cardHeight = Math.max(46, 30 + lines * 12.2);

        // This should only trigger when a single section is too large for one page.
        // It prevents card text from being clipped while the larger pre-check above
        // handles normal section-level page breaks.
        if (cardHeight + 70 > availableHeight()) newPage();

        page.drawRectangle({ x: 32, y: y - cardHeight + 8, width: 548, height: cardHeight, color: fill, borderColor: border, borderWidth: 0.65 });
        page.drawRectangle({ x: 32, y: y - cardHeight + 8, width: 5, height: cardHeight, color });
        page.drawCircle({ x: 49, y: y - 11, size: 3.5, color });
        y = drawWrappedText(item, 62, y - 15, 84, 8.2, slate, regular, 4.4) - 12;
      }
      y -= 8;
    }

    function drawPositioningTable() {
      const rows = [
        {
          asset: "Equity",
          current: `${asNumber(allocation?.current?.equity)}%`,
          proposed: `${asNumber(allocation?.target?.equity, 60)}%`,
          color: teal,
        },
        {
          asset: "Fixed",
          current: `${asNumber(allocation?.current?.fixedIncome)}%`,
          proposed: `${asNumber(allocation?.target?.fixedIncome, 35)}%`,
          color: blue,
        },
        {
          asset: "Cash",
          current: `${asNumber(allocation?.current?.cash)}%`,
          proposed: `${asNumber(allocation?.target?.cash, 5)}%`,
          color: gold,
        },
      ];

      const sectionHeight = 150;
      ensureBlock(sectionHeight);
      sectionTitle("Current vs Proposed Positioning", "Allocation change only.", teal);

      const tableX = 32;
      const tableW = 548;
      const headerH = 28;
      const rowH = 30;
      const tableTop = y + 6;
      const tableBottom = tableTop - headerH - rows.length * rowH;

      page.drawRectangle({
        x: tableX,
        y: tableBottom,
        width: tableW,
        height: headerH + rows.length * rowH,
        color: white,
        borderColor: border,
        borderWidth: 0.75,
      });

      page.drawRectangle({
        x: tableX,
        y: tableTop - headerH,
        width: tableW,
        height: headerH,
        color: deep,
      });

      page.drawText("Asset Class", { x: tableX + 18, y: tableTop - 18, size: 8.4, font: bold, color: white });
      page.drawText("Current", { x: tableX + 250, y: tableTop - 18, size: 8.4, font: bold, color: white });
      page.drawText("Proposed", { x: tableX + 398, y: tableTop - 18, size: 8.4, font: bold, color: white });

      let rowY = tableTop - headerH;

      rows.forEach((row, index) => {
        rowY -= rowH;
        const rowFill = index % 2 === 0 ? soft : white;

        page.drawRectangle({
          x: tableX,
          y: rowY,
          width: tableW,
          height: rowH,
          color: rowFill,
          borderColor: rgb(0.91, 0.94, 0.96),
          borderWidth: 0.3,
        });

        page.drawCircle({ x: tableX + 22, y: rowY + 15, size: 4, color: row.color });
        page.drawText(row.asset, { x: tableX + 36, y: rowY + 11, size: 8.8, font: bold, color: navy });

        page.drawRectangle({
          x: tableX + 230,
          y: rowY + 7,
          width: 82,
          height: 16,
          color: white,
          borderColor: border,
          borderWidth: 0.4,
        });

        page.drawRectangle({
          x: tableX + 378,
          y: rowY + 7,
          width: 82,
          height: 16,
          color: index === 0 ? softTeal : index === 1 ? softBlue : rgb(1.0, 0.985, 0.92),
          borderColor: border,
          borderWidth: 0.4,
        });

        page.drawText(row.current, { x: tableX + 258, y: rowY + 11, size: 8.5, font: bold, color: slate });
        page.drawText(row.proposed, { x: tableX + 406, y: rowY + 11, size: 8.5, font: bold, color: navy });
      });

      y = tableBottom - 24;
    }

    function drawScoreCard(title: string, value: number, helper: string, x: number, top: number, color: RGB) {
      const n = Math.max(0, Math.min(100, Number(value || 0)));
      page.drawRectangle({ x, y: top - 76, width: 168, height: 76, color: white, borderColor: border, borderWidth: 0.7 });
      page.drawRectangle({ x, y: top - 4, width: 168, height: 4, color });
      page.drawText(title, { x: x + 12, y: top - 22, size: 8.6, font: bold, color: navy });
      page.drawText(`${Math.round(n)}`, { x: x + 12, y: top - 50, size: 22, font: bold, color: navy });
      page.drawText("/100", { x: x + 46, y: top - 47, size: 8.5, font: regular, color: muted });
      page.drawText(helper, { x: x + 12, y: top - 64, size: 6.8, font: regular, color: muted });
      page.drawRectangle({ x: x + 78, y: top - 50, width: 76, height: 4, color: rgb(0.89, 0.92, 0.95) });
      page.drawRectangle({ x: x + 78, y: top - 50, width: 76 * (n / 100), height: 4, color: n >= 75 ? teal : n >= 55 ? gold : red });
    }


    function drawRetirementSuccessModel() {
      const sectionHeight = 250;
      ensureBlock(sectionHeight);
      sectionTitle("Retirement Success Model", "Illustrative current vs proposed retirement sustainability estimate.", teal);

      const boxX = 32;
      const boxY = y + 8;
      const boxW = 548;
      const boxH = 195;

      page.drawRectangle({
        x: boxX,
        y: boxY - boxH,
        width: boxW,
        height: boxH,
        color: white,
        borderColor: border,
        borderWidth: 0.75,
      });

      page.drawRectangle({
        x: boxX,
        y: boxY - 4,
        width: boxW,
        height: 4,
        color: teal,
      });

      function gradeColor(value: number) {
        if (value >= 85) return teal;
        if (value >= 70) return gold;
        return red;
      }

      function drawSuccessBar(label: string, value: number, modelLabel: string, x: number, top: number) {
        const n = Math.max(0, Math.min(100, Number(value || 0)));
        const barW = 330;
        const barH = 14;
        const scoreColor = gradeColor(n);

        page.drawText(cleanText(label), {
          x,
          y: top,
          size: 9.6,
          font: bold,
          color: navy,
        });

        page.drawText(cleanText(modelLabel), {
          x,
          y: top - 13,
          size: 6.9,
          font: regular,
          color: muted,
        });

        page.drawRectangle({
          x: x + 406,
          y: top - 29,
          width: 96,
          height: 35,
          color: white,
          borderColor: scoreColor,
          borderWidth: 0.7,
        });

        page.drawText(`${Math.round(n)}/100`, {
          x: x + 416,
          y: top - 11,
          size: 16,
          font: bold,
          color: navy,
        });

        page.drawText(successLabel(n), {
          x: x + 416,
          y: top - 24,
          size: 6.9,
          font: regular,
          color: scoreColor,
        });

        page.drawRectangle({
          x,
          y: top - 42,
          width: barW,
          height: barH,
          color: rgb(0.90, 0.93, 0.96),
        });

        page.drawRectangle({
          x,
          y: top - 42,
          width: barW * (n / 100),
          height: barH,
          color: scoreColor,
        });

        page.drawRectangle({
          x: x + barW * 0.85,
          y: top - 47,
          width: 1.15,
          height: barH + 10,
          color: navy,
        });
      }

      drawSuccessBar("Current Allocation", currentSuccessRate, "Based on current positioning", 52, boxY - 36);
      drawSuccessBar("Proposed Baseline", proposedSuccessRate, "Based on discussion target", 52, boxY - 108);

      const delta = proposedSuccessRate - currentSuccessRate;
      const deltaText = delta >= 0 ? `+${delta} point improvement` : `${delta} point decrease`;

      page.drawRectangle({
        x: 52,
        y: boxY - 176,
        width: 170,
        height: 26,
        color: delta >= 0 ? softTeal : softRed,
        borderColor: delta >= 0 ? teal : red,
        borderWidth: 0.6,
      });

      page.drawText(cleanText(deltaText), {
        x: 64,
        y: boxY - 166,
        size: 9.1,
        font: bold,
        color: delta >= 0 ? teal : red,
      });

      page.drawText("Vertical marker shows the 85+ target zone.", {
        x: 245,
        y: boxY - 160,
        size: 6.7,
        font: regular,
        color: muted,
      });

      page.drawText("Illustrative model, not a guarantee.", {
        x: 245,
        y: boxY - 173,
        size: 6.7,
        font: regular,
        color: muted,
      });

      y = boxY - boxH - 22;
    }


    function drawMonteCarloExplanation() {
      const explanation =
        mode === "client"
          ? "This model estimates how the portfolio may hold up under many different market environments. It uses 5,000 simulated scenarios that include market returns, fixed performance, cash reserves, inflation, withdrawals, sequence-of-return risk, and a retirement horizon to age 95."
          : "This Retirement Success Model is based on a Monte Carlo simulation designed to evaluate the long-term sustainability of a portfolio under a wide range of market conditions. The analysis runs 5,000 simulated scenarios incorporating equity returns, fixed performance, cash reserves, inflation, retirement withdrawals, sequence-of-return risk, and a retirement horizon to age 95.";

      const sectionHeight = paragraphBlockHeight(explanation, "Methodology summary.");
      ensureBlock(sectionHeight);

      sectionTitle("How This Analysis Works", "Methodology summary.", teal);

      const boxHeight = Math.max(72, estimateLines(explanation, 112) * 13.4 + 26);

      page.drawRectangle({
        x: 32,
        y: y - boxHeight + 12,
        width: 548,
        height: boxHeight,
        color: softTeal,
        borderColor: border,
        borderWidth: 0.7,
      });

      page.drawRectangle({
        x: 32,
        y: y - boxHeight + 12,
        width: 5,
        height: boxHeight,
        color: teal,
      });

      y = drawWrappedText(explanation, 48, y - 8, 112, 8.3, slate, regular, 5.0) - 14;
    }

    function allocationCard(title: string, subtitle: string, x: number, top: number, data: any, accent: RGB) {
      const equity = asNumber(data?.equity);
      const fixed = asNumber(data?.fixedIncome);
      const cash = asNumber(data?.cash);
      const values = [
        { label: "Equity", value: equity, color: teal },
        { label: "Fixed", value: fixed, color: blue },
        { label: "Cash", value: cash, color: gold },
      ];

      page.drawRectangle({ x, y: top - 132, width: 256, height: 132, color: white, borderColor: border, borderWidth: 0.8 });
      page.drawRectangle({ x, y: top - 4, width: 256, height: 4, color: accent });
      page.drawText(title, { x: x + 14, y: top - 24, size: 13.5, font: serif, color: navy });
      page.drawText(subtitle, { x: x + 14, y: top - 38, size: 7.3, font: regular, color: muted });

      let yy = top - 62;
      for (const item of values) {
        page.drawCircle({ x: x + 18, y: yy + 2, size: 4, color: item.color });
        page.drawText(item.label, { x: x + 30, y: yy - 1, size: 8.3, font: regular, color: slate });
        page.drawText(`${item.value}%`, { x: x + 200, y: yy - 1, size: 8.3, font: bold, color: navy });
        page.drawRectangle({ x: x + 30, y: yy - 10, width: 168, height: 3.5, color: rgb(0.90, 0.93, 0.96) });
        page.drawRectangle({ x: x + 30, y: yy - 10, width: 168 * (item.value / 100), height: 3.5, color: item.color });
        yy -= 28;
      }
    }

    function drawOverview() {
      ensureBlock(265);
      sectionTitle("Allocation Overview", "Current positioning compared with discussion baseline.");
      allocationCard("Current Allocation", "Based on current statement", 32, y + 4, allocation?.current || {}, teal);
      allocationCard("Potential Baseline", "Discussion target", 324, y + 4, allocation?.target || {}, blue);
      y -= 152;

      sectionTitle("Portfolio Scores", "Quick diagnostic view of alignment, diversification, and income readiness.");
      drawScoreCard("Risk Alignment", scores.riskAlignment, "Risk versus baseline", 32, y + 6, teal);
      drawScoreCard("Diversification", scores.diversification, "Asset balance", 222, y + 6, indigo);
      drawScoreCard("Income Readiness", scores.incomeReadiness, "Income stability", 412, y + 6, blue);
      y -= 98;
    }

    function drawHoldingsAppendix() {
      if (!holdings.length || mode !== "advisor") return;
      newPage();
      sectionTitle("Holdings Appendix", "Extracted holdings and advisor-reviewed classifications.");

      page.drawRectangle({ x: 32, y: y - 18, width: 548, height: 22, color: deep });
      page.drawText("Holding", { x: 40, y: y - 12, size: 7.5, font: bold, color: white });
      page.drawText("Selected Match", { x: 174, y: y - 12, size: 7.5, font: bold, color: white });
      page.drawText("Asset Class", { x: 350, y: y - 12, size: 7.5, font: bold, color: white });
      page.drawText("Value", { x: 504, y: y - 12, size: 7.5, font: bold, color: white });
      y -= 30;

      for (let i = 0; i < holdings.length; i++) {
        const h = holdings[i];
        if (y < 78) {
          newPage();
          sectionTitle("Holdings Appendix Continued", "Remaining extracted holdings.");
        }
        const rowFill = i % 2 === 0 ? soft : white;
        page.drawRectangle({ x: 32, y: y - 15, width: 548, height: 20, color: rowFill, borderColor: rgb(0.91, 0.94, 0.96), borderWidth: 0.25 });
        page.drawText(cleanText(h?.rawName || "Unknown").slice(0, 30), { x: 40, y: y - 8, size: 6.9, font: regular, color: slate });
        page.drawText(cleanText(h?.suggested || "Needs review").slice(0, 36), { x: 174, y: y - 8, size: 6.9, font: regular, color: slate });
        page.drawText(cleanText(h?.assetClass || "Unknown").slice(0, 30), { x: 350, y: y - 8, size: 6.9, font: regular, color: slate });
        page.drawText(money(h?.value || 0), { x: 504, y: y - 8, size: 6.9, font: regular, color: slate });
        y -= 20;
      }
    }

    drawHeader();
    drawOverview();


    drawTextSection("Synopsis", "Summary of the portfolio review.", analysis?.synopsis || "No analysis available.");

    newPage();
    drawRetirementSuccessModel();

    drawMonteCarloExplanation();

    drawPositioningTable();

    if (mode === "advisor") {
      drawCardSection("Advisor Red Flags", "Advisor-only concerns to review before discussing any strategy.", redFlagItems, red, softRed);
    }

    drawCardSection("Overlap & Concentration Insights", "Hidden exposure that may not be obvious from the number of holdings alone.", overlapInsightItems, indigo, softBlue);
    drawCardSection("What This Means for You", "Plain-English impact without technical detail.", mode === "client" ? whatThisMeansItems.slice(0, 3) : whatThisMeansItems, teal, softTeal);
    drawCardSection("Strategic Considerations", "Planning areas to review.", mode === "client" ? strategyItems.slice(0, 3) : strategyItems, blue, soft);

    if (mode === "advisor") {
      drawCardSection("Advisor Example Recommendations", "Advisor-only rebalance ideas for review, not final trade instructions.", recommendationItems, gold, rgb(1.0, 0.985, 0.92));
    } else {
      drawCardSection("Potential Next Steps", "A simple path for the next conversation.", [
        "We will review how your current portfolio lines up with your retirement timeline, income needs, and comfort with market volatility.",
        "We will discuss whether a more balanced mix between growth, stability, and income may better support your retirement goals.",
        "We will look at diversification opportunities across asset classes, sectors, and income sources before making any changes.",
        "We will prepare a personalized plan that considers taxes, liquidity needs, risk tolerance, and your full financial picture.",
      ], teal, softTeal);
    }

    if (mode === "client") {
      drawCardSection("Portfolio Highlights", "Three headline takeaways from the portfolio review.", portfolioHighlightItems.slice(0, 3), navy, soft);
    } else {
      drawCardSection("Meeting Overview", "Talking points for the next conversation.", meetingItems.slice(0, 4), navy, soft);
    }

    if (mode === "advisor" && analysis?.advisorOpeningScript) {
      drawTextSection("Advisor Opening Script", "Suggested meeting opener.", analysis.advisorOpeningScript);
    }

    if (mode === "advisor" && Array.isArray(analysis?.objectionHandling) && analysis.objectionHandling.length) {
      drawCardSection("Objection Handling", "Potential client concerns and response framing.", analysis.objectionHandling, red, softRed);
    }

    drawHoldingsAppendix();

    pdfDoc.getPages().forEach((p) => drawFooter(p));
    const pdfBytes = await pdfDoc.save();

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${fileName}`,
      },
    });
  } catch (err: any) {
    console.error("PDF REPORT ERROR:", err);
    return NextResponse.json({ error: err?.message || "Failed to generate PDF report." }, { status: 500 });
  }
}
