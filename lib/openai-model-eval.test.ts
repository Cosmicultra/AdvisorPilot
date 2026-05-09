import { describe, expect, it } from "vitest";
import {
  ANALYSIS_JSON_EVAL_FIXTURE,
  ENRICHMENT_JSON_EVAL_FIXTURES,
  STATEMENT_EXTRACTION_EVAL_CHECKLIST,
  buildAnalysisJsonEvalPrompt,
  buildEnrichmentJsonEvalPrompt,
} from "./openai-model-eval-fixtures";

describe("openai-model-eval-fixtures", () => {
  it("documents eight manual statement extraction regressions", () => {
    expect(STATEMENT_EXTRACTION_EVAL_CHECKLIST).toHaveLength(8);
  });

  it("defines three enrichment JSON eval fixtures", () => {
    expect(ENRICHMENT_JSON_EVAL_FIXTURES).toHaveLength(3);
    for (const fx of ENRICHMENT_JSON_EVAL_FIXTURES) {
      expect(fx.id).toMatch(/^[a-z0-9-]+$/);
      expect(fx.scenario.trim().length).toBeGreaterThan(3);
      expect(fx.researchNotes.trim()).toContain("\n");
      const prompt = buildEnrichmentJsonEvalPrompt(fx);
      expect(prompt).toContain(fx.holding.rawName);
    }
  });

  it("builds deterministic analysis-eval prompt text", () => {
    const p = buildAnalysisJsonEvalPrompt(ANALYSIS_JSON_EVAL_FIXTURE);
    expect(p).toContain("Jamie");
    expect(p).toContain("VOO");
    expect(p).toContain(`As of ${ANALYSIS_JSON_EVAL_FIXTURE.analysisDate}`);
  });
});
