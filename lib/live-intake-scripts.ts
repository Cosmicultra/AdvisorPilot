import type { IntakeClient } from "@/lib/intake-config";
import { clientFirstNameSalutation } from "@/lib/intake-config";

/** Spoken every time Live Intake starts. Use {{ADVISOR_FIRST}} (first name only). */
export const LIVE_INTAKE_OPENING_SCRIPT = `Hi, how are you? I'm {{ADVISOR_FIRST}}'s profile assistant from AdvisorPilot. Let's walk through the intake questionnaire and get a new profile set up for you.`;

/**
 * Asked after the main goal is captured, before Statement Capture.
 * Covers paper vs advisor upload vs digital link to the email from the form.
 */
export const LIVE_INTAKE_HANDOFF_QUESTION_SCRIPT = `How do you plan on giving us your statements? Do you have a copy of the paper statement for the advisor? Or are we going to upload one? If you have it digitally, I can send a link right now to the email you used at the beginning of this form — you can upload directly through that link.`;

/** After they choose paper / in-person statement with the advisor. Use {{ADVISOR_FIRST}}. */
export const LIVE_INTAKE_PAPER_SIGNOFF_SCRIPT = `Well, {{ADVISOR_FIRST}}, it sounds like you've got it from here. I'll sign off — thank you both.`;

/** Right before minting the link and sending email (digital path). */
export const LIVE_INTAKE_DIGITAL_ACK_SCRIPT = `Got it — I'm creating your secure upload link and emailing it to the address we saved at the start of the form. One moment.`;

/** After other paths (e.g. advisor uploads on this device). Use {{FIRST_NAME}}. */
export const LIVE_INTAKE_UPLOAD_CLOSING_SCRIPT = `Perfect — {{FIRST_NAME}}, we're opening Statement Capture next. You'll see upload options on the next screen.`;

export type LiveIntakeHandoffAction = "paper" | "digital_email" | "advisor_upload" | "none";

export function personalizeLiveIntakeScript(
  template: string,
  client: IntakeClient,
  advisorDisplayName = "your advisor"
): string {
  const fullName = String(advisorDisplayName || "").trim() || "your advisor";
  const firstName = fullName.split(/\s+/)[0] || fullName;
  return template
    .replace(/\{\{FIRST_NAME\}\}/g, clientFirstNameSalutation(client))
    .replace(/\{\{ADVISOR_FIRST\}\}/g, firstName)
    /** Backward compat — older templates referenced full name. */
    .replace(/\{\{ADVISOR_NAME\}\}/g, fullName);
}

/** Build the natural read-back the assistant says after a step has been satisfied, before advancing. */
export function buildStepConfirmationScript(stepIndex: number, client: IntakeClient): string {
  const fn = client.firstName.trim();
  const ln = client.lastName.trim();
  const email = client.advisorEmail.trim();
  const age = client.age.trim();
  const dob = client.dob.trim();
  const retire = client.retirementAge.trim();
  const agi = client.adjustedGrossIncomeAnnual.trim();
  const bracket = client.federalTaxBracket.trim();
  const spend = client.retirementSpendableIncomeAnnual.trim();
  const ssClient = client.socialSecurityMonthlyClient.trim();
  const ssSpouse = client.socialSecurityMonthlySpouse.trim();
  const risk = client.riskProfile.replace(/-/g, " ").trim();
  const calibration = client.calibration.replace(/-/g, " ").trim();
  const goal = client.goal.trim();

  switch (stepIndex) {
    case 0: {
      const namePart = `${fn} ${ln}`.trim() || "no name yet";
      const emailPart = email ? `at ${email}` : "and no email yet";
      if (client.married) {
        const sf = client.spouseFirstName.trim();
        const sl = client.spouseLastName.trim();
        const spousePart = sf || sl ? `Spouse: ${`${sf} ${sl}`.trim()}` : "spouse name not filled in yet";
        return `Quick confirm: I have ${namePart} ${emailPart}. ${spousePart}. Is that right?`;
      }
      return `Quick confirm: I have ${namePart} ${emailPart}. Is that right?`;
    }
    case 1: {
      const spouseAge = client.spouseAge.trim();
      const spouseDob = client.spouseDob.trim();
      const clientBit = age
        ? `age ${age}`
        : dob
          ? `date of birth ${dob}`
          : "the client's age";
      if (client.married) {
        const spouseBit = spouseAge
          ? `spouse age ${spouseAge}`
          : spouseDob
            ? `spouse date of birth ${spouseDob}`
            : "spouse age";
        return `So that's ${clientBit}, and ${spouseBit}. Did I get that right?`;
      }
      if (age) return `So that's age ${age}. Did I get that right?`;
      if (dob) return `So that's a date of birth of ${dob}. Did I get that right?`;
      return `Did I get the age right?`;
    }
    case 2:
      return agi
        ? `For Adjusted Gross Income on the most recent return, I'm using about ${agi} dollars. Does that sound right?`
        : `Did I get the AGI right?`;
    case 3:
      return bracket
        ? `So we're using about a ${bracket}% federal marginal bracket for planning. Sound right?`
        : `Did I get the tax bracket right?`;
    case 4: {
      const sr = client.spouseRetirementAge.trim();
      if (client.married && sr) {
        return `Retiring at age ${retire || "—"} for the client and ${sr} for the spouse. Is that right?`;
      }
      return `Planning to retire at age ${retire || "—"}. Is that right?`;
    }
    case 5:
      return spend
        ? `For spendable income in retirement, I'm using about ${spend} dollars per year. Does that match?`
        : `Did I capture the retirement income need correctly?`;
    case 6:
      if (!client.takingSocialSecurity) return `Got it — not taking Social Security yet. We'll move on. Sound right?`;
      if (client.married && ssClient && ssSpouse) {
        return `Social Security about ${ssClient} a month for the client and ${ssSpouse} for the spouse. Does that match?`;
      }
      return ssClient
        ? `Social Security about ${ssClient} dollars a month. Does that match?`
        : `Did I capture Social Security correctly?`;
    case 7:
      return `So that's a ${risk} risk profile. Sound right?`;
    case 8:
      return `We'll calibrate using ${calibration}. Sound good?`;
    case 9:
      return goal
        ? `Let me read back the goal: "${goal}". Does that capture it?`
        : `Did I get the goal right?`;
    default:
      return `Did I get that right?`;
  }
}

/**
 * Lightweight client-side yes/no classifier for the confirmation reply.
 * If unclear, we treat the response as a correction and re-run as a normal turn —
 * the LLM can then update fields based on what they actually said.
 */
export function classifyConfirmationReply(text: string): "yes" | "no" {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "no";
  if (
    /\b(no|nope|not (?:right|correct|that)|wrong|incorrect|change|fix|actually|let me)\b/.test(t)
  ) {
    return "no";
  }
  if (
    /\b(yes|yeah|yep|yup|correct|right|that'?s right|that'?s correct|that is right|that is correct|sounds? right|sounds? good|all good|perfect|exactly|affirmative|sure|works for me|that works|good|okay|ok|great)\b/.test(
      t
    )
  ) {
    return "yes";
  }
  return "no";
}
