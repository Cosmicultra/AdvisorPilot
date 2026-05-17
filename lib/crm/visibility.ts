/**
 * SQL fragment exports for the visibility resolver functions defined in
 * supabase/advisorpilot_rls_helpers.sql.
 *
 * These helpers exist so API routes (Phase 1+) construct WHERE clauses by
 * calling the SAME SQL function that RLS policies use — single source of
 * truth for who-sees-what. Eliminates risk O5 from
 * docs/crm/50-organizations-and-sharing.md §12.
 *
 * Usage (Phase 1+):
 *
 *   import { visibleClientsClause } from "@/lib/crm/visibility";
 *
 *   const { data } = await supabase
 *     .from("advisorpilot_clients")
 *     .select("id, owner_email, ...")
 *     .filter("id", "in", supabase.rpc("clients_visible_to", { ... }));
 *
 * Or as a raw WHERE fragment when using a direct query:
 *
 *   `WHERE ${visibleClientsClause("c.id")}`  →  `WHERE clients_visible_to($1, c.id)`
 *
 * All helpers take the column reference as an argument so the same function
 * works whether the query aliases the table as `c`, `client`, or none.
 */

/**
 * Returns the SQL fragment `clients_visible_to($1, <columnRef>)` for use in
 * WHERE clauses. The `$1` placeholder is the viewer's email — bind it as the
 * first parameter when running the query.
 *
 * @param columnRef - The fully-qualified column reference for the client id
 *                    (e.g. `"c.id"` when the table is aliased as `c`).
 */
export function visibleClientsClause(columnRef: string = "id"): string {
  return `public.clients_visible_to($1, ${columnRef})`;
}

/**
 * Returns the SQL fragment `tasks_visible_to($1, <columnRef>)` for use in
 * WHERE clauses against advisorpilot_tasks.
 */
export function visibleTasksClause(columnRef: string = "id"): string {
  return `public.tasks_visible_to($1, ${columnRef})`;
}

/**
 * Returns the SQL fragment `notes_visible_to($1, <columnRef>)` for use in
 * WHERE clauses against advisorpilot_notes.
 */
export function visibleNotesClause(columnRef: string = "id"): string {
  return `public.notes_visible_to($1, ${columnRef})`;
}

/**
 * Returns the SQL fragment `is_org_admin($1, <columnRef>)` for use in
 * WHERE clauses that gate admin-only writes.
 */
export function isOrgAdminClause(columnRef: string = "org_id"): string {
  return `public.is_org_admin($1, ${columnRef})`;
}
