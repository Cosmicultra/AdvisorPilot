import { describe, expect, it, vi } from "vitest";
import { emptyFiaWorksheet } from "@/lib/fia-worksheet";
import type { FiaProductTemplate } from "@/lib/fia-product-template-storage";
import {
  extractFiaProductTemplate,
  formatFiaTemplateDisplayName,
  applyFiaProductTemplate,
  applyFiaProductTemplateCarrierProductOnly,
  isFiaProductTemplateSpecComplete,
  loadFiaProductTemplates,
  replaceFiaProductTemplateById,
} from "@/lib/fia-product-template-storage";

const STORAGE_KEY = "advisorpilot:fia-product-templates:v1";

function sampleTemplate(over: Partial<FiaProductTemplate> = {}): FiaProductTemplate {
  return {
    carrierName: "Acme",
    productName: "Growth",
    premiumBonusPct: "5",
    trailingBonusPct: "0",
    trailBonusYears: "",
    contractCapRatePct: "8",
    penaltyFreeWithdrawalPct: "10",
    surrenderYears: "10",
    hasIncomeRider: false,
    incomeBaseBonusPct: "",
    incomeRiderGuaranteePct: "",
    contractEarningsAddToRiderBase: null,
    incomeRiderFeePct: "",
    ...over,
  };
}

describe("fia-product-template-storage", () => {
  it("formats display name as Carrier (Product)", () => {
    expect(formatFiaTemplateDisplayName("Equitrust", "MarketEdge Bonus")).toBe("Equitrust (MarketEdge Bonus)");
  });

  it("extract omits premium fields from worksheet", () => {
    const ws = emptyFiaWorksheet();
    ws.premiumSource = "custom";
    ws.premiumAmount = "999999";
    ws.registrationPremiumOverride = "111";
    ws.carrierName = "Acme";
    ws.productName = "Zen";
    ws.contractCapRatePct = "8";
    const t = extractFiaProductTemplate(ws);
    expect(t.carrierName).toBe("Acme");
    expect(t.productName).toBe("Zen");
    expect(t.contractCapRatePct).toBe("8");
    expect(("premiumAmount" as keyof typeof t) in t).toBe(false);
  });

  it("apply merges product only", () => {
    const ws = emptyFiaWorksheet();
    ws.premiumAmount = "5000";
    ws.carrierName = "Old";
    const tpl = extractFiaProductTemplate(
      Object.assign(emptyFiaWorksheet(), { carrierName: "NewCo", productName: "P1", contractCapRatePct: "10" })
    );
    const next = applyFiaProductTemplate(ws, tpl);
    expect(next.premiumAmount).toBe("5000");
    expect(next.carrierName).toBe("NewCo");
    expect(next.contractCapRatePct).toBe("10");
  });

  it("apply carrier-product only keeps names and clears other specs", () => {
    const ws = emptyFiaWorksheet();
    ws.carrierName = "X";
    ws.productName = "Y";
    ws.contractCapRatePct = "99";
    ws.premiumBonusPct = "7";
    const tpl = sampleTemplate({ carrierName: "KeepC", productName: "KeepP", contractCapRatePct: "3" });
    const next = applyFiaProductTemplateCarrierProductOnly(ws, tpl);
    expect(next.carrierName).toBe("KeepC");
    expect(next.productName).toBe("KeepP");
    expect(next.contractCapRatePct).toBe("");
    expect(next.premiumBonusPct).toBe("");
    expect(next.hasIncomeRider).toBeNull();
  });

  it("isFiaProductTemplateSpecComplete reflects cap, terms, and rider branch", () => {
    expect(isFiaProductTemplateSpecComplete(sampleTemplate())).toBe(true);
    expect(isFiaProductTemplateSpecComplete(sampleTemplate({ contractCapRatePct: "" }))).toBe(false);
    expect(isFiaProductTemplateSpecComplete(sampleTemplate({ hasIncomeRider: true, incomeRiderGuaranteePct: "5" }))).toBe(
      false,
    );
    expect(
      isFiaProductTemplateSpecComplete(
        sampleTemplate({
          hasIncomeRider: true,
          incomeRiderGuaranteePct: "5",
          incomeRiderFeePct: "1",
          contractEarningsAddToRiderBase: false,
        }),
      ),
    ).toBe(true);
    expect(isFiaProductTemplateSpecComplete(sampleTemplate({ trailingBonusPct: "1", trailBonusYears: "" }))).toBe(false);
    expect(isFiaProductTemplateSpecComplete(sampleTemplate({ trailingBonusPct: "1", trailBonusYears: "7" }))).toBe(true);
  });

  it("replaceFiaProductTemplateById updates stored row", () => {
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

    const id = "tid-1";
    const initialTpl = sampleTemplate({ contractCapRatePct: "8" });
    lsState[STORAGE_KEY] = JSON.stringify([
      { id, displayName: "Acme (Growth)", savedAt: "2020-01-01", template: initialTpl },
    ]);

    const updated = sampleTemplate({ contractCapRatePct: "12" });
    const rep = replaceFiaProductTemplateById(id, updated, "Acme (Growth)");
    expect(rep.ok).toBe(true);

    const list = loadFiaProductTemplates();
    expect(list).toHaveLength(1);
    expect(list[0]!.template.contractCapRatePct).toBe("12");

    vi.unstubAllGlobals();
  });
});
