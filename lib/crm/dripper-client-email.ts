/**
 * Compose client-facing drip emails: LLM rewrite + advisor signature.
 */

import { complete, resolveAdvisorLlmSelection, type AdvisorLlmSelection } from "@/lib/llm";
import { buildSignedEmailBodies } from "@/lib/gmail/signature";
import { plainParagraphsToHtml } from "@/lib/gmail/mime";
import type { DripperEmailContext } from "@/lib/crm/dripper-context";
import { formatClientEmailBody } from "@/lib/crm/dripper-email-greeting";

export { formatClientEmailBody } from "@/lib/crm/dripper-email-greeting";

const DEFAULT_SUBJECTS: Record<string, (firstName: string) => string> = {
  "quarterly-review-brief": (n) => `Ahead of our review — ${n}`,
  "pre-meeting-talking-points": (n) => `Scheduling time to connect — ${n}`,
  "stale-contact-nudge": (n) => `Introduction — ${n}`,
};

/** Per-template tone hints for the client-email pass (Closing Meeting Book + Prospect/Lead). */
export const CLIENT_EMAIL_HINTS: Record<string, string> = {
  "pre-meeting-talking-points":
    "Short, friendly email focused on scheduling a meeting. Reference exactly one theme from the advisor brief or dripContext. Clear meeting ask. No numbers, rates, or product details.",
  "stale-contact-nudge":
    "Warm prospect/lead follow-up or introduction. Optional single high-level mention of one planning tool if toolsReviewed supports it. Invite a conversation — no advice or figures.",
};

const CLIENT_EMAIL_SYSTEM = `
You write a professional email FROM a financial advisor TO their client or prospect.
Output valid JSON only: { "subject": string, "body": string }.

Rules:
- Warm, clear, client-appropriate tone (2–4 short paragraphs). No markdown.
- Do NOT include a greeting or salutation (no "Hi", "Hello", or "Dear") — the system adds "Hi {firstName}," automatically.
- Do NOT promise returns, guarantees, or specific trade instructions.
- Do NOT include compliance disclaimers (signature is appended separately).
- Use only facts supported by the advisor brief and dripContext provided.
- Do not mention "AI", "dripper", or internal tools.
- Never include dollar amounts, percentages, rates, or calculator outputs.
- Do not give financial advice — only invite a conversation with the advisor.
- If recentDripAngles in dripContext is non-empty, do not repeat subject lines or body themes from those prior emails.
`.trim();

export function defaultDripperEmailSubject(
  templateId: string,
  firstName: string
): string {
  const fn = DEFAULT_SUBJECTS[templateId];
  const name = firstName.trim() || "there";
  return fn ? fn(name) : `A note from your advisor — ${name}`;
}

export function buildClientEmailSystemPrompt(templateId: string): string {
  const hint = CLIENT_EMAIL_HINTS[templateId];
  if (!hint) return CLIENT_EMAIL_SYSTEM;
  return `${CLIENT_EMAIL_SYSTEM}\n\nTemplate-specific guidance:\n${hint}`;
}

export interface ComposeDripperClientEmailInput {
  advisorEmail: string;
  templateId: string;
  templateTitle: string;
  advisorBrief: string;
  clientFirstName: string;
  dripContext?: DripperEmailContext;
  selection?: AdvisorLlmSelection;
}

export interface ComposeDripperClientEmailResult {
  subject: string;
  plainBody: string;
  htmlBody: string;
}

function parseClientEmailJson(text: string): { subject?: string; body?: string } {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as { subject?: string; body?: string };
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as { subject?: string; body?: string };
      } catch {
        return {};
      }
    }
    return {};
  }
}

export async function composeDripperClientEmail(
  input: ComposeDripperClientEmailInput
): Promise<ComposeDripperClientEmailResult> {
  const firstName = input.clientFirstName.trim() || "there";

  const selection =
    input.selection ?? (await resolveAdvisorLlmSelection(input.advisorEmail));

  const userPayload = JSON.stringify({
    templateTitle: input.templateTitle,
    clientFirstName: firstName,
    advisorInternalBrief: input.advisorBrief,
    dripContext: input.dripContext ?? {
      toolsReviewed: { fia: false, roth: false, retirementIncome: false },
      riskAlignment: null,
      recentDripAngles: [],
    },
  });

  const result = await complete<{ subject?: string; body?: string }>(
    {
      pass: "dripper.client-email",
      system: buildClientEmailSystemPrompt(input.templateId),
      user: userPayload,
      jsonSchema: {
        type: "object",
        properties: {
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["subject", "body"],
      },
      maxOutputTokens: 900,
    },
    { selection }
  );

  const parsed = result.json ?? parseClientEmailJson(result.text);
  const subject =
    (typeof parsed.subject === "string" && parsed.subject.trim()) ||
    defaultDripperEmailSubject(input.templateId, firstName);
  const rawBody =
    (typeof parsed.body === "string" && parsed.body.trim()) ||
    input.advisorBrief.trim() ||
    "I wanted to reach out and see how you're doing. Please let me know if you'd like to schedule time to connect.";

  const formattedBody = formatClientEmailBody(firstName, rawBody);
  const messageHtmlCore = plainParagraphsToHtml(formattedBody);

  const signed = await buildSignedEmailBodies(
    input.advisorEmail,
    formattedBody,
    messageHtmlCore
  );

  return {
    subject,
    plainBody: signed.plainBody,
    htmlBody: signed.htmlBody,
  };
}
