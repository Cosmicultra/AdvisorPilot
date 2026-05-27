import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import {
  getSupabaseServiceAdmin,
  missingSupabaseServiceEnv,
} from "@/lib/supabase-service-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public bucket; create in Supabase Dashboard → Storage (see docs/advisorpilot-database-reference.sql). */
const BUCKET = "advisorpilot-advisor-branding";
const MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function extForMime(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  const sub = mime.split("/")[1];
  if (sub === "jpeg") return "jpg";
  return sub || "png";
}

export async function POST(req: Request) {
  try {
    if (missingSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Server storage is not configured." }, { status: 500 });
    }
    const supabaseAdmin = getSupabaseServiceAdmin()!;

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in before uploading." }, { status: 401 });
    }

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
    }

    const form = await req.formData();
    const kindRaw = String(form.get("kind") || "").trim();
    const file = form.get("file");

    if (kindRaw !== "logo" && kindRaw !== "disclosures") {
      return NextResponse.json({ error: 'Use kind "logo" or "disclosures".' }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing image file." }, { status: 400 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be 2 MB or smaller." }, { status: 400 });
    }

    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED.has(mime)) {
      return NextResponse.json({ error: "Use a JPEG, PNG, GIF, or WebP image." }, { status: 400 });
    }

    const safeOwner = identity.email.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 72) || "advisor";
    const objectPath = `${safeOwner}/${kindRaw}-${crypto.randomUUID()}.${extForMime(mime)}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(objectPath, buffer, {
      contentType: mime,
      upsert: false,
    });

    if (upErr) {
      console.error("ADVISOR ASSET UPLOAD:", upErr);
      return NextResponse.json(
        {
          error:
            upErr.message?.includes("Bucket not found") || upErr.message?.includes("not found")
              ? 'Storage bucket "advisorpilot-advisor-branding" is missing. Create a public bucket with that name in Supabase, then try again.'
              : upErr.message || "Upload failed.",
        },
        { status: 500 }
      );
    }

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(objectPath);
    const publicUrl = pub?.publicUrl || "";
    if (!publicUrl) {
      return NextResponse.json({ error: "Could not resolve public URL for upload." }, { status: 500 });
    }

    return NextResponse.json({ publicUrl, kind: kindRaw });
  } catch (err: unknown) {
    console.error("ADVISOR PROFILE UPLOAD ERROR:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 500 }
    );
  }
}
