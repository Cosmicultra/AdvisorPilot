import { NextResponse } from "next/server";
import { Buffer } from "buffer";
import { extractHoldingsFromFileBuffer } from "@/lib/extract-statement-holdings";

export const runtime = "nodejs";

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
      allHoldings.push(
        ...holdings.map((holding) => ({
          ...holding,
          sourceFileName: file.name || `statement-${index + 1}.pdf`,
          sourceFileIndex: index + 1,
        }))
      );
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