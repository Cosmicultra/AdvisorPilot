/**
 * Browser-local FIA product templates (carrier/terms only; no client premium or questionnaire data).
 */

import type { FiaWorksheet } from "@/lib/fia-worksheet";
import { fiaInputValue, parsePct } from "@/lib/fia-worksheet";

/** Product-only fields saved as a reusable template. */
export type FiaProductTemplate = {
  carrierName: string;
  productName: string;
  premiumBonusPct: string;
  trailingBonusPct: string;
  trailBonusYears: string;
  contractCapRatePct: string;
  penaltyFreeWithdrawalPct: string;
  surrenderYears: string;
  hasIncomeRider: boolean | null;
  incomeBaseBonusPct: string;
  incomeRiderGuaranteePct: string;
  contractEarningsAddToRiderBase: boolean | null;
  incomeRiderFeePct: string;
};

export type FiaProductTemplateSaved = {
  id: string;
  displayName: string;
  savedAt: string;
  template: FiaProductTemplate;
};

const STORAGE_KEY = "advisorpilot:fia-product-templates:v1";
const MAX_TEMPLATES = 80;

const EMPTY_PRODUCT_TEMPLATE: FiaProductTemplate = {
  carrierName: "",
  productName: "",
  premiumBonusPct: "",
  trailingBonusPct: "",
  trailBonusYears: "",
  contractCapRatePct: "",
  penaltyFreeWithdrawalPct: "",
  surrenderYears: "",
  hasIncomeRider: null,
  incomeBaseBonusPct: "",
  incomeRiderGuaranteePct: "",
  contractEarningsAddToRiderBase: null,
  incomeRiderFeePct: "",
};

/** Safe string when reading from localStorage JSON. */
function normTemplateStr(raw: unknown, base: string): string {
  if (raw == null) return base;
  const s = String(raw);
  if (s === "undefined" || s === "null") return base;
  return s;
}

/** Human-readable name: "Carrier (Product)". */
export function formatFiaTemplateDisplayName(carrier: string, product: string): string {
  const c = carrier.trim();
  const p = product.trim();
  if (c && p) return `${c} (${p})`;
  if (c) return c;
  if (p) return p;
  return "Untitled product";
}

export function extractFiaProductTemplate(ws: FiaWorksheet): FiaProductTemplate {
  return {
    carrierName: fiaInputValue(ws.carrierName),
    productName: fiaInputValue(ws.productName),
    premiumBonusPct: fiaInputValue(ws.premiumBonusPct),
    trailingBonusPct: fiaInputValue(ws.trailingBonusPct),
    trailBonusYears: fiaInputValue(ws.trailBonusYears),
    contractCapRatePct: fiaInputValue(ws.contractCapRatePct),
    penaltyFreeWithdrawalPct: fiaInputValue(ws.penaltyFreeWithdrawalPct),
    surrenderYears: fiaInputValue(ws.surrenderYears),
    hasIncomeRider: ws.hasIncomeRider ?? null,
    incomeBaseBonusPct: fiaInputValue(ws.incomeBaseBonusPct),
    incomeRiderGuaranteePct: fiaInputValue(ws.incomeRiderGuaranteePct),
    contractEarningsAddToRiderBase: ws.contractEarningsAddToRiderBase ?? null,
    incomeRiderFeePct: fiaInputValue(ws.incomeRiderFeePct),
  };
}

/** Merge template into worksheet; leaves premium / client fields unchanged. */
export function applyFiaProductTemplate(ws: FiaWorksheet, t: FiaProductTemplate): FiaWorksheet {
  return {
    ...ws,
    carrierName: t.carrierName,
    productName: t.productName,
    premiumBonusPct: t.premiumBonusPct,
    trailingBonusPct: t.trailingBonusPct,
    trailBonusYears: t.trailBonusYears,
    contractCapRatePct: t.contractCapRatePct,
    penaltyFreeWithdrawalPct: t.penaltyFreeWithdrawalPct,
    surrenderYears: t.surrenderYears,
    hasIncomeRider: t.hasIncomeRider,
    incomeBaseBonusPct: t.incomeBaseBonusPct,
    incomeRiderGuaranteePct: t.incomeRiderGuaranteePct,
    contractEarningsAddToRiderBase: t.contractEarningsAddToRiderBase,
    incomeRiderFeePct: t.incomeRiderFeePct,
  };
}

/**
 * Load only carrier + product from a template; clears other product specs so the advisor can re-enter them.
 * Premium / client fields are unchanged.
 */
export function applyFiaProductTemplateCarrierProductOnly(ws: FiaWorksheet, t: FiaProductTemplate): FiaWorksheet {
  const blank = EMPTY_PRODUCT_TEMPLATE;
  return {
    ...ws,
    carrierName: t.carrierName,
    productName: t.productName,
    premiumBonusPct: blank.premiumBonusPct,
    trailingBonusPct: blank.trailingBonusPct,
    trailBonusYears: blank.trailBonusYears,
    contractCapRatePct: blank.contractCapRatePct,
    penaltyFreeWithdrawalPct: blank.penaltyFreeWithdrawalPct,
    surrenderYears: blank.surrenderYears,
    hasIncomeRider: blank.hasIncomeRider,
    incomeBaseBonusPct: blank.incomeBaseBonusPct,
    incomeRiderGuaranteePct: blank.incomeRiderGuaranteePct,
    contractEarningsAddToRiderBase: blank.contractEarningsAddToRiderBase,
    incomeRiderFeePct: blank.incomeRiderFeePct,
  };
}

/** True when product-only fields are filled enough to save or run the calculator (cap & core terms; rider details when rider on). */
export function isFiaProductTemplateSpecComplete(t: FiaProductTemplate): boolean {
  if (!String(t.carrierName ?? "").trim() || !String(t.productName ?? "").trim()) return false;
  const cap = parsePct(t.contractCapRatePct);
  if (!(cap > 0)) return false;
  if (!String(t.surrenderYears ?? "").trim()) return false;
  if (!String(t.penaltyFreeWithdrawalPct ?? "").trim()) return false;
  if (!String(t.premiumBonusPct ?? "").trim()) return false;
  const trailPct = parsePct(t.trailingBonusPct);
  if (trailPct > 0 && !String(t.trailBonusYears ?? "").trim()) return false;
  if (t.hasIncomeRider !== true && t.hasIncomeRider !== false) return false;
  if (t.hasIncomeRider === true) {
    if (!String(t.incomeRiderGuaranteePct ?? "").trim()) return false;
    if (!String(t.incomeRiderFeePct ?? "").trim()) return false;
    if (t.contractEarningsAddToRiderBase !== true && t.contractEarningsAddToRiderBase !== false) return false;
  }
  return true;
}

export function replaceFiaProductTemplateById(
  id: string,
  template: FiaProductTemplate,
  displayName?: string
): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: false, error: "Templates save only in the browser." };
  const carrier = template.carrierName.trim();
  const product = template.productName.trim();
  if (!carrier || !product) {
    return { ok: false, error: "Carrier and product name are required." };
  }
  const list = loadFiaProductTemplates();
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) {
    return { ok: false, error: "That template was not found. It may have been removed from this browser." };
  }
  const name = (displayName ?? "").trim() || formatFiaTemplateDisplayName(carrier, product);
  const next = [...list];
  next[idx] = {
    ...next[idx],
    displayName: name,
    savedAt: new Date().toISOString(),
    template: {
      ...template,
      carrierName: carrier,
      productName: product,
    },
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, error: "Could not update template (storage may be full or disabled)." };
  }
  return { ok: true };
}

function parseStoredList(raw: string | null): FiaProductTemplateSaved[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: FiaProductTemplateSaved[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : "";
      const displayName = typeof r.displayName === "string" ? r.displayName : "";
      const savedAt = typeof r.savedAt === "string" ? r.savedAt : "";
      const tpl = r.template && typeof r.template === "object" ? (r.template as Record<string, unknown>) : null;
      if (!id || !tpl) continue;
      const base = EMPTY_PRODUCT_TEMPLATE;
      out.push({
        id,
        displayName: displayName || formatFiaTemplateDisplayName(normTemplateStr(tpl.carrierName, ""), normTemplateStr(tpl.productName, "")),
        savedAt: savedAt || new Date().toISOString(),
        template: {
          carrierName: normTemplateStr(tpl.carrierName, base.carrierName),
          productName: normTemplateStr(tpl.productName, base.productName),
          premiumBonusPct: normTemplateStr(tpl.premiumBonusPct, base.premiumBonusPct),
          trailingBonusPct: normTemplateStr(tpl.trailingBonusPct, base.trailingBonusPct),
          trailBonusYears: normTemplateStr(tpl.trailBonusYears, base.trailBonusYears),
          contractCapRatePct: normTemplateStr(tpl.contractCapRatePct, base.contractCapRatePct),
          penaltyFreeWithdrawalPct: normTemplateStr(tpl.penaltyFreeWithdrawalPct, base.penaltyFreeWithdrawalPct),
          surrenderYears: normTemplateStr(tpl.surrenderYears, base.surrenderYears),
          hasIncomeRider:
            tpl.hasIncomeRider === true ? true : tpl.hasIncomeRider === false ? false : null,
          incomeBaseBonusPct: normTemplateStr(tpl.incomeBaseBonusPct, base.incomeBaseBonusPct),
          incomeRiderGuaranteePct: normTemplateStr(tpl.incomeRiderGuaranteePct, base.incomeRiderGuaranteePct),
          contractEarningsAddToRiderBase:
            tpl.contractEarningsAddToRiderBase === true
              ? true
              : tpl.contractEarningsAddToRiderBase === false
                ? false
                : null,
          incomeRiderFeePct: normTemplateStr(tpl.incomeRiderFeePct, base.incomeRiderFeePct),
        },
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function loadFiaProductTemplates(): FiaProductTemplateSaved[] {
  if (typeof window === "undefined") return [];
  return parseStoredList(window.localStorage.getItem(STORAGE_KEY));
}

export function appendFiaProductTemplate(template: FiaProductTemplate, displayName: string): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: false, error: "Templates save only in the browser." };

  const carrier = template.carrierName.trim();
  const product = template.productName.trim();
  if (!carrier || !product) {
    return { ok: false, error: "Enter carrier and product name before saving a template." };
  }

  const name = displayName.trim() || formatFiaTemplateDisplayName(carrier, product);
  const list = loadFiaProductTemplates();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `fia-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const next: FiaProductTemplateSaved = {
    id,
    displayName: name,
    savedAt: new Date().toISOString(),
    template,
  };

  const merged = [next, ...list].slice(0, MAX_TEMPLATES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    return { ok: false, error: "Could not save template (storage may be full or disabled)." };
  }
  return { ok: true };
}
