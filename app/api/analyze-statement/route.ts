import OpenAI from "openai";
import { NextResponse } from "next/server";
import { Buffer } from "buffer";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeParseJson(text: string) {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const clientRaw = formData.get("client") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY in .env.local" }, { status: 500 });
    }

    const client = clientRaw ? JSON.parse(clientRaw) : {};
    const bytes = Buffer.from(await file.arrayBuffer());
    const base64 = bytes.toString("base64");
    const mimeType = file.type || "application/pdf";

    const filePart =
      mimeType.includes("image")
        ? {
            type: "input_image" as const,
            image_url: `data:${mimeType};base64,${base64}`,
            detail: "auto" as const,
          }
        : {
            type: "input_file" as const,
            filename: file.name || "statement.pdf",
            file_data: `data:${mimeType};base64,${base64}`,
          };

    const prompt = `
You are AdvisorPilot, an advisor-facing financial statement extraction assistant.

Extract all investment holdings from the uploaded statement.

Client context:
${JSON.stringify(client, null, 2)}

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
      "options": [
        "Likely ticker or fund option 1",
        "Likely ticker or fund option 2",
        "Likely ticker or fund option 3",
        "Manual ticker / CUSIP entry"
      ]
    }
  ]
}

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

    return NextResponse.json(safeParseJson(text));
  } catch (error: any) {
    console.error("ANALYZE ERROR:", error);

    return NextResponse.json(
      { error: error?.message || "Could not analyze statement." },
      { status: 500 }
    );
  }
}