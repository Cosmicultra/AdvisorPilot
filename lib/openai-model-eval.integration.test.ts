import OpenAI from "openai";
import { beforeAll, describe, expect, it } from "vitest";
import { isCanonicalAssetClass } from "./asset-classes";
import {
  ANALYSIS_JSON_EVAL_FIXTURE,
  ENRICHMENT_JSON_EVAL_FIXTURES,
  buildAnalysisJsonEvalPrompt,
  buildEnrichmentJsonEvalPrompt,
} from "./openai-model-eval-fixtures";

const MODEL_BASELINE = process.env.ADVISORPILOT_EVAL_JSON_BASELINE_MODEL?.trim() || "gpt-4o";
const MODEL_CANDIDATE =
  process.env.ADVISORPILOT_EVAL_JSON_CANDIDATE_MODEL?.trim() || "gpt-4o-mini";

const runCompare =
  process.env.ADVISORPILOT_EVAL_JSON_COMPARE === "1" &&
  Boolean(process.env.OPENAI_API_KEY?.trim());

describe.skipIf(!runCompare)(
  `openai json paired compare (${MODEL_BASELINE} vs ${MODEL_CANDIDATE}; ADVISORPILOT_EVAL_JSON_COMPARE=1)`,
  () => {
    let openai: OpenAI;

    beforeAll(() => {
      openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
      });
    });

    async function structuredJson(prompt: string, model: string) {
      const res = await openai.responses.create({
        model,
        input: prompt,
        text: { format: { type: "json_object" } },
      });
      const text = res.output_text || "";
      return JSON.parse(text) as Record<string, unknown>;
    }

    async function enrichmentSchemaOk(model: string) {
      for (const fx of ENRICHMENT_JSON_EVAL_FIXTURES) {
        const parsed = await structuredJson(buildEnrichmentJsonEvalPrompt(fx), model);
        const cls = String(parsed.mappedAssetClass ?? "");
        expect(isCanonicalAssetClass(cls), `fixture ${fx.id} mappedAssetClass=${cls}`).toBe(true);
      }
    }

    async function analysisSchemaOk(model: string) {
      const parsed = await structuredJson(
        buildAnalysisJsonEvalPrompt(ANALYSIS_JSON_EVAL_FIXTURE),
        model
      );
      expect(String(parsed.synopsis ?? "")).toContain(
        `As of ${ANALYSIS_JSON_EVAL_FIXTURE.analysisDate}`
      );
      const ph = parsed.portfolioHighlights;
      expect(Array.isArray(ph)).toBe(true);
      expect(ph).toHaveLength(3);
    }

    it("accepts enrichment JSON prompts for baseline and mini candidates", async () => {
      await enrichmentSchemaOk(MODEL_BASELINE);
      await enrichmentSchemaOk(MODEL_CANDIDATE);
    }, 120_000);

    it("accepts analysis JSON prompts for baseline and mini candidates", async () => {
      await analysisSchemaOk(MODEL_BASELINE);
      await analysisSchemaOk(MODEL_CANDIDATE);
    }, 120_000);
  }
);
