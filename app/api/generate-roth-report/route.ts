import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import { clientDisplayName } from "@/lib/intake-config";
import { buildRothReportPdfBytes } from "@/lib/roth-report-pdf";

function cleanFilenamePart(client: Record<string, unknown>) {
  return String(clientDisplayName(client as { firstName?: string; lastName?: string; name?: string }) || "Client")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/\s+/g, "_")
    .trim() || "Client";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pdfBytes = await buildRothReportPdfBytes(body);
    const client = body?.client && typeof body.client === "object" ? (body.client as Record<string, unknown>) : {};
    const name = `Roth_Option_${cleanFilenamePart(client)}.pdf`;

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${name}`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to generate Roth report.";
    const status =
      /must be a positive number|only generated for clients age 60|retirement spendable income/i.test(msg) ? 400 : 500;
    console.error("ROTH PDF ERROR:", err);
    return NextResponse.json({ error: msg }, { status });
  }
}
