import { complete, type AdvisorLlmSelection } from "@/lib/llm";
import type { Attachment } from "@/lib/llm/types";
import type { StatementDocumentKind } from "@/lib/annuity-contract-types";

export type DocumentKindDetection = {
  documentKind: StatementDocumentKind;
  confidence: number;
  method: "heuristic" | "llm";
};

const ANNUITY_SIGNALS: RegExp[] = [
  /\bcontract\s+value\b/i,
  /\baccumulation\s+value\b/i,
  /\bsurrender\s+value\b/i,
  /\bincome\s+base\b/i,
  /\bincome\s+rider\b/i,
  /\bindexed\s+account\b/i,
  /\bparticipation\s+rate\b/i,
  /\bcap\s+rate\b/i,
  /\bguaranteed\s+interest\b/i,
  /\bfixed\s+indexed\b/i,
  /\bmyga\b/i,
  /\bannuity\s+contract\b/i,
  /\bcontract\s+number\b/i,
  /\bpolicy\s+number\b/i,
  /\bvariable\s+annuity\b/i,
  /\bguarantee\s+period\b/i,
  /\broll[- ]?up\b/i,
];

const BROKERAGE_SIGNALS: RegExp[] = [
  /\bending\s+account\s+value\b/i,
  /\bmarket\s+value\b/i,
  /\bpositions\b/i,
  /\bholdings\s+detail\b/i,
  /\bcusip\b/i,
  /\bticker\b/i,
  /\bshares\b/i,
  /\bquantity\b/i,
  /\baccount\s+summary\b/i,
];

function scoreSignals(text: string, patterns: RegExp[]): number {
  let score = 0;
  for (const re of patterns) {
    if (re.test(text)) score += 1;
  }
  return score;
}

function heuristicDocumentKind(embeddedText: string): DocumentKindDetection | null {
  const text = embeddedText.trim();
  if (!text) return null;

  const annuityScore = scoreSignals(text, ANNUITY_SIGNALS);
  const brokerageScore = scoreSignals(text, BROKERAGE_SIGNALS);

  if (annuityScore >= 3 && annuityScore > brokerageScore + 1) {
    return { documentKind: "annuity", confidence: Math.min(95, 60 + annuityScore * 8), method: "heuristic" };
  }
  if (brokerageScore >= 3 && brokerageScore > annuityScore + 1) {
    return { documentKind: "brokerage", confidence: Math.min(95, 60 + brokerageScore * 8), method: "heuristic" };
  }
  if (annuityScore >= 5 && annuityScore >= brokerageScore) {
    return { documentKind: "annuity", confidence: 75, method: "heuristic" };
  }
  if (brokerageScore >= 5) {
    return { documentKind: "brokerage", confidence: 75, method: "heuristic" };
  }

  return null;
}

function extractClassifyJsonBlob(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1].trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) body = body.slice(start, end + 1);
  return body;
}

async function classifyWithLlm(params: {
  attachment: Attachment;
  selection?: AdvisorLlmSelection;
  request?: Request;
}): Promise<DocumentKindDetection> {
  const textSnippet = params.attachment.textLayer?.clippedText?.slice(0, 8000) ?? "";
  const prompt = `
Classify this financial document for an advisor workflow.

Return JSON only:
{"documentKind":"brokerage"|"annuity","confidence":0-100}

- **brokerage**: custodian/broker statement with stock, ETF, mutual fund, bond positions (Schwab, Fidelity, Vanguard, etc.) — may be IRA, Roth, 401(k), or taxable.
- **annuity**: insurance carrier annuity contract statement (FIA, MYGA, variable annuity) with contract value, surrender, income base, indexing strategies — not a grid of tickers/CUSIPs.

Embedded text (may be partial):
---
${textSnippet || "(no text layer — use filename and document type hints only)"}
---
Filename: ${params.attachment.fileName}
`;

  const result = await complete<unknown>(
    {
      pass: "extraction.classify",
      system: "Classify financial PDFs as brokerage holdings statements vs annuity contract statements. JSON only.",
      user: prompt,
      attachments:
        params.attachment.kind === "image" || !textSnippet.trim()
          ? [params.attachment]
          : [],
      jsonSchema: { type: "object" },
      maxOutputTokens: 256,
    },
    { request: params.request, selection: params.selection }
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractClassifyJsonBlob(result.text)) as Record<string, unknown>;
  } catch {
    return { documentKind: "brokerage", confidence: 40, method: "llm" };
  }

  const kindRaw = String(parsed.documentKind ?? "").toLowerCase();
  const documentKind: StatementDocumentKind = kindRaw === "annuity" ? "annuity" : "brokerage";
  const conf = Number(parsed.confidence);
  const confidence = Number.isFinite(conf) ? Math.min(100, Math.max(0, conf)) : 50;

  return { documentKind, confidence, method: "llm" };
}

/**
 * Detect whether a statement is a custodian holdings extract or an annuity contract statement.
 * Defaults to brokerage when uncertain (safer for existing users).
 */
export async function detectStatementDocumentKind(params: {
  attachment: Attachment;
  selection?: AdvisorLlmSelection;
  request?: Request;
}): Promise<DocumentKindDetection> {
  const embedded = params.attachment.textLayer?.fullText ?? params.attachment.textLayer?.clippedText ?? "";
  const heuristic = embedded ? heuristicDocumentKind(embedded) : null;

  if (heuristic && heuristic.confidence >= 70) {
    return heuristic;
  }

  try {
    const llm = await classifyWithLlm(params);
    if (llm.confidence >= 55) return llm;
  } catch (err) {
    console.warn("[statement-document-kind] LLM classify failed:", err);
  }

  if (heuristic) return heuristic;

  return { documentKind: "brokerage", confidence: 50, method: "heuristic" };
}
