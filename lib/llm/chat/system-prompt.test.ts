import { describe, expect, it } from "vitest";
import {
  buildChatSystemPrompt,
  type SystemPromptAdvisor,
  type SystemPromptView,
} from "./system-prompt";

/**
 * System-prompt builder tests.
 *
 * Pure function → easy to assert on. Covers:
 *   1. Always-present blocks (advisor, current_view, policy, date footer)
 *   2. Conditional blocks — present when data is, omitted entirely when empty
 *   3. Field-level omission inside blocks (e.g. firm missing → "Firm:" line omitted)
 *   4. AUM formatting ($1.42M / $250.0K / $999)
 *   5. Cash sleeve as a decimal renders as integer percent
 *   6. Date footer respects the advisor's timezone
 *   7. Multi-line / messy strings get normalized (no embedded newlines breaking XML structure)
 */

const ADVISOR_MIN: SystemPromptAdvisor = {
  name: "Jane Doe",
  email: "jane@firm.com",
};

const VIEW_MIN: SystemPromptView = {
  route: "/app",
};

// Fixed instant so the date footer is deterministic across CI runs.
// 2026-05-16 14:30 UTC.
const FIXED_NOW = new Date("2026-05-16T14:30:00.000Z");

describe("buildChatSystemPrompt — always-present blocks", () => {
  it("always emits the greeting line addressing the advisor by name (Nova persona)", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).toContain(
      "You are Nova, an AI Co-Pilot in the app AdvisorPilot, the assistant for Jane Doe.",
    );
  });

  it("always emits the static policy block", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).toContain("<policy>");
    expect(out).toContain("Never fabricate client data.");
    expect(out).toContain("## End of Policy");
  });

  it("always emits the rendering-capabilities block teaching the model the renderer's surface", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).toContain("<rendering>");
    expect(out).toContain("</rendering>");
    // The whole point of this block: teach the model the two custom languages
    // so it stops emitting ASCII flowcharts in plain ``` blocks.
    expect(out).toContain("```chart:chartjs");
    expect(out).toContain("```mermaid");
    expect(out).toMatch(/flowchart LR/);
    // Branding rules — the model should NOT set colors or %%{init}%% directives.
    expect(out).toMatch(/OMIT all color fields/);
    expect(out).toMatch(/%%\{init\}%%/);
    // Forbidden list calls out the exact failure mode (ASCII flowcharts).
    expect(out).toMatch(/ASCII-art flowcharts/);
    // Both chart libraries should be taught (chartjs for basics, echarts
    // for advanced viz). PR 13 — echarts is no longer in the FORBIDDEN
    // list; it lives in its own ALLOWED bullet.
    expect(out).toMatch(/chart:echarts/);
    expect(out).toMatch(/sankey/);
    expect(out).toMatch(/heatmap/);
  });

  it("teaches the CRITICAL Mermaid parser-trap rules (control_tower wisdom)", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    // 1. `flowchart TD` not the deprecated `graph TD`.
    expect(out).toMatch(/NOT the deprecated `graph TD`/);
    // 2. The no-colons-in-labels rule with an em-dash alternative.
    expect(out).toMatch(/NO colons[\s\S]*node labels/);
    expect(out).toMatch(/Stage 1 — Discovery/);
    // 3. Sequence-diagram arrow conventions (solid request, dashed response).
    // Use [\s\S] (not .) so the regex matches across the wrapped line.
    expect(out).toMatch(/solid arrow[\s\S]*request/i);
    expect(out).toMatch(/dashed[\s\S]*response/i);
  });

  it("emits the rendering block BEFORE the tools block (so the model sees rendering capabilities even when no tools are wired)", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
      tools: [{ name: "query_crm", description: "Read the CRM database." }],
    });
    const renderingIdx = out.indexOf("<rendering>");
    const toolsIdx = out.indexOf("<tools>");
    expect(renderingIdx).toBeGreaterThan(-1);
    expect(toolsIdx).toBeGreaterThan(-1);
    expect(renderingIdx).toBeLessThan(toolsIdx);
  });

  it("always emits the advisor block with name + email", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).toMatch(/<advisor>\n  Name: Jane Doe \(jane@firm\.com\)\n<\/advisor>/);
  });

  it("always emits the current_view block with the route", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: { route: "/app/crm/c_a1b2/overview", surface: "crm", tab: "overview" },
      now: FIXED_NOW,
    });
    expect(out).toContain("<current_view>");
    expect(out).toContain("Route: /app/crm/c_a1b2/overview");
    expect(out).toContain("Surface: crm · Tab: overview");
  });

  it("emits the date footer with the advisor's timezone", () => {
    const out = buildChatSystemPrompt({
      advisor: { ...ADVISOR_MIN, timezone: "America/Denver" },
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    // 14:30 UTC = 08:30 MDT in mid-May (after spring forward)
    expect(out).toMatch(/Today is 05\/16\/2026 08:30 \(America\/Denver\)\./);
  });

  it("falls back to UTC when timezone is not set", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).toMatch(/\(UTC\)\.$/);
  });

  it("recovers from an invalid timezone string (falls back to UTC components)", () => {
    const out = buildChatSystemPrompt({
      advisor: { ...ADVISOR_MIN, timezone: "Not/A_Real_Zone" },
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).toContain("2026-05-16");
    expect(out).toContain("Not/A_Real_Zone");
  });
});

describe("buildChatSystemPrompt — conditional blocks", () => {
  it("OMITS current_client / pinned_notes / recent_activity / open_tasks when not provided", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).not.toContain("<current_client>");
    expect(out).not.toContain("<pinned_notes>");
    expect(out).not.toContain("<recent_activity>");
    expect(out).not.toContain("<open_tasks>");
  });

  it("OMITS pinned_notes when the array is empty (never ships empty XML tags)", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      pinnedNotes: [],
      recentActivity: [],
      openTasks: [],
      now: FIXED_NOW,
    });
    expect(out).not.toContain("<pinned_notes>");
    expect(out).not.toContain("<recent_activity>");
    expect(out).not.toContain("<open_tasks>");
  });

  it("emits the full current_client block with stage, AUM, risk, cash sleeve, accounts", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: { route: "/app/crm/c_a1b2/overview", surface: "crm", tab: "overview" },
      currentClient: {
        name: "John Smith",
        stage: "review-due",
        lastReviewDate: "2026-02-14",
        nextDueDate: "2026-06-01",
        aum: 1_420_000,
        riskProfile: "moderate",
        cashSleevePct: 0.08,
        accountSummary: "1 IRA, 1 Joint Brokerage",
      },
      now: FIXED_NOW,
    });
    expect(out).toContain("<current_client>");
    expect(out).toContain("Name: John Smith · Stage: review-due · (next due 2026-06-01)");
    expect(out).toContain("Last review: 2026-02-14 · AUM: $1.42M");
    expect(out).toContain("Risk profile: moderate · Cash sleeve: 8%");
    expect(out).toContain("Accounts: 1 IRA, 1 Joint Brokerage");
  });

  it("emits a sparse current_client block when only name is set", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      currentClient: { name: "Aisha K." },
      now: FIXED_NOW,
    });
    expect(out).toContain("<current_client>\n  Name: Aisha K.\n</current_client>");
    expect(out).not.toContain("Last review:");
    expect(out).not.toContain("Risk profile:");
  });

  it("emits pinned_notes lines, squashing internal whitespace", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      pinnedNotes: [
        { date: "2026-04-02", body: "Looking to consolidate his\n  late wife's IRA" },
        { date: "2026-03-18", body: "529 conversation needed" },
      ],
      now: FIXED_NOW,
    });
    expect(out).toContain("<pinned_notes>");
    expect(out).toMatch(
      /  - 2026-04-02 — "Looking to consolidate his late wife's IRA"/,
    );
    expect(out).toMatch(/  - 2026-03-18 — "529 conversation needed"/);
  });

  it("emits recent_activity lines including the optional refId in parens", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      recentActivity: [
        { date: "2026-05-15", summary: "Generated portfolio review PDF", refId: "review_id=r_77" },
        { date: "2026-05-14", summary: "Logged note" },
      ],
      now: FIXED_NOW,
    });
    expect(out).toContain("  - 2026-05-15 — Generated portfolio review PDF (review_id=r_77)");
    expect(out).toContain("  - 2026-05-14 — Logged note");
  });

  it("emits open_tasks as a numbered list with due date + priority", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      openTasks: [
        { title: "Follow up on Roth conversion", dueDate: "2026-05-20", priority: "Medium" },
        { title: "Send updated IPS" },
      ],
      now: FIXED_NOW,
    });
    expect(out).toMatch(/  1\. Follow up on Roth conversion — due 2026-05-20 — Medium/);
    expect(out).toMatch(/  2\. Send updated IPS$/m);
  });
});

describe("buildChatSystemPrompt — tools block", () => {
  it("emits a <tools> block listing each name + description when tools provided", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      tools: [
        { name: "query_crm", description: "Read CRM rows." },
        { name: "compute", description: "Derive projections." },
      ],
      now: FIXED_NOW,
    });
    expect(out).toContain("<tools>");
    expect(out).toContain("  - query_crm: Read CRM rows.");
    expect(out).toContain("  - compute: Derive projections.");
    expect(out).toContain("</tools>");
  });

  it("omits the <tools> block when no tools are provided", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).not.toContain("<tools>");
  });

  it("omits the <tools> block when the array is empty", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      tools: [],
      now: FIXED_NOW,
    });
    expect(out).not.toContain("<tools>");
  });
});

describe("buildChatSystemPrompt — formatting helpers", () => {
  it("formats AUM in millions with 2 decimals", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      currentClient: { name: "x", aum: 1_420_000 },
      now: FIXED_NOW,
    });
    expect(out).toContain("AUM: $1.42M");
  });

  it("formats AUM in thousands with 1 decimal when below 1M", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      currentClient: { name: "x", aum: 250_000 },
      now: FIXED_NOW,
    });
    expect(out).toContain("AUM: $250.0K");
  });

  it("formats AUM in plain dollars when below 1K", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      currentClient: { name: "x", aum: 999 },
      now: FIXED_NOW,
    });
    expect(out).toContain("AUM: $999");
  });

  it("omits AUM line entirely when value is NaN/null", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      currentClient: { name: "x", aum: null, riskProfile: "moderate" },
      now: FIXED_NOW,
    });
    expect(out).not.toContain("AUM:");
    expect(out).toContain("Risk profile: moderate");
  });

  it("omits firm/title lines when both are missing", () => {
    const out = buildChatSystemPrompt({
      advisor: ADVISOR_MIN,
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(out).not.toContain("Firm:");
    expect(out).not.toContain("Title:");
  });

  it("includes firm only when title is missing (and vice versa)", () => {
    const firmOnly = buildChatSystemPrompt({
      advisor: { ...ADVISOR_MIN, firmName: "Riverside Wealth" },
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(firmOnly).toContain("Firm: Riverside Wealth");
    expect(firmOnly).not.toContain("Title:");

    const titleOnly = buildChatSystemPrompt({
      advisor: { ...ADVISOR_MIN, title: "Senior Advisor" },
      currentView: VIEW_MIN,
      now: FIXED_NOW,
    });
    expect(titleOnly).toContain("Title: Senior Advisor");
    expect(titleOnly).not.toContain("Firm:");
  });
});
