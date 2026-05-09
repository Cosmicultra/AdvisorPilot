-- ============================================================================
-- AdvisorPilot firm-wide securities catalog (NASDAQ seed + optional web growth).
-- Requires public.set_advisorpilot_updated_at() from advisorpilot_full_schema_rls.sql.
-- Only server routes using SUPABASE_SERVICE_ROLE_KEY should touch this table.
-- RLS is enabled with no policies for authenticated users; service role bypasses RLS.
-- ============================================================================
--
-- If this table ALREADY exists from a Supabase CSV import, align column NAMES to match
-- App code selects: primary_symbol, holding_name, investment_type, share_class,
-- nasdaq_asset_class, region_scope, source, created_at, updated_at.
--
-- Inspect current names:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='advisorpilot_securities_master';
--
-- Example RENAME FROM the stock CSV headers (identifiers may differ slightly):
--
-- ALTER TABLE public.advisorpilot_securities_master RENAME COLUMN "Ticker Symbols" TO primary_symbol;
-- ALTER TABLE public.advisorpilot_securities_master RENAME COLUMN "Holding Name" TO holding_name;
-- ALTER TABLE public.advisorpilot_securities_master RENAME COLUMN "Investment Type" TO investment_type;
-- ALTER TABLE public.advisorpilot_securities_master RENAME COLUMN "Share Class" TO share_class;
-- ALTER TABLE public.advisorpilot_securities_master RENAME COLUMN "Asset Class" TO nasdaq_asset_class;
-- ALTER TABLE public.advisorpilot_securities_master RENAME COLUMN "Domestic, Foriegn, Global" TO region_scope;
--
-- If there is NO id column yet after import:
-- ALTER TABLE public.advisorpilot_securities_master ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
-- UPDATE advisorpilot_securities_master SET id = gen_random_uuid() WHERE id IS NULL;
-- ALTER TABLE public.advisorpilot_securities_master ALTER COLUMN id SET NOT NULL;
-- ALTER TABLE public.advisorpilot_securities_master ADD PRIMARY KEY (id);
--
-- Optional fuzzy name fallback (defer until needed):
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
--
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.advisorpilot_securities_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_symbol text NOT NULL UNIQUE,
  holding_name text NOT NULL DEFAULT '',
  investment_type text NOT NULL DEFAULT '',
  share_class text NOT NULL DEFAULT '',
  nasdaq_asset_class text NOT NULL DEFAULT '',
  region_scope text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'nasdaq_csv',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advisorpilot_securities_master_holding_lower_idx
  ON public.advisorpilot_securities_master (LOWER(holding_name));

DROP TRIGGER IF EXISTS set_advisorpilot_securities_master_updated_at
  ON public.advisorpilot_securities_master;

CREATE TRIGGER set_advisorpilot_securities_master_updated_at
BEFORE UPDATE ON public.advisorpilot_securities_master
FOR EACH ROW EXECUTE FUNCTION public.set_advisorpilot_updated_at();

ALTER TABLE public.advisorpilot_securities_master ENABLE ROW LEVEL SECURITY;
