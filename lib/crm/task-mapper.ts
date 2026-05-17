/**
 * Mapper from raw advisorpilot_tasks rows → Task shape.
 *
 * Spec: docs/crm/20-technical-specs.md §3.
 */

import type { Task, Visibility } from "./types";

export interface TaskRow {
  id: string;
  owner_email: string;
  owner_user_id: string | null;
  client_id: string | null;
  org_id: string | null;
  visibility: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: string | null;
  status: string | null;
  completed_at: string | null;
  reminder_at: string | null;
  tags: unknown;
  created_at: string;
  updated_at: string;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    clientId: row.client_id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    dueTime: row.due_time,
    priority: normalizePriority(row.priority),
    status: normalizeStatus(row.status),
    completedAt: row.completed_at,
    reminderAt: row.reminder_at,
    tags: normalizeTags(row.tags),
    visibility: isVisibility(row.visibility) ? row.visibility : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isTaskPriority(value: unknown): value is Task["priority"] {
  return value === "High" || value === "Medium" || value === "Low";
}

export function isTaskStatus(value: unknown): value is Task["status"] {
  return (
    value === "open" ||
    value === "in_progress" ||
    value === "done" ||
    value === "cancelled"
  );
}

export function isVisibility(value: unknown): value is Visibility {
  return value === "private" || value === "shared" || value === "organization";
}

function normalizePriority(value: string | null): Task["priority"] {
  return isTaskPriority(value) ? value : "Medium";
}

function normalizeStatus(value: string | null): Task["status"] {
  return isTaskStatus(value) ? value : "open";
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((tag): tag is string => typeof tag === "string");
}
