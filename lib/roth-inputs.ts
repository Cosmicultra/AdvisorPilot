import type { IntakeClient } from "@/lib/intake-config";

export function parseClientAgeForIllustration(client: Partial<IntakeClient> & Record<string, unknown>): number {
  const explicitAge = Number(client.age);
  if (Number.isFinite(explicitAge) && explicitAge > 0) return Math.floor(explicitAge);

  const dob = String(client.dob || "");
  if (!dob) return 62;
  const birth = new Date(`${dob}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return 62;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

export function annualSocialSecurityGrossForIllustration(client: Partial<IntakeClient> & Record<string, unknown>): number {
  const taking = client.takingSocialSecurity === true || String(client.takingSocialSecurity || "").toLowerCase() === "true";
  if (!taking) return 0;

  const clientMonthly = Number(String(client.socialSecurityMonthlyClient ?? "").replace(/[$,]/g, ""));
  const spouseMonthly = Number(String(client.socialSecurityMonthlySpouse ?? "").replace(/[$,]/g, ""));
  const clientAmount = Number.isFinite(clientMonthly) && clientMonthly > 0 ? clientMonthly : 0;
  const married = client.married === true || String(client.married || "").toLowerCase() === "true";
  const spouseAmount = married && Number.isFinite(spouseMonthly) && spouseMonthly > 0 ? spouseMonthly : 0;
  return 12 * (clientAmount + spouseAmount);
}
