import { Buffer } from "buffer";
import { ASSET_CLASSES } from "./asset-classes";
import { complete, type AdvisorLlmSelection } from "./llm";
import { normalizeAttachment } from "./llm/attachments";
import { extractionMaxOutputTokens } from "./openai-route-models";
import { assertHoldingsReconcileToVerifiedTotal } from "./statement-extraction-verify";

/** Remove trailing commas before } or ] (common in LLM JSON). */
function stripTrailingCommas(json: string): string {
  let prev = "";
  let out = json;
  for (let i = 0; i < 6 && out !== prev; i++) {
    prev = out;
    out = out.replace(/,(\s*[}\]])/g, "$1");
  }
  return out;
}

/**
 * Isolate and lightly normalize model output before JSON.parse.
 * Models sometimes add fences, prose, smart quotes, or invalid example fragments from prompts.
 */
function extractHoldingsJsonBlob(text: string): string {
  const trimmed = text.trim().replace(/^﻿/, "");
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1].trim() : trimmed;
  body = body.replace(/[“”]/g, '"');
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    body = body.slice(start, end + 1);
  }
  return stripTrailingCommas(body);
}

function parseExtractedHoldingsResponse(text: string): {
  holdings: ExtractedHolding[];
  statementAccountEndingValue?: number;
} {
  const body = extractHoldingsJsonBlob(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not parse statement extraction as JSON (${msg}). If this persists, try again or use a different statement file.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Statement extraction must be a JSON object with a holdings array.");
  }
  const rec = parsed as Record<string, unknown>;
  const holdings = rec.holdings;
  if (!Array.isArray(holdings)) {
    throw new Error('Statement extraction JSON must include a "holdings" array.');
  }
  const savRaw = rec.statementAccountEndingValue;
  let statementAccountEndingValue: number | undefined;
  if (typeof savRaw === "number" && Number.isFinite(savRaw)) {
    statementAccountEndingValue = savRaw;
  }
  return { holdings: holdings as ExtractedHolding[], statementAccountEndingValue };
}

export type ExtractedHolding = {
  rawName: string;
  suggested: string;
  confidence: number;
  assetClass: string;
  value: number;
  status: string;
  options: string[];
  /** Account identifier as printed (often last 4); empty if only one pooled account */
  accountNumber?: string;
  /**
   * qualified = traditional tax-deferred (IRA, 401(k), etc.) — Roth conversion sourcing;
   * non_qualified = taxable brokerage or bank non-retirement;
   * roth = Roth IRA/b Roth 401(k) balance (not a traditional conversion source);
   * unknown = not clear from statement.
   */
  registrationType?: "qualified" | "non_qualified" | "roth" | "unknown";
  /** For non-qualified positions only: cost basis when shown on statement (0 omit). */
  costBasis?: number;
};

/**
 * Run the OpenAI extraction pass via the multi-provider LLM abstraction
 * (`lib/llm`). All intake normalization — magic-byte sniff, size cap, page
 * slicing, text-layer extraction, multi-account hint — happens in
 * `normalizeAttachment()`; this function only builds the prompt and
 * dispatches the model call.
 */
export async function extractHoldingsFromFileBuffer(params: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  clientContext: Record<string, unknown>;
  /** Optional: the advisor's persisted LLM selection (provider + per-pass overrides). */
  selection?: AdvisorLlmSelection;
  /** Optional: incoming HTTP request — used for header-based provider override. */
  request?: Request;
}): Promise<{ holdings: ExtractedHolding[] }> {
  const { fileName, mimeType, bytes, clientContext: clientContextIn, selection, request } = params;
  const { holdingsPagesWithPositions: advisorHoldingsPagesRaw, ...clientContext } = clientContextIn;
  const advisorHoldingsPages =
    typeof advisorHoldingsPagesRaw === "string" ? advisorHoldingsPagesRaw.trim() : "";

  const attachment = await normalizeAttachment({
    bytes,
    mime: mimeType,
    fileName,
    pageHint: advisorHoldingsPages || undefined,
  });

  const visionOnlyStatement =
    attachment.kind === "image" || (attachment.kind === "pdf" && !attachment.hasTextLayer);

  const advisorPageScope =
    advisorHoldingsPages && attachment.kind === "pdf"
      ? attachment.pdfPhysicallySliced
        ? `
**PDF PAGE FILTER (server-applied):** This attachment contains **only** the original pages matching the advisor's pattern **${advisorHoldingsPages}** (1-based; hyphen = inclusive). The PDF was trimmed before upload to the model — extract holdings from the **entire** file; there are no other pages to read.
`
        : `
**ADVISOR PAGE SCOPE (hint only — full file still attached):** The advisor indicated holdings may appear only on pages matching **${advisorHoldingsPages}** (1-based: hyphen = inclusive range, commas separate pages/ranges). **Extract holdings only from those pages/sections** when you can identify them. Do not invent rows from other parts of the document.
`
      : "";

  const pdfTextLayerSection = attachment.textLayer
    ? `
${attachment.textLayer.multiAccountHint}EMBEDDED PDF TEXT (order may differ from visuals — align rows using the PDF layout; **Mkt Val / Market value** column wins for **value**):
---
${attachment.textLayer.clippedText}
---
`
    : "";

  const visionOnlySection = visionOnlyStatement
    ? `
(Image / scan / no selectable text.) Read the printed table visually. **value** = **Mkt Val / Market value**; **costBasis** = printed **Cost basis** for that row when present. Ignore qty, price, day change when choosing market value.
`
    : "";

  const assetClassList = ASSET_CLASSES.join(", ");

  const prompt = `
Can you read this statement? Tell me the **account number**, the **holding name**, the **ticker** for that holding, the **value** of each holding **broken out line by line**, and **give me totals at the bottom** (portfolio-level total as **statementAccountEndingValue** when one headline number equals all positions). **List the cost basis for each holding if there is one**, and show it on each applicable holding as the JSON field **costBasis** (use 0 only when that row has no cost printed).

Map into our app as JSON only (no markdown, no trailing commas):

- **accountNumber** on rows in that account section when the statement shows it.
- **rawName** / **suggested** for name and ticker; **value** = **market value / Mkt val** USD for that row **only** — not shares × price.
- **costBasis** = explicit **cost basis / tax cost / avg cost** dollar amount for that holding when the statement prints it; omit or 0 otherwise.

IGNORE for the **value** field only (still read **cost basis** into **costBasis** when in its own column): Quantity/Shares/Qty/last **Price**/% change/Day change/unrealized gain$ and % as substitutes for market value. Commas in USD = thousands separators.

**Respond in JSON only**. Do not summarize away rows.

confidence integer 0–100. status exactly "matched" or "review".

assetClass must be EXACTLY one verbatim string from: ${assetClassList}

Suggested assetClass picks: equities → Individual Stock; broad ETFs → Equity ETF; mutual funds/open-end → Equity Mutual Fund / Mutual Fund / Cash Mutual Fund as appropriate; cash/sweep/MM → Cash / Money Market, Money Market Account, or Cash Mutual Fund by label.

options: minimal — usually [ "TICKER" ] or [ "suggested text", "Manual ticker / CUSIP entry" ].

registrationType each row when possible: qualified | non_qualified | roth | unknown.

If the statement has **multiple accounts** (multiple **Account Number** / **Ending Account Value** blocks), extract **every** holding row in **every** account; set **accountNumber** per row. **statementAccountEndingValue** must be the **combined** total of those account-ending values (or omit it — the server uses machine-parsed totals). **Partial single-account extracts fail verification.**

The server rejects the response unless sum(all **value**) matches machine-parsed multi-account totals or a single-account **statementAccountEndingValue**, within ~2% / $500 — fix columns before returning.

AdvisorPilot client metadata (hints only — extract from document first):
${JSON.stringify(clientContext, null, 2)}
${advisorPageScope}${visionOnlySection}${pdfTextLayerSection}
Example shape:
{"statementAccountEndingValue":3500.84,"holdings":[{"rawName":"APPLE INC","suggested":"AAPL","confidence":90,"assetClass":"Individual Stock","value":250.01,"status":"matched","registrationType":"roth","accountNumber":"****023","options":["AAPL"],"costBasis":199.5}]}
`;

  // We pass `jsonSchema` solely to force `text.format: { type: "json_object" }`
  // on the OpenAI adapter. The adapter's auto-parse would throw a generic
  // SyntaxError on malformed output, so we re-parse `result.text` with our
  // statement-specific parser below to preserve the helpful error messages
  // and capture `statementAccountEndingValue`.
  let result;
  try {
    result = await complete<unknown>(
      {
        pass: "extraction",
        system: visionOnlyStatement
          ? "User-style task in prompt: holdings JSON line-by-line, market-value column only, minimal options. Prefer matching ChatGPT conversational clarity."
          : "User-style holdings extract to JSON only; Schwab/account-summary totals must tie sum(values). Trust visual Mkt Val when text is scrambled.",
        user: prompt,
        attachments: [attachment],
        jsonSchema: { type: "object" },
        maxOutputTokens: extractionMaxOutputTokens(),
      },
      { request, selection }
    );
  } catch (err) {
    // Adapter throws on incomplete-due-to-max-tokens or empty response with
    // its own copy that mentions max-output-tokens. Re-throw unchanged so the
    // route surfaces it.
    throw err;
  }

  const rawResponse = result.raw as {
    status?: string;
    incomplete_details?: { reason?: string };
  };

  try {
    const parsed = parseExtractedHoldingsResponse(result.text);
    assertHoldingsReconcileToVerifiedTotal({
      holdings: parsed.holdings,
      embeddedPdfText: attachment.textLayer?.fullText ?? null,
      modelStatementEndingValue: parsed.statementAccountEndingValue,
    });
    return { holdings: parsed.holdings };
  } catch (err) {
    if (rawResponse.status === "incomplete") {
      const reason = rawResponse.incomplete_details?.reason;
      throw new Error(
        reason === "max_output_tokens"
          ? "Statement extraction may have been cut off before all holdings were listed. Try a smaller PDF or fewer accounts per file, or increase OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS."
          : err instanceof Error
            ? err.message
            : String(err)
      );
    }
    throw err;
  }
}
