import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { toActivityEntry, type VisibleActivityRow } from "@/lib/crm/activity-adapter";
import { toNote, type NoteRow } from "@/lib/crm/note-mapper";
import { toTask, type TaskRow } from "@/lib/crm/task-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVITY_LIMIT = 6;
const TASK_LIMIT = 5;
const NOTE_LIMIT = 1;

export const GET = async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in." }, { status: 401 });
    }

    const { id: clientId } = await context.params;
    if (!clientId || !isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid client id." }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    const visibleResult = await supabase.rpc("clients_visible_to", {
      viewer_email: identity.email,
      client_id: clientId,
    });
    if (visibleResult.error) {
      return NextResponse.json({ error: visibleResult.error.message }, { status: 400 });
    }
    if (visibleResult.data !== true) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const [activityResult, tasksResult, notesResult] = await Promise.all([
      supabase.rpc("list_visible_activity", {
        viewer_email: identity.email,
        target_client_id: clientId,
        since_ts: null,
        limit_n: ACTIVITY_LIMIT,
      }),
      supabase.rpc("list_visible_tasks", {
        viewer_email: identity.email,
      }),
      supabase.rpc("list_visible_notes", {
        viewer_email: identity.email,
      }),
    ]);

    if (activityResult.error) {
      return NextResponse.json({ error: activityResult.error.message }, { status: 400 });
    }

    const activity = ((activityResult.data ?? []) as VisibleActivityRow[])
      .slice(0, ACTIVITY_LIMIT)
      .map(toActivityEntry);

    const openTasks = ((tasksResult.data ?? []) as TaskRow[])
      .filter(
        (t) =>
          t.client_id === clientId &&
          (t.status === "open" || t.status === "in_progress")
      )
      .slice(0, TASK_LIMIT)
      .map(toTask);

    const notes = ((notesResult.data ?? []) as NoteRow[])
      .filter((n) => n.client_id === clientId)
      .sort((a, b) => {
        const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        if (pin !== 0) return pin;
        return String(b.created_at).localeCompare(String(a.created_at));
      })
      .slice(0, NOTE_LIMIT)
      .map(toNote);

    return NextResponse.json({
      activity,
      openTasks,
      pinnedNote: notes[0] ?? null,
    });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/clients/[id]/overview error", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load overview bundle.",
      },
      { status: 500 }
    );
  }
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
