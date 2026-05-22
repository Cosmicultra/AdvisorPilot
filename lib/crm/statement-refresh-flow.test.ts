import { describe, expect, it } from "vitest";
import {
  applyAccountRefreshResolutions,
  planAccountRefreshMerge,
} from "./statement-refresh-flow";
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

describe("planAccountRefreshMerge", () => {
  const prior = [
    holding({ rawName: "A", suggested: "AAPL", value: 100, accountNumber: "BRK-****-1111" }),
    holding({ rawName: "B", suggested: "MSFT", value: 200, accountNumber: "IRA-****-2222" }),
    holding({ rawName: "C", suggested: "VTI", value: 300, accountNumber: "401K-****-3333" }),
  ];

  it("auto-merges when extracted account matches existing", () => {
    const extracted = [
      holding({ rawName: "D", suggested: "GOOG", value: 400, accountNumber: "BRK-9914-1111" }),
    ];
    const plan = planAccountRefreshMerge(prior, extracted);
    expect(plan.needsConfirmation).toBe(false);
    expect(plan.mergedHoldings).not.toBeNull();
    expect(plan.mergedHoldings!.some((h) => h.suggested === "GOOG")).toBe(true);
    expect(plan.mergedHoldings!.some((h) => h.suggested === "AAPL")).toBe(false);
    expect(plan.mergedHoldings!.some((h) => h.suggested === "MSFT")).toBe(true);
    expect(plan.mergedHoldings!.some((h) => h.suggested === "VTI")).toBe(true);
  });

  it("leaves untouched accounts when only one account is refreshed", () => {
    const extracted = [
      holding({ rawName: "D", suggested: "GOOG", value: 400, accountNumber: "BRK-9914-1111" }),
    ];
    const merged = applyAccountRefreshResolutions(
      prior,
      extracted,
      planAccountRefreshMerge(prior, extracted).autoResolutions
    );
    const bySymbol = (sym: string) => merged.filter((h) => h.suggested === sym);
    expect(bySymbol("GOOG")).toHaveLength(1);
    expect(bySymbol("MSFT")).toHaveLength(1);
    expect(bySymbol("VTI")).toHaveLength(1);
    expect(bySymbol("AAPL")).toHaveLength(0);
  });
});
