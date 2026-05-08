import OpenAI from "openai";
import { NextResponse } from "next/server";
import { enrichOneHolding, type EnrichmentInputHolding } from "@/lib/holding-enrichment";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as { holdings?: unknown[] } | null;
    const rawHoldings = Array.isArray(body?.holdings) ? body!.holdings! : [];

    const openfigiApiKey = process.env.OPENFIGI_API_KEY?.trim() || undefined;
    const enriched: Record<string, unknown>[] = [];

    for (let i = 0; i < rawHoldings.length; i++) {
      const row = rawHoldings[i];
      const base =
        row && typeof row === "object" && !Array.isArray(row)
          ? { ...(row as Record<string, unknown>) }
          : {};

      const patch = await enrichOneHolding(openai, toInput(base), { openfigiApiKey });
      const suggested = String(patch.suggested || "");
      const merged = {
        ...base,
        ...patch,
        options: mergeOptions(base.options, suggested),
      };
      enriched.push(merged);

      if (i < rawHoldings.length - 1) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    return NextResponse.json({ holdings: enriched });
  } catch (err: unknown) {
    console.error("ENRICH HOLDINGS:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to enrich holdings." },
      { status: 500 }
    );
  }
}
