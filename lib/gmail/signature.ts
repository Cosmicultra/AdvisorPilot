import { createClient } from "@supabase/supabase-js";
import { escapeHtml } from "./mime";

export type AdvisorProfileRecord = {
  email_signature?: string | null;
  calendar_link?: string | null;
  advisor_name?: string | null;
  advisor_title?: string | null;
  advisor_license?: string | null;
  office_address?: string | null;
  office_phone?: string | null;
  cell_phone?: string | null;
  website?: string | null;
  logo_url?: string | null;
  disclosures_text?: string | null;
  disclosures_image_url?: string | null;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

function ensureUrl(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const SIGNATURE_LOGO_IMG_STYLE =
  "max-width:220px;width:100%;height:auto;display:block;border:0;outline:none;text-decoration:none;";
const DISCLOSURES_IMG_STYLE =
  "max-width:480px;width:100%;height:auto;display:block;border:0;outline:none;text-decoration:none;";

export async function getAdvisorProfile(
  ownerEmail: string
): Promise<AdvisorProfileRecord | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key);
  const { data, error } = await supabase
    .from("advisorpilot_advisor_profiles")
    .select("*")
    .eq("owner_email", normalizeEmail(ownerEmail))
    .maybeSingle();

  if (error) {
    console.error("[gmail:signature] profile lookup failed:", error.message);
    return null;
  }
  return (data as AdvisorProfileRecord | null) || null;
}

export function buildPlainSignature(
  profile: AdvisorProfileRecord | null,
  fallbackSignature = "",
  calendarLinkFallback = ""
): string {
  const calendarRaw = clean(profile?.calendar_link) || clean(calendarLinkFallback);
  const calendarUrl = calendarRaw ? ensureUrl(calendarRaw) : "";

  const savedBlock = clean(profile?.email_signature);
  if (savedBlock) {
    if (calendarUrl) {
      const lines = savedBlock.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (/book( a time)? on my calendar\.?$/i.test(trimmed)) {
          return `Book a time on my calendar: ${calendarUrl}`;
        }
        return line;
      });
      if (!lines.some((l) => /Book a time on my calendar:/i.test(l))) {
        lines.push(`Book a time on my calendar: ${calendarUrl}`);
      }
      return lines.join("\n").trim();
    }
    return savedBlock;
  }

  const lines = [
    clean(profile?.advisor_name),
    clean(profile?.advisor_title),
    clean(profile?.advisor_license),
    calendarUrl ? `Book a time on my calendar: ${calendarUrl}` : "",
    clean(profile?.office_address),
    profile?.office_phone ? `Office: ${clean(profile.office_phone)}` : "",
    profile?.cell_phone ? `Cell: ${clean(profile.cell_phone)}` : "",
    clean(profile?.website),
  ].filter(Boolean);

  if (lines.length) return lines.join("\n");
  return clean(fallbackSignature);
}

export function buildHtmlSignature(
  profile: AdvisorProfileRecord | null,
  fallbackSignature = "",
  calendarLinkFallback = ""
): string {
  const savedBlock = clean(profile?.email_signature);
  if (savedBlock) {
    const calendarRaw = clean(profile?.calendar_link) || clean(calendarLinkFallback);
    const calendarUrl = calendarRaw ? ensureUrl(calendarRaw) : "";
    const renderedLines = savedBlock.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<br />";
      if (calendarUrl && /book( a time)? on my calendar\.?$/i.test(trimmed)) {
        return `<a href="${escapeHtml(calendarUrl)}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`;
      }
      return escapeHtml(line);
    });
    if (calendarUrl && !renderedLines.some((l) => l.includes('href="'))) {
      renderedLines.push(
        `<a href="${escapeHtml(calendarUrl)}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`
      );
    }
    return renderedLines.join("<br />");
  }

  if (!profile) {
    return escapeHtml(fallbackSignature || "[Email signature]").replace(/\n/g, "<br />");
  }

  const parts: string[] = [];
  if (profile.advisor_name) parts.push(`<strong>${escapeHtml(profile.advisor_name)}</strong>`);
  if (profile.advisor_title) parts.push(escapeHtml(profile.advisor_title));
  if (profile.advisor_license) parts.push(escapeHtml(profile.advisor_license));
  if (profile.calendar_link) {
    parts.push(
      `<a href="${escapeHtml(ensureUrl(profile.calendar_link))}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`
    );
  } else if (clean(calendarLinkFallback)) {
    parts.push(
      `<a href="${escapeHtml(ensureUrl(calendarLinkFallback))}" style="color:#0f766e;text-decoration:underline;">Book a time on my calendar</a>`
    );
  }
  if (profile.office_address) parts.push(escapeHtml(profile.office_address));
  if (profile.office_phone) parts.push(`Office: ${escapeHtml(profile.office_phone)}`);
  if (profile.cell_phone) parts.push(`Cell: ${escapeHtml(profile.cell_phone)}`);
  if (profile.website) {
    const websiteUrl = ensureUrl(profile.website);
    parts.push(
      `<a href="${escapeHtml(websiteUrl)}" style="color:#0f766e;text-decoration:underline;">${escapeHtml(profile.website)}</a>`
    );
  }
  if (!parts.length) {
    return escapeHtml(fallbackSignature || "[Email signature]").replace(/\n/g, "<br />");
  }
  return parts.join("<br />");
}

export function appendBrandingToHtmlSignature(
  coreHtml: string,
  profile: AdvisorProfileRecord | null
): string {
  if (!profile) return coreHtml;
  const parts: string[] = [coreHtml];
  const logo = clean(profile.logo_url);
  if (logo) {
    parts.push(
      `<div style="margin-top:14px;"><img src="${escapeHtml(logo)}" alt="" width="220" style="${SIGNATURE_LOGO_IMG_STYLE}" /></div>`
    );
  }
  const discText = clean(profile.disclosures_text);
  if (discText) {
    parts.push(
      `<div style="margin-top:14px;font-size:11px;line-height:1.45;color:#64748b;">${escapeHtml(discText).replace(/\r\n|\n|\r/g, "<br />")}</div>`
    );
  }
  const discImg = clean(profile.disclosures_image_url);
  if (discImg) {
    parts.push(
      `<div style="margin-top:10px;"><img src="${escapeHtml(discImg)}" alt="Disclosures" width="480" style="${DISCLOSURES_IMG_STYLE}" /></div>`
    );
  }
  return parts.join("");
}

export function appendBrandingToPlainSignature(
  plain: string,
  profile: AdvisorProfileRecord | null
): string {
  if (!profile) return plain;
  const extra: string[] = [];
  const logo = clean(profile.logo_url);
  if (logo) extra.push(`Logo: ${logo}`);
  const discText = clean(profile.disclosures_text);
  if (discText) extra.push(discText);
  const discImg = clean(profile.disclosures_image_url);
  if (discImg) extra.push(`Disclosures image: ${discImg}`);
  if (!extra.length) return plain;
  return `${plain}\n\n${extra.join("\n\n")}`;
}

export async function buildSignedEmailBodies(
  advisorEmail: string,
  messagePlain: string,
  messageHtmlCore: string
): Promise<{ plainBody: string; htmlBody: string }> {
  const profile = await getAdvisorProfile(advisorEmail);
  const plainSignature = appendBrandingToPlainSignature(
    buildPlainSignature(profile),
    profile
  );
  const htmlSignature = appendBrandingToHtmlSignature(
    buildHtmlSignature(profile),
    profile
  );
  const plainBody = [messagePlain.trim(), "", plainSignature].filter(Boolean).join("\n");
  const htmlBody = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.55;">
      ${messageHtmlCore}
      <div style="margin-top:18px;">${htmlSignature}</div>
    </div>
  `;
  return { plainBody, htmlBody };
}
