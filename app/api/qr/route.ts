import QRCode from "qrcode";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const text = String(searchParams.get("text") || "").trim();
    if (!text || !/^https?:\/\//i.test(text)) {
      return NextResponse.json({ error: "Missing or invalid QR text." }, { status: 400 });
    }

    const svg = await QRCode.toString(text, {
      type: "svg",
      margin: 2,
      width: 220,
      errorCorrectionLevel: "M",
    });

    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    console.error("QR GENERATION ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not generate QR code." },
      { status: 500 }
    );
  }
}
