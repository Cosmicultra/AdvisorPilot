import { accountKeyForHolding } from "@/lib/annuity-contract-types";
import {
  isExternalAccountNumber,
  isUnknownAccountNumber,
  UNKNOWN_ACCOUNT_NUMBER,
} from "@/lib/crm/move-account";
import { financialInstitutionForAccountKey } from "@/lib/crm/account-display";
import {
  financialInstitutionFromHolding,
  normalizeFinancialInstitution,
} from "@/lib/crm/financial-institution";
import { maskAccountNumberDisplay } from "@/lib/mask-account-number";
import type { UiHolding } from "@/lib/saved-review-normalize";
import { normalizeHoldingsForUi } from "@/lib/saved-review-normalize";

/** Holdings with no account key group here — requires manual mapping. */
export const UNLABELED_ACCOUNT_KEY = "__ap_unlabeled__";

export const ADD_AS_NEW_RESOLUTION = "__ap_add_as_new__";

export type AccountMatchStatus = "matched" | "ambiguous" | "new" | "needs_confirmation";

export type AccountMatchResult = {
  extractedKey: string;
  extractedHoldings: UiHolding[];
  status: AccountMatchStatus;
  /** Set when status is `matched`. */
  existingKey?: string;
  /** Existing account keys that share the same normalized identity. */
  candidates: string[];
};

export type AccountRefreshResolution = {
  extractedKey: string;
  /**
   * Existing account key whose holdings are removed before append, or
   * `ADD_AS_NEW_RESOLUTION` to keep existing rows and add extracted as new.
   */
  targetExistingKey: string | typeof ADD_AS_NEW_RESOLUTION;
};

const HYPHENATED_PREFIX = /^((?:[A-Za-z][A-Za-z0-9]*|[A-Za-z0-9]*[A-Za-z]))-/;

/**
 * Comparable identity for account matching: custodian prefix (if any) + last four digits.
 * Bridges masked (`BRK-****-5502`), full (`BRK-9914-5502`), and bare last-four forms.
 */
export function normalizeAccountMatchKey(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (isExternalAccountNumber(s) || isUnknownAccountNumber(s)) return "";

  const digits = s.replace(/\D/g, "");
  if (digits.length < 4) return s.toLowerCase();

  const last4 = digits.slice(-4);
  const hyphenated = s.match(HYPHENATED_PREFIX);
  const prefix = hyphenated ? hyphenated[1].toUpperCase() : "";
  return prefix ? `${prefix}:${last4}` : `:${last4}`;
}

export function groupHoldingsByAccountKey(holdings: UiHolding[]): Map<string, UiHolding[]> {
  const map = new Map<string, UiHolding[]>();
  for (const h of holdings) {
    const key = accountKeyForHolding(h) || UNLABELED_ACCOUNT_KEY;
    const list = map.get(key) ?? [];
    list.push(h);
    map.set(key, list);
  }
  return map;
}

function existingKeysEligibleForMatch(existingGroups: Map<string, UiHolding[]>): string[] {
  return [...existingGroups.keys()].filter(
    (k) =>
      k !== UNLABELED_ACCOUNT_KEY &&
      !isExternalAccountNumber(k) &&
      k !== UNKNOWN_ACCOUNT_NUMBER
  );
}

function buildExistingMatchIndex(existingGroups: Map<string, UiHolding[]>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const key of existingKeysEligibleForMatch(existingGroups)) {
    const mk = normalizeAccountMatchKey(key);
    if (!mk) continue;
    const list = index.get(mk) ?? [];
    list.push(key);
    index.set(mk, list);
  }
  return index;
}

export type MatchExtractedOptions = {
  /** CRM deep-link hint when auto-match fails for a single extracted account. */
  preferredExistingKey?: string;
  /** Prior client holdings — used to disambiguate by financialInstitution. */
  existingHoldings?: UiHolding[];
};

function normalizeInstitutionKey(raw: string | null | undefined): string {
  const n = normalizeFinancialInstitution(raw ?? "");
  return n ? n.toLowerCase() : "";
}

function institutionForExtractedGroup(extractedHoldings: UiHolding[]): string {
  let best: string | null = null;
  let bestValue = -1;
  for (const h of extractedHoldings) {
    const inst = financialInstitutionFromHolding(h);
    if (!inst) continue;
    const v = Number(h.value) || 0;
    if (v >= bestValue) {
      bestValue = v;
      best = inst;
    }
  }
  return normalizeInstitutionKey(best);
}

/** Rank existing account keys by institution match (best first). */
function rankCandidatesByInstitution(
  candidates: string[],
  existing: UiHolding[],
  extractedInstitutionKey: string
): string[] {
  if (!extractedInstitutionKey || candidates.length <= 1) return candidates;

  const scored = candidates.map((key) => {
    const existingKey = normalizeInstitutionKey(
      financialInstitutionForAccountKey(existing, key)
    );
    const match = existingKey === extractedInstitutionKey ? 2 : 0;
    const partial =
      match === 0 &&
      existingKey &&
      extractedInstitutionKey &&
      (existingKey.includes(extractedInstitutionKey) ||
        extractedInstitutionKey.includes(existingKey))
        ? 1
        : 0;
    return { key, score: match + partial };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.key);
}

function pickAmbiguousCandidate(
  candidates: string[],
  existing: UiHolding[],
  extractedHoldings: UiHolding[],
  preferred?: string
): string {
  const extractedInst = institutionForExtractedGroup(extractedHoldings);
  const ranked = rankCandidatesByInstitution(candidates, existing, extractedInst);
  if (extractedInst && ranked.length > 0) {
    const topInst = normalizeInstitutionKey(
      financialInstitutionForAccountKey(existing, ranked[0]!)
    );
    if (topInst === extractedInst) return ranked[0]!;
  }
  if (preferred && ranked.includes(preferred)) return preferred;
  return ranked[0] ?? ADD_AS_NEW_RESOLUTION;
}

/**
 * For each extracted account group, determine how it maps to existing accounts.
 */
export function matchExtractedAccountsToExisting(
  extracted: UiHolding[],
  existing: UiHolding[],
  options: MatchExtractedOptions = {}
): AccountMatchResult[] {
  const extractedGroups = groupHoldingsByAccountKey(extracted);
  const existingGroups = groupHoldingsByAccountKey(existing);
  const matchIndex = buildExistingMatchIndex(existingGroups);
  const eligibleExisting = existingKeysEligibleForMatch(existingGroups);
  const preferred = options.preferredExistingKey?.trim();

  const results: AccountMatchResult[] = [];

  for (const [extractedKey, extractedHoldings] of extractedGroups) {
    if (extractedKey === UNLABELED_ACCOUNT_KEY) {
      results.push({
        extractedKey,
        extractedHoldings,
        status: "needs_confirmation",
        candidates: eligibleExisting,
      });
      continue;
    }

    if (isExternalAccountNumber(extractedKey) || isUnknownAccountNumber(extractedKey)) {
      results.push({
        extractedKey,
        extractedHoldings,
        status: "needs_confirmation",
        candidates: eligibleExisting,
      });
      continue;
    }

    const mk = normalizeAccountMatchKey(extractedKey);
    let candidates = mk ? [...(matchIndex.get(mk) ?? [])] : [];

    if (candidates.length === 0 && preferred && existingGroups.has(preferred)) {
      if (extractedGroups.size === 1) {
        candidates = [preferred];
      }
    }

    if (candidates.length === 1) {
      results.push({
        extractedKey,
        extractedHoldings,
        status: "matched",
        existingKey: candidates[0],
        candidates,
      });
    } else if (candidates.length > 1) {
      results.push({
        extractedKey,
        extractedHoldings,
        status: "ambiguous",
        candidates: rankCandidatesByInstitution(
          candidates,
          existing,
          institutionForExtractedGroup(extractedHoldings)
        ),
      });
    } else {
      results.push({
        extractedKey,
        extractedHoldings,
        status: "new",
        candidates: [],
      });
    }
  }

  return results;
}

export function accountRefreshNeedsConfirmation(results: AccountMatchResult[]): boolean {
  return results.some(
    (r) =>
      r.status === "ambiguous" ||
      r.status === "needs_confirmation" ||
      (r.status === "new" && r.extractedKey !== UNLABELED_ACCOUNT_KEY)
  );
}

/** Default resolutions for auto-merge when no confirmation UI is required. */
export function buildAutoResolutions(results: AccountMatchResult[]): AccountRefreshResolution[] {
  return results.map((r) => {
    if (r.status === "matched" && r.existingKey) {
      return { extractedKey: r.extractedKey, targetExistingKey: r.existingKey };
    }
    return { extractedKey: r.extractedKey, targetExistingKey: ADD_AS_NEW_RESOLUTION };
  });
}

/** Starting resolutions for the confirmation UI (editable by advisor). */
export function buildInitialResolutions(
  results: AccountMatchResult[],
  options: MatchExtractedOptions = {}
): AccountRefreshResolution[] {
  const preferred = options.preferredExistingKey?.trim();
  const existing = options.existingHoldings ?? [];
  return results.map((r) => {
    if (r.status === "matched" && r.existingKey) {
      return { extractedKey: r.extractedKey, targetExistingKey: r.existingKey };
    }
    if (r.status === "ambiguous") {
      const pick = pickAmbiguousCandidate(
        r.candidates,
        existing,
        r.extractedHoldings,
        preferred
      );
      return {
        extractedKey: r.extractedKey,
        targetExistingKey: pick,
      };
    }
    if (r.status === "needs_confirmation") {
      const pick =
        preferred && r.candidates.includes(preferred)
          ? preferred
          : r.candidates[0] ?? ADD_AS_NEW_RESOLUTION;
      return { extractedKey: r.extractedKey, targetExistingKey: pick };
    }
    return { extractedKey: r.extractedKey, targetExistingKey: ADD_AS_NEW_RESOLUTION };
  });
}

function assignAccountKeyOnRows(holdings: UiHolding[], accountKey: string): UiHolding[] {
  const masked = maskAccountNumberDisplay(accountKey) || accountKey;
  return holdings.map((h) => ({
    ...h,
    accountNumber: masked,
  }));
}

/**
 * Replace holdings for resolved existing accounts; keep all other accounts untouched.
 */
export function mergeAccountRefresh(
  existing: UiHolding[],
  extracted: UiHolding[],
  resolutions: AccountRefreshResolution[]
): UiHolding[] {
  const resolutionByExtracted = new Map(
    resolutions.map((r) => [r.extractedKey, r.targetExistingKey] as const)
  );
  const extractedGroups = groupHoldingsByAccountKey(extracted);
  const keysToRemove = new Set<string>();
  const rowsToAdd: UiHolding[] = [];

  for (const [extractedKey, groupHoldings] of extractedGroups) {
    const target = resolutionByExtracted.get(extractedKey) ?? ADD_AS_NEW_RESOLUTION;

    if (target === ADD_AS_NEW_RESOLUTION) {
      rowsToAdd.push(...groupHoldings);
      continue;
    }

    keysToRemove.add(target);
    rowsToAdd.push(...assignAccountKeyOnRows(groupHoldings, target));
  }

  const kept = existing.filter((h) => {
    const key = accountKeyForHolding(h) || UNLABELED_ACCOUNT_KEY;
    return !keysToRemove.has(key);
  });

  return normalizeHoldingsForUi([...kept, ...rowsToAdd]);
}
