/**
 * Per-advisor voice settings persistence — reads and writes the new
 * `advisorpilot_voice_settings` table.
 *
 * NULL semantics across every preference column: "no preference set; use the
 * firm/env default." `voice_disclosed` is intentionally tri-state for
 * compliance audits.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;
function getAdmin(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  return _client;
}

export interface VoiceSettings {
  voiceEnabled: boolean | null;
  voiceModel: string | null;
  voiceName: string | null;
  voiceHotkey: string | null;
  voiceShowCaptions: boolean | null;
  voicePauseOnBlur: boolean | null;
  voiceDisclosed: boolean | null;
  voiceAuditToolCalls: boolean | null;
}

interface DbRow {
  advisor_email: string;
  advisor_user_id: string | null;
  voice_enabled: boolean | null;
  voice_model: string | null;
  voice_name: string | null;
  voice_hotkey: string | null;
  voice_show_captions: boolean | null;
  voice_pause_on_blur: boolean | null;
  voice_disclosed: boolean | null;
  voice_audit_tool_calls: boolean | null;
}

function mapRow(row: DbRow): VoiceSettings {
  return {
    voiceEnabled: row.voice_enabled,
    voiceModel: row.voice_model,
    voiceName: row.voice_name,
    voiceHotkey: row.voice_hotkey,
    voiceShowCaptions: row.voice_show_captions,
    voicePauseOnBlur: row.voice_pause_on_blur,
    voiceDisclosed: row.voice_disclosed,
    voiceAuditToolCalls: row.voice_audit_tool_calls,
  };
}

export const EMPTY_VOICE_SETTINGS: VoiceSettings = {
  voiceEnabled: null,
  voiceModel: null,
  voiceName: null,
  voiceHotkey: null,
  voiceShowCaptions: null,
  voicePauseOnBlur: null,
  voiceDisclosed: null,
  voiceAuditToolCalls: null,
};

export async function getVoiceSettings(
  advisorEmail: string | null | undefined
): Promise<VoiceSettings> {
  if (!advisorEmail) return EMPTY_VOICE_SETTINGS;
  const admin = getAdmin();
  if (!admin) return EMPTY_VOICE_SETTINGS;
  try {
    const { data, error } = await admin
      .from("advisorpilot_voice_settings")
      .select("*")
      .eq("advisor_email", advisorEmail.toLowerCase())
      .maybeSingle();
    if (error || !data) return EMPTY_VOICE_SETTINGS;
    return mapRow(data as DbRow);
  } catch {
    return EMPTY_VOICE_SETTINGS;
  }
}

export async function saveVoiceSettings(
  advisorEmail: string,
  advisorUserId: string | null,
  partial: Partial<VoiceSettings>
): Promise<VoiceSettings> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase admin client unavailable.");

  const payload: Record<string, unknown> = {
    advisor_email: advisorEmail.toLowerCase(),
    advisor_user_id: advisorUserId,
  };
  const mapping: Record<keyof VoiceSettings, string> = {
    voiceEnabled: "voice_enabled",
    voiceModel: "voice_model",
    voiceName: "voice_name",
    voiceHotkey: "voice_hotkey",
    voiceShowCaptions: "voice_show_captions",
    voicePauseOnBlur: "voice_pause_on_blur",
    voiceDisclosed: "voice_disclosed",
    voiceAuditToolCalls: "voice_audit_tool_calls",
  };
  for (const [k, dbKey] of Object.entries(mapping)) {
    const v = partial[k as keyof VoiceSettings];
    if (v !== undefined) payload[dbKey] = v;
  }
  const { data, error } = await admin
    .from("advisorpilot_voice_settings")
    .upsert(payload, { onConflict: "advisor_email" })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to save voice settings: ${error?.message ?? "unknown"}`);
  return mapRow(data as DbRow);
}
