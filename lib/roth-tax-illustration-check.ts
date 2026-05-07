import { FEDERAL_TAX_ILLUSTRATION_REFERENCE } from "@/lib/federal-tax-illustration";

export type RothIllustrationTaxCheckResult = {
  proceed: true;
  /** Always empty today — bracket/deduction updates ship with app releases rather than runtime IRS polling. */
  updatesAppliedToMath: string[];
  messages: string[];
  taxIllustrationReference: string;
};

/**
 * Pre-flight check before running Roth illustration math.
 *
 * Important: AdvisorPilot cannot query the IRS in real time. This step confirms that the illustration
 * will use embedded federal brackets, standard deduction, and IRMAA simplifications from code.
 * Actual law changes are folded in when advisors update AdvisorPilot releases.
 */
export function runRothIllustrationTaxCheck(): RothIllustrationTaxCheckResult {
  return {
    proceed: true,
    updatesAppliedToMath: [],
    messages: [
      "Using embedded federal tax illustration tables (single and MFJ) and standard deductions from AdvisorPilot—not a live IRS request.",
      "If Congress or Treasury updates materially change marginal bands or deductions, AdvisorPilot publishes an app update so those parameters can be refreshed in this library.",
      FEDERAL_TAX_ILLUSTRATION_REFERENCE,
    ],
    taxIllustrationReference: FEDERAL_TAX_ILLUSTRATION_REFERENCE,
  };
}
