import { Buffer } from "buffer";
import { extractHoldingsFromFileBuffer } from "@/lib/extract-statement-holdings";
import { extractAnnuityFromFileBuffer } from "@/lib/extract-annuity-statement";
import { normalizeAttachment } from "@/lib/llm/attachments";
import type { AdvisorLlmSelection } from "@/lib/llm";
import { detectStatementDocumentKind } from "@/lib/statement-document-kind";
import type { StatementDocumentKind } from "@/lib/annuity-contract-types";
import type { UiHolding } from "@/lib/saved-review-normalize";

export type StatementExtractResult = {
  holdings: UiHolding[];
  documentKind: StatementDocumentKind;
};

/**
 * Auto-detect brokerage vs annuity statement, then run the appropriate extractor.
 * Brokerage extraction module is unchanged — only routing lives here.
 */
export async function extractStatementFromFileBuffer(params: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  clientContext: Record<string, unknown>;
  selection?: AdvisorLlmSelection;
  request?: Request;
}): Promise<StatementExtractResult> {
  const { holdingsPagesWithPositions: pageHintRaw, ...restContext } = params.clientContext;
  const pageHint = typeof pageHintRaw === "string" ? pageHintRaw.trim() : "";

  const attachment = await normalizeAttachment({
    bytes: params.bytes,
    mime: params.mimeType,
    fileName: params.fileName,
    pageHint: pageHint || undefined,
  });

  const detection = await detectStatementDocumentKind({
    attachment,
    selection: params.selection,
    request: params.request,
  });

  if (detection.documentKind === "annuity") {
    const { holdings } = await extractAnnuityFromFileBuffer({
      fileName: params.fileName,
      mimeType: params.mimeType,
      bytes: params.bytes,
      clientContext: params.clientContext,
      selection: params.selection,
      request: params.request,
    });
    return {
      holdings: holdings.map((h) => ({ ...h, documentKind: "annuity" as const })),
      documentKind: "annuity",
    };
  }

  const { holdings: rawHoldings } = await extractHoldingsFromFileBuffer({
    fileName: params.fileName,
    mimeType: params.mimeType,
    bytes: params.bytes,
    clientContext: params.clientContext,
    selection: params.selection,
    request: params.request,
  });

  const holdings: UiHolding[] = rawHoldings.map((h) => ({
    ...h,
    documentKind: "brokerage" as const,
  }));

  return { holdings, documentKind: "brokerage" };
}
