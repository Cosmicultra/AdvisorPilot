import { Buffer } from "buffer";
import {
  normalizeAnnuityContractDetails,
  toUiHoldingFromAnnuityContract,
  type AnnuityContractDetails,
  type ExtractedAnnuityContract,
} from "@/lib/annuity-contract-types";
import { assertAnnuityContractsReconcile } from "@/lib/annuity-extraction-verify";
import { complete, type AdvisorLlmSelection } from "@/lib/llm";
import { normalizeAttachment } from "@/lib/llm/attachments";
import type { UiHolding } from "@/lib/saved-review-normalize";
import { extractionMaxOutputTokens } from "@/lib/openai-route-models";

function stripTrailingCommas(json: string): string {
  let prev = "";
  let out = json;
  for (let i = 0; i < 6 && out !== prev; i++) {
    prev = out;
    out = out.replace(/,(\s*[}\]])/g, "$1");
  }
  return out;
}

function extractAnnuityJsonBlob(text: string): string {
  const trimmed = text.trim().replace(/^﻿/, "");
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1].trim() : trimmed;
  body = body.replace(/[“”]/g, '"');
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) body = body.slice(start, end + 1);
  return stripTrailingCommas(body);
}

function parseExtractedAnnuityResponse(text: string): {
  contracts: ExtractedAnnuityContract[];
  statementContractValue?: number;
} {
  const body = extractAnnuityJsonBlob(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not parse annuity extraction as JSON (${msg}). Try again or use a clearer carrier PDF.`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Annuity extraction must be a JSON object with a contracts array.");
  }
  const rec = parsed as Record<string, unknown>;
  const rawContracts = rec.contracts;
  if (!Array.isArray(rawContracts)) {
    throw new Error('Annuity extraction JSON must include a "contracts" array.');
  }

  const contracts: ExtractedAnnuityContract[] = [];
  for (const item of rawContracts) {
    const normalized = normalizeAnnuityContractDetails(item);
    if (!normalized) continue;
    const src = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const conf = Number(src.confidence);
    contracts.push({
      ...normalized,
      ...(Number.isFinite(conf) ? { confidence: conf } : {}),
    });
  }

  if (contracts.length === 0) {
    throw new Error("No annuity contracts could be parsed from the extraction response.");
  }

  const savRaw = rec.statementContractValue;
  let statementContractValue: number | undefined;
  if (typeof savRaw === "number" && Number.isFinite(savRaw)) {
    statementContractValue = savRaw;
  }

  return { contracts, statementContractValue };
}

/**
 * Extract annuity contract fields from a carrier statement PDF/image.
 * Separate from brokerage holdings extraction — does not modify that module.
 */
export async function extractAnnuityFromFileBuffer(params: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  clientContext: Record<string, unknown>;
  selection?: AdvisorLlmSelection;
  request?: Request;
}): Promise<{ holdings: UiHolding[] }> {
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

  const visionOnly =
    attachment.kind === "image" || (attachment.kind === "pdf" && !attachment.hasTextLayer);

  const advisorPageScope =
    advisorHoldingsPages && attachment.kind === "pdf"
      ? `
**PAGE SCOPE:** Advisor indicated relevant pages: **${advisorHoldingsPages}**. Extract contract data only from those pages when identifiable.
`
      : "";

  const pdfTextLayerSection = attachment.textLayer
    ? `
EMBEDDED PDF TEXT (align with visuals; dollar amounts on statement win over guesses):
---
${attachment.textLayer.clippedText}
---
`
    : "";

  const prompt = `
Extract annuity contract data from this insurance carrier statement (FIA, MYGA, or variable annuity).

Return JSON only (no markdown, no trailing commas). One object per contract in **contracts**. Omit fields not printed — do not invent riders, rates, or values.

Required per contract when printed:
- **contractNumber** (contract #, policy #, certificate #)
- **carrierName**
- **qualifiedStatus**: qualified | non_qualified | unknown (IRA/401(k)/tax-deferred → qualified; non-qualified/taxable → non_qualified)
- **productName**
- **contractType**: fia | myga | variable | unknown
- **issueDate** (YYYY-MM-DD when possible)
- **currentValue** (accumulation / contract / account value in USD)
- **initialPremium** (USD)
- **surrenderValue** (USD)

Optional when printed:
- **maturityDate** (YYYY-MM-DD)
- **riderCharge**: { "raw": "as printed", "amountUsd": number, "percentPct": number }
- **incomeRiderName**
- **incomeBaseValue**
- **incomeBasePaymentAmount**
- **incomeBasePaymentFrequency**: annual | monthly | unknown
- **incomeBaseRollUpRatePct** (guaranteed roll-up % for income base)
- **indexingStrategies**: [{ "name", "capRatePct", "participationRatePct", "fixedRatePct" }] — include current cap/participation/fixed rates per strategy bucket

Top-level optional:
- **statementContractValue**: headline total when one number equals all contracts combined

confidence integer 0–100 per contract when you can assess clarity.

AdvisorPilot client metadata (hints only):
${JSON.stringify(clientContext, null, 2)}
${advisorPageScope}
${pdfTextLayerSection}

Example:
{"statementContractValue":250000,"contracts":[{"contractNumber":"ABC123456","carrierName":"Athene","qualifiedStatus":"qualified","productName":"Ascension 10","contractType":"fia","issueDate":"2019-06-01","currentValue":250000,"initialPremium":200000,"surrenderValue":235000,"indexingStrategies":[{"name":"S&P 500 Annual Point-to-Point","capRatePct":9.25,"participationRatePct":100}],"confidence":88}]}
`;

  const result = await complete<unknown>(
    {
      pass: "extraction.annuity",
      system: visionOnly
        ? "Extract annuity contract JSON from carrier statements. Do not invent tickers or fund positions."
        : "Extract annuity contract JSON; trust printed dollar amounts; separate FIA/MYGA/VA contract fields from brokerage position tables.",
      user: prompt,
      attachments: [attachment],
      jsonSchema: { type: "object" },
      maxOutputTokens: extractionMaxOutputTokens(),
    },
    { request, selection }
  );

  const parsed = parseExtractedAnnuityResponse(result.text);
  assertAnnuityContractsReconcile({
    contracts: parsed.contracts,
    embeddedPdfText: attachment.textLayer?.fullText ?? null,
    modelStatementContractValue: parsed.statementContractValue,
  });

  const holdings = parsed.contracts.map((c) =>
    toUiHoldingFromAnnuityContract(c as AnnuityContractDetails, {
      confidence: c.confidence,
    })
  );

  return { holdings };
}
