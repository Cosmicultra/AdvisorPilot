import type { ClientDripperEnrollment, DripperRun } from "./types";

export interface ClientDripperRow {
  id: string;
  client_id: string;
  template_id: string;
  owner_email: string;
  owner_user_id: string | null;
  enabled: boolean;
  starts_at: string;
  ends_at: string | null;
  frequency_days: number;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DripperRunRow {
  id: string;
  enrollment_id: string;
  client_id: string;
  template_id: string;
  owner_email: string;
  owner_user_id: string | null;
  status: string;
  output_text: string | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  ran_at: string;
  email_status?: string | null;
  email_error?: string | null;
  client_email_to?: string | null;
}

export function toClientDripperEnrollment(row: ClientDripperRow): ClientDripperEnrollment {
  return {
    id: row.id,
    clientId: row.client_id,
    templateId: row.template_id,
    enabled: row.enabled,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    frequencyDays: row.frequency_days,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEmailStatus(value: string | null | undefined): DripperRun["emailStatus"] {
  if (value === "sent" || value === "skipped" || value === "failed") return value;
  return null;
}

export function toDripperRun(row: DripperRunRow): DripperRun {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    clientId: row.client_id,
    templateId: row.template_id,
    status: row.status === "failed" ? "failed" : "success",
    outputText: row.output_text,
    errorMessage: row.error_message,
    provider: row.provider,
    model: row.model,
    ranAt: row.ran_at,
    emailStatus: toEmailStatus(row.email_status),
    emailError: row.email_error ?? null,
    clientEmailTo: row.client_email_to ?? null,
  };
}

export function isDripperTablesMissingError(error: { code?: string; message?: string }): boolean {
  if (error.code === "PGRST204") return true;
  const msg = error.message?.toLowerCase() ?? "";
  return msg.includes("could not find") && msg.includes("advisorpilot_client_drippers");
}
