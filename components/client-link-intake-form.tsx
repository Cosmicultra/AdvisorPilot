"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  computeRiskProfileFromQuiz,
  isRiskQuizComplete,
  RISK_PROFILE_DESCRIPTORS,
  RISK_QUIZ_QUESTIONS,
} from "@/lib/risk-questionnaire";
import {
  FEDERAL_TAX_BRACKET_IDS,
  INTAKE_STEPS,
  type IntakeClient,
} from "@/lib/intake-config";
import type { RiskProfileId } from "@/lib/risk-profiles";
import type { RiskQuizQuestionId } from "@/lib/risk-questionnaire";

type Props = {
  value: IntakeClient;
  onChange: (next: IntakeClient) => void;
};

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-none border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative h-8 w-14 shrink-0 rounded-none transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#0f6fde] ${
          checked ? "bg-teal-600" : "bg-slate-200"
        }`}
      >
        <span
          className={`absolute top-1 left-1 block h-6 w-6 rounded-none bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

const CALIBRATION_CHOICES: { value: string; title: string; desc: string }[] = [
  ["risk-profile", "Use stated risk profile", "Best default once you confirm Question 8."],
  ["age-default", "Run default based on age", "Uses age only; ignores the tier from Question 8."],
  ["income-goal", "Retirement income goal", "Emphasizes income stability for near-retirees."],
  ["custom", "Custom advisor model", "Your advisor can fine-tune allocations after upload."],
].map(([value, title, desc]) => ({ value: String(value), title: String(title), desc: String(desc) }));

export function ClientLinkIntakeForm({ value: c, onChange }: Props) {
  const riskTierSelectValue = useMemo(() => {
    const v = c.riskProfile as RiskProfileId;
    const ok = RISK_PROFILE_DESCRIPTORS.some((x) => x.id === v);
    return ok ? v : "moderate-conservative";
  }, [c.riskProfile]);

  function patch(p: Partial<IntakeClient>) {
    onChange({ ...c, ...p });
  }

  function setRiskFromTier(profile: RiskProfileId) {
    patch({
      riskProfile: profile,
      riskIntakeKnown: "yes",
      riskIntakeScreen: "known",
    });
  }

  function setQuizAnswer(id: RiskQuizQuestionId, optionIndex: number) {
    const nextAnswers = { ...c.riskQuizAnswers, [id]: optionIndex };
    if (!isRiskQuizComplete(nextAnswers)) {
      patch({ riskQuizAnswers: nextAnswers });
      return;
    }
    const { profile } = computeRiskProfileFromQuiz(nextAnswers);
    patch({
      riskQuizAnswers: nextAnswers,
      riskProfile: profile,
      riskProfileSuggested: profile,
      riskIntakeKnown: "no",
      riskIntakeScreen: "result",
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Confirm or fill in each section the same way you would with your advisor. If your advisor entered details already,
        they will appear below. Please correct anything that changed.
      </p>

      {INTAKE_STEPS.map((step) => (
        <section key={step.id} className="rounded-none border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">{step.eyebrow}</p>
          <h3 className="mt-1 font-serif text-lg font-bold text-slate-900">{step.title}</h3>
          {step.helper ? <p className="mt-2 text-sm text-slate-600">{step.helper}</p> : null}

          <div className="mt-4 space-y-4">
            {step.id === "identity" && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-700">First name</label>
                    <Input
                      className="mt-1 h-12 rounded-none"
                      value={c.firstName}
                      onChange={(e) => patch({ firstName: e.target.value })}
                      autoComplete="given-name"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Last name</label>
                    <Input
                      className="mt-1 h-12 rounded-none"
                      value={c.lastName}
                      onChange={(e) => patch({ lastName: e.target.value })}
                      autoComplete="family-name"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Email</label>
                  <Input
                    className="mt-1 h-12 rounded-none"
                    type="email"
                    value={c.advisorEmail}
                    onChange={(e) => patch({ advisorEmail: e.target.value })}
                    placeholder="Reports and updates (optional)"
                    autoComplete="email"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    This stays with your advisor for follow-up. You can leave it blank if unsure.
                  </p>
                </div>
                <SwitchRow
                  label="Married filing jointly (capture spouse)"
                  checked={c.married}
                  onChange={() => {
                    const next = !c.married;
                    if (next) patch({ married: true });
                    else
                      patch({
                        married: false,
                        spouseFirstName: "",
                        spouseLastName: "",
                        spouseDob: "",
                        spouseAge: "",
                        spouseRetirementAge: "",
                      });
                  }}
                />
                {c.married ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Spouse first name</label>
                      <Input
                        className="mt-1 h-12 rounded-none"
                        value={c.spouseFirstName}
                        onChange={(e) => patch({ spouseFirstName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Spouse last name</label>
                      <Input
                        className="mt-1 h-12 rounded-none"
                        value={c.spouseLastName}
                        onChange={(e) => patch({ spouseLastName: e.target.value })}
                      />
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {step.id === "age" && (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Date of birth</label>
                    <Input
                      className="mt-1 h-12 rounded-none"
                      type="date"
                      value={c.dob}
                      onChange={(e) => patch({ dob: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Or age</label>
                    <Input
                      className="mt-1 h-12 rounded-none"
                      type="number"
                      value={c.age}
                      onChange={(e) => patch({ age: e.target.value })}
                      placeholder="62"
                    />
                  </div>
                </div>
                {c.married ? (
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Spouse</p>
                    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-slate-700">Date of birth</label>
                        <Input
                          className="mt-1 h-12 rounded-none"
                          type="date"
                          value={c.spouseDob}
                          onChange={(e) => patch({ spouseDob: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700">Or age</label>
                        <Input
                          className="mt-1 h-12 rounded-none"
                          type="number"
                          value={c.spouseAge}
                          onChange={(e) => patch({ spouseAge: e.target.value })}
                          placeholder="60"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {step.id === "adjustedGrossIncome" && (
              <div>
                <label className="text-xs font-semibold text-slate-700">Adjusted Gross Income (annual)</label>
                <Input
                  className="mt-1 h-12 rounded-none"
                  inputMode="decimal"
                  value={c.adjustedGrossIncomeAnnual}
                  onChange={(e) => patch({ adjustedGrossIncomeAnnual: e.target.value })}
                  placeholder="e.g. 185000"
                />
              </div>
            )}

            {step.id === "taxBracket" && (
              <div>
                <label className="text-xs font-semibold text-slate-700">Marginal federal tax bracket</label>
                <Select
                  value={
                    FEDERAL_TAX_BRACKET_IDS.includes(c.federalTaxBracket as (typeof FEDERAL_TAX_BRACKET_IDS)[number])
                      ? c.federalTaxBracket
                      : "22"
                  }
                  onValueChange={(v) => patch({ federalTaxBracket: v })}
                >
                  <SelectTrigger className="mt-1 h-12 rounded-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FEDERAL_TAX_BRACKET_IDS.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}% bracket
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-slate-500">Illustrative only, not a tax determination.</p>
              </div>
            )}

            {step.id === "retirement" && (
              <>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Expected retirement age (you)</label>
                  <Input
                    className="mt-1 h-12 rounded-none"
                    type="number"
                    value={c.retirementAge}
                    onChange={(e) => patch({ retirementAge: e.target.value })}
                    placeholder="67"
                  />
                </div>
                {c.married ? (
                  <div>
                    <label className="text-xs font-semibold text-slate-700">Expected retirement age (spouse)</label>
                    <Input
                      className="mt-1 h-12 rounded-none"
                      type="number"
                      value={c.spouseRetirementAge}
                      onChange={(e) => patch({ spouseRetirementAge: e.target.value })}
                      placeholder="65"
                    />
                  </div>
                ) : null}
              </>
            )}

            {step.id === "retirementIncome" && (
              <div>
                <label className="text-xs font-semibold text-slate-700">Spendable income needed in retirement (annual)</label>
                <Input
                  className="mt-1 h-12 rounded-none"
                  inputMode="decimal"
                  value={c.retirementSpendableIncomeAnnual}
                  onChange={(e) => patch({ retirementSpendableIncomeAnnual: e.target.value })}
                  placeholder="e.g. 85000"
                />
              </div>
            )}

            {step.id === "socialSecurity" && (
              <>
                <SwitchRow
                  label="Taking Social Security?"
                  checked={c.takingSocialSecurity}
                  onChange={() =>
                    patch(
                      c.takingSocialSecurity
                        ? {
                            takingSocialSecurity: false,
                            socialSecurityMonthlyClient: "",
                            socialSecurityMonthlySpouse: "",
                          }
                        : { takingSocialSecurity: true }
                    )
                  }
                />
                {c.takingSocialSecurity ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">Your monthly benefit</label>
                      <Input
                        className="mt-1 h-12 rounded-none"
                        inputMode="decimal"
                        value={c.socialSecurityMonthlyClient}
                        onChange={(e) => patch({ socialSecurityMonthlyClient: e.target.value })}
                        placeholder="Approximate"
                      />
                    </div>
                    {c.married ? (
                      <div>
                        <label className="text-xs font-semibold text-slate-700">Spouse monthly benefit</label>
                        <Input
                          className="mt-1 h-12 rounded-none"
                          inputMode="decimal"
                          value={c.socialSecurityMonthlySpouse}
                          onChange={(e) => patch({ socialSecurityMonthlySpouse: e.target.value })}
                          placeholder="Approximate"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}

            {step.id === "risk" && (
              <>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Stated risk profile</label>
                  <Select
                    value={riskTierSelectValue}
                    onValueChange={(v) => setRiskFromTier(v as RiskProfileId)}
                  >
                    <SelectTrigger className="mt-1 h-12 rounded-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RISK_PROFILE_DESCRIPTORS.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-slate-500">
                    Choose the tier that fits you, or use the optional questionnaire below for a suggested tier.
                  </p>
                </div>
                <details className="rounded-none border border-slate-100 bg-slate-50/80 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-800">
                    Optional: short risk questionnaire
                  </summary>
                  <p className="mt-2 text-xs text-slate-600">
                    Answering all questions suggests a tier automatically. You can still change the dropdown above.
                  </p>
                  <div className="mt-4 space-y-5">
                    {RISK_QUIZ_QUESTIONS.map((q) => (
                      <div key={q.id}>
                        <p className="text-sm font-medium text-slate-800">{q.prompt}</p>
                        <div className="mt-2 space-y-2">
                          {q.options.map((opt, idx) => (
                            <label
                              key={opt.label}
                              className="flex cursor-pointer items-start gap-2 rounded-none border border-transparent px-2 py-1.5 hover:bg-white"
                            >
                              <input
                                type="radio"
                                className="mt-1"
                                name={`quiz-${q.id}`}
                                checked={c.riskQuizAnswers[q.id] === idx}
                                onChange={() => setQuizAnswer(q.id, idx)}
                              />
                              <span className="text-sm text-slate-700">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}

            {step.id === "calibration" && (
              <div className="grid grid-cols-1 gap-2">
                {CALIBRATION_CHOICES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => patch({ calibration: opt.value })}
                    className={`rounded-none border p-3 text-left text-sm transition ${
                      c.calibration === opt.value
                        ? "border-teal-600 bg-teal-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className="font-semibold text-slate-900">{opt.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-600">{opt.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {step.id === "goal" && (
              <div>
                <label className="text-xs font-semibold text-slate-700">Main goal for this review</label>
                <Textarea
                  className="mt-1 min-h-[100px] rounded-none"
                  value={c.goal}
                  onChange={(e) => patch({ goal: e.target.value })}
                  placeholder="In your own words…"
                />
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
