import { describe, expect, it } from "vitest";
import { holdingAdvisorReviewBlocking } from "./holding-advisor-review";

describe("holdingAdvisorReviewBlocking", () => {
  it("blocks on low confidence or review status unless advisor confirmed", () => {
    expect(holdingAdvisorReviewBlocking({ confidence: 50, status: "matched" })).toBe(true);
    expect(holdingAdvisorReviewBlocking({ confidence: 80, status: "review" })).toBe(true);
    expect(holdingAdvisorReviewBlocking({ confidence: 80, status: "matched", confirmedMatchOverridesReview: false })).toBe(
      false
    );
  });

  it("clears blocking when advisor sets confirmedMatchOverridesReview", () => {
    expect(holdingAdvisorReviewBlocking({ confidence: 50, status: "review", confirmedMatchOverridesReview: true })).toBe(
      false
    );
  });
});
