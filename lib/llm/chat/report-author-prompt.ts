/**
 * System-prompt builder for the report-authoring LLM call.
 *
 * Distinct from `system-prompt.ts` (the chat orchestrator's prompt) — this
 * one tells the model "you are composing a markdown REPORT, not chatting
 * with the advisor". The two prompts have different output contracts:
 *
 *   chat prompt   → conversational; can call tools; can ask clarifying questions
 *   report prompt → markdown only; NO tools; NO commentary; just a polished doc
 *
 * Pure function — NO IO. Returns `{ systemPrompt, userMessage }` so the
 * caller can pass them straight to `streamChat()` without further shaping.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.22 (generate_report_content).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Input shape
// ─────────────────────────────────────────────────────────────────────────────

/** Coarse-grained report categories. The model uses this to pick tone + structure. */
export const REPORT_TYPES = [
  "analysis",
  "allocation",
  "fee",
  "planning",
  "roth",
  "estate",
  "tax",
  "performance",
  "general",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(v: unknown): v is ReportType {
  return typeof v === "string" && (REPORT_TYPES as readonly string[]).includes(v);
}

export interface ReportAuthorInput {
  /** Report title. Becomes the H1 — model should NOT repeat it inside the body. */
  title: string;
  /** Category — drives tone + standard sections. */
  reportType: ReportType;
  /** The actual instructions from Nova / the advisor: what to cover, focus areas. */
  prompt: string;
  /**
   * Optional outline hints (section titles). When present the model should use
   * them as H2 headings in order. Empty / absent = model picks its own sections.
   */
  sections?: string[];
  /** Optional target audience (e.g. "the client", "internal review", "CPA"). */
  audience?: string;
  /**
   * Optional client snapshot. When present the model can reference the client
   * by name. NEVER invent client data — only use what's here.
   */
  client?: {
    name: string;
    /** Concise summary line(s) extracted from intake. */
    summary?: string;
    totalValue?: number;
  };
  /**
   * Structured data the model has gathered (allocations, holdings, fees,
   * activity, etc.). JSON-stringified into a fenced block in the prompt
   * — the report MUST cite this and ONLY this for any numbers.
   */
  sourceData?: unknown;
  /** Display name of the advisor whose firm is generating the report. */
  advisorName?: string;
  /** Firm name for the footer. */
  firmName?: string;
  /** ISO timestamp; rendered into a "Generated …" footer for traceability. */
  generatedAt: string;
}

export interface ReportAuthorPrompt {
  systemPrompt: string;
  /** The single user-turn that kicks the model off. */
  userMessage: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_CHART_TYPES = [
  "bar",
  "line",
  "pie",
  "doughnut",
  "radar",
  "polarArea",
  "scatter",
  "bubble",
];

const CHARTJS_EXAMPLE = `\`\`\`chart:chartjs
{
  "type": "doughnut",
  "data": {
    "labels": ["Equities", "Fixed Income", "Cash"],
    "datasets": [{ "data": [65, 30, 5] }]
  }
}
\`\`\``;

const ECHARTS_SANKEY_EXAMPLE = `\`\`\`chart:echarts
{
  "series": [{
    "type": "sankey",
    "data": [
      { "name": "Earned income" },
      { "name": "After-tax cash" },
      { "name": "Brokerage" },
      { "name": "401(k)" },
      { "name": "Roth IRA" }
    ],
    "links": [
      { "source": "Earned income", "target": "After-tax cash", "value": 70 },
      { "source": "Earned income", "target": "401(k)", "value": 22 },
      { "source": "Earned income", "target": "Roth IRA", "value": 8 },
      { "source": "After-tax cash", "target": "Brokerage", "value": 35 }
    ]
  }]
}
\`\`\``;

const ECHARTS_HEATMAP_EXAMPLE = `\`\`\`chart:echarts
{
  "xAxis": { "type": "category", "data": ["Mon", "Tue", "Wed", "Thu", "Fri"] },
  "yAxis": { "type": "category", "data": ["Morning", "Afternoon"] },
  "visualMap": { "min": 0, "max": 10, "calculable": true, "orient": "horizontal", "left": "center", "bottom": "0%" },
  "series": [{
    "type": "heatmap",
    "data": [[0,0,2],[1,0,4],[2,0,6],[3,0,8],[4,0,3],[0,1,5],[1,1,7],[2,1,9],[3,1,10],[4,1,4]]
  }]
}
\`\`\``;

const MERMAID_FLOWCHART_EXAMPLE = `\`\`\`mermaid
flowchart LR
  A[Discovery call] --> B[Risk profile]
  B --> C{Conservative?}
  C -->|Yes| D[Stable portfolio]
  C -->|No| E[Growth portfolio]
\`\`\``;

const MERMAID_SEQUENCE_EXAMPLE = `\`\`\`mermaid
sequenceDiagram
    participant Advisor
    participant Client
    participant Custodian
    Advisor->>Client: Send recommendation
    Client->>Advisor: Approve
    Advisor->>Custodian: Submit rebalance
    Custodian-->>Advisor: Confirmation
\`\`\``;

const MERMAID_ER_EXAMPLE = `\`\`\`mermaid
erDiagram
    HOUSEHOLD ||--o{ CLIENT : includes
    CLIENT ||--o{ ACCOUNT : owns
    ACCOUNT ||--o{ HOLDING : contains
\`\`\``;

const MERMAID_GANTT_EXAMPLE = `\`\`\`mermaid
gantt
    title Roth Conversion Timeline
    dateFormat YYYY-MM-DD
    section 2026
    Q1 Conversion: 2026-01-15, 30d
    Q4 Top-up: 2026-10-01, 14d
\`\`\``;

/**
 * Build the system + user prompt pair for the report-author run.
 *
 * The user message is intentionally short ("Compose the report now.") —
 * all the actual instructions live in the system prompt so the model
 * treats them as authoritative + cacheable across runs.
 */
export function buildReportAuthorPrompt(input: ReportAuthorInput): ReportAuthorPrompt {
  const systemPrompt = renderSystemPrompt(input);
  const userMessage = "Compose the report now. Begin with the H1 title and end after the final section. No commentary outside the markdown.";
  return { systemPrompt, userMessage };
}

function renderSystemPrompt(input: ReportAuthorInput): string {
  const blocks: string[] = [];
  blocks.push(renderRoleBlock(input));
  blocks.push(renderOutputContract());
  blocks.push(renderChartContract());
  blocks.push(renderMermaidContract());
  blocks.push(renderTaskBlock(input));
  if (input.client) blocks.push(renderClientBlock(input.client));
  if (input.sourceData !== undefined) blocks.push(renderSourceDataBlock(input.sourceData));
  if (input.sections && input.sections.length > 0) {
    blocks.push(renderOutlineBlock(input.sections));
  }
  blocks.push(renderFooterContract(input));
  return blocks.join("\n\n");
}

function renderRoleBlock(input: ReportAuthorInput): string {
  const audience = input.audience ? ` for ${input.audience}` : "";
  return [
    "<role>",
    `You are AdvisorPilot's report-authoring agent. You compose polished markdown reports${audience} for an independent financial advisor's firm.`,
    "You write ONE document per run and return ONLY that markdown — no preamble, no closing remarks, no apology if data is thin.",
    "</role>",
  ].join("\n");
}

function renderOutputContract(): string {
  return [
    "<output_contract>",
    "- Output MUST be valid CommonMark + GitHub-Flavored Markdown (GFM tables, task lists).",
    "- Start with a single H1 (`# `) using the title from <task>. Do NOT repeat the title elsewhere.",
    "- Use H2 (`## `) for main sections and H3 (`### `) for subsections. Never skip a level.",
    "- Use GFM tables for any tabular data (3+ rows or 2+ columns).",
    "- Use **bold** for key figures and *italics* sparingly. No underline.",
    "- Use bullet lists for talking points, numbered lists for sequential steps.",
    "- ALLOWED: headings, paragraphs, lists, GFM tables, blockquotes, links, inline code, fenced code blocks, horizontal rules, the chart:chartjs extension (see <charts>), the chart:echarts extension (see <charts>), the mermaid-block extension (see <diagrams>).",
    "- FORBIDDEN: raw HTML, `<script>`, inline images.",
    "- No introductory \"Here's the report:\" or \"Let me know if…\" lines. The markdown IS the deliverable.",
    "</output_contract>",
  ].join("\n");
}

function renderChartContract(): string {
  return [
    "<charts>",
    "Two chart libraries are available — pick the right one for the job:",
    "",
    "### Chart.js (`chart:chartjs`) — basic charts",
    `Use for: ${SUPPORTED_CHART_TYPES.join(", ")}.`,
    "Schema:",
    "```json",
    JSON.stringify(
      {
        type: "<one of the supported types>",
        height: "<optional positive integer pixels, defaults to 320>",
        data: {
          labels: ["<x-axis or slice labels>"],
          datasets: [
            {
              label: "<series label>",
              data: ["<numeric values aligned with labels>"],
            },
          ],
        },
        options: "<optional Chart.js v4 options object>",
      },
      null,
      2,
    ),
    "```",
    "",
    "Worked example (allocation doughnut):",
    CHARTJS_EXAMPLE,
    "",
    "### ECharts (`chart:echarts`) — advanced visualizations",
    "Use for: sankey (money flow / allocation movement), heatmap (calendar / matrix), treemap (nested composition), sunburst (hierarchical breakdown), graph/network, gauge.",
    "JSON ONLY — no comments, trailing commas, or JS expressions. The schema varies per chart type; the model is expected to know ECharts v6 series syntax.",
    "",
    "Worked example (sankey — household cash flow):",
    ECHARTS_SANKEY_EXAMPLE,
    "",
    "Worked example (heatmap — meeting frequency by day/half):",
    ECHARTS_HEATMAP_EXAMPLE,
    "",
    "### Color + sizing rules (both libraries)",
    "OMIT all color fields (`backgroundColor`, `color`, `itemStyle.color`, dataset colors, palette arrays, etc.). The renderer auto-applies the AdvisorPilot brand palette so charts look consistent across every report. Set colors ONLY when the advisor specifically requested a custom palette.",
    "",
    "JSON ONLY — no comments, no trailing commas, no JS expressions. The container is sized automatically (default 320 px for Chart.js, 360 px for ECharts); pass `height` only when you need a specific pixel value.",
    "",
    "Use charts purposefully — one or two per report is plenty. Do NOT embed a chart that just restates a small table.",
    "</charts>",
  ].join("\n");
}

function renderMermaidContract(): string {
  return [
    "<diagrams>",
    "When a PROCESS, RELATIONSHIP, SEQUENCE, or TIMELINE is easier to grasp visually than in prose, embed a Mermaid diagram in a fenced code block tagged `mermaid`.",
    "",
    "Supported diagram types: flowchart (most common — use for processes, decision trees, recommendation paths), sequenceDiagram (for handoffs / interactions), classDiagram (for entity relationships), stateDiagram-v2 (for lifecycle states), erDiagram (for data relationships), gantt (for timelines), pie (only as a SECONDARY visualization — prefer `chart:chartjs` for real charts), journey, mindmap, timeline.",
    "",
    "CRITICAL Mermaid rules (these trip the parser — read carefully):",
    "- Use `flowchart TD` or `flowchart LR`. NEVER use the deprecated `graph TD` / `graph LR` syntax.",
    "- NO colons (`:`) inside node labels or edge labels — colons are reserved in sequence / gantt / class / ER syntax. Use a dash or em-dash instead: `A[Stage 1 — Discovery]`, not `A[Stage 1: Discovery]`.",
    "- NO parentheses with special chars inside node labels — quote them if needed: `A[\"Step (final)\"]`.",
    "- For sequenceDiagram: solid arrow (`->>`) is a request, dashed (`-->>`) is a response.",
    "- For erDiagram: cardinality goes BEFORE the entity (`HOUSEHOLD ||--o{ CLIENT : includes`), and the relationship label comes after the colon (it's the ONE place colons are required).",
    "- For gantt: ALWAYS declare `dateFormat YYYY-MM-DD` first, then `section <name>`, then tasks as `Label: start_date, duration` (e.g. `Q1 Conversion: 2026-01-15, 30d`).",
    "- NEVER set custom colors, themes, or `%%{init}%%` theme directives — the renderer applies the AdvisorPilot brand palette automatically.",
    "- Keep labels concise (≤4 words per node). Prefer `flowchart LR` over `flowchart TD` for reports — left-to-right fits the narrow report column better.",
    "",
    "Worked examples:",
    "",
    "Flowchart (advisor recommendation path):",
    MERMAID_FLOWCHART_EXAMPLE,
    "",
    "Sequence diagram (advisor → client → custodian handoff):",
    MERMAID_SEQUENCE_EXAMPLE,
    "",
    "Entity relationship (household / client / account / holding):",
    MERMAID_ER_EXAMPLE,
    "",
    "Gantt (Roth conversion timeline):",
    MERMAID_GANTT_EXAMPLE,
    "",
    "Use diagrams purposefully — at most one or two per report. If the diagram would just repeat a bulleted list, skip it.",
    "</diagrams>",
  ].join("\n");
}

function renderTaskBlock(input: ReportAuthorInput): string {
  return [
    "<task>",
    `title: ${input.title}`,
    `report_type: ${input.reportType}`,
    `instructions: ${collapseWhitespace(input.prompt)}`,
    "</task>",
  ].join("\n");
}

function renderClientBlock(client: NonNullable<ReportAuthorInput["client"]>): string {
  const lines: string[] = ["<client>"];
  lines.push(`name: ${client.name}`);
  if (typeof client.totalValue === "number" && Number.isFinite(client.totalValue)) {
    lines.push(`total_aum_usd: ${client.totalValue.toFixed(2)}`);
  }
  if (client.summary && client.summary.trim()) {
    lines.push(`summary: ${collapseWhitespace(client.summary)}`);
  }
  lines.push(
    "USE only data from <client> and <source_data> when referencing the client. Do NOT invent figures, dates, holdings, or family details.",
  );
  lines.push("</client>");
  return lines.join("\n");
}

/**
 * Serialize sourceData as a JSON block. Capped at 60 KB to bound prompt
 * cost — beyond that the model can't reason about the data meaningfully
 * anyway, and the caller should pre-aggregate.
 */
const MAX_SOURCE_DATA_CHARS = 60_000;

function renderSourceDataBlock(data: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(data, null, 2);
  } catch {
    serialized = "<<unserializable — caller should pass plain JSON-compatible values only>>";
  }
  if (serialized.length > MAX_SOURCE_DATA_CHARS) {
    serialized =
      serialized.slice(0, MAX_SOURCE_DATA_CHARS) +
      `\n... (truncated to ${MAX_SOURCE_DATA_CHARS} chars — total ${serialized.length})`;
  }
  return [
    "<source_data>",
    "Pre-gathered structured data for this report. EVERY number you cite MUST come from here (or <client>).",
    "If <source_data> is insufficient to support a section, write the section anyway but include a \"Limitations\" subsection that lists what's missing.",
    "",
    "```json",
    serialized,
    "```",
    "</source_data>",
  ].join("\n");
}

function renderOutlineBlock(sections: string[]): string {
  const cleaned = sections
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) {
    return "<outline>\nNo outline provided — pick sensible sections for this report type.\n</outline>";
  }
  const lines = cleaned.map((s, i) => `${i + 1}. ${s}`);
  return [
    "<outline>",
    "Use these section titles as H2 headings in this exact order:",
    ...lines,
    "</outline>",
  ].join("\n");
}

function renderFooterContract(input: ReportAuthorInput): string {
  const parts: string[] = [
    "<footer_contract>",
    "End the report with a horizontal rule (`---`) followed by a single italicized footer line:",
  ];
  const advisor = input.advisorName?.trim();
  const firm = input.firmName?.trim();
  const dateLabel = formatReadableDate(input.generatedAt);
  const components: string[] = [];
  if (advisor) components.push(advisor);
  if (firm) components.push(firm);
  components.push(`Generated ${dateLabel} via AdvisorPilot`);
  parts.push(`*${components.join(" — ")}*`);
  parts.push("Use that footer verbatim. Do not add additional sign-off text.");
  parts.push("</footer_contract>");
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function formatReadableDate(iso: string): string {
  // We get an ISO string and want a stable, locale-independent rendering
  // ("May 16, 2026") for the footer. Falls back to the raw string on parse fail.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}
