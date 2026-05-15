/**
 * Regression coverage for the enrichment-citation bug fix. If this suite
 * passes, the JSON pass cannot inject URLs that weren't returned by the
 * research pass — even if the model invented them.
 */

import { describe, expect, it } from "vitest";
import { filterUrlsToCitations, normalizeUrlForCompare } from "./citation-filter";
import type { Citation } from "./types";

const citation = (uri: string): Citation => ({ uri, sourceType: "web" });

describe("normalizeUrlForCompare", () => {
  it("lowercases hostname and strips trailing slash + fragment", () => {
    expect(normalizeUrlForCompare("https://WWW.SEC.GOV/foo/")).toBe(
      "https://www.sec.gov/foo"
    );
    expect(normalizeUrlForCompare("https://www.sec.gov/foo#section-2")).toBe(
      "https://www.sec.gov/foo"
    );
  });

  it("preserves query strings", () => {
    expect(normalizeUrlForCompare("https://example.com/x?ticker=AGG")).toContain(
      "?ticker=AGG"
    );
  });

  it("falls back to lowercase string for non-URL input", () => {
    expect(normalizeUrlForCompare("Not A URL")).toBe("not a url");
  });
});

describe("filterUrlsToCitations", () => {
  it("keeps URLs that match the citation list", () => {
    const cites = [
      citation("https://sec.gov/cgi-bin/browse-edgar?action=getcompany"),
      citation("https://ishares.com/us/products/239726/"),
    ];
    const result = filterUrlsToCitations(
      [
        "https://ishares.com/us/products/239726",
        "https://sec.gov/cgi-bin/browse-edgar?action=getcompany",
      ],
      cites
    );
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it("drops URLs the model invented from memory", () => {
    const cites = [citation("https://ishares.com/us/products/239726/")];
    const result = filterUrlsToCitations(
      [
        "https://ishares.com/us/products/239726",
        "https://morningstar.com/etfs/arcx/agg/quote", // not in citations
        "https://bogus-domain.invalid/this-is-fake",
      ],
      cites
    );
    expect(result.kept).toEqual(["https://ishares.com/us/products/239726"]);
    expect(result.dropped).toHaveLength(2);
  });

  it("drops EVERYTHING when no research citations were captured", () => {
    const result = filterUrlsToCitations(
      ["https://sec.gov/something", "https://anywhere.com"],
      []
    );
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(2);
  });

  it("treats hostname case + trailing slash + fragment as equivalent", () => {
    // URL paths are case-sensitive per HTTP; only hostname normalization
    // collapses case. Trailing slashes and fragments are equivalence-class
    // noise we strip.
    const cites = [citation("https://Federal.Reserve.gov/releases/h15/")];
    const result = filterUrlsToCitations(
      [
        "https://federal.reserve.gov/releases/h15",
        "https://federal.reserve.gov/releases/h15#january",
      ],
      cites
    );
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it("handles malformed URLs without crashing", () => {
    const cites = [citation("https://valid.example.com/foo")];
    const result = filterUrlsToCitations(["not-a-url", "https://valid.example.com/foo"], cites);
    expect(result.kept).toEqual(["https://valid.example.com/foo"]);
    expect(result.dropped).toEqual(["not-a-url"]);
  });
});
