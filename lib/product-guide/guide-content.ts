/**
 * Copy for the in-app beginner product guide.
 * Shell-specific variants (CRM rail vs legacy wizard) where navigation differs.
 */

import type { ProductGuideShell } from "@/lib/product-guide/steps";

export interface GuideStepCopy {
  lead: string;
  bullets: string[];
  aiRecommendation?: string;
  tip?: string;
}

export type GuideStepId =
  | "welcome"
  | "navigation"
  | "workflow"
  | "crm"
  | "nova"
  | "account";

export const GEMINI_AGENTIC_RECOMMENDATION =
  "Recommended: Use Gemini with Agentic research for statement reading and portfolio analysis — currently the best balance of speed and accuracy in AdvisorPilot. Change anytime via AI models & research tier in your account menu.";

const WELCOME: GuideStepCopy = {
  lead: "AdvisorPilot is your workspace for client portfolio reviews — from custodian statements through confirmed holdings, analysis, meeting prep, and PDF deliverables.",
  bullets: [
    "You upload or collect statements, confirm the book of record, edit AI-generated drafts, then export materials under your firm's process.",
    "Nothing goes to a client automatically; you approve every narrative and deliverable.",
  ],
  aiRecommendation: GEMINI_AGENTIC_RECOMMENDATION,
  tip: "AdvisorPilot does not provide investment advice, suitability determinations, or automated client communication.",
};

const WORKFLOW: GuideStepCopy = {
  lead: "Every review follows the same sequence. Work through it in order — especially Confirm before Analysis.",
  bullets: [
    "Intake — capture household context, goals, and risk framing.",
    "Upload — add custodian PDFs yourself or send a secure client magic link.",
    "Confirm holdings — reconcile positions and account registration (IRA, Roth, taxable) against the statements.",
    "Portfolio analysis — review synopsis, highlights, and talking points; edit before the meeting.",
    "Meeting & planning — use FIA, Roth, retirement income, and fee modules when that review requires them.",
    "Report — export a PDF with your branding and disclosures after final review.",
  ],
  aiRecommendation: GEMINI_AGENTIC_RECOMMENDATION,
  tip: "Skipping Confirm is the most common source of bad analysis — fix line items and registrations before you run synthesis.",
};

const NOVA: GuideStepCopy = {
  lead: "Nova is the in-app assistant (royal button, bottom-right). Use it for next-step guidance, summaries, and draft language.",
  bullets: [
    "Ask about the client on screen, open tasks, or where you are in the workflow.",
    "Example prompts: “What should I do after upload?” · “Summarize this client's risk themes.” · “What tasks are due this week?”",
    "Voice mode is available inside the chat panel for hands-free prep.",
    "Treat replies as drafts — verify numbers and recommendations before client use.",
  ],
  aiRecommendation: GEMINI_AGENTIC_RECOMMENDATION,
};

function navigationCopy(shell: ProductGuideShell): GuideStepCopy {
  if (shell === "crm") {
    return {
      lead: "The navy side rail is your main navigation. Start a new household under Analysis; return to existing clients in CRM.",
      bullets: [
        "Analysis — intake and review workflow for a new or in-progress client.",
        "CRM — client roster, profile header, and tabs (Overview, Workflow, Notes, Tasks).",
        "Tasks — follow-ups across your book, sorted by due date.",
        "Reports — generated PDFs and report entry points.",
        "Settings (bottom of rail) — profile, signature, branding, and AI models.",
        "+ New client in the header — shortcut to start intake from any CRM page.",
      ],
    };
  }

  return {
    lead: "Navigation runs through the top bar and the horizontal wizard rail. Move left to right as each step completes.",
    bullets: [
      "New review — start or switch to another household's review.",
      "Wizard rail — Intake → Upload → Confirm → Analysis → Meeting → planning tools → Report.",
      "Saved — reopen a review you started earlier.",
      "Account menu (top right) — setup wizard, signature, this guide, sign out.",
    ],
    tip: "When your firm enables the CRM shell, the same destinations appear on a side rail (Analysis, CRM, Tasks, Reports).",
  };
}

function clientsCopy(shell: ProductGuideShell): GuideStepCopy {
  if (shell === "legacy") {
    return {
      lead: "Client work lives in the workflow until the CRM roster is enabled for your firm.",
      bullets: [
        "Complete intake and upload, then use Saved in the wizard rail to return to that review.",
        "Open this guide from a CRM route later for the full roster and tab walkthrough.",
      ],
    };
  }

  return {
    lead: "CRM is each household's home in AdvisorPilot — search the roster, open a client, and work from one profile.",
    bullets: [
      "Start new clients in Analysis; find them in CRM for every subsequent meeting.",
      "Overview — allocation, accounts, and recent activity before a call.",
      "Workflow — upload, confirm, and analysis scoped to that client.",
      "Notes & Timeline — log conversation points and see activity in order.",
      "Tasks — track follow-ups so prep does not rely on memory.",
    ],
    tip: "Log a note right after client calls — it saves time at the next review.",
  };
}

function accountCopy(shell: ProductGuideShell): GuideStepCopy {
  const setupBullet =
    shell === "legacy"
      ? "Setup wizard (account menu) — AI provider, signature, logo, and disclosures."
      : "Settings (rail) or Profile & signature (account menu) — same setup surfaces.";

  return {
    lead: "Configure account-level settings once, then update only when your contact info or firm requirements change.",
    bullets: [
      setupBullet,
      "Profile & signature — name, title, contact info on emails and PDFs.",
      "AI models & research tier — provider and research depth for extraction, enrichment, and Nova.",
      "How AdvisorPilot works — reopen this guide from the account menu anytime.",
    ],
    aiRecommendation:
      "New accounts default to Gemini with Agentic research. Your selection persists until you change it in AI models & research tier.",
  };
}

export function getGuideCopy(stepId: GuideStepId, shell: ProductGuideShell): GuideStepCopy {
  switch (stepId) {
    case "welcome":
      return WELCOME;
    case "navigation":
      return navigationCopy(shell);
    case "workflow":
      return WORKFLOW;
    case "crm":
      return clientsCopy(shell);
    case "nova":
      return NOVA;
    case "account":
      return accountCopy(shell);
    default:
      return { lead: "", bullets: [] };
  }
}
