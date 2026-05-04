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
You are AdvisorPilot, an elite portfolio analysis assistant for licensed financial advisors.

Using the portfolio data and current market research notes below, generate a professional portfolio review.

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
  "synopsis": "Client-facing executive summary dated with today's analysis date.",
  "portfolioHighlights": [
    "highlight 1",
    "highlight 2",
    "highlight 3"
  ],
  "strategies": [
    "strategy 1",
    "strategy 2",
    "strategy 3"
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
  "displayWhatThisMeans": [
    "client impact 1",
    "client impact 2",
    "client impact 3"
  ],
  "recommendations": [
    "advisor-only rebalance consideration 1",
    "advisor-only rebalance consideration 2",
    "advisor-only rebalance consideration 3",
    "advisor-only rebalance consideration 4"
  ],
  "talkingPoints": [
    "advisor meeting agenda point 1",
    "advisor meeting agenda point 2",
    "advisor meeting agenda point 3"
  ],
  "advisorOpeningScript": "Professional advisor opening script.",
  "objectionHandling": [
    "objection and response 1",
    "objection and response 2",
    "objection and response 3"
  ]
}

NON-NEGOTIABLE SECTION SEPARATION RULE:
Each section has a distinct job. Do not repeat the same talking point across sections. If a topic appears in multiple sections, it must serve a different purpose each time. The report should feel intentionally structured, not repetitive.

SECTION ROLES:

1. synopsis
- Client-facing executive summary.
- Must start with: "As of ${analysisDate}, ..."
- Keep the date.
- 6-8 sentences max.
- Include the most important portfolio facts and holdings when relevant.
- It may reference actual tickers/holdings because the client report is based on their statement.
- It should explain the portfolio in a clear advisor voice, not a generic AI voice.
- It should prioritize the 3-5 most important observations only.
- It should NOT include a checklist of every possible issue.
- It should NOT duplicate exact wording from portfolioHighlights, overlapInsights, displayWhatThisMeans, strategies, or next steps.
- Avoid phrase stacking such as "demonstrates," "highlighting a need," "suggesting an opportunity," "may benefit from adjustments," or "ensure alignment" unless truly necessary.
- Use confident but compliance-aware language.

2. portfolioHighlights
- Client-facing.
- Exactly 3 bullets.
- One sentence each.
- These are headline takeaways, not explanations.
- No repeated wording from the synopsis.
- No "consider," "evaluate," or "review" language.
- No generic filler.
- Each bullet should identify one distinct takeaway.

3. overlapInsights
- Hidden concentration and overlap only.
- Do not repeat broad allocation commentary.
- Focus on duplicated exposure across funds, ETFs, mutual funds, sector exposure, individual stocks, or bond categories.
- Use tickers/holding names when helpful.
- If exact fund-level overlap is unknown, use "may" or "should be reviewed" rather than claiming exact overlap percentages.
- Do not turn this into a recommendation section.

4. displayWhatThisMeans
- Client-facing impact only.
- Plain English.
- No tickers.
- No fund names.
- No percentages.
- Focus on what the client may experience: volatility, confidence, flexibility, income stability, behavior during pullbacks, retirement planning impact.
- Do not repeat the technical explanation from overlapInsights.

5. strategies
- Client-facing planning direction only.
- 3 bullets max.
- Do not repeat the diagnosis.
- Use wording such as "Review," "Discuss," "Compare," "Stress-test," or "Evaluate."
- Keep it practical and calm.
- Do not mention advisor-only trade ideas.

6. redFlags
- Advisor-eyes-only.
- Direct, specific, and analytical.
- Identify the biggest portfolio concerns before strategy.
- May mention tickers, sectors, asset classes, allocation gaps, liquidity, income readiness, overlap, interest-rate sensitivity, or retirement timeline mismatch.
- Do not duplicate recommendations.
- Do not phrase as final client instructions.

7. recommendations
- Advisor-eyes-only.
- Sharper than client-facing sections.
- Each recommendation should be 1-2 clean sentences.
- Each recommendation should identify:
  a) the holding or category to review,
  b) why it may be an issue,
  c) what comparison or rebalance direction may be worth evaluating.
- Mention specific holdings or categories when appropriate.
- Use advisor-review language such as review, evaluate, compare, stress-test, reduce exposure, rebalance toward, or rotate.
- Do not say "buy this" or "sell this."

8. talkingPoints
- Advisor meeting agenda only.
- Brief and advisor-facing.
- This is not intended to appear as the final client report section if Portfolio Highlights is used instead.
- No repeated full analysis.

9. advisorOpeningScript
- Advisor-facing.
- Professional and concise.

10. objectionHandling
- Advisor-facing.
- Common client concerns and response framing.
- Keep each item concise.

STYLE RULES:
- Make it specific to the client age, retirement timeline, risk profile, goals, holdings, and allocation.
- Use "Fixed" instead of "Fixed Income" in short labels.
- Do not call dividend equity exposure fixed income or guaranteed income.
- Distinguish bond funds, Treasuries, cash, dividend equity, annuities, and guaranteed income as different tools.
- Keep client-facing language clear, calm, and non-alarming.
- Avoid generic filler such as "optimize the portfolio," "ensure alignment," "monitor closely," or "maintain diversification" unless paired with specific context.
- Avoid saying the same thing in different words across sections.
- Do not claim exact live prices unless they were found in research notes.
- Do not phrase anything as tax, legal, or investment advice.
- Do not make final trade instructions.
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
      portfolioHighlights: Array.isArray(parsed.portfolioHighlights)
        ? parsed.portfolioHighlights
        : [],
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
      redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags : [],
      overlapInsights: Array.isArray(parsed.overlapInsights)
        ? parsed.overlapInsights
        : [],
      displayWhatThisMeans: Array.isArray(parsed.displayWhatThisMeans)
        ? parsed.displayWhatThisMeans
        : Array.isArray(parsed.whatThisMeans)
          ? parsed.whatThisMeans
          : [],
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
