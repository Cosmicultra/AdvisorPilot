import { describe, expect, it } from "vitest";
import { emptyFiaWorksheet } from "@/lib/fia-worksheet";
import { emptyRothWorksheet } from "@/lib/roth-worksheet";
import type { IntakeClient } from "@/lib/intake-config";
import type { ClientDetail } from "./types";
import {
  buildAnalysisThemes,
  buildDripperClientContext,
  detectToolsReviewed,
  excerptDripRunOutput,
  excerptText,
  formatRiskAlignment,
  isFiaWorksheetPopulated,
  isRothWorksheetPopulated,
  toDripperEmailContext,
} from "./dripper-context";

function minimalDetail(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: "c1",
    firstName: "Jane",
    lastName: "Doe",
    initials: "JD",
    householdLabel: null,
    stage: "prospect",
    status: null,
    aum: null,
    ytdReturn: null,
    accountsCount: null,
    custodians: [],
    ownerEmail: "adv@firm.com",
    ownerInitials: "AB",
    lastContactedAt: null,
    nextMeetingAt: null,
    reviewDueAt: null,
    isOverdue: false,
    tags: [],
    client: {
      riskProfile: "moderate-conservative",
      riskProfileSuggested: "moderate",
    } as IntakeClient,
    holdings: [],
    analysis: null,
    rothWorksheet: null,
    meetingNotes: "",
    email: null,
    phone: null,
    location: null,
    relationshipSummary: null,
    inceptionYear: null,
    openTaskCount: 0,
    recentNoteCount: 0,
    ...overrides,
  };
}

describe("dripper-context", () => {
  it("detectToolsReviewed flags FIA, Roth, and retirement income", () => {
    const fia = emptyFiaWorksheet();
    fia.carrierName = "Acme";

    const roth = emptyRothWorksheet();
    roth.qualifiedAssetValue = "500000";

    const detail = minimalDetail({
      client: {
        ...minimalDetail().client,
        fiaWorksheet: fia,
        retirementSpendableIncomeAnnual: "80000",
      } as IntakeClient,
      rothWorksheet: roth,
    });

    expect(detectToolsReviewed(detail)).toEqual({
      fia: true,
      roth: true,
      retirementIncome: true,
    });
  });

  it("isFiaWorksheetPopulated is false for empty worksheet", () => {
    expect(isFiaWorksheetPopulated(emptyFiaWorksheet())).toBe(false);
    expect(isFiaWorksheetPopulated(null)).toBe(false);
  });

  it("isRothWorksheetPopulated is true when conversion choice is set", () => {
    const roth = emptyRothWorksheet();
    roth.useEntireQualifiedBalance = true;
    expect(isRothWorksheetPopulated(roth)).toBe(true);
  });

  it("formatRiskAlignment shows stated vs suggested when they differ", () => {
    expect(
      formatRiskAlignment({
        riskProfile: "moderate-conservative",
        riskProfileSuggested: "moderate",
      } as IntakeClient)
    ).toBe("stated: moderate-conservative; suggested: moderate");
  });

  it("formatRiskAlignment returns stated only when suggested matches", () => {
    expect(
      formatRiskAlignment({
        riskProfile: "moderate",
        riskProfileSuggested: "moderate",
      } as IntakeClient)
    ).toBe("stated: moderate");
  });

  it("excerptText strips HTML and truncates", () => {
    expect(excerptText("<p>Hello <b>world</b></p>", 20)).toBe("Hello world");
    expect(excerptDripRunOutput("x".repeat(300)).length).toBeLessThanOrEqual(250);
  });

  it("buildAnalysisThemes truncates arrays", () => {
    const themes = buildAnalysisThemes({
      synopsis: "s",
      strategies: ["a".repeat(100), "b"],
      recommendations: [],
    });
    expect(themes?.strategies[0]?.length).toBeLessThanOrEqual(80);
    expect(themes?.strategies).toHaveLength(2);
  });

  it("buildDripperClientContext includes enriched fields and prior angles", () => {
    const ctx = buildDripperClientContext(minimalDetail({ meetingNotes: "Discussed Roth options." }), {
      recentNotesExcerpts: ["Called last week."],
      recentDripAngles: ["Prior email about scheduling."],
    });
    expect(ctx.toolsReviewed).toEqual({ fia: false, roth: false, retirementIncome: false });
    expect(ctx.riskAlignment).toBe("stated: moderate-conservative; suggested: moderate");
    expect(ctx.meetingNotesExcerpt).toContain("Roth");
    expect(ctx.recentNotesExcerpt).toEqual(["Called last week."]);
    expect(ctx.recentDripAngles).toEqual(["Prior email about scheduling."]);
  });

  it("toDripperEmailContext picks slim email fields", () => {
    const full = buildDripperClientContext(minimalDetail(), {
      recentDripAngles: ["angle one"],
    });
    const slim = toDripperEmailContext(full);
    expect(slim.recentDripAngles).toEqual(["angle one"]);
    expect(slim.riskAlignment).toContain("stated:");
    expect(slim.toolsReviewed).toBeDefined();
  });
});
