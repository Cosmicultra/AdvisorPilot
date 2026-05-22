import { describe, expect, it } from "vitest";
import {
  ADD_AS_NEW_RESOLUTION,
  buildAutoResolutions,
  buildInitialResolutions,
  groupHoldingsByAccountKey,
  matchExtractedAccountsToExisting,
  mergeAccountRefresh,
  normalizeAccountMatchKey,
  UNLABELED_ACCOUNT_KEY,
} from "./merge-account-holdings";
import type { UiHolding } from "@/lib/saved-review-normalize";

function holding(
  partial: Partial<UiHolding> & Pick<UiHolding, "rawName" | "suggested" | "value">
): UiHolding {
  return {
    confidence: 90,
    assetClass: "Equity ETF",
    status: "matched",
    options: [],
    ...partial,
  };
}

describe("normalizeAccountMatchKey", () => {
  it("matches masked and full Schwab-style numbers", () => {
    expect(normalizeAccountMatchKey("BRK-9914-5502")).toBe("BRK:5502");
    expect(normalizeAccountMatchKey("BRK-****-5502")).toBe("BRK:5502");
  });

  it("matches bare last-four forms", () => {
    expect(normalizeAccountMatchKey("****5502")).toBe(":5502");
  });

  it("returns empty for external/unknown keys", () => {
    expect(normalizeAccountMatchKey("EXTERNAL:Fidelity")).toBe("");
    expect(normalizeAccountMatchKey("__ap_unknown_account__")).toBe("");
  });
});

describe("matchExtractedAccountsToExisting", () => {
  const existing = [
    holding({ rawName: "A", suggested: "AAPL", value: 100, accountNumber: "BRK-****-1111" }),
    holding({ rawName: "B", suggested: "MSFT", value: 200, accountNumber: "IRA-****-2222" }),
  ];

  it("auto-matches extracted account to existing by normalized key", () => {
    const extracted = [
      holding({ rawName: "C", suggested: "GOOG", value: 300, accountNumber: "BRK-9914-1111" }),
    ];
    const results = matchExtractedAccountsToExisting(extracted, existing);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("matched");
    expect(results[0]?.existingKey).toBe("BRK-****-1111");
  });

  it("marks ambiguous when two existing accounts share match key", () => {
    const existingDup = [
      holding({ rawName: "A", suggested: "AAPL", value: 100, accountNumber: "BRK-****-1111" }),
      holding({ rawName: "B", suggested: "MSFT", value: 200, accountNumber: "IRA-****-2222" }),
      holding({ rawName: "X", suggested: "X", value: 50, accountNumber: "BRK-1111" }),
    ];
    const extracted = [
      holding({ rawName: "C", suggested: "GOOG", value: 300, accountNumber: "BRK-9914-1111" }),
    ];
    const results = matchExtractedAccountsToExisting(extracted, existingDup);
    expect(results[0]?.status).toBe("ambiguous");
    expect(results[0]?.candidates.length).toBeGreaterThan(1);
  });

  it("uses preferredExistingKey when no normalized match", () => {
    const extracted = [
      holding({ rawName: "C", suggested: "GOOG", value: 300, accountNumber: "BRK-****-9999" }),
    ];
    const results = matchExtractedAccountsToExisting(extracted, existing, {
      preferredExistingKey: "IRA-****-2222",
    });
    expect(results[0]?.status).toBe("matched");
    expect(results[0]?.existingKey).toBe("IRA-****-2222");
  });

  it("flags unlabeled extracted groups for confirmation", () => {
    const extracted = [holding({ rawName: "C", suggested: "GOOG", value: 300 })];
    const results = matchExtractedAccountsToExisting(extracted, existing);
    expect(results[0]?.extractedKey).toBe(UNLABELED_ACCOUNT_KEY);
    expect(results[0]?.status).toBe("needs_confirmation");
  });
});

describe("mergeAccountRefresh", () => {
  const existing = [
    holding({ rawName: "A", suggested: "AAPL", value: 100, accountNumber: "BRK-****-1111" }),
    holding({ rawName: "B", suggested: "MSFT", value: 200, accountNumber: "IRA-****-2222" }),
    holding({ rawName: "C", suggested: "GOOG", value: 150, accountNumber: "IRA-****-2222" }),
  ];

  it("replaces one account and keeps others", () => {
    const extracted = [
      holding({ rawName: "A2", suggested: "AAPL", value: 110, accountNumber: "BRK-9914-1111" }),
      holding({ rawName: "A3", suggested: "VTI", value: 90, accountNumber: "BRK-9914-1111" }),
    ];
    const merged = mergeAccountRefresh(existing, extracted, [
      { extractedKey: "BRK-9914-1111", targetExistingKey: "BRK-****-1111" },
    ]);

    const groups = groupHoldingsByAccountKey(merged);
    expect(groups.get("BRK-****-1111")).toHaveLength(2);
    expect(groups.get("IRA-****-2222")).toHaveLength(2);
    expect(merged.reduce((s, h) => s + h.value, 0)).toBe(110 + 90 + 200 + 150);
  });

  it("appends as new account when resolution is ADD_AS_NEW", () => {
    const extracted = [
      holding({ rawName: "N", suggested: "BND", value: 500, accountNumber: "401K-****-3333" }),
    ];
    const merged = mergeAccountRefresh(existing, extracted, [
      { extractedKey: "401K-****-3333", targetExistingKey: ADD_AS_NEW_RESOLUTION },
    ]);
    expect(merged).toHaveLength(4);
    expect(groupHoldingsByAccountKey(merged).has("401K-****-3333")).toBe(true);
  });
});

describe("ambiguous match with financialInstitution", () => {
  it("ranks candidates by institution and prefers institution over preferredExistingKey", () => {
    const existing = [
      holding({
        rawName: "A",
        suggested: "AAPL",
        value: 100,
        accountNumber: "BRK-****-5502",
        financialInstitution: "Schwab",
      }),
      holding({
        rawName: "B",
        suggested: "MSFT",
        value: 200,
        accountNumber: "BRK-5502",
        financialInstitution: "Fidelity",
      }),
    ];
    const extracted = [
      holding({
        rawName: "C",
        suggested: "GOOG",
        value: 300,
        accountNumber: "BRK-9914-5502",
        financialInstitution: "Fidelity",
      }),
    ];
    const results = matchExtractedAccountsToExisting(extracted, existing);
    expect(results[0]?.status).toBe("ambiguous");
    expect(results[0]?.candidates[0]).toBe("BRK-5502");

    const resolutions = buildInitialResolutions(results, {
      preferredExistingKey: "BRK-****-5502",
      existingHoldings: existing,
    });
    expect(resolutions[0]?.targetExistingKey).toBe("BRK-5502");
  });
});

describe("buildAutoResolutions", () => {
  it("maps matched and new statuses", () => {
    const resolutions = buildAutoResolutions([
      {
        extractedKey: "BRK-****-1111",
        extractedHoldings: [],
        status: "matched",
        existingKey: "BRK-****-1111",
        candidates: ["BRK-****-1111"],
      },
      {
        extractedKey: "401K-****-3333",
        extractedHoldings: [],
        status: "new",
        candidates: [],
      },
    ]);
    expect(resolutions[0]?.targetExistingKey).toBe("BRK-****-1111");
    expect(resolutions[1]?.targetExistingKey).toBe(ADD_AS_NEW_RESOLUTION);
  });
});
