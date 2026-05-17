import { describe, expect, it } from "vitest";
import {
  CHAT_TOOL_REGISTRY,
  chatToolDefinitionsFromRegistry,
} from "./index";

/**
 * Registry sanity tests.
 *
 *   1. `query_crm` ships in v1 (the only tool in Phase 0).
 *   2. `chatToolDefinitionsFromRegistry()` strips `handler` and preserves
 *      `name + description + parameters` for every entry.
 *   3. The derived definitions have JSON-Schema-compatible parameter shapes.
 *   4. Insertion order is preserved (matters for prompt truncation behavior).
 */

describe("CHAT_TOOL_REGISTRY", () => {
  it("contains query_crm in v1", () => {
    expect(CHAT_TOOL_REGISTRY.has("query_crm")).toBe(true);
    const tool = CHAT_TOOL_REGISTRY.get("query_crm");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("query_crm");
    expect(typeof tool!.handler).toBe("function");
    expect(tool!.description.length).toBeGreaterThan(20);
  });

  it("size matches the entries array (PR 4-7: 9; PR 8: +manage_report = 10; PR 10: +generate_report_content = 11)", () => {
    expect(CHAT_TOOL_REGISTRY.size).toBe(11);
  });

  it("ships all PR 4-10 tool names", () => {
    for (const name of [
      "query_crm",
      "compute",
      "manage_note",
      "manage_task",
      "manage_client",
      "manage_report",
      "generate_report_content",
      "run_analysis",
      "run_fee_analysis",
      "run_enrich_holdings",
      "run_deep_research",
    ]) {
      expect(CHAT_TOOL_REGISTRY.has(name)).toBe(true);
    }
  });
});

describe("chatToolDefinitionsFromRegistry", () => {
  it("strips the handler field and preserves name/description/parameters", () => {
    const defs = chatToolDefinitionsFromRegistry(CHAT_TOOL_REGISTRY);
    expect(defs).toHaveLength(CHAT_TOOL_REGISTRY.size);
    for (const def of defs) {
      expect(def.name).toBeDefined();
      expect(def.description).toBeDefined();
      expect(def.parameters).toBeDefined();
      // Belt-and-suspenders — handler must NEVER leak to the model.
      expect((def as { handler?: unknown }).handler).toBeUndefined();
    }
  });

  it("produces parameters shaped like JSON Schema (type=object + properties + required)", () => {
    const defs = chatToolDefinitionsFromRegistry(CHAT_TOOL_REGISTRY);
    for (const def of defs) {
      expect(def.parameters.type).toBe("object");
      expect(typeof def.parameters.properties).toBe("object");
      // `required` is optional per OpenAI's spec, but every v1 tool sets it.
      expect(Array.isArray(def.parameters.required)).toBe(true);
    }
  });

  it("preserves Map insertion order (matters for prompt truncation)", () => {
    const names = chatToolDefinitionsFromRegistry(CHAT_TOOL_REGISTRY).map((d) => d.name);
    const registryNames = Array.from(CHAT_TOOL_REGISTRY.keys());
    expect(names).toEqual(registryNames);
  });

  it("returns an empty array for an empty registry", () => {
    const empty = new Map();
    expect(chatToolDefinitionsFromRegistry(empty)).toEqual([]);
  });
});
