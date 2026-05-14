import { describe, expect, it } from "vitest";
import {
  illustrativeAimeMonthly,
  illustrativeFullRetirementAgeYears,
  illustrativePiaMonthlyAtFra,
  illustrativeSpouseMonthlyMaxOwnOrSpousal,
  illustrativeSsaRetirementBenefitMonthly,
  illustrativeWorkerPiaMonthly,
  parseBirthYearFromIsoDob,
} from "@/lib/social-security-benefit-estimate";

describe("illustrativeWorkerPiaMonthly", () => {
  it("returns PIA from earnings", () => {
    const p = illustrativeWorkerPiaMonthly({ birthYear: 1960, annualCoveredEarnings: 100_000, yearsWorkedCapped35: 35 });
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(1000);
  });
  it("returns null without earnings", () => {
    expect(illustrativeWorkerPiaMonthly({ birthYear: 1960, annualCoveredEarnings: 0, yearsWorkedCapped35: 35 })).toBeNull();
  });
});

describe("illustrativeSpouseMonthlyMaxOwnOrSpousal", () => {
  const workerPia = illustrativeWorkerPiaMonthly({
    birthYear: 1960,
    annualCoveredEarnings: 120_000,
    yearsWorkedCapped35: 35,
  })!;

  it("picks spousal when spouse has no earnings and layer is on", () => {
    const m = illustrativeSpouseMonthlyMaxOwnOrSpousal({
      workerPiaMonthly: workerPia,
      spouseInput: {
        birthYear: 1962,
        annualCoveredEarnings: 0,
        yearsWorkedCapped35: 10,
        benefitStartAge: 67,
      },
      useSpousalLayer: true,
    });
    expect(m).not.toBeNull();
    expect(m!).toBeGreaterThan(1000);
  });

  it("returns null own path when layer off and no earnings", () => {
    const m = illustrativeSpouseMonthlyMaxOwnOrSpousal({
      workerPiaMonthly: workerPia,
      spouseInput: {
        birthYear: 1962,
        annualCoveredEarnings: 0,
        yearsWorkedCapped35: 10,
        benefitStartAge: 67,
      },
      useSpousalLayer: false,
    });
    expect(m).toBeNull();
  });

  it("picks own when higher than spousal", () => {
    const ownHigh = illustrativeSpouseMonthlyMaxOwnOrSpousal({
      workerPiaMonthly: workerPia,
      spouseInput: {
        birthYear: 1962,
        annualCoveredEarnings: 150_000,
        yearsWorkedCapped35: 35,
        benefitStartAge: 67,
      },
      useSpousalLayer: true,
    });
    const ownOnly = illustrativeSsaRetirementBenefitMonthly({
      birthYear: 1962,
      annualCoveredEarnings: 150_000,
      yearsWorkedCapped35: 35,
      benefitStartAge: 67,
    });
    expect(ownHigh).toBe(ownOnly);
  });
});

describe("parseBirthYearFromIsoDob", () => {
  it("parses ISO date", () => {
    expect(parseBirthYearFromIsoDob("1962-03-15")).toBe(1962);
  });
  it("returns null for invalid", () => {
    expect(parseBirthYearFromIsoDob("")).toBeNull();
    expect(parseBirthYearFromIsoDob("03/15/1962")).toBeNull();
  });
});

describe("illustrativeFullRetirementAgeYears", () => {
  it("uses 67 for 1960 and later", () => {
    expect(illustrativeFullRetirementAgeYears(1960)).toBe(67);
    expect(illustrativeFullRetirementAgeYears(1970)).toBe(67);
  });
});

describe("illustrativeSsaRetirementBenefitMonthly", () => {
  it("returns a positive monthly amount for typical inputs", () => {
    const m = illustrativeSsaRetirementBenefitMonthly({
      birthYear: 1962,
      annualCoveredEarnings: 85_000,
      yearsWorkedCapped35: 35,
      benefitStartAge: 67,
    });
    expect(m).not.toBeNull();
    expect(m!).toBeGreaterThan(500);
    expect(m!).toBeLessThan(15_000);
  });

  it("returns null when annual earnings are zero or negative", () => {
    expect(
      illustrativeSsaRetirementBenefitMonthly({
        birthYear: 1962,
        annualCoveredEarnings: 0,
        yearsWorkedCapped35: 35,
        benefitStartAge: 67,
      })
    ).toBeNull();
  });

  it("returns null for invalid earnings", () => {
    expect(
      illustrativeSsaRetirementBenefitMonthly({
        birthYear: 1962,
        annualCoveredEarnings: Number.NaN,
        yearsWorkedCapped35: 35,
        benefitStartAge: 67,
      })
    ).toBeNull();
  });
});

describe("illustrativeAimeMonthly and PIA", () => {
  it("PIA increases with AIME through first bend", () => {
    const aime = illustrativeAimeMonthly(40_000, 35);
    const pia = illustrativePiaMonthlyAtFra(aime);
    expect(pia).toBeGreaterThan(0);
    expect(pia).toBeLessThan(3500);
  });
});
