import { describe, expect, it } from "vitest";
import { isReportSource, isReportStatus, toReport, type ReportRow } from "./report-mapper";

/**
 * Report mapper tests.
 *
 *   1. Happy-path mapping of every column
 *   2. Status normalization — unknown → 'draft'
 *   3. Source normalization — unknown → 'ai_generated'
 *   4. Tags array: filters non-strings, tolerates non-array
 *   5. Visibility normalization — unknown → null
 *   6. embedded_media: only valid `image` entries pass through; junk dropped
 *   7. Defaults for icon when null
 *   8. Type guards (isReportStatus, isReportSource)
 */

function baseRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    owner_email: "jane@firm.com",
    owner_user_id: null,
    client_id: null,
    org_id: null,
    visibility: "private",
    title: "Sample Report",
    content: "# Sample\n\nBody text.",
    embedded_media: [],
    icon: "📄",
    color: null,
    status: "draft",
    tags: [],
    source: "ai_generated",
    generated_by_model: null,
    generated_by_provider: null,
    generated_in_conversation_id: null,
    archived_at: null,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    ...overrides,
  };
}

describe("toReport — happy path", () => {
  it("maps every column to the camel-cased Report shape", () => {
    const r = toReport(
      baseRow({
        client_id: "11111111-1111-1111-1111-111111111111",
        title: "Q2 2026 Review",
        content: "## Allocation\n\nUS large-cap: 62%.",
        icon: "📈",
        color: "#163765",
        status: "published",
        tags: ["q2", "review"],
        source: "ai_generated",
        generated_by_model: "gpt-4o",
        generated_by_provider: "openai",
        generated_in_conversation_id: "conv_abc",
        visibility: "shared",
        archived_at: null,
        created_at: "2026-05-15T10:00:00+00:00",
        updated_at: "2026-05-16T10:00:00+00:00",
      }),
    );
    expect(r.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(r.ownerEmail).toBe("jane@firm.com");
    expect(r.clientId).toBe("11111111-1111-1111-1111-111111111111");
    expect(r.title).toBe("Q2 2026 Review");
    expect(r.icon).toBe("📈");
    expect(r.color).toBe("#163765");
    expect(r.status).toBe("published");
    expect(r.source).toBe("ai_generated");
    expect(r.tags).toEqual(["q2", "review"]);
    expect(r.visibility).toBe("shared");
    expect(r.generatedByModel).toBe("gpt-4o");
    expect(r.generatedByProvider).toBe("openai");
    expect(r.generatedInConversationId).toBe("conv_abc");
  });
});

describe("toReport — normalizers", () => {
  it("unknown status → 'draft'", () => {
    const r = toReport(baseRow({ status: "weird-state" }));
    expect(r.status).toBe("draft");
  });

  it("unknown source → 'ai_generated'", () => {
    const r = toReport(baseRow({ source: "scraped-from-twitter" }));
    expect(r.source).toBe("ai_generated");
  });

  it("null status defaults to 'draft'", () => {
    const r = toReport(baseRow({ status: null }));
    expect(r.status).toBe("draft");
  });

  it("null icon defaults to 📄", () => {
    const r = toReport(baseRow({ icon: null }));
    expect(r.icon).toBe("📄");
  });

  it("non-array tags coerces to empty []", () => {
    const r = toReport(baseRow({ tags: "not-an-array" as unknown as ReportRow["tags"] }));
    expect(r.tags).toEqual([]);
  });

  it("tags drops non-string entries", () => {
    const r = toReport(
      baseRow({
        tags: ["valid", 123, null, { x: 1 }, "also-valid"] as unknown as ReportRow["tags"],
      }),
    );
    expect(r.tags).toEqual(["valid", "also-valid"]);
  });

  it("unknown visibility → null", () => {
    const r = toReport(baseRow({ visibility: "public" }));
    expect(r.visibility).toBeNull();
  });
});

describe("toReport — embedded_media", () => {
  it("passes through valid image entries", () => {
    const r = toReport(
      baseRow({
        embedded_media: [
          { type: "image", storagePath: "reports/x/abc.png", caption: "AUM chart", atLine: 5 },
        ],
      }),
    );
    expect(r.embeddedMedia).toEqual([
      { type: "image", storagePath: "reports/x/abc.png", caption: "AUM chart", atLine: 5 },
    ]);
  });

  it("drops entries missing storagePath", () => {
    const r = toReport(
      baseRow({
        embedded_media: [
          { type: "image", caption: "no path" },
          { type: "image", storagePath: "ok.png" },
        ],
      }),
    );
    expect(r.embeddedMedia).toHaveLength(1);
    expect(r.embeddedMedia[0].storagePath).toBe("ok.png");
  });

  it("drops entries with unsupported type (only 'image' in v1)", () => {
    const r = toReport(
      baseRow({
        embedded_media: [
          { type: "video", storagePath: "x.mp4" },
          { type: "image", storagePath: "y.png" },
        ],
      }),
    );
    expect(r.embeddedMedia).toHaveLength(1);
    expect(r.embeddedMedia[0].storagePath).toBe("y.png");
  });

  it("returns [] for null embedded_media", () => {
    const r = toReport(baseRow({ embedded_media: null as unknown as ReportRow["embedded_media"] }));
    expect(r.embeddedMedia).toEqual([]);
  });
});

describe("type guards", () => {
  it("isReportStatus accepts only the three valid values", () => {
    expect(isReportStatus("draft")).toBe(true);
    expect(isReportStatus("published")).toBe(true);
    expect(isReportStatus("archived")).toBe(true);
    expect(isReportStatus("DRAFT")).toBe(false);
    expect(isReportStatus(null)).toBe(false);
  });

  it("isReportSource accepts only the three valid values", () => {
    expect(isReportSource("ai_generated")).toBe(true);
    expect(isReportSource("advisor_authored")).toBe(true);
    expect(isReportSource("imported")).toBe(true);
    expect(isReportSource("scraped")).toBe(false);
  });
});
