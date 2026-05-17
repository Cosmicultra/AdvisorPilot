/**
 * `reportFiltersToQuery` — pure URL builder shared between the list view
 * and (eventually) deep-link URL persistence. Tested in isolation here
 * so any future tweak to the API contract (status names, sort tokens,
 * etc.) is caught immediately.
 *
 * The reducer-style mapping:
 *   - `status === "active"`     → omitted (server default = draft+published)
 *   - `source === "all"`        → omitted
 *   - `sort   === "created_desc"` → omitted (server default)
 *   - empty/whitespace search   → omitted
 *
 * The omission rules matter — they keep generated URLs short and let the
 * server's defaults stay authoritative.
 */

import { describe, expect, it } from "vitest";
import { reportFiltersToQuery } from "./report-filter-bar";

describe("reportFiltersToQuery", () => {
  it("returns empty params when every filter is at its default", () => {
    const params = reportFiltersToQuery({
      status: "active",
      source: "all",
      sort: "created_desc",
      search: "",
    });
    expect(params.toString()).toBe("");
  });

  it("emits status= for non-default statuses", () => {
    expect(
      reportFiltersToQuery({
        status: "draft",
        source: "all",
        sort: "created_desc",
        search: "",
      }).get("status"),
    ).toBe("draft");

    expect(
      reportFiltersToQuery({
        status: "all",
        source: "all",
        sort: "created_desc",
        search: "",
      }).get("status"),
    ).toBe("all");
  });

  it("emits source= only when not 'all'", () => {
    expect(
      reportFiltersToQuery({
        status: "active",
        source: "ai_generated",
        sort: "created_desc",
        search: "",
      }).get("source"),
    ).toBe("ai_generated");

    expect(
      reportFiltersToQuery({
        status: "active",
        source: "all",
        sort: "created_desc",
        search: "",
      }).has("source"),
    ).toBe(false);
  });

  it("emits sort= only when not 'created_desc'", () => {
    expect(
      reportFiltersToQuery({
        status: "active",
        source: "all",
        sort: "title_asc",
        search: "",
      }).get("sort"),
    ).toBe("title_asc");

    expect(
      reportFiltersToQuery({
        status: "active",
        source: "all",
        sort: "created_desc",
        search: "",
      }).has("sort"),
    ).toBe(false);
  });

  it("emits search= with trimmed value when non-empty", () => {
    expect(
      reportFiltersToQuery({
        status: "active",
        source: "all",
        sort: "created_desc",
        search: "  Q3 review  ",
      }).get("search"),
    ).toBe("Q3 review");
  });

  it("omits search= for empty / whitespace-only values", () => {
    expect(
      reportFiltersToQuery({
        status: "active",
        source: "all",
        sort: "created_desc",
        search: "   ",
      }).has("search"),
    ).toBe(false);
  });

  it("composes multiple non-default filters", () => {
    const params = reportFiltersToQuery({
      status: "published",
      source: "ai_generated",
      sort: "updated_desc",
      search: "Jane",
    });
    expect(params.get("status")).toBe("published");
    expect(params.get("source")).toBe("ai_generated");
    expect(params.get("sort")).toBe("updated_desc");
    expect(params.get("search")).toBe("Jane");
    expect([...params.keys()].sort()).toEqual(["search", "sort", "source", "status"]);
  });
});
