/**
 * Tests for the report-author prompt builder.
 *
 * These tests pin down the OUTPUT SHAPE of the system prompt so anyone
 * editing the prompt text understands what callers — and the underlying
 * model contract — are relying on. They don't lock the exact wording (the
 * builder is allowed to evolve), but they do verify:
 *
 *   1. Block presence + omission rules (client, sourceData, sections,
 *      audience, advisor footer)
 *   2. JSON-Schema sketch for chart blocks
 *   3. SourceData truncation behavior
 *   4. Outline ordering preserved + cap enforced (well, cap is enforced
 *      by the TOOL — the prompt builder happily accepts arbitrary lengths)
 *   5. User message is a one-liner directing the model to start
 *   6. Footer-contract block respects optional advisor / firm names
 *   7. isReportType type guard
 */

import { describe, expect, it } from "vitest";
import {
  buildReportAuthorPrompt,
  isReportType,
  REPORT_TYPES,
  type ReportAuthorInput,
} from "./report-author-prompt";

function baseInput(overrides: Partial<ReportAuthorInput> = {}): ReportAuthorInput {
  return {
    title: "Q3 Allocation Review for Jane",
    reportType: "allocation",
    prompt: "Summarize current allocation, flag concentration in tech, suggest rebalancing.",
    generatedAt: "2026-05-16T19:00:00.000Z",
    ...overrides,
  };
}

describe("isReportType", () => {
  for (const t of REPORT_TYPES) {
    it(`accepts ${t}`, () => expect(isReportType(t)).toBe(true));
  }
  it("rejects unknown types", () => {
    expect(isReportType("random")).toBe(false);
    expect(isReportType("")).toBe(false);
    expect(isReportType(42)).toBe(false);
    expect(isReportType(undefined)).toBe(false);
  });
});

describe("buildReportAuthorPrompt — base shape", () => {
  it("always includes role + output_contract + charts + task + footer blocks", () => {
    const { systemPrompt, userMessage } = buildReportAuthorPrompt(baseInput());
    expect(systemPrompt).toContain("<role>");
    expect(systemPrompt).toContain("</role>");
    expect(systemPrompt).toContain("<output_contract>");
    expect(systemPrompt).toContain("<charts>");
    expect(systemPrompt).toContain("<task>");
    expect(systemPrompt).toContain("title: Q3 Allocation Review for Jane");
    expect(systemPrompt).toContain("report_type: allocation");
    expect(systemPrompt).toContain("<footer_contract>");
    expect(userMessage).toMatch(/Compose the report/);
  });

  it("omits the client block when no client is provided", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput({ client: undefined }));
    expect(systemPrompt).not.toContain("<client>");
  });

  it("omits source_data when none is provided", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput({ sourceData: undefined }));
    expect(systemPrompt).not.toContain("<source_data>");
  });

  it("omits outline when sections is undefined or empty", () => {
    const noSections = buildReportAuthorPrompt(baseInput());
    expect(noSections.systemPrompt).not.toContain("<outline>");
    // Empty array is also treated as no outline (still safe; consumers shouldn't pass [])
    const emptySections = buildReportAuthorPrompt(baseInput({ sections: [] }));
    expect(emptySections.systemPrompt).not.toContain("<outline>");
  });

  it("includes ALL listed chart types in the charts block", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    for (const t of ["bar", "line", "pie", "doughnut", "radar", "polarArea", "scatter", "bubble"]) {
      expect(systemPrompt).toContain(t);
    }
  });

  it("teaches both chart libraries (chartjs for basics, echarts for advanced)", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    expect(systemPrompt).toContain("chart:chartjs");
    expect(systemPrompt).toContain("chart:echarts");
    // The contract explicitly guides the model on WHICH to use.
    expect(systemPrompt).toMatch(/sankey/);
    expect(systemPrompt).toMatch(/heatmap/);
    // Both should appear in ALLOWED, not FORBIDDEN.
    const forbiddenLine = systemPrompt
      .split("\n")
      .find((l) => l.startsWith("- FORBIDDEN:"));
    expect(forbiddenLine).toBeDefined();
    expect(forbiddenLine).not.toMatch(/chart:echarts/);
    expect(forbiddenLine).not.toMatch(/chart:chartjs/);
  });

  it("includes the <diagrams> block teaching mermaid", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    expect(systemPrompt).toContain("<diagrams>");
    expect(systemPrompt).toContain("</diagrams>");
    // Sanity: at least one Mermaid diagram type is mentioned in the contract.
    expect(systemPrompt).toMatch(/flowchart/);
    expect(systemPrompt).toMatch(/sequenceDiagram/);
  });

  it("lists mermaid in ALLOWED and not in the FORBIDDEN line itself", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    // Pull the FORBIDDEN line out of <output_contract> and assert mermaid
    // isn't on it. (The substring "mermaid" appears LATER in the prompt's
    // <diagrams> block — we only care about the FORBIDDEN list itself.)
    const forbiddenLine = systemPrompt
      .split("\n")
      .find((l) => l.startsWith("- FORBIDDEN:"));
    expect(forbiddenLine).toBeDefined();
    expect(forbiddenLine).not.toMatch(/mermaid/);
    // And ALLOWED-line mentions the mermaid-block extension.
    const allowedLine = systemPrompt
      .split("\n")
      .find((l) => l.startsWith("- ALLOWED:"));
    expect(allowedLine).toMatch(/mermaid-block/);
  });

  it("warns the model NOT to set custom mermaid colors / themes (palette is auto)", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    // The contract should explicitly discourage %%{init}%% directives.
    expect(systemPrompt).toMatch(/NEVER[\s\S]*custom colors/i);
    expect(systemPrompt).toMatch(/%%\{init\}%%/);
  });

  it("teaches CRITICAL parser-trap Mermaid rules (control_tower wisdom)", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    // The most common failure mode the model hits:
    expect(systemPrompt).toMatch(/NEVER use the deprecated `graph TD`/);
    expect(systemPrompt).toMatch(/NO colons \(`:`\) inside node labels/);
    // The recovery hint with an em-dash example.
    expect(systemPrompt).toMatch(/A\[Stage 1 — Discovery\]/);
  });

  it("includes worked examples for flowchart, sequenceDiagram, erDiagram, and gantt", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    expect(systemPrompt).toMatch(/flowchart LR\n  A\[Discovery call\]/);
    expect(systemPrompt).toMatch(/sequenceDiagram\n    participant Advisor/);
    expect(systemPrompt).toMatch(/erDiagram\n    HOUSEHOLD/);
    expect(systemPrompt).toMatch(/gantt\n    title Roth Conversion Timeline/);
    // The gantt example uses the dateFormat directive correctly.
    expect(systemPrompt).toMatch(/dateFormat YYYY-MM-DD/);
  });
});

describe("buildReportAuthorPrompt — client block", () => {
  it("renders client name + total_aum + summary when supplied", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({
        client: { name: "Jane Doe", totalValue: 4500000, summary: "Age 62, retired, conservative goals" },
      }),
    );
    expect(systemPrompt).toContain("<client>");
    expect(systemPrompt).toContain("name: Jane Doe");
    expect(systemPrompt).toContain("total_aum_usd: 4500000.00");
    expect(systemPrompt).toContain("summary: Age 62, retired, conservative goals");
    expect(systemPrompt).toContain("Do NOT invent");
  });

  it("omits total_aum when not finite", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({
        client: { name: "Jane Doe", totalValue: Number.NaN },
      }),
    );
    expect(systemPrompt).toContain("name: Jane Doe");
    expect(systemPrompt).not.toContain("total_aum_usd:");
  });

  it("omits summary line when summary is empty/whitespace", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ client: { name: "Jane Doe", summary: "   " } }),
    );
    expect(systemPrompt).toContain("name: Jane Doe");
    expect(systemPrompt).not.toContain("summary:");
  });

  it("collapses internal whitespace in summary to single spaces", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({
        client: { name: "Jane Doe", summary: "line1\n\n   line2\t\tline3" },
      }),
    );
    expect(systemPrompt).toContain("summary: line1 line2 line3");
  });
});

describe("buildReportAuthorPrompt — source data", () => {
  it("includes a JSON block when sourceData is present", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({
        sourceData: {
          buckets: [{ label: "Equities", weight: 65 }, { label: "Fixed Income", weight: 30 }],
        },
      }),
    );
    expect(systemPrompt).toContain("<source_data>");
    expect(systemPrompt).toContain("```json");
    expect(systemPrompt).toContain('"label": "Equities"');
    expect(systemPrompt).toContain('"weight": 65');
    expect(systemPrompt).toContain("EVERY number you cite MUST come from here");
  });

  it("truncates source data above the 60 KB cap with a marker", () => {
    // Build a payload that's clearly over the cap.
    const bigArray: { i: number; payload: string }[] = [];
    for (let i = 0; i < 5000; i += 1) {
      bigArray.push({ i, payload: "x".repeat(20) });
    }
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ sourceData: { items: bigArray } }),
    );
    expect(systemPrompt).toContain("(truncated to 60000 chars");
  });

  it("handles unserializable source data gracefully", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ sourceData: circular }),
    );
    expect(systemPrompt).toContain("<source_data>");
    expect(systemPrompt).toMatch(/unserializable/);
  });
});

describe("buildReportAuthorPrompt — outline", () => {
  it("preserves section order and renders as numbered list", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ sections: ["Overview", "Concentration Risk", "Recommendations"] }),
    );
    expect(systemPrompt).toContain("<outline>");
    expect(systemPrompt).toContain("1. Overview");
    expect(systemPrompt).toContain("2. Concentration Risk");
    expect(systemPrompt).toContain("3. Recommendations");
    // Order check: ensure indexes are increasing.
    const overviewIdx = systemPrompt.indexOf("1. Overview");
    const recsIdx = systemPrompt.indexOf("3. Recommendations");
    expect(overviewIdx).toBeLessThan(recsIdx);
  });

  it("trims whitespace and drops empty entries", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ sections: ["  Intro  ", "", "  ", "Conclusion"] }),
    );
    expect(systemPrompt).toContain("1. Intro");
    expect(systemPrompt).toContain("2. Conclusion");
    expect(systemPrompt).not.toContain("3.");
  });
});

describe("buildReportAuthorPrompt — audience + footer", () => {
  it("threads audience into the role block when supplied", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ audience: "the client's CPA" }),
    );
    expect(systemPrompt).toMatch(/for the client's CPA/);
  });

  it("renders a clean footer when advisor + firm omitted", () => {
    const { systemPrompt } = buildReportAuthorPrompt(baseInput());
    expect(systemPrompt).toMatch(/\*Generated May 16, 2026 via AdvisorPilot\*/);
  });

  it("includes advisor + firm when supplied", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ advisorName: "Jane Smith", firmName: "Acme Wealth" }),
    );
    expect(systemPrompt).toMatch(/\*Jane Smith — Acme Wealth — Generated May 16, 2026 via AdvisorPilot\*/);
  });

  it("falls back to raw ISO when generatedAt isn't parseable", () => {
    const { systemPrompt } = buildReportAuthorPrompt(
      baseInput({ generatedAt: "not-a-date" }),
    );
    expect(systemPrompt).toContain("Generated not-a-date via AdvisorPilot");
  });
});

describe("buildReportAuthorPrompt — user message", () => {
  it("returns a short directive (NO content instructions duplicated here)", () => {
    const { userMessage } = buildReportAuthorPrompt(baseInput());
    expect(userMessage.length).toBeLessThan(300);
    expect(userMessage).toMatch(/Compose the report now/);
    expect(userMessage).toMatch(/No commentary outside the markdown/);
  });
});
