-- =============================================================================
-- AdvisorPilot — apply CRM Phase 3 migrations
--
-- Self-contained — paste into Supabase Dashboard → SQL Editor → Run.
--
-- Phase 3 adds the `query_crm_aggregate` Postgres function (plus four private
-- helpers) that backs the `aggregate` operation of the chat orchestrator's
-- `query_crm` tool. The model can ask "AUM by stage", "tasks by priority",
-- "average client age by risk profile" — and Postgres does the grouping
-- + summation instead of the chat surface pulling all rows to TypeScript.
--
-- Security model (security INVOKER + visibility CTE):
--   - The caller is ALWAYS the service-role chat-tool executor, so RLS is
--     bypassed by design.
--   - Visibility is INJECTED via the per-entity list_visible_* RPC (same
--     functions API routes already use). The aggregate runs over the result
--     of list_visible_clients/tasks/notes/activity — never raw tables.
--   - Per-entity allowlists for `group_by` tokens, aggregate `field` names,
--     and `filters` keys are enforced inside the helper functions. Unknown
--     tokens raise — the security boundary against grouping by / aggregating
--     a column we didn't intend to expose.
--   - All filter VALUES reach SQL via format(%L, ...) (Postgres' built-in
--     literal-quoting). No string interpolation of user-supplied values.
--
-- Idempotent: every function uses CREATE OR REPLACE. Safe to re-run.
--
-- DEPENDENCIES (must already exist from Phase 0/1/2):
--   - list_visible_clients(text), list_visible_tasks(text), list_visible_notes(text)
--   - list_visible_activity(text, uuid, timestamptz, integer)
--   - clients_visible_to(text, uuid)
--   - public.advisorpilot_documents (for the documents branch — uses owner_email
--     + clients_visible_to since there's no list_visible_documents RPC yet)
--
-- Spec: docs/crm/75-database-tools.md §5 (full per-helper rationale).
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  _qcrm_effective_stage(persisted_stage, status, review_due_at,            ║
-- ║                        last_contacted_at, next_meeting_at, inception_year)║
-- ║                                                                           ║
-- ║  Returns the EFFECTIVE lifecycle stage for a client — persisted value     ║
-- ║  when set, otherwise computed via the same rules as                       ║
-- ║  `lib/crm/stage.ts:computeStage()`. Both the groupBy + filter use this    ║
-- ║  so a client whose `stage` column is NULL (the default) but who is        ║
-- ║  computed to be 'Review due' still appears in the right aggregate bucket  ║
-- ║  AND matches a filter `{stage: 'Review due'}`.                            ║
-- ║                                                                           ║
-- ║  STABLE (not IMMUTABLE) because it reads current_date / now().            ║
-- ║                                                                           ║
-- ║  Rules (priority order — matches lib/crm/stage.ts:60-93):                 ║
-- ║    1. status = 'Prospect'                          → 'Prospect'           ║
-- ║    2. review_due_at < today                        → 'Review due'         ║
-- ║    3. review_due_at within next 14d                → 'Upcoming'           ║
-- ║    4. last_contacted_at older than 90d             → 'At risk'            ║
-- ║    5. next_meeting_at within next 14d              → 'Upcoming'           ║
-- ║    6. inception_year within last 90d               → 'Onboarding'         ║
-- ║    7. otherwise                                    → 'Stable'             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public._qcrm_effective_stage(
  persisted_stage text,
  c_status text,
  c_review_due_at timestamptz,
  c_last_contacted_at timestamptz,
  c_next_meeting_at timestamptz,
  c_inception_year integer
)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(persisted_stage, ''),
    case
      when c_status = 'Prospect' then 'Prospect'
      when c_review_due_at is not null and c_review_due_at::date < current_date then 'Review due'
      when c_review_due_at is not null and c_review_due_at::date <= (current_date + interval '14 days')::date then 'Upcoming'
      when c_last_contacted_at is not null and c_last_contacted_at < now() - interval '90 days' then 'At risk'
      when c_next_meeting_at is not null
           and c_next_meeting_at::date >= current_date
           and c_next_meeting_at::date <= (current_date + interval '14 days')::date
        then 'Upcoming'
      when c_inception_year is not null
           and make_date(c_inception_year, 1, 1) <= current_date
           and make_date(c_inception_year, 1, 1) >= (current_date - interval '90 days')::date
        then 'Onboarding'
      else 'Stable'
    end
  );
$$;

grant execute on function public._qcrm_effective_stage(text, text, timestamptz, timestamptz, timestamptz, integer)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  _qcrm_visible_set_sql(viewer_email, entity)                              ║
-- ║                                                                           ║
-- ║  Returns the SQL fragment that yields the visible cohort for one entity.  ║
-- ║  The aggregate function inlines this as a CTE so every downstream filter, ║
-- ║  group-by, and aggregate runs against the visibility-checked set only.    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public._qcrm_visible_set_sql(viewer_email text, entity text)
returns text
language plpgsql immutable
as $$
declare
  v_email_lit text := quote_literal(lower(viewer_email));
begin
  return case entity
    when 'clients'  then format('select * from public.list_visible_clients(%s) src', v_email_lit)
    when 'tasks'    then format('select * from public.list_visible_tasks(%s) src',   v_email_lit)
    when 'notes'    then format('select * from public.list_visible_notes(%s) src',   v_email_lit)
    when 'activity' then format(
      'select * from public.list_visible_activity(%s, null, null, 100000) src',
      v_email_lit)
    when 'documents' then format(
      'select d.* from public.advisorpilot_documents d ' ||
      'where d.owner_email = %s ' ||
      'or (d.client_id is not null and public.clients_visible_to(%s, d.client_id))',
      v_email_lit, v_email_lit)
    else null
  end;
end;
$$;

grant execute on function public._qcrm_visible_set_sql(text, text)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  _qcrm_build_group_expr(entity, group_by)                                 ║
-- ║                                                                           ║
-- ║  Allowlist per entity — known token → SQL expression that yields the      ║
-- ║  bucket. Unknown token raises (the security boundary against grouping     ║
-- ║  by columns we didn't intend to expose).                                  ║
-- ║                                                                           ║
-- ║  Returns 'NULL' for ungrouped (single-bucket) queries.                    ║
-- ║                                                                           ║
-- ║  Note: written with IF/ELSIF instead of nested CASE because plpgsql's     ║
-- ║  CASE expression doesn't allow `raise exception` in branches.             ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public._qcrm_build_group_expr(entity text, group_by text)
returns text
language plpgsql immutable
as $$
begin
  if group_by is null or group_by = '' then
    return 'NULL';
  end if;

  -- ===== clients =====
  if entity = 'clients' then
    -- `stage` groups by the EFFECTIVE stage (persisted column when set,
    -- otherwise computed per lib/crm/stage.ts via _qcrm_effective_stage).
    -- Without this, clients whose stage column is NULL (most of them, since
    -- the column is set manually) all collapse into a single "ALL" bucket.
    if group_by = 'stage'                          then
      return 'public._qcrm_effective_stage(src.stage, src.status, src.review_due_at, src.last_contacted_at, src.next_meeting_at, src.inception_year)';
    end if;
    if group_by = 'status'                         then return 'src.status'; end if;
    if group_by = 'owner_email'                    then return 'src.owner_email'; end if;
    if group_by = 'inception_year'                 then return 'src.inception_year::text'; end if;
    if group_by = 'review_month'                   then return 'to_char(src.review_due_at, ''YYYY-MM'')'; end if;
    if group_by = 'intake.riskProfile'             then return 'src.client ->> ''riskProfile'''; end if;
    if group_by = 'intake.federalTaxBracket'       then return 'src.client ->> ''federalTaxBracket'''; end if;
    if group_by = 'intake.calibration'             then return 'src.client ->> ''calibration'''; end if;
    if group_by = 'intake.married'                 then return '(src.client ->> ''married'')'; end if;
    if group_by = 'intake.takingSocialSecurity'    then return '(src.client ->> ''takingSocialSecurity'')'; end if;
    if group_by = 'analysis.hasRedFlags'           then
      return 'case when src.analysis ? ''redFlags'' and jsonb_array_length(src.analysis -> ''redFlags'') > 0 then ''true'' else ''false'' end';
    end if;
    if group_by = 'analysis.hasAnalysis'           then
      return 'case when src.analysis is not null then ''true'' else ''false'' end';
    end if;
    if group_by = 'holdings.dominant_asset_class'  then
      return '(select h ->> ''assetClass''
               from jsonb_array_elements(src.holdings) h
               group by h ->> ''assetClass''
               order by sum((h ->> ''value'')::numeric) desc nulls last
               limit 1)';
    end if;
    if group_by = 'account_count_bucket'           then
      return 'case
                when (select count(distinct h ->> ''accountNumber'') from jsonb_array_elements(src.holdings) h where h ? ''accountNumber'') = 0 then ''0''
                when (select count(distinct h ->> ''accountNumber'') from jsonb_array_elements(src.holdings) h where h ? ''accountNumber'') = 1 then ''1''
                when (select count(distinct h ->> ''accountNumber'') from jsonb_array_elements(src.holdings) h where h ? ''accountNumber'') <= 3 then ''2-3''
                else ''4+'' end';
    end if;
    raise exception 'query_crm_aggregate: groupBy "%" not allowed for entity "clients"', group_by;
  end if;

  -- ===== tasks =====
  if entity = 'tasks' then
    if group_by = 'status'     then return 'src.status'; end if;
    if group_by = 'priority'   then return 'src.priority'; end if;
    if group_by = 'client_id'  then return 'src.client_id::text'; end if;
    if group_by = 'due_week'   then return 'to_char(src.due_date::date, ''IYYY-IW'')'; end if;
    if group_by = 'is_overdue' then
      return 'case when src.due_date is not null and src.due_date::date < current_date and src.status not in (''done'',''cancelled'') then ''true'' else ''false'' end';
    end if;
    raise exception 'query_crm_aggregate: groupBy "%" not allowed for entity "tasks"', group_by;
  end if;

  -- ===== notes =====
  if entity = 'notes' then
    if group_by = 'client_id'    then return 'src.client_id::text'; end if;
    if group_by = 'source'       then return 'src.source'; end if;
    if group_by = 'pinned'       then return 'src.pinned::text'; end if;
    if group_by = 'created_week' then return 'to_char(src.created_at, ''IYYY-IW'')'; end if;
    if group_by = 'author_email' then return 'src.author_email'; end if;
    raise exception 'query_crm_aggregate: groupBy "%" not allowed for entity "notes"', group_by;
  end if;

  -- ===== activity =====
  if entity = 'activity' then
    if group_by = 'type'           then return 'src.type'; end if;
    if group_by = 'client_id'      then return 'src.client_id::text'; end if;
    if group_by = 'actor_email'    then return 'src.actor_email'; end if;
    if group_by = 'occurred_week'  then return 'to_char(src.occurred_at, ''IYYY-IW'')'; end if;
    if group_by = 'occurred_month' then return 'to_char(src.occurred_at, ''YYYY-MM'')'; end if;
    if group_by = 'source'         then return 'src.source'; end if;
    raise exception 'query_crm_aggregate: groupBy "%" not allowed for entity "activity"', group_by;
  end if;

  -- ===== documents =====
  if entity = 'documents' then
    if group_by = 'source'        then return 'src.source'; end if;
    if group_by = 'client_id'     then return 'src.client_id::text'; end if;
    if group_by = 'status'        then return 'src.status'; end if;
    if group_by = 'mime_type'     then return 'src.mime_type'; end if;
    if group_by = 'created_month' then return 'to_char(src.created_at, ''YYYY-MM'')'; end if;
    raise exception 'query_crm_aggregate: groupBy "%" not allowed for entity "documents"', group_by;
  end if;

  raise exception 'query_crm_aggregate: unknown entity %', entity;
end;
$$;

grant execute on function public._qcrm_build_group_expr(text, text)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  _qcrm_build_aggregate_field_expr(entity, field)                          ║
-- ║                                                                           ║
-- ║  Translates a numeric-field name from the aggregates[] array to the SQL   ║
-- ║  expression that yields the value to aggregate over. Per-entity allowlist;║
-- ║  unknown fields raise.                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public._qcrm_build_aggregate_field_expr(entity text, field text)
returns text
language plpgsql immutable
as $$
begin
  if entity = 'clients' then
    if field = 'total_value'                              then return 'src.total_value'; end if;
    if field = 'ytd_return'                               then return 'src.ytd_return'; end if;
    if field = 'inception_year'                           then return 'src.inception_year'; end if;
    if field = 'intake.age'                               then return '(src.client ->> ''age'')::numeric'; end if;
    if field = 'intake.retirementAge'                     then return '(src.client ->> ''retirementAge'')::numeric'; end if;
    if field = 'intake.adjustedGrossIncomeAnnual'         then return '(src.client ->> ''adjustedGrossIncomeAnnual'')::numeric'; end if;
    if field = 'intake.retirementSpendableIncomeAnnual'   then return '(src.client ->> ''retirementSpendableIncomeAnnual'')::numeric'; end if;
    if field = 'intake.socialSecurityMonthlyClient'       then return '(src.client ->> ''socialSecurityMonthlyClient'')::numeric'; end if;
    if field = 'holdings.totalValue'                      then return '(select sum((h ->> ''value'')::numeric) from jsonb_array_elements(src.holdings) h)'; end if;
    if field = 'holdings.count'                           then return 'jsonb_array_length(src.holdings)'; end if;
    raise exception 'query_crm_aggregate: field "%" not allowed for entity "clients"', field;
  end if;

  if entity = 'tasks' then
    if field = 'days_overdue' then return 'greatest(0, (current_date - src.due_date::date))'; end if;
    raise exception 'query_crm_aggregate: field "%" not allowed for entity "tasks"', field;
  end if;

  -- notes / activity / documents are count-only entities in v1.
  raise exception 'query_crm_aggregate: aggregate field expressions not allowed for entity "%"', entity;
end;
$$;

grant execute on function public._qcrm_build_aggregate_field_expr(text, text)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  _qcrm_build_aggregate_metrics(entity, aggregates)                        ║
-- ║                                                                           ║
-- ║  Compiles the aggregates[] array to a `jsonb_build_object(...)` SELECT    ║
-- ║  expression that yields one jsonb object per bucket.                      ║
-- ║                                                                           ║
-- ║  Defaults to `{"count": count(*)}` when aggregates is empty so a bare     ║
-- ║  `aggregate` call always returns a useful number.                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public._qcrm_build_aggregate_metrics(entity text, aggregates jsonb)
returns text
language plpgsql immutable
as $$
declare
  pair  jsonb;
  fn    text;
  field text;
  alias text;
  fn_sql text;
  parts text[] := '{}'::text[];
begin
  if aggregates is null or jsonb_array_length(aggregates) = 0 then
    -- Default: a single count(*) named "count"
    return 'jsonb_build_object(''count'', count(*))';
  end if;

  if jsonb_array_length(aggregates) > 5 then
    raise exception 'query_crm_aggregate: at most 5 aggregate expressions per call (%)', jsonb_array_length(aggregates);
  end if;

  for pair in select * from jsonb_array_elements(aggregates) loop
    fn    := pair ->> 'fn';
    field := pair ->> 'field';
    alias := pair ->> 'as';

    if alias is null or alias = '' then
      raise exception 'query_crm_aggregate: every aggregate needs an "as" alias';
    end if;
    if fn not in ('count','sum','avg','min','max') then
      raise exception 'query_crm_aggregate: invalid aggregate fn % (must be count|sum|avg|min|max)', fn;
    end if;
    if fn <> 'count' and (field is null or field = '') then
      raise exception 'query_crm_aggregate: aggregate fn % requires "field"', fn;
    end if;

    if fn = 'count' then
      fn_sql := 'count(*)';
    else
      fn_sql := format('%s(%s)', fn, public._qcrm_build_aggregate_field_expr(entity, field));
    end if;

    parts := parts || format('%L, %s', alias, fn_sql);
  end loop;

  return 'jsonb_build_object(' || array_to_string(parts, ', ') || ')';
end;
$$;

grant execute on function public._qcrm_build_aggregate_metrics(text, jsonb)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  _qcrm_build_filter_where(entity, filters)                                ║
-- ║                                                                           ║
-- ║  Compiles per-entity filter map to a `where ... and ...` fragment.        ║
-- ║                                                                           ║
-- ║  Same allowlist pattern as the group-by helper. KEYS are validated        ║
-- ║  against the per-entity allowlist; VALUES are accessed via filters ->>    ║
-- ║  and quoted through format(%L,...) so no user-supplied string ever        ║
-- ║  reaches SQL unquoted.                                                    ║
-- ║                                                                           ║
-- ║  Returns '' (empty string) when there are no filters — callers safely     ║
-- ║  concatenate this into their SELECT.                                      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public._qcrm_build_filter_where(entity text, filters jsonb)
returns text
language plpgsql immutable
as $$
declare
  parts text[] := '{}'::text[];
  k     text;
begin
  if filters is null or filters = '{}'::jsonb then return ''; end if;

  for k in select jsonb_object_keys(filters) loop

    -- ===== clients =====
    if entity = 'clients' then
      -- `stage` filters against the EFFECTIVE stage so a client whose stage
      -- column is NULL but who is computed to be 'Review due' still matches
      -- a filter `{stage: 'Review due'}`. Same helper the groupBy uses.
      if k = 'stage'                 then parts := parts || format(
        'public._qcrm_effective_stage(src.stage, src.status, src.review_due_at, src.last_contacted_at, src.next_meeting_at, src.inception_year) = %L',
        filters ->> 'stage');
      elsif k = 'status'             then parts := parts || format('src.status = %L', filters ->> 'status');
      elsif k = 'ownerEmail'         then parts := parts || format('lower(src.owner_email) = lower(%L)', filters ->> 'ownerEmail');
      elsif k = 'minAum'             then parts := parts || format('src.total_value >= %L::numeric', filters ->> 'minAum');
      elsif k = 'maxAum'             then parts := parts || format('src.total_value <= %L::numeric', filters ->> 'maxAum');
      elsif k = 'reviewDueBefore'    then parts := parts || format('src.review_due_at <= %L::date', filters ->> 'reviewDueBefore');
      elsif k = 'reviewDueAfter'     then parts := parts || format('src.review_due_at >= %L::date', filters ->> 'reviewDueAfter');
      elsif k = 'nextMeetingBefore'  then parts := parts || format('src.next_meeting_at <= %L::timestamptz', filters ->> 'nextMeetingBefore');
      elsif k = 'staleDays'          then parts := parts || format(
        '(src.last_contacted_at is null or src.last_contacted_at < now() - %L::interval)',
        ((filters ->> 'staleDays') || ' days'));
      elsif k = 'inceptionYearMin'   then parts := parts || format('src.inception_year >= %L::int', filters ->> 'inceptionYearMin');
      elsif k = 'inceptionYearMax'   then parts := parts || format('src.inception_year <= %L::int', filters ->> 'inceptionYearMax');
      elsif k = 'married'            then parts := parts || format('(src.client ->> ''married'')::boolean = %L::boolean', filters ->> 'married');
      elsif k = 'takingSocialSecurity' then parts := parts || format('(src.client ->> ''takingSocialSecurity'')::boolean = %L::boolean', filters ->> 'takingSocialSecurity');
      elsif k = 'riskProfile'        then parts := parts || format('src.client ->> ''riskProfile'' = %L', filters ->> 'riskProfile');
      elsif k = 'federalTaxBracket'  then parts := parts || format('src.client ->> ''federalTaxBracket'' = %L', filters ->> 'federalTaxBracket');
      elsif k = 'hasFiaWorksheet'    then
        if (filters ->> 'hasFiaWorksheet')::boolean then
          parts := parts || '(src.client -> ''fiaWorksheet'') is not null';
        else
          parts := parts || '(src.client -> ''fiaWorksheet'') is null';
        end if;
      elsif k = 'hasRothWorksheet'   then
        if (filters ->> 'hasRothWorksheet')::boolean then
          parts := parts || 'src.roth_worksheet is not null';
        else
          parts := parts || 'src.roth_worksheet is null';
        end if;
      elsif k = 'hasAnalysis'        then
        if (filters ->> 'hasAnalysis')::boolean then
          parts := parts || 'src.analysis is not null';
        else
          parts := parts || 'src.analysis is null';
        end if;
      elsif k = 'hasRedFlags'        then
        if (filters ->> 'hasRedFlags')::boolean then
          parts := parts || '(src.analysis ? ''redFlags'') and jsonb_array_length(src.analysis -> ''redFlags'') > 0';
        else
          parts := parts || '(src.analysis is null or not (src.analysis ? ''redFlags'') or jsonb_array_length(src.analysis -> ''redFlags'') = 0)';
        end if;
      elsif k = 'redFlagKeyword'     then parts := parts || format(
        'exists (select 1 from jsonb_array_elements_text(src.analysis -> ''redFlags'') x where x ilike %L)',
        '%' || (filters ->> 'redFlagKeyword') || '%');
      elsif k = 'recommendationKeyword' then parts := parts || format(
        'exists (select 1 from jsonb_array_elements_text(src.analysis -> ''recommendations'') x where x ilike %L)',
        '%' || (filters ->> 'recommendationKeyword') || '%');
      elsif k = 'goalKeyword'        then parts := parts || format('(src.client ->> ''goal'') ilike %L',
        '%' || (filters ->> 'goalKeyword') || '%');
      elsif k = 'holdsTicker'        then parts := parts || format(
        'exists (select 1 from jsonb_array_elements(src.holdings) h where upper(h ->> ''enrichmentResolvedTicker'') = upper(%L))',
        filters ->> 'holdsTicker');
      elsif k = 'holdsAssetClass'    then parts := parts || format(
        'exists (select 1 from jsonb_array_elements(src.holdings) h where h ->> ''assetClass'' = %L)',
        filters ->> 'holdsAssetClass');
      elsif k = 'hasAccountNumber'   then parts := parts || format(
        'exists (select 1 from jsonb_array_elements(src.holdings) h where h ->> ''accountNumber'' = %L)',
        filters ->> 'hasAccountNumber');
      elsif k = 'holdingsNeedReview' then
        if (filters ->> 'holdingsNeedReview')::boolean then
          parts := parts || 'exists (select 1 from jsonb_array_elements(src.holdings) h where (h ->> ''enrichmentNeedsReview'')::boolean = true)';
        else
          parts := parts || 'not exists (select 1 from jsonb_array_elements(src.holdings) h where (h ->> ''enrichmentNeedsReview'')::boolean = true)';
        end if;
      elsif k = 'hasRegistrationType' then parts := parts || format(
        'exists (select 1 from jsonb_array_elements(src.holdings) h where h ->> ''registrationType'' = %L)',
        filters ->> 'hasRegistrationType');
      else
        raise exception 'query_crm_aggregate: filter "%" not allowed for entity "clients"', k;
      end if;

    -- ===== tasks =====
    elsif entity = 'tasks' then
      if k = 'clientId' then
        if jsonb_typeof(filters -> 'clientId') = 'null' then
          parts := parts || 'src.client_id is null';
        else
          parts := parts || format('src.client_id = %L::uuid', filters ->> 'clientId');
        end if;
      elsif k = 'status'     then parts := parts || format('src.status = %L', filters ->> 'status');
      elsif k = 'priority'   then parts := parts || format('src.priority = %L', filters ->> 'priority');
      elsif k = 'ownerEmail' then parts := parts || format('lower(src.owner_email) = lower(%L)', filters ->> 'ownerEmail');
      elsif k = 'dueBefore'  then parts := parts || format('src.due_date::date <= %L::date', filters ->> 'dueBefore');
      elsif k = 'dueAfter'   then parts := parts || format('src.due_date::date >= %L::date', filters ->> 'dueAfter');
      elsif k = 'overdueOnly' then
        if (filters ->> 'overdueOnly')::boolean then
          parts := parts || '(src.due_date::date < current_date and src.status not in (''done'',''cancelled''))';
        end if;
      else
        raise exception 'query_crm_aggregate: filter "%" not allowed for entity "tasks"', k;
      end if;

    -- ===== notes =====
    elsif entity = 'notes' then
      if k = 'clientId'    then parts := parts || format('src.client_id = %L::uuid', filters ->> 'clientId');
      elsif k = 'pinned'   then parts := parts || format('src.pinned = %L::boolean', filters ->> 'pinned');
      elsif k = 'source'   then parts := parts || format('src.source = %L', filters ->> 'source');
      elsif k = 'authorEmail' then parts := parts || format('lower(src.author_email) = lower(%L)', filters ->> 'authorEmail');
      elsif k = 'since'    then parts := parts || format('src.created_at >= %L::timestamptz', filters ->> 'since');
      else
        raise exception 'query_crm_aggregate: filter "%" not allowed for entity "notes"', k;
      end if;

    -- ===== activity =====
    elsif entity = 'activity' then
      if k = 'clientId'  then parts := parts || format('src.client_id = %L::uuid', filters ->> 'clientId');
      elsif k = 'type'   then parts := parts || format('src.type = %L', filters ->> 'type');
      elsif k = 'source' then parts := parts || format('src.source = %L', filters ->> 'source');
      elsif k = 'actorEmail' then parts := parts || format('lower(src.actor_email) = lower(%L)', filters ->> 'actorEmail');
      elsif k = 'since'  then parts := parts || format('src.occurred_at >= %L::timestamptz', filters ->> 'since');
      else
        raise exception 'query_crm_aggregate: filter "%" not allowed for entity "activity"', k;
      end if;

    -- ===== documents =====
    elsif entity = 'documents' then
      if k = 'clientId'  then parts := parts || format('src.client_id = %L::uuid', filters ->> 'clientId');
      elsif k = 'status' then parts := parts || format('src.status = %L', filters ->> 'status');
      elsif k = 'source' then parts := parts || format('src.source = %L', filters ->> 'source');
      elsif k = 'mimeType' then parts := parts || format('src.mime_type = %L', filters ->> 'mimeType');
      elsif k = 'since'  then parts := parts || format('src.created_at >= %L::timestamptz', filters ->> 'since');
      else
        raise exception 'query_crm_aggregate: filter "%" not allowed for entity "documents"', k;
      end if;

    else
      raise exception 'query_crm_aggregate: unknown entity %', entity;
    end if;
  end loop;

  if array_length(parts, 1) is null or array_length(parts, 1) = 0 then return ''; end if;
  return 'where ' || array_to_string(parts, ' and ');
end;
$$;

grant execute on function public._qcrm_build_filter_where(text, jsonb)
  to anon, authenticated, service_role;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  query_crm_aggregate(viewer_email, entity, group_by, aggregates,          ║
-- ║                      filters, limit_n)                                    ║
-- ║                                                                           ║
-- ║  The public entry point. Composes the four helpers into a single SQL     ║
-- ║  statement, executes it, and returns (bucket, metrics) rows.              ║
-- ║                                                                           ║
-- ║  Returns one row per groupBy bucket; ungrouped queries return exactly     ║
-- ║  one row with bucket='ALL'.                                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.query_crm_aggregate(
  viewer_email text,
  entity text,
  group_by text default null,
  aggregates jsonb default '[]'::jsonb,
  filters jsonb default '{}'::jsonb,
  limit_n integer default 1000
)
returns table (bucket text, metrics jsonb)
language plpgsql
stable
security invoker
as $$
declare
  v_visible_cte text;
  v_group_expr  text;
  v_select_aggs text;
  v_where_extra text;
  v_sql         text;
begin
  if entity not in ('clients','tasks','notes','activity','documents') then
    raise exception 'query_crm_aggregate: invalid entity %', entity;
  end if;

  v_visible_cte := public._qcrm_visible_set_sql(viewer_email, entity);
  v_group_expr  := public._qcrm_build_group_expr(entity, group_by);
  v_select_aggs := public._qcrm_build_aggregate_metrics(entity, aggregates);
  v_where_extra := public._qcrm_build_filter_where(entity, filters);

  v_sql := format(
    'with visible as (%s) ' ||
    'select coalesce((%s)::text, ''ALL'') as bucket, %s as metrics ' ||
    'from visible src %s ' ||
    'group by %s ' ||
    'order by 1 nulls last ' ||
    'limit %L::int',
    v_visible_cte,
    v_group_expr,
    v_select_aggs,
    v_where_extra,
    v_group_expr,
    greatest(coalesce(limit_n, 1000), 1)
  );

  return query execute v_sql;
end;
$$;

grant execute on function public.query_crm_aggregate(text, text, text, jsonb, jsonb, integer)
  to anon, authenticated, service_role;


-- =============================================================================
-- DONE. Verify in the Supabase SQL Editor with a few smoke tests:
--
--   -- 1. Bare count of all visible clients
--   select * from public.query_crm_aggregate('you@firm.com', 'clients');
--   -- → bucket=ALL, metrics={"count": N}
--
--   -- 2. AUM by stage
--   select * from public.query_crm_aggregate(
--     'you@firm.com', 'clients', 'stage',
--     '[{"fn":"sum","field":"total_value","as":"aum"},
--       {"fn":"count","as":"n"}]'::jsonb
--   );
--   -- → one row per stage with {"aum": ..., "n": ...}
--
--   -- 3. Tasks by priority, open only
--   select * from public.query_crm_aggregate(
--     'you@firm.com', 'tasks', 'priority',
--     '[]'::jsonb,
--     '{"status":"open"}'::jsonb
--   );
--   -- → one row per priority with {"count": N}
--
--   -- 4. EFFECTIVE-STAGE spot-check — every visible client + their stage:
--   select
--     (c.client ->> 'firstName') || ' ' || (c.client ->> 'lastName') as name,
--     c.stage as persisted,
--     public._qcrm_effective_stage(c.stage, c.status, c.review_due_at, c.last_contacted_at, c.next_meeting_at, c.inception_year) as effective
--   from public.list_visible_clients('you@firm.com') c;
--   -- → "persisted" is mostly NULL; "effective" is one of: Prospect / Review due /
--   --   Upcoming / At risk / Onboarding / Stable. The aggregate buckets MUST
--   --   match the distinct "effective" values.
--
--   -- 5. PATH spot-check — surgical JSONB extraction on a single client:
--   select * from public.query_crm_path(
--     'you@firm.com',
--     'clients',
--     '<client-uuid>',
--     ARRAY['intake.spouseFirstName', 'intake.age', 'analysis.synopsis']
--   );
--   -- → ONE row (id text, extracted jsonb) where extracted =
--   --   { "intake.spouseFirstName": "Jane",
--   --     "intake.age": "62",
--   --     "analysis.synopsis": "Moderate-risk..." }
--   -- The TS helper maps `extracted` → `values` in the LLM-facing response.
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  query_crm_path(viewer_email, entity, id_text, paths)                    ║
-- ║                                                                          ║
-- ║  Surgical JSONB extraction. When the LLM only needs one field from a row ║
-- ║  ("what's Sarah's spouse's first name?"), this returns just the          ║
-- ║  requested paths without marshalling the whole row.                       ║
-- ║                                                                          ║
-- ║  Returns ONE row: (id text, values jsonb) where values is an object      ║
-- ║  mapping each requested path → extracted value. Returns NO rows when      ║
-- ║  the entity row exists but is not visible to the viewer (404 semantics). ║
-- ║                                                                          ║
-- ║  Path syntax (v1 = dotted, no array indexing):                           ║
-- ║    "intake.spouseFirstName"      → row.client ->> 'spouseFirstName'      ║
-- ║    "intake.fiaWorksheet.carrierName" → row.client #>> '{fiaWorksheet,carrierName}' ║
-- ║    "analysis.synopsis"           → row.analysis ->> 'synopsis'           ║
-- ║    "rothWorksheet.fic.carrierName" → row.roth_worksheet #>> '{fic,carrierName}' ║
-- ║    "top.stage"                   → row.stage (any persisted column)      ║
-- ║                                                                          ║
-- ║  Aliases (so the model sees a clean namespace):                          ║
-- ║    intake        ↔ clients.client           (intake JSONB)               ║
-- ║    holdings      ↔ clients.holdings         (the full array — v1.5 adds [N]) ║
-- ║    analysis      ↔ clients.analysis                                       ║
-- ║    rothWorksheet ↔ clients.roth_worksheet                                ║
-- ║    top           ↔ clients (the row itself — top-level columns)          ║
-- ║                                                                          ║
-- ║  Hard cap: at most 25 paths per call to bound prompt-token cost.         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Note: column name is `extracted` (not `values`) because VALUES is a
-- reserved SQL keyword and Postgres rejects it as an unquoted column name.
-- The TS helper maps `extracted` → `values` in the response the model sees,
-- so the LLM-facing shape stays `{id, values: {...}}` which is more
-- intuitive to narrate.
create or replace function public.query_crm_path(
  viewer_email text,
  entity text,
  id_text text,
  paths text[]
)
returns table (id text, extracted jsonb)
language plpgsql
stable
security invoker
as $$
declare
  v_id uuid;
  v_visible boolean;
  v_row jsonb;
  v_aliased jsonb;
  out_obj jsonb := '{}'::jsonb;
  p text;
  v_extracted jsonb;
begin
  -- 1. Validate entity (v1 supports `clients` only; reports comes when the
  --    reports table lands in PR 4-of-the-reports-doc).
  if entity is null or entity <> 'clients' then
    raise exception 'query_crm_path: entity "%" not supported (v1: clients only)', entity;
  end if;

  -- 2. Validate id format. Bad UUIDs return zero rows (404-like) rather than
  --    raising — keeps the tool surface forgiving for the LLM.
  begin
    v_id := id_text::uuid;
  exception when others then
    return;
  end;

  -- 3. Hard cap on path count (cheap; prompt-budget-bound).
  if paths is null or array_length(paths, 1) is null then
    return;
  end if;
  if array_length(paths, 1) > 25 then
    raise exception 'query_crm_path: at most 25 paths per call (got %)', array_length(paths, 1);
  end if;

  -- 4. Visibility gate — same RPC the rest of the CRM uses.
  v_visible := public.clients_visible_to(viewer_email, v_id);
  if not v_visible then
    return; -- 404-like: no rows
  end if;

  -- 5. Fetch the row.
  select to_jsonb(c) into v_row
  from public.advisorpilot_clients c
  where c.id = v_id;
  if v_row is null then
    return;
  end if;

  -- 6. Build the synthetic alias namespace so the model can address the
  --    JSONB columns by intuitive names (intake, analysis, rothWorksheet,
  --    holdings) instead of the underlying snake_case column names.
  v_aliased := jsonb_build_object(
    'intake',        coalesce(v_row -> 'client', 'null'::jsonb),
    'holdings',      coalesce(v_row -> 'holdings', 'null'::jsonb),
    'analysis',      coalesce(v_row -> 'analysis', 'null'::jsonb),
    'rothWorksheet', coalesce(v_row -> 'roth_worksheet', 'null'::jsonb),
    'top',           v_row
  );

  -- 7. Extract each path.
  foreach p in array paths loop
    v_extracted := public._qcrm_extract_path(v_aliased, p);
    out_obj := jsonb_set(out_obj, array[p], v_extracted, true);
  end loop;

  return query select id_text, out_obj;
end;
$$;

grant execute on function public.query_crm_path(text, text, text, text[])
  to anon, authenticated, service_role;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  _qcrm_extract_path(row_data, path)                                      ║
-- ║                                                                          ║
-- ║  Dotted-path extractor used by query_crm_path. Splits the path on '.',   ║
-- ║  navigates the jsonb tree, and returns the value as jsonb (so callers    ║
-- ║  preserve type — strings stay strings, numbers stay numbers).            ║
-- ║                                                                          ║
-- ║  Returns 'null'::jsonb when any segment of the path doesn't exist,       ║
-- ║  rather than raising — the model gets a clear "this field isn't set"     ║
-- ║  signal it can narrate, without crashing the whole tool call.            ║
-- ║                                                                          ║
-- ║  v1 limitation: no array indexing ([0] / [*]). Holdings paths return the ║
-- ║  whole array; the LLM can use query_crm.get for full holdings if needed. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create or replace function public._qcrm_extract_path(row_data jsonb, path text)
returns jsonb
language plpgsql
immutable
as $$
declare
  segments text[];
begin
  if path is null or path = '' then return 'null'::jsonb; end if;
  if row_data is null then return 'null'::jsonb; end if;
  segments := string_to_array(path, '.');
  -- `#>` returns jsonb (or null when any segment is missing). Coerce null
  -- to the jsonb literal 'null' so callers get a uniform jsonb value.
  return coalesce(row_data #> segments, 'null'::jsonb);
end;
$$;

grant execute on function public._qcrm_extract_path(jsonb, text)
  to anon, authenticated, service_role;
