import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import { extractHoldingsFromFileBuffer } from "@/lib/extract-statement-holdings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const clientRaw = formData.get("client") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    const client = clientRaw ? JSON.parse(clientRaw) : {};
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/pdf";

    const data = await extractHoldingsFromFileBuffer({
      fileName: file.name || "statement.pdf",
      mimeType,
      bytes,
      clientContext: client,
    });

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("ANALYZE ERROR:", error);

    return NextResponse.json(
      { error: error?.message || "Could not analyze statement." },
      { status: 500 }
    );
  }
}