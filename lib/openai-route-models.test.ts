import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analysisJsonModel,
  analysisResearchModel,
  enrichmentJsonModel,
  enrichmentResearchModel,
  extractionMaxOutputTokens,
  extractionModel,
  logOpenAiPass,
} from "./openai-route-models";

const MODEL_ENV_KEYS = [
  "OPENAI_ANALYSIS_RESEARCH_MODEL",
  "OPENAI_ANALYSIS_JSON_MODEL",
  "OPENAI_ENRICHMENT_RESEARCH_MODEL",
  "OPENAI_ENRICHMENT_JSON_MODEL",
  "OPENAI_EXTRACTION_MODEL",
  "OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS",
  "ADVISORPILOT_OPENAI_LOG_MODEL_PASS",
] as const;

function clearOpenAiEnv() {
  for (const k of MODEL_ENV_KEYS) delete process.env[k];
}

describe("openai-route-models", () => {
  beforeEach(() => {
    clearOpenAiEnv();
  });

  it("defaults portfolio and enrichment passes to gpt-4o", () => {
    expect(analysisResearchModel()).toBe("gpt-4o");
    expect(analysisJsonModel()).toBe("gpt-4o");
    expect(enrichmentResearchModel()).toBe("gpt-4o");
    expect(enrichmentJsonModel()).toBe("gpt-4o");
    expect(extractionModel()).toBe("gpt-4o");
    expect(extractionMaxOutputTokens()).toBe(16384);
  });

  it("honors OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS override", () => {
    process.env.OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS = "8192";
    expect(extractionMaxOutputTokens()).toBe(8192);
  });

  it("caps OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS at 32768", () => {
    process.env.OPENAI_EXTRACTION_MAX_OUTPUT_TOKENS = "999999";
    expect(extractionMaxOutputTokens()).toBe(32768);
  });

  it("trims whitespace and honors overrides", () => {
    process.env.OPENAI_ANALYSIS_JSON_MODEL = "  gpt-4o-mini  ";
    process.env.OPENAI_ENRICHMENT_JSON_MODEL = "gpt-4o-mini";

    expect(analysisJsonModel()).toBe("gpt-4o-mini");
    expect(enrichmentJsonModel()).toBe("gpt-4o-mini");
  });

  it("logs passes only when ADVISORPILOT_OPENAI_LOG_MODEL_PASS=1", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logOpenAiPass("test-route", "json", "gpt-4o-mini");
    expect(spy).not.toHaveBeenCalled();

    process.env.ADVISORPILOT_OPENAI_LOG_MODEL_PASS = "1";
    logOpenAiPass("test-route", "json", "gpt-4o-mini");
    expect(spy).toHaveBeenCalledWith("[openai:test-route:json] model=gpt-4o-mini");

    spy.mockRestore();
  });
});
