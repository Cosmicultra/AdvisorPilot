import { NextResponse } from "next/server";
import { enrichOneHolding, type EnrichmentInputHolding } from "@/lib/holding-enrichment";
import { createSupabaseAdminForEnrichmentCache } from "@/lib/security-enrichment-cache";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { resolveAdvisorLlmSelection } from "@/lib/llm";

export const runtime = "nodejs";

function toInput(row: Record<string, unknown>): EnrichmentInputHolding {
  return {
    rawName: String(row.rawName ?? ""),
    suggested: String(row.suggested ?? ""),
    assetClass: String(row.assetClass ?? "Unknown"),
    value: Number(row.value ?? 0),
    confidence: Number(row.confidence ?? 0),
    status: String(row.status ?? "review"),
    options: Array.isArray(row.options) ? row.options.map((x) => String(x)) : [],
  };
}

function mergeOptions(prev: unknown, suggested: string): string[] {
  const base = Array.isArray(prev) ? prev.map((x) => String(x)) : [];
  const values = [suggested, ...base, "Manual ticker / CUSIP entry"].filter(Boolean);
  return Array.from(new Set(values));
}

type EnrichmentRequestBody = {
  holdings?: unknown[];
  enrichIndices?: unknown;
};

function parseSelectiveIndices(body: EnrichmentRequestBody | null): {
  selective: boolean;
  indicesToProcess: number[];
} | { error: string } {
  if (!body || !("enrichIndices" in body)) {
    const all = typeof body?.holdings === "undefined" ? [] : (Array.isArray(body?.holdings) ? body.holdings! : []);
    return {
      selective: false,
      indicesToProcess: all.map((_, i) => i),
    };
  }
  const raw = body.enrichIndices;
  if (!Array.isArray(raw)) {
    return { error: "enrichIndices must be an array of non-negative integers when provided." };
  }
  const nums = raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 0);
  return {
    selective: true,
    indicesToProcess: Array.from(new Set(nums)).sort((a, b) => a - b),
  };
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as EnrichmentRequestBody | null;
    const rawHoldings = Array.isArray(body?.holdings) ? body!.holdings! : [];

    const parsed = parseSelectiveIndices(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { selective, indicesToProcess } = parsed;
    const openfigiApiKey = process.env.OPENFIGI_API_KEY?.trim() || undefined;
    const patches: { index: number; holding: Record<string, unknown>; cacheHit?: boolean }[] = [];
    const enrichedFull: Record<string, unknown>[] = [];

    const supabaseCache = createSupabaseAdminForEnrichmentCache();
    const identity = await resolveAdvisorIdentity(req);
    const selection = await resolveAdvisorLlmSelection(identity?.email);

    for (let step = 0; step < indicesToProcess.length; step++) {
      const i = indicesToProcess[step];
      const rowUnknown = rawHoldings[i];
      const row =
        rowUnknown && typeof rowUnknown === "object" && !Array.isArray(rowUnknown)
          ? (rowUnknown as Record<string, unknown>)
          : {};
      const base = { ...row };

      const { patch, cacheHit } = await enrichOneHolding(toInput(base), {
        openfigiApiKey,
        supabaseCache,
        supabaseMaster: supabaseCache,
        selection,
        request: req,
      });
      const suggested = String(patch.suggested || "");
      const merged = {
        ...base,
        ...patch,
        options: mergeOptions(base.options, suggested),
      };

      if (selective) {
        patches.push({ index: i, holding: merged, cacheHit });
      } else {
        enrichedFull.push(merged);
      }

      if (step < indicesToProcess.length - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    if (selective) {
      return NextResponse.json({ patches });
    }

    return NextResponse.json({ holdings: enrichedFull });
  } catch (err: unknown) {
    console.error("ENRICH HOLDINGS:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to enrich holdings." },
      { status: 500 }
    );
  }
}
