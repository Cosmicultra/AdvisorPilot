/**
 * Profile facts card — organizes every intake-captured fact into three
 * labeled sub-sections so nothing the advisor entered during onboarding
 * sits hidden in the JSONB blob:
 *
 *   PERSONAL    age · dob · retirement ages · spouse · household · location · client since
 *   FINANCIAL   AGI · federal bracket · retirement need · social security · goal
 *   RISK        risk profile (+ quiz-suggested subtext if different) · calibration method
 *
 * Sub-sections are rendered only when they have at least one populated
 * fact, so a sparse client doesn't show empty headers.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (Overview tab body).
 */

import type { ClientDetail } from "@/lib/crm/types";
import { OverviewCard } from "./overview-card";

interface Fact {
  label: string;
  value: string;
  hint?: string;
}

const CALIBRATION_LABELS: Record<string, string> = {
  "risk-profile": "Risk profile",
  "age-default": "Age default",
  "income-goal": "Income goal",
  custom: "Custom",
};

export function ProfileFactsCard({ client }: { client: ClientDetail }) {
  const personal = buildPersonal(client);
  const financial = buildFinancial(client);
  const risk = buildRisk(client);

  const isEmpty = personal.length + financial.length + risk.length === 0;

  return (
    <OverviewCard title="Profile facts">
      {isEmpty ? (
        <p className="text-[12.5px]" style={{ color: "var(--ap-gray)" }}>
          Intake is empty for this client.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <FactSection label="Personal" facts={personal} />
          <FactSection label="Financial" facts={financial} />
          <FactSection label="Risk & calibration" facts={risk} />
        </div>
      )}
    </OverviewCard>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────

function FactSection({ label, facts }: { label: string; facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p
        className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--ap-gray)" }}
      >
        {label}
      </p>
      <dl className="grid grid-cols-1 gap-y-2">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="flex items-baseline justify-between gap-4"
          >
            <dt
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--ap-gray)" }}
            >
              {fact.label}
            </dt>
            <dd
              className="flex flex-col items-end text-[12.5px]"
              style={{ color: "var(--ap-navy)" }}
            >
              <span className="text-right">{fact.value}</span>
              {fact.hint ? (
                <span
                  className="text-[10.5px]"
                  style={{ color: "var(--ap-gray)" }}
                >
                  {fact.hint}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─── Field builders ───────────────────────────────────────────────────────

function buildPersonal(client: ClientDetail): Fact[] {
  const intake = client.client;
  const facts: Fact[] = [];

  if (intake.age) facts.push({ label: "Age", value: intake.age });
  if (intake.dob) facts.push({ label: "DOB", value: formatDate(intake.dob) });
  if (intake.retirementAge) {
    facts.push({ label: "Retirement age", value: intake.retirementAge });
  }
  if (intake.married) {
    const spouseName = [intake.spouseFirstName, intake.spouseLastName]
      .filter(Boolean)
      .join(" ");
    facts.push({
      label: "Spouse",
      value: spouseName || "Married",
      hint: intake.spouseAge ? `age ${intake.spouseAge}` : undefined,
    });
    if (intake.spouseRetirementAge) {
      facts.push({
        label: "Spouse retirement age",
        value: intake.spouseRetirementAge,
      });
    }
  }
  if (client.relationshipSummary && !intake.married) {
    facts.push({ label: "Household", value: client.relationshipSummary });
  }
  if (client.householdLabel) {
    facts.push({ label: "Household label", value: client.householdLabel });
  }
  if (client.location) {
    facts.push({ label: "Location", value: client.location });
  }
  if (client.inceptionYear) {
    facts.push({ label: "Client since", value: String(client.inceptionYear) });
  }

  return facts;
}

function buildFinancial(client: ClientDetail): Fact[] {
  const intake = client.client;
  const facts: Fact[] = [];

  if (intake.adjustedGrossIncomeAnnual) {
    facts.push({
      label: "AGI (annual)",
      value: formatCurrencyFromString(intake.adjustedGrossIncomeAnnual),
    });
  }
  if (intake.federalTaxBracket) {
    facts.push({
      label: "Federal bracket",
      value: `${intake.federalTaxBracket}%`,
    });
  }
  if (intake.retirementSpendableIncomeAnnual) {
    facts.push({
      label: "Retirement need",
      value: formatCurrencyFromString(intake.retirementSpendableIncomeAnnual),
    });
  }
  if (intake.takingSocialSecurity && intake.socialSecurityMonthlyClient) {
    facts.push({
      label: "Social Security",
      value: `${formatCurrencyFromString(intake.socialSecurityMonthlyClient)}/mo`,
      hint: "primary client",
    });
  }
  if (intake.takingSocialSecurity && intake.socialSecurityMonthlySpouse) {
    facts.push({
      label: "Social Security",
      value: `${formatCurrencyFromString(intake.socialSecurityMonthlySpouse)}/mo`,
      hint: "spouse",
    });
  }
  if (intake.goal) {
    facts.push({ label: "Goal", value: intake.goal });
  }

  return facts;
}

function buildRisk(client: ClientDetail): Fact[] {
  const intake = client.client;
  const facts: Fact[] = [];

  if (intake.riskProfile) {
    const suggestedDiffers =
      intake.riskProfileSuggested &&
      intake.riskProfileSuggested !== intake.riskProfile;
    facts.push({
      label: "Risk profile",
      value: capitalize(intake.riskProfile.replace(/-/g, " ")),
      hint: suggestedDiffers
        ? `quiz suggested ${capitalize(intake.riskProfileSuggested.replace(/-/g, " "))}`
        : undefined,
    });
  }
  if (intake.calibration) {
    facts.push({
      label: "Calibration",
      value: CALIBRATION_LABELS[intake.calibration] ?? capitalize(intake.calibration),
    });
  }

  return facts;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCurrencyFromString(raw: string): string {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return raw;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
