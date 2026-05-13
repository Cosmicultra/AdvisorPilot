import OpenAI from "openai";
import { Buffer } from "buffer";
import { ASSET_CLASSES } from "./asset-classes";
import {
  clipPdfTextForPrompt,
  isLikelyPdf,
  tryExtractPdfText,
  PDF_TEXT_PROMPT_DEFAULT_MAX_CHARS,
} from "./extract-pdf-text-layer";
import {
  extractionMaxOutputTokens,
  extractionModel,
  logOpenAiPass,
} from "./openai-route-models";
import { assertStatementFileReadable } from "./statement-input-quality";
import { assertHoldingsReconcileToVerifiedTotal } from "./statement-extraction-verify";
import { expandHoldingsPageSpec, slicePdfBytesToPages } from "./holdings-page-spec";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1].trim() : trimmed;
  body = body.replace(/[\u201C\u201D]/g, '"');
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
 * Many consolidated PDFs repeat account shells (IRA + taxable + 401(k)). Embedded text lists each
 * `Account Number:` — surfacing that count up front sharply reduces “first table only” omissions.
 */
function buildMultiAccountPdfHint(pdfText: string): string {
  const ids = [...pdfText.matchAll(/Account Number:\s*([^\n\r]+)/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }
  if (unique.length <= 1) return "";

  const endingCount = [...pdfText.matchAll(/Ending Account Value:\s*\$[\d,]+\.\d{2}/gi)].length;

  return `
MULTI-ACCOUNT DOCUMENT (embedded PDF text lists ${unique.length} distinct account numbers — ${endingCount} printed ending-account totals):
${unique.map((id, i) => `${i + 1}. ${id}`).join("\n")}
Extract holdings[] for **every** position line under **each** account block above (every holdings table tied to each account number). Do not stop after the first account’s table.
When the same ticker appears in two accounts, emit separate holdings[] rows and set accountNumber to the printed id for that row.

`;
}

/**
 * Run the same OpenAI extraction as POST /api/analyze-statement (server-only).
 */
export async function extractHoldingsFromFileBuffer(params: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  clientContext: Record<string, unknown>;
}): Promise<{ holdings: ExtractedHolding[] }> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment.");
  }

  const { fileName, mimeType, bytes, clientContext: clientContextIn } = params;
  const { holdingsPagesWithPositions: advisorHoldingsPagesRaw, ...clientContext } = clientContextIn;
  const advisorHoldingsPages =
    typeof advisorHoldingsPagesRaw === "string" ? advisorHoldingsPagesRaw.trim() : "";

  await assertStatementFileReadable({ bytes, mimeType, fileName });

  let workBytes = bytes;
  let pdfPhysicallySliced = false;
  if (
    advisorHoldingsPages &&
    !mimeType.toLowerCase().includes("image") &&
    isLikelyPdf(mimeType, fileName)
  ) {
    const expanded = expandHoldingsPageSpec(advisorHoldingsPages);
    if (expanded.length > 0) {
      const sliced = await slicePdfBytesToPages(bytes, expanded);
      if (sliced && sliced.length > 0) {
        workBytes = sliced;
        pdfPhysicallySliced = true;
      }
    }
  }

  const advisorPageScope = advisorHoldingsPages
    ? pdfPhysicallySliced
      ? `
**PDF PAGE FILTER (server-applied):** This attachment contains **only** the original pages matching the advisor’s pattern **${advisorHoldingsPages}** (1-based; hyphen = inclusive). The PDF was trimmed before upload to the model — extract holdings from the **entire** file; there are no other pages to read.
`
      : `
**ADVISOR PAGE SCOPE (hint only — full file still attached):** The advisor indicated holdings may appear only on pages matching **${advisorHoldingsPages}** (1-based: hyphen = inclusive range, commas separate pages/ranges). **Extract holdings only from those pages/sections** when you can identify them. Do not invent rows from other parts of the document.
`
    : "";

  const base64 = workBytes.toString("base64");

  const filePart = mimeType.includes("image")
    ? {
        type: "input_image" as const,
        image_url: `data:${mimeType};base64,${base64}`,
        // Avoid detail "high" — some gpt-4o Responses requests reject it (400).
        detail: "auto" as const,
      }
    : {
        type: "input_file" as const,
        filename: fileName || "statement.pdf",
        file_data: `data:${mimeType};base64,${base64}`,
      };

  const assetClassList = ASSET_CLASSES.join(", ");

  const mimeLower = mimeType.toLowerCase();
  const isImage = mimeLower.includes("image");

  let embeddedPdfText: string | null = null;
  let pdfTextLayerSection = "";
  if (!isImage && isLikelyPdf(mimeType, fileName)) {
    embeddedPdfText = await tryExtractPdfText(workBytes);
    if (embeddedPdfText) {
      const multiHint = buildMultiAccountPdfHint(embeddedPdfText);
      const clipped = clipPdfTextForPrompt(
        embeddedPdfText,
        pdfPhysicallySliced ? Number.MAX_SAFE_INTEGER : PDF_TEXT_PROMPT_DEFAULT_MAX_CHARS
      );
      pdfTextLayerSection = `
${multiHint}
EMBEDDED PDF TEXT (order may differ from visuals — align rows using the PDF layout; **Mkt Val / Market value** column wins for **value**):
---
${clipped}
---
`;
    }
  }

  const visionOnlyStatement =
    isImage || (isLikelyPdf(mimeType, fileName) && embeddedPdfText == null);

  const visionOnlySection = visionOnlyStatement
    ? `
(Image / scan / no selectable text.) Read the printed table visually. **value** = **Mkt Val / Market value**; **costBasis** = printed **Cost basis** for that row when present. Ignore qty, price, day change when choosing market value.
`
    : "";

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

  const extractModel = extractionModel();
  logOpenAiPass("analyze-statement", "extract", extractModel);

  const response = await openai.responses.create({
    model: extractModel,
    instructions: visionOnlyStatement
      ? "User-style task in prompt: holdings JSON line-by-line, market-value column only, minimal options. Prefer matching ChatGPT conversational clarity."
      : "User-style holdings extract to JSON only; Schwab/account-summary totals must tie sum(values). Trust visual Mkt Val when text is scrambled.",
    input: [
      {
        role: "user",
        content: [
          filePart,
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
    max_output_tokens: extractionMaxOutputTokens(),
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  const text = response.output_text || "";

  if (!text) {
    throw new Error("OpenAI returned an empty extraction response.");
  }

  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    console.warn("[analyze-statement] extract response incomplete:", reason);
    if (reason === "max_output_tokens") {
      throw new Error(
        "Statement extraction stopped early because the response size limit was reached. Try uploading fewer pages at once, or set OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS higher if your model allows it."
      );
    }
  }

  try {
    const parsed = parseExtractedHoldingsResponse(text);
    assertHoldingsReconcileToVerifiedTotal({
      holdings: parsed.holdings,
      embeddedPdfText,
      modelStatementEndingValue: parsed.statementAccountEndingValue,
    });
    return { holdings: parsed.holdings };
  } catch (err) {
    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason;
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
