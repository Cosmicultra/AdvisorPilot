import { NextResponse } from "next/server";
import { holdingsForAnalysisPrompt } from "@/lib/holdings-for-analysis";
import { buildRegistrationSummaryForAnalysis } from "@/lib/holding-registration";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { writeAuditEvent } from "@/lib/audit-log";
import { complete, research, resolveAdvisorLlmSelection } from "@/lib/llm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { client, holdings, allocation, totalValue } = body;
    const demoMode = Boolean(body?.demoMode);
    const identity = await resolveAdvisorIdentity(req);
    if (!demoMode && !identity) {
      return NextResponse.json(
        { error: "Sign in to generate portfolio analysis." },
        { status: 401 }
      );
    }

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

    const registrationSummary = buildRegistrationSummaryForAnalysis(
      Array.isArray(holdings) ? holdings : []
    );
    const holdingsForPrompt = holdingsForAnalysisPrompt(
      Array.isArray(holdings) ? holdings : []
    );

    const selection = await resolveAdvisorLlmSelection(identity?.email);

    const researchPrompt = `
Research current market conditions for an advisor-facing portfolio review.

Today's analysis date is ${analysisDate}.

Focus on:
- current stock market conditions
- interest rates and bond environment
- sector leadership/weakness
- volatility and sequence-of-return risk
- bond and credit market dynamics (including how rate moves affect fixed sleeve positioning)
- income-oriented strategies
- relevance to these holdings

Client:
${JSON.stringify(client, null, 2)}

Holdings:
${JSON.stringify(holdingsForPrompt, null, 2)}

Registration / account summary (from holdings; advisor may have edited):
${JSON.stringify(registrationSummary, null, 2)}

Allocation:
${JSON.stringify(allocation, null, 2)}

Total Value:
${totalValue}

For rows with annuityContractSummary, treat as insurance annuity contracts (surrender, income base, indexing rates) — not exchange-traded securities.

Write concise research notes only. Do not return JSON.
`;

    const researchResult = await research(
      {
        tier: selection.defaultResearchTier ?? "agentic-research",
        user: researchPrompt,
      },
      { request: req, selection }
    );

    const researchNotes = researchResult.text;
    const researchCitations = researchResult.citations;

    // Surface the real sources to the synthesis pass so its output references
    // actual research instead of model memory. The previous behavior discarded
    // citations entirely.
    const citationsBlock = researchCitations.length
      ? `\n\nResearch Sources (use only these when referencing external evidence; do not invent URLs):
${researchCitations
  .map((c, i) => `[${i + 1}] ${c.title ? `${c.title} — ` : ""}${c.uri}`)
  .join("\n")}\n`
      : "";

    const jsonPrompt = `
You are AdvisorPilot, an elite portfolio analysis assistant for licensed financial advisors.

Using the portfolio data and current market research notes below, generate a professional portfolio review.

Today's analysis date is ${analysisDate}.

Client:
${JSON.stringify(client, null, 2)}

Holdings:
${JSON.stringify(holdingsForPrompt, null, 2)}

Registration / account summary:
${JSON.stringify(registrationSummary, null, 2)}

Allocation:
${JSON.stringify(allocation, null, 2)}

Total Value:
${totalValue}

Annuity contract rows include annuityContractSummary when present — reference surrender value, income base, and indexing terms in analysis when material.

Market Research Notes:
${researchNotes}
${citationsBlock}
Return ONLY valid JSON. No markdown. No code fences.

Use this exact JSON shape:
{
  "synopsis": "As of [long date]. Executive summary: concrete holdings fact, integrated current vs proposed sleeves in prose, 2+ tight sentences on why the proposed mix fits risk/age/timeline/income (causal reasoning; not a pitch). No client-profile clichés.",
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
    "advisor meeting agenda point 1 (grounding)",
    "advisor meeting agenda point 2 (registration wrappers)",
    "advisor meeting agenda point 3 (narrative and sleeves)",
    "advisor meeting agenda point 4 (diagnostics: scores, stress, red flags vs overlap, impact before strategy)"
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
- This is the client-facing executive summary at the top of the report. Write it as if an exceptional advisor and portfolio analyst drafted it: calm, precise, ethically tight, and easy to trust. Short does not mean shallow—every sentence should earn its place.
- Must start with: "As of ${analysisDate}, ..."
- Hard cap: 6-7 sentences (not more). Dense plain English. No bullet characters inside the synopsis string. No markdown.
- After the date, use first name when Client.firstName exists ("For Morgan," or woven into the first clause). If firstName is missing, use neutral phrasing—never "the client profile," "on the client's profile," or "per the client profile."
- Do all of the following in order, without sounding like a mail-merge template:
  a) Ground the reader in 1-2 concrete facts from their holdings: largest positions by weight or dollars when values exist, or one clear concentration fact if a sleeve dominates. Use names/tickers from the Holdings data.
  b) Describe current vs proposed sleeves once, in prose. Prefer weaving percentages in naturally; avoid a dry "current X% vs proposed Y%" rundown unless one contrast is essential.
  c) Reasoning (required): Spend at least 2 sentences on why the proposed mix is directionally appropriate for this person. Tie to stated risk profile, age or retirement timeline, income or stability needs, concentration, or volatility—only what the Client + holdings data support. Explain cause and effect (e.g., added fixed sleeve to buffer drawdowns with a shorter runway; retained equity when the timeline still supports growth; reduced dominant equity weight when one sleeve drives most outcome risk). If proposed is close to current, explain what the calibration still clarifies or tightens (roles of sleeves, drift from stated risk posture).
  d) Optional: one short clause from Market Research Notes only if it directly supports that rationale—never a macro lecture.
- Compliance: No return guarantees, no buy/sell commands, no tax or legal advice. Use disciplined wording: illustrative, for discussion, aligned with, where appropriate.
- Tone: institutional confidence, zero hype, zero filler ("leverage synergies," "optimize alignment," "holistic"). Avoid stacked abstractions ("demonstrates," "underscores," "positions the portfolio to") unless unavoidable.
- Do not duplicate wording from portfolioHighlights, overlapInsights, displayWhatThisMeans, strategies, or recommendations. Synopsis = the arc; other sections hold the detail list.

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
- Return exactly 4 bullets, one sentence each, in this conversation order (do not number them in the strings):
  a) Grounding: confirm statement period, rough total, and whether major accounts are missing from uploads.
  b) Registration: tax wrappers (traditional vs taxable vs Roth) using the registration summary—qualitative, not tax advice.
  c) Narrative then sleeves: executive story then current vs proposed allocation roles.
  d) Diagnostics: scores and illustrative stress only after context; then red flags versus overlap as distinct jobs; translate impact before strategy.
- Brief and advisor-facing.
- This is not intended to appear as the final client report section if Portfolio Highlights is used instead.
- No repeated full analysis; do not paste synopsis sentences verbatim.

9. advisorOpeningScript
- Advisor-facing.
- Professional and concise.

10. objectionHandling
- Advisor-facing.
- Common client concerns and response framing.
- Keep each item concise.

STYLE RULES:
- Make it specific to the client age, retirement timeline, risk profile, goals, holdings, and allocation.
- Use "Fixed" (or "fixed sleeve") instead of "Fixed Income" when naming the allocation bucket in outputs.
- Do not call dividend equity exposure fixed or guaranteed income.
- Distinguish bond funds, Treasuries, cash, dividend equity, annuities, and guaranteed income as different tools.
- When registration summary shows both traditional tax-deferred balances and non-qualified (taxable) balances, discuss them separately: qualified-style assets vs brokerage/taxable buckets, and tie Roth conversion framing to traditional tax-deferred sources only (do not treat taxable or Roth IRA balances as Roth conversion sources).
- If nonQualifiedWithCostBasis is non-empty, include at least one advisor-facing note (in redFlags and/or recommendations and/or talkingPoints) that selling or rotating taxable positions may realize capital gains versus stated cost basis — qualitative only, not tax advice, no dollar tax estimates unless the stated basis and market value plainly imply a taxable gain magnitude you describe in general terms.
- Keep client-facing language clear, calm, and non-alarming.
- Avoid generic filler such as "optimize the portfolio," "ensure alignment," "monitor closely," or "maintain diversification" unless paired with specific context.
- Avoid saying the same thing in different words across sections.
- Do not claim exact live prices unless they were found in research notes.
- Do not phrase anything as tax, legal, or investment advice.
- Do not make final trade instructions.

RISK INTAKE AND QUESTIONNAIRE (use Client JSON fields riskIntakeKnown, riskIntakeScreen, riskQuizAnswers, riskProfileSuggested, riskProfile):
- If riskIntakeKnown is "yes" (or the record clearly reflects a stated tier only), treat riskProfile as the client's existing stated posture from their process. Do not imply a full in-app questionnaire was completed.
- If riskIntakeKnown is "no" and riskQuizAnswers has entries, ground one or two sentences of synopsis reasoning (and where relevant displayWhatThisMeans or redFlags) in concrete themes those answers support—such as withdrawal horizon, liquidity outside the portfolio, dependence on the portfolio for essential expenses, comfort with drawdown scenarios, or concentration—only when consistent with Client + holdings. The in-app questions are illustrative discussion support in AdvisorPilot, not a regulated risk-tolerance instrument; do not guarantee future behavior.
- If riskProfileSuggested is present and differs from riskProfile, you may add at most one neutral clause that the advisor chose a different tier than the quick assessment suggested—no suitability or "correct profile" language.
`;

    const synthesisResult = await complete<Record<string, unknown>>(
      {
        pass: "synthesis.json",
        user: jsonPrompt,
        jsonSchema: { type: "object" },
      },
      { request: req, selection }
    );

    const parsed = (synthesisResult.json ?? {}) as Record<string, unknown>;

    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const holdingsLen = Array.isArray(holdings) ? holdings.length : 0;

    await writeAuditEvent({
      ownerEmail: identity?.email ?? "unauthenticated.demo",
      ownerUserId: identity?.userId ?? null,
      actorEmail: identity?.email ?? null,
      action: "analysis.completed",
      entityType: "analysis",
      entityId: clientId,
      metadata: {
        demoMode,
        holdingsCount: holdingsLen,
        provider: synthesisResult.context.provider,
        researchModel: researchResult.context.model,
        jsonModel: synthesisResult.context.model,
        researchCitationCount: researchCitations.length,
        unauthenticated: !identity,
      },
    });

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
      /**
       * Real citations harvested from the research pass. Today's PDF route
       * does not yet render these; persisted now so the UI / report can
       * surface "Sources" in a follow-up PR without re-running the call.
       */
      citations: researchCitations,
      searchSuggestionsHtml: researchResult.searchSuggestionsHtml ?? null,
    });
  } catch (err: unknown) {
    console.error("ANALYSIS ERROR:", err);
    console.error("MESSAGE:", err instanceof Error ? err.message : String(err));

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate analysis" },
      { status: 500 }
    );
  }
}
