import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  applyIntakePatch,
  boostIdentityFromUtterance,
  canAdvanceIntakeStep,
  intakeClientDiff,
  INTAKE_STEPS,
  type IntakeClient,
  RISK_PROFILES,
  CALIBRATION_OPTIONS,
} from "@/lib/intake-config";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** Small / cheap model is enough for structured JSON; override via .env if you want. */
const MODEL = process.env.OPENAI_INTAKE_MODEL || "gpt-4o-mini";

function formatProviderError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.includes("429") || raw.includes("rate limit") || raw.includes("Rate limit")) {
    return `OpenAI rate limit. Wait a moment or check your plan. Model: ${MODEL}.`;
  }
  if (raw.includes("insufficient_quota") || raw.includes("quota")) {
    return `OpenAI billing or quota issue. Check your OpenAI account balance and limits. Model: ${MODEL}.`;
  }
  return raw;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1].trim() : trimmed;
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asPatch(obj: unknown): Partial<IntakeClient> & { name?: string } {
  if (!obj || typeof obj !== "object") return {};
  const out: Partial<IntakeClient> & { name?: string } = {};
  const keys: (keyof IntakeClient | "name")[] = [
    "firstName",
    "lastName",
    "name",
    "dob",
    "age",
    "retirementAge",
    "riskProfile",
    "calibration",
    "goal",
    "advisorEmail",
  ];
  const record = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string") (out as Record<string, string>)[k] = v;
  }
  return out;
}

async function completeJson(system: string, user: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  return res.choices[0]?.message?.content ?? "";
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY in .env.local" }, { status: 500 });
    }

    const body = await req.json();
    const mode =
      body.mode === "opening" ? "opening" : body.mode === "handoff" ? "handoff" : "turn";
    const intakeStep = Number(body.intakeStep);
    const client = body.client as IntakeClient | undefined;
    const userText = typeof body.userText === "string" ? body.userText : "";

    if (mode === "handoff") {
      if (!userText.trim()) {
        return NextResponse.json({ error: "userText is required for handoff mode." }, { status: 400 });
      }

      const system = `You classify how the advisor or client wants to provide statements next. Output JSON only, no markdown.
handoffAction must be exactly one of: "paper", "digital_email", "advisor_upload", "none".
Use "paper" when they have or will use a physical paper statement with the advisor, or are not using a digital upload in the room.
Use "digital_email" when they want a secure link emailed (to the address collected on the form), or will upload from phone/email link.
Use "advisor_upload" when they will upload or drag the file on this computer now, or the PDF is on this machine.
Use "none" only if unclear — assistantMessage gives one short spoken clarification (no handoffAction guess).`;

      const user = `They were just asked how they will provide statements: paper for the advisor, upload on this device, or an emailed link for digital upload.

They said:
"${userText}"

Return JSON: {"assistantMessage":"brief spoken reply or clarification","handoffAction":"paper"|"digital_email"|"advisor_upload"|"none"}`;

      const text = await completeJson(system, user);
      const parsed = extractJsonObject(text);
      const assistantMessage =
        typeof parsed?.assistantMessage === "string" && parsed.assistantMessage.trim()
          ? parsed.assistantMessage.trim()
          : "Got it.";
      let handoffAction: "paper" | "digital_email" | "advisor_upload" | "none" = "none";
      const raw = parsed?.handoffAction;
      if (raw === "paper" || raw === "digital_email" || raw === "advisor_upload" || raw === "none") {
        handoffAction = raw;
      }

      return NextResponse.json({
        assistantMessage,
        handoffAction,
        clientPatch: {},
        advance: false,
      });
    }

    if (!client || typeof client !== "object") {
      return NextResponse.json({ error: "Missing client object." }, { status: 400 });
    }

    if (!Number.isInteger(intakeStep) || intakeStep < 0 || intakeStep >= INTAKE_STEPS.length) {
      return NextResponse.json({ error: "Invalid intakeStep." }, { status: 400 });
    }

    const step = INTAKE_STEPS[intakeStep];

    const system = `You are a warm colleague in the room with a financial advisor and client—not on the phone, not reading a form aloud.
The assistantMessage text will be read aloud to everyone; write it as natural spoken dialogue (short clauses, contractions okay).
Never use bullet lists, field labels like “riskProfile:”, or robotic dictation phrasing. Output valid JSON only—no markdown.`;

    if (mode === "opening") {
      const user = `You sit in the room with a financial advisor and their client—not on a phone call.

Current step (${step.eyebrow}): ${step.title}
Context: ${step.helper}
Fields to collect this step: ${step.fields.join(", ")}

Allowed risk profiles (exact strings if relevant): ${RISK_PROFILES.join(", ")}
Allowed calibration modes (exact strings): ${CALIBRATION_OPTIONS.join(", ")}

Write 2–4 short sentences. Introduce this step and ask the main question naturally.

Return JSON with exactly this shape: {"assistantMessage":"your text here"}`;

      const text = await completeJson(system, user);
      const parsed = extractJsonObject(text);
      const assistantMessage =
        typeof parsed?.assistantMessage === "string" && parsed.assistantMessage.trim()
          ? parsed.assistantMessage.trim()
          : text.trim() || `Let's fill in ${step.title.toLowerCase()}`;

      return NextResponse.json({
        assistantMessage,
        clientPatch: {},
        advance: false,
      });
    }

    if (!userText.trim()) {
      return NextResponse.json({ error: "userText is required for turn mode." }, { status: 400 });
    }

    const user = `You help fill client intake for AdvisorPilot (financial advisors). You are in the room with the advisor and client.

Current step (${step.eyebrow}): ${step.title}
Step purpose: ${step.helper}
Primary fields for this step: ${step.fields.join(", ")}

Current client record (JSON):
${JSON.stringify(client, null, 2)}

Client just said:
"${userText}"

Rules:
1. Put field updates in clientPatch (partial object). Keys allowed: firstName, lastName, advisorEmail, dob, age, retirementAge, riskProfile, calibration, goal. You may also use a single "name" string only if they give full name at once (e.g. "Jane Smith"); the app will split it.
2. For question 1 (Who is this review for?) you MUST put firstName and lastName in clientPatch whenever the user gives a full name (e.g. "Jane Smith" → firstName "Jane", lastName "Smith"). Never leave both empty if they clearly stated a name. Only set advance true when firstName and lastName are both filled (or a splittable full name in clientPatch / name).
3. riskProfile must be one of: ${RISK_PROFILES.join(", ")}
4. calibration must be one of: ${CALIBRATION_OPTIONS.join(", ")}
5. dob as YYYY-MM-DD when you can infer it.
6. age and retirementAge as string numbers like "62".
7. If unclear, ask one short follow-up in assistantMessage and set advance false.
8. Set advance true when this step's required information is clearly captured.
9. assistantMessage must sound like a person talking across the table—never metadata (“updated age”) unless briefly confirming like a human would.
10. On the final step (main client goal) only: if the user already said how they will provide statements in this same reply, set handoffAction to one of: "paper" (physical statement with advisor), "digital_email" (wants link emailed / upload via emailed link), "advisor_upload" (upload on this computer now). Otherwise set handoffAction to null.

Return JSON with exactly this shape:
{"clientPatch":{},"assistantMessage":"...","advance":false,"handoffAction":null}`;

    const text = await completeJson(system, user);
    const parsed = extractJsonObject(text);

    if (!parsed) {
      return NextResponse.json(
        {
          error: "Could not parse model response.",
          assistantMessage: "Sorry, I didn’t catch that. Could you repeat it once more?",
          clientPatch: {},
          advance: false,
        },
        { status: 200 }
      );
    }

    const patch = asPatch(parsed.clientPatch);
    if (intakeStep === 0) boostIdentityFromUtterance(userText, patch);
    const merged = applyIntakePatch(client, patch);
    const assistantMessage =
      typeof parsed.assistantMessage === "string" ? parsed.assistantMessage.trim() : "Thanks—I've noted that.";
    let advance = parsed.advance === true;
    if (advance && !canAdvanceIntakeStep(intakeStep, merged)) {
      advance = false;
    }
    if (!advance && canAdvanceIntakeStep(intakeStep, merged)) {
      advance = true;
    }

    let handoffAction: "paper" | "digital_email" | "advisor_upload" | null = null;
    if (intakeStep === INTAKE_STEPS.length - 1 && advance) {
      const h = parsed.handoffAction;
      if (h === "paper" || h === "digital_email" || h === "advisor_upload") handoffAction = h;
    }

    return NextResponse.json({
      assistantMessage,
      clientPatch: intakeClientDiff(client, merged),
      advance,
      handoffAction,
    });
  } catch (e) {
    console.error("intake-voice error", e);
    return NextResponse.json({ error: formatProviderError(e) }, { status: 500 });
  }
}
