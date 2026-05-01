import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { client, holdings, allocation, totalValue } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const analysisDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const researchPrompt = `
Research current market conditions for an advisor-facing portfolio review.

Today's analysis date is ${analysisDate}.

Focus on:
- current stock market conditions
- interest rates and bond environment
- sector leadership/weakness
- volatility and sequence-of-return risk
- fixed income landscape
- income-oriented strategies
- relevance to these holdings

Client:
${JSON.stringify(client, null, 2)}

Holdings:
${JSON.stringify(holdings, null, 2)}

Allocation:
${JSON.stringify(allocation, null, 2)}

Total Value:
${totalValue}

Write concise research notes only. Do not return JSON.
`;

    const researchResponse = await openai.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: researchPrompt,
    });

    const researchNotes = researchResponse.output_text || "";

    const jsonPrompt = `
You are AdvisorPilot, an elite advisor-facing portfolio analysis assistant.

Using the portfolio data and the current market research notes below, generate a professional advisor-level review.

Today's analysis date is ${analysisDate}.

Client:
${JSON.stringify(client, null, 2)}

Holdings:
${JSON.stringify(holdings, null, 2)}

Allocation:
${JSON.stringify(allocation, null, 2)}

Total Value:
${totalValue}

Market Research Notes:
${researchNotes}

Return ONLY valid JSON. No markdown. No code fences.

Use this exact JSON shape:
{
  "synopsis": "A detailed advisor-level paragraph dated with today's analysis date. It should explain the client's portfolio in depth, discuss current market context, identify a few specific holdings or asset categories that may be overexposed, underperforming, overly concentrated, or misaligned with the client's age, risk profile, retirement objective, and stated goal.",
  "strategies": [
    "strategy 1",
    "strategy 2",
    "strategy 3",
    "strategy 4"
  ],
  "redFlags": [
    "advisor red flag 1",
    "advisor red flag 2",
    "advisor red flag 3",
    "advisor red flag 4"
  ],
  "overlapInsights": [
    "overlap and concentration insight 1",
    "overlap and concentration insight 2",
    "overlap and concentration insight 3"
  ],
  "whatThisMeans": [
    "client impact 1",
    "client impact 2",
    "client impact 3"
  ],
  "recommendations": [
    "advisor-only rebalance consideration 1 written as 1-2 detailed sentences",
    "advisor-only rebalance consideration 2 written as 1-2 detailed sentences",
    "advisor-only rebalance consideration 3 written as 1-2 detailed sentences",
    "advisor-only rebalance consideration 4 written as 1-2 detailed sentences"
  ],
  "talkingPoints": [
    "meeting overview point 1",
    "meeting overview point 2",
    "meeting overview point 3",
    "meeting overview point 4"
  ],
  "advisorOpeningScript": "Detailed professional opening script.",
  "objectionHandling": [
    "objection and response 1",
    "objection and response 2",
    "objection and response 3"
  ]
}

Rules:
- This report is for a licensed advisor's internal review and meeting preparation.
- Do not phrase recommendations as final client instructions.
- Do not say "buy this" or "sell this."
- Use advisor-review language such as review, evaluate, consider, potential, rotate, reduce exposure, replace with, rebalance toward, or compare against.
- Make it specific to the client age, retirement timeline, risk profile, goals, holdings, and allocation.
- In the synopsis, reference several actual holdings from the statement when relevant, especially holdings that appear concentrated, growth-heavy, interest-rate sensitive, under-diversified, underperforming, or potentially mismatched to the client's retirement timeline.
- Discuss whether the portfolio appears overweight or underweight equities, fixed, cash, dividend exposure, international exposure, and retirement income positioning.
- The redFlags array should be advisor-eyes-only and should identify the biggest portfolio concerns before recommending strategy.
- Red flags should identify issues such as equity overweight, fund overlap, sector overexposure, concentration risk, low income readiness, excess cash, lack of fixed income, weak diversification, interest-rate sensitivity, or mismatch with the client's retirement timeline.
- Red flags should be direct, specific, and analytical, but still compliance-aware.
- Do not phrase red flags as final client instructions.
- Use language such as appears, may, review, evaluate, potential concern, or worth stress-testing.
- The overlapInsights array should focus specifically on hidden concentration and overlap.
- Overlap insights should identify whether multiple funds, ETFs, mutual funds, or individual stock holdings may create similar underlying exposure.
- Specifically look for overlap across S&P 500 funds, large-cap funds, growth funds, tech stocks, dividend funds, bond funds, cash/money market positions, and any repeated asset category exposure.
- If exact fund-level overlap is unknown, say "may" or "should be reviewed" rather than claiming exact overlap percentages.
- The overlapInsights array should be useful for both advisor review and a simplified client conversation.
- The recommendations array should be advisor-eyes-only and sharper than the client-facing sections.
- Each recommendation should be 1-2 clean sentences, not a long paragraph.
- Each recommendation should identify: the specific holding or category to review, why it may be an issue, and what type of replacement or rebalance direction may be worth comparing.
- The recommendations should feel like a portfolio manager reviewing the statement, not a generic planning checklist.
- The recommendations array should identify specific holdings or categories that may be overexposed, concentrated, sector-sensitive, high-volatility, underperforming, overlapping, or mismatched to the client's retirement objective.
- When appropriate, include potential replacement examples or comparison ideas such as broad-market ETFs, dividend ETFs, short-duration bond ETFs, Treasuries, high-quality bond funds, money market funds, MYGAs, FIAs, SPIAs, or income rider strategies.
- If mentioning individual stock examples, frame them as holdings to review, reduce concentration in, compare, stress-test, rotate away from, or rebalance around, not as final trade instructions.
- Avoid vague recommendations like "diversify more" unless paired with specific portfolio context and a practical comparison idea.
- Keep all language compliance-aware and advisor-facing.
- Do not claim exact live prices unless they were found in research notes.

- Avoid repeating the same concern across multiple sections.
- Each section must have a separate job:
  - synopsis = detailed executive summary/deep dive, dated with today's analysis date, about 8-12 sentences if needed.
  - redFlags = advisor-only concerns, direct and specific.
  - overlapInsights = hidden concentration or fund/stock overlap only; do not repeat broad allocation percentages.
  - whatThisMeans = client-friendly impact only; no ticker symbols, no fund names, no percentages.
  - strategies = planning direction only; do not repeat overlap language.
  - recommendations = advisor-only review ideas; be specific but do not duplicate redFlags.
  - talkingPoints = meeting agenda only; keep brief.
- Use "Fixed" instead of "Fixed Income" in short labels.
- Do not call dividend equity exposure fixed income or guaranteed income.
- Distinguish bond funds, Treasuries, cash, dividend equity, annuities, and guaranteed income as different tools.
- When a holding appears in more than one section, it should serve a different purpose in each section.
- Keep the client-facing language clean, calm, and non-alarming.
- Make the synopsis the deepest narrative section and include today's analysis date. It can be detailed, but avoid copying the exact bullet language from the other sections.
`;

    const jsonResponse = await openai.responses.create({
      model: "gpt-4o",
      input: jsonPrompt,
      text: {
        format: {
          type: "json_object",
        },
      },
    });

    const parsed = JSON.parse(jsonResponse.output_text || "{}");

    return NextResponse.json({
      synopsis: parsed.synopsis || "",
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
      redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
      overlapInsights: Array.isArray(parsed.overlapInsights) ? parsed.overlapInsights : [],
      whatThisMeans: Array.isArray(parsed.whatThisMeans) ? parsed.whatThisMeans : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations
        : [],
      talkingPoints: Array.isArray(parsed.talkingPoints)
        ? parsed.talkingPoints
        : [],
      advisorOpeningScript: parsed.advisorOpeningScript || "",
      objectionHandling: Array.isArray(parsed.objectionHandling)
        ? parsed.objectionHandling
        : [],
    });
  } catch (err: any) {
    console.error("ANALYSIS ERROR:", err);
    console.error("MESSAGE:", err?.message);

    return NextResponse.json(
      { error: err?.message || "Failed to generate analysis" },
      { status: 500 }
    );
  }
}
