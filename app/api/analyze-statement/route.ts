import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import { extractHoldingsFromFileBuffer } from "@/lib/extract-statement-holdings";
import { isCashLikeHolding } from "@/lib/asset-classes";
import {
  buildCashParkingSyntheticHolding,
  cashParkingTitleMatches,
} from "@/lib/cash-parking-title-heuristics";
import { extractLikelySymbol } from "@/lib/holding-validation";
import { SYNTHETIC_CASH_TICKER } from "@/lib/cash-holding-constants";
import {
  applyMasterResolutionToHolding,
  createSupabaseAdminForSecuritiesMaster,
  resolveFromSecuritiesMaster,
  securitiesMasterFeatureEnabled,
} from "@/lib/securities-master";

export const runtime = "nodejs";

async function enrichHoldingsWithSecuritiesMaster(
  holders: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const masterOn = securitiesMasterFeatureEnabled();
  const sb = masterOn ? createSupabaseAdminForSecuritiesMaster() : null;
  if (masterOn && !sb) {
    console.warn("[analyze-statement] securities master enabled but Supabase admin client unavailable.");
  }

  const out: Record<string, unknown>[] = [];
  for (const row of holders) {
    const rec = row as Record<string, unknown>;
    const assetClass = String(rec.assetClass ?? "");
    const suggested = String(rec.suggested ?? "");
    const rawName = String(rec.rawName ?? "");

    if (cashParkingTitleMatches(rawName)) {
      const sym = extractLikelySymbol(suggested, rawName);
      if (sb && sym && sym !== SYNTHETIC_CASH_TICKER) {
        const hit = await resolveFromSecuritiesMaster(sb, {
          inferredSymbol: sym,
          suggested,
          rawName,
        });
        if (hit) {
          out.push(applyMasterResolutionToHolding(rec, hit));
          continue;
        }
      }
      out.push(buildCashParkingSyntheticHolding(rec));
      continue;
    }

    if (isCashLikeHolding(assetClass, suggested, rawName)) {
      out.push(rec);
      continue;
    }

    if (!sb) {
      out.push(rec);
      continue;
    }

    const sym = extractLikelySymbol(suggested, rawName);
    const hit = await resolveFromSecuritiesMaster(sb, { inferredSymbol: sym, suggested, rawName });
    if (!hit) {
      out.push(rec);
      continue;
    }
    out.push(applyMasterResolutionToHolding(rec, hit));
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const legacyFile = formData.get("file");
    if (files.length === 0 && legacyFile instanceof File) files.push(legacyFile);
    const clientRaw = formData.get("client") as string | null;

    if (files.length === 0) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const client = clientRaw ? JSON.parse(clientRaw) : {};
    const allHoldings: unknown[] = [];

    for (const [index, file] of files.entries()) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || "application/pdf";
      const data = await extractHoldingsFromFileBuffer({
        fileName: file.name || `statement-${index + 1}.pdf`,
        mimeType,
        bytes,
        clientContext: { ...client, sourceFileName: file.name, sourceFileIndex: index + 1 },
      });
      const holdings = Array.isArray(data.holdings) ? data.holdings : [];
      const withMeta = holdings.map((holding) =>
        ({
          ...(holding && typeof holding === "object" && !Array.isArray(holding)
            ? (holding as Record<string, unknown>)
            : {}),
          sourceFileName: file.name || `statement-${index + 1}.pdf`,
          sourceFileIndex: index + 1,
        }) as Record<string, unknown>
      );

      const tagged = await enrichHoldingsWithSecuritiesMaster(withMeta);
      allHoldings.push(...tagged);
    }

    return NextResponse.json({ holdings: allHoldings });
  } catch (error: unknown) {
    console.error("ANALYZE ERROR:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not analyze statement." },
      { status: 500 }
    );
  }
}