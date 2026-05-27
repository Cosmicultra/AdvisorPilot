import { describe, expect, it, vi } from "vitest";
import { emptyRothWorksheet } from "@/lib/roth-worksheet";
import {
  appendRothFicProductTemplate,
  applyRothFicProductTemplate,
  applyRothFicProductTemplateCarrierProductOnly,
  extractRothFicProductTemplate,
  formatRothFicTemplateDisplayName,
  isRothFicProductTemplateSpecComplete,
  loadRothFicProductTemplates,
  replaceRothFicProductTemplateById,
} from "@/lib/roth-fic-template-storage";

const STORAGE_KEY = "advisorpilot:roth-fic-product-templates:v1";

function sampleRothFic(over: Partial<ReturnType<typeof extractRothFicProductTemplate>> = {}) {
  return {
    ...emptyRothWorksheet().fic,
    carrierName: "Acme",
    productName: "Roth FIC",
    premiumBonusPct: "5",
    trailingBonusPct: "0",
    trailBonusYears: "",
    contractEstimatedRateOfReturnPct: "6",
    maxTaxRatePct: "22",
    protectInitialInvestment: false,
    penaltyFreeWithdrawalPct: "10",
    surrenderYears: "10",
    ...over,
  };
}

describe("roth-fic-template-storage", () => {
  it("uses separate storage key from FIA templates", () => {
    expect(STORAGE_KEY).not.toContain("fia-product-templates");
    expect(STORAGE_KEY).toContain("roth-fic");
  });

  it("formats display name like FIA helper", () => {
    expect(formatRothFicTemplateDisplayName("A", "B")).toBe("A (B)");
  });

  it("extract and apply round-trip FIC fields", () => {
    const ws = emptyRothWorksheet();
    ws.fic = sampleRothFic({ carrierName: "X" });
    const t = extractRothFicProductTemplate(ws);
    const ws2 = emptyRothWorksheet();
    const next = applyRothFicProductTemplate(ws2, t);
    expect(next.fic.carrierName).toBe("X");
    expect(next.fic.contractEstimatedRateOfReturnPct).toBe("6");
  });

  it("apply fills missing fic string fields from legacy templates", () => {
    const legacyTemplate = sampleRothFic();
    delete (legacyTemplate as Partial<typeof legacyTemplate>).stateTaxPct;
    const next = applyRothFicProductTemplate(emptyRothWorksheet(), legacyTemplate);
    expect(next.fic.stateTaxPct).toBe("");
  });

  it("carrier-product only clears other specs", () => {
    const ws = emptyRothWorksheet();
    ws.fic = sampleRothFic();
    const tpl = sampleRothFic({ carrierName: "NewC", productName: "NewP" });
    const next = applyRothFicProductTemplateCarrierProductOnly(ws, tpl);
    expect(next.fic.carrierName).toBe("NewC");
    expect(next.fic.productName).toBe("NewP");
    expect(next.fic.contractEstimatedRateOfReturnPct).toBe("");
    expect(next.fic.premiumBonusPct).toBe("");
  });

  it("spec complete requires bracket and core FIC fields", () => {
    expect(isRothFicProductTemplateSpecComplete(sampleRothFic())).toBe(true);
    expect(isRothFicProductTemplateSpecComplete(sampleRothFic({ maxTaxRatePct: "99" }))).toBe(false);
    expect(isRothFicProductTemplateSpecComplete(sampleRothFic({ trailingBonusPct: "2", trailBonusYears: "" }))).toBe(
      false
    );
  });

  it("append and replace persist via window.localStorage", () => {
    const lsState: Record<string, string> = {};
    const ls = {
      getItem: (k: string) => lsState[k] ?? null,
      setItem: (k: string, v: string) => {
        lsState[k] = v;
      },
      removeItem: (k: string) => {
        delete lsState[k];
      },
      clear: () => {
        for (const k of Object.keys(lsState)) delete lsState[k];
      },
      key: (i: number) => Object.keys(lsState)[i] ?? null,
      get length() {
        return Object.keys(lsState).length;
      },
    } as Storage;

    vi.stubGlobal("window", { localStorage: ls });

    const tpl = sampleRothFic();
    expect(appendRothFicProductTemplate(tpl, "Roth tpl").ok).toBe(true);
    const list = loadRothFicProductTemplates();
    expect(list).toHaveLength(1);
    const id = list[0]!.id;

    const updated = sampleRothFic({ premiumBonusPct: "7" });
    expect(replaceRothFicProductTemplateById(id, updated).ok).toBe(true);
    expect(loadRothFicProductTemplates()[0]!.template.premiumBonusPct).toBe("7");

    vi.unstubAllGlobals();
  });
});
