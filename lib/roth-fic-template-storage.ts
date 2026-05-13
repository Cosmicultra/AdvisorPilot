/**
 * Browser-local Roth worksheet FIC (fixed indexed contract) product templates.
 * Separate storage key from FIA calculator templates — lists never mix.
 */

import { parsePct } from "@/lib/fia-worksheet";
import { formatFiaTemplateDisplayName } from "@/lib/fia-product-template-storage";
import {
  emptyRothWorksheet,
  federalBracketIdFromWorksheetPct,
  type RothFixedIndexContractFields,
  type RothWorksheet,
} from "@/lib/roth-worksheet";

export type RothFicProductTemplate = RothFixedIndexContractFields;

export type RothFicProductTemplateSaved = {
  id: string;
  displayName: string;
  savedAt: string;
  template: RothFicProductTemplate;
};

const STORAGE_KEY = "advisorpilot:roth-fic-product-templates:v1";
const MAX_TEMPLATES = 80;

/** Same human-readable rule as FIA templates: "Carrier (Product)". */
export const formatRothFicTemplateDisplayName = formatFiaTemplateDisplayName;

function emptyProductFields(): RothFicProductTemplate {
  return { ...emptyRothWorksheet().fic };
}

function normTemplateStr(raw: unknown, base: string): string {
  if (raw == null) return base;
  const s = String(raw);
  if (s === "undefined" || s === "null") return base;
  return s;
}

export function extractRothFicProductTemplate(ws: RothWorksheet): RothFicProductTemplate {
  return { ...ws.fic };
}

export function applyRothFicProductTemplate(ws: RothWorksheet, t: RothFicProductTemplate): RothWorksheet {
  return {
    ...ws,
    fic: { ...t },
  };
}

/** Keep carrier + product; clear other FIC specs so the advisor can re-enter (matches FIA remap flow). */
export function applyRothFicProductTemplateCarrierProductOnly(
  ws: RothWorksheet,
  t: RothFicProductTemplate
): RothWorksheet {
  const blank = emptyProductFields();
  return {
    ...ws,
    fic: {
      ...blank,
      carrierName: String(t.carrierName ?? "").trim(),
      productName: String(t.productName ?? "").trim(),
    },
  };
}

function estimatedReturnParses(t: RothFicProductTemplate): boolean {
  const s = String(t.contractEstimatedRateOfReturnPct ?? "").replace(/%/g, "").trim();
  if (!s) return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0;
}

/** Enough to run Roth illustration with FIC path and to replace a saved template after remap. */
export function isRothFicProductTemplateSpecComplete(t: RothFicProductTemplate): boolean {
  if (!String(t.carrierName ?? "").trim() || !String(t.productName ?? "").trim()) return false;
  if (federalBracketIdFromWorksheetPct(t.maxTaxRatePct) == null) return false;
  if (!estimatedReturnParses(t)) return false;
  if (!String(t.premiumBonusPct ?? "").trim()) return false;
  if (!String(t.surrenderYears ?? "").trim()) return false;
  if (!String(t.penaltyFreeWithdrawalPct ?? "").trim()) return false;
  const trailPct = parsePct(t.trailingBonusPct);
  if (trailPct > 0 && !String(t.trailBonusYears ?? "").trim()) return false;
  return true;
}

export function replaceRothFicProductTemplateById(
  id: string,
  template: RothFicProductTemplate,
  displayName?: string
): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: false, error: "Templates save only in the browser." };
  const carrier = template.carrierName.trim();
  const product = template.productName.trim();
  if (!carrier || !product) {
    return { ok: false, error: "Carrier and product name are required." };
  }
  const list = loadRothFicProductTemplates();
  const idx = list.findIndex((x) => x.id === id);
  if (idx === -1) {
    return { ok: false, error: "That template was not found. It may have been removed from this browser." };
  }
  const name = (displayName ?? "").trim() || formatRothFicTemplateDisplayName(carrier, product);
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

function parseStoredList(raw: string | null): RothFicProductTemplateSaved[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    const out: RothFicProductTemplateSaved[] = [];
    const base = emptyProductFields();
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : "";
      const displayName = typeof r.displayName === "string" ? r.displayName : "";
      const savedAt = typeof r.savedAt === "string" ? r.savedAt : "";
      const tpl = r.template && typeof r.template === "object" ? (r.template as Record<string, unknown>) : null;
      if (!id || !tpl) continue;
      const fic: RothFicProductTemplate = {
        carrierName: normTemplateStr(tpl.carrierName, base.carrierName),
        productName: normTemplateStr(tpl.productName, base.productName),
        premiumBonusPct: normTemplateStr(tpl.premiumBonusPct, base.premiumBonusPct),
        trailingBonusPct: normTemplateStr(tpl.trailingBonusPct, base.trailingBonusPct),
        trailBonusYears: normTemplateStr(tpl.trailBonusYears, base.trailBonusYears),
        contractEstimatedRateOfReturnPct: normTemplateStr(
          tpl.contractEstimatedRateOfReturnPct,
          base.contractEstimatedRateOfReturnPct
        ),
        maxTaxRatePct: normTemplateStr(tpl.maxTaxRatePct, base.maxTaxRatePct),
        protectInitialInvestment: tpl.protectInitialInvestment === true,
        penaltyFreeWithdrawalPct: normTemplateStr(tpl.penaltyFreeWithdrawalPct, base.penaltyFreeWithdrawalPct),
        surrenderYears: normTemplateStr(tpl.surrenderYears, base.surrenderYears),
      };
      out.push({
        id,
        displayName: displayName || formatRothFicTemplateDisplayName(fic.carrierName, fic.productName),
        savedAt: savedAt || new Date().toISOString(),
        template: fic,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function loadRothFicProductTemplates(): RothFicProductTemplateSaved[] {
  if (typeof window === "undefined") return [];
  return parseStoredList(window.localStorage.getItem(STORAGE_KEY));
}

export function appendRothFicProductTemplate(
  template: RothFicProductTemplate,
  displayName: string
): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: false, error: "Templates save only in the browser." };

  const carrier = template.carrierName.trim();
  const product = template.productName.trim();
  if (!carrier || !product) {
    return { ok: false, error: "Enter carrier and product name before saving a template." };
  }

  const name = displayName.trim() || formatRothFicTemplateDisplayName(carrier, product);
  const list = loadRothFicProductTemplates();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `roth-fic-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const next: RothFicProductTemplateSaved = {
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
