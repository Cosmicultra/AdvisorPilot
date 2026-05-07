import OpenAI from "openai";
import { Buffer } from "buffer";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeParseJson(text: string) {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
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

  const { fileName, mimeType, bytes, clientContext } = params;
  const base64 = bytes.toString("base64");

  const filePart = mimeType.includes("image")
    ? {
        type: "input_image" as const,
        image_url: `data:${mimeType};base64,${base64}`,
        detail: "auto" as const,
      }
    : {
        type: "input_file" as const,
        filename: fileName || "statement.pdf",
        file_data: `data:${mimeType};base64,${base64}`,
      };

  const prompt = `
You are AdvisorPilot, an advisor-facing financial statement extraction assistant.

Extract all investment holdings from the uploaded statement.

Client context:
${JSON.stringify(clientContext, null, 2)}

Return ONLY valid JSON. No markdown.

Use this exact format:
{
  "holdings": [
    {
      "rawName": "name exactly as shown on statement",
      "suggested": "best match, ticker, fund name, or Needs advisor confirmation",
      "confidence": 0-100,
      "assetClass": "U.S. Large Cap Equity / Bond Fund / ETF / Mutual Fund / Individual Stock / Treasury / Corporate Bond / Cash / Annuity / Unknown",
      "value": number,
      "status": "matched or review",
      "accountNumber": "masked or last-4 digits as printed, or empty string if unclear",
      "registrationType": "qualified | non_qualified | roth | unknown",
      "costBasis": 0,
      "options": [
        "Likely ticker or fund option 1",
        "Likely ticker or fund option 2",
        "Likely ticker or fund option 3",
        "Manual ticker / CUSIP entry"
      ]
    }
  ]
}

Registration rules (per holding, from statement headings / account tiles / tax labels):
- qualified: Traditional IRA, rollover IRA, SEP/SIMPLE, 401(k)/403(b) pre-tax, pension rollover to traditional — tax-deferred money that could be illustrated as Roth conversion *source*.
- roth: Roth IRA or designated Roth/deferred Roth accounts — NOT counted as traditional conversion source.
- non_qualified: Individual/joint taxable brokerage, TOD/TITLED taxable, trusts (taxable), regular bank/broker cash not in IRA.
- unknown: wrappers not visible or ambiguous across pages.

Cost basis rules:
- Populate costBasis only when the statement shows explicit cost/unrealized gain for a taxable (non_qualified) lot; otherwise 0.

Rules:
- If ticker is clearly visible, use it.
- If ticker is not visible, infer likely options from the name.
- Always provide 3-5 possible options when the name is ambiguous.
- If a holding could be multiple share classes, confidence should usually be below 75.
- If confidence is below 75, status must be "review".
- If confidence is 75 or higher, status can be "matched".
- Do not invent account values. Use 0 if value cannot be found.
- For mutual funds, include possible share class tickers.
- For ETFs, include likely ticker options.
- For bonds, include CUSIP if visible. If not visible, classify by bond type.
- For annuities or proprietary indexes, mark as review if no public ticker exists.
- Do not provide trade recommendations here. Only extract and classify holdings.
`;

  const response = await openai.responses.create({
    model: "gpt-4o",
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
  });

  const text = response.output_text || "";

  if (!text) {
    throw new Error("OpenAI returned an empty extraction response.");
  }

  return safeParseJson(text) as { holdings: ExtractedHolding[] };
}
