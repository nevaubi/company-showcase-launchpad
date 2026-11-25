-- ABS-EE: asset-level data that issuers of asset-backed securities file with the SEC (Form ABS-EE and
-- ABS-EE/A, exhibit EX-102 "asset data file"). Read by scripts/abs-ee.ts; rules in src/lib/abs/AGENTS.md.
--
-- What is stored, and how a row keeps its source:
--   abs_deals            one issuing entity (the trust). deal_id is its SEC CIK as ten digits; a filing
--                        whose only filer is the depositor is keyed "<depositor cik>:<file number>". Its
--                        name and parties are those of its newest loaded filing; `family` is what its
--                        asset files are (their namespace), not the label in a filing header.
--   abs_filings          every ABS-EE / ABS-EE/A found for a deal, with the cover period from its EDGAR
--                        header. A filing is `listed` until its asset file has been read and stored.
--   abs_documents        the filing's documents as its EDGAR index lists them; the asset file that was
--                        read carries the size and SHA-256 of the bytes SEC served.
--   abs_loads            the import ledger: one row per attempt to store a filing's asset file.
--   abs_cmbs_assets      one row per <assets> record of a commercial mortgage file (a loan, or a record
--                        that carries only a property of a multi-property loan).
--   abs_cmbs_properties  one row per <property> block.
--   abs_pool_metrics     figures computed from one asset file (pool totals and breakdowns); `metric`
--                        names a definition in src/lib/abs/metrics.ts and abs_loads.parser its version.
--
-- Values are kept as filed: numbers and dates are stored as the number and date the file states, a field
-- with no column is kept word for word in `extra`, and text that could not be read as its type is kept
-- word for word in `unparsed` (the typed column is then NULL). Nothing is rescaled.
--
-- Revisions are kept, never overwritten. An amendment is its own filing with its own rows. Among the
-- loaded filings of one deal and one cover period, the one SEC accepted last is `is_current` and the
-- others point at it through `superseded_by`.
--
-- Storing is all-or-nothing per filing. Rows are written under a new load (abs_begin_load,
-- abs_put_rows) and become the filing's data only when abs_commit_load has counted them and they match
-- what the reader parsed; until then readers keep seeing the previous committed load, or nothing. An
-- interrupted attempt leaves an open load that the next attempt clears. Readers use the *_live views.
--
-- The whole file can be applied twice: every statement either creates what is missing or replaces a
-- definition with the same one, so it does not matter who applies it, or whether it was applied before.

CREATE TABLE IF NOT EXISTS public.abs_deals (
  deal_id text PRIMARY KEY,
  issuer_cik bigint,
  issuer_name text NOT NULL,
  file_number text,
  family text NOT NULL CHECK (family IN ('cmbs', 'auto_loan', 'auto_lease', 'other')),
  depositor_cik bigint,
  sponsor_cik bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.abs_filings (
  accession text PRIMARY KEY CHECK (accession ~ '^\d{10}-\d{2}-\d{6}$'),
  list_cik bigint NOT NULL,
  form text NOT NULL CHECK (form IN ('ABS-EE', 'ABS-EE/A')),
  filed date NOT NULL,
  accepted_at timestamptz,
  deal_id text REFERENCES public.abs_deals (deal_id),
  period_start date,
  period_end date,
  asset_class text,
  issuer_cik bigint,
  issuer_name text,
  depositor_cik bigint,
  sponsor_cik bigint,
  file_number text,
  header_sha256 text,
  status text NOT NULL DEFAULT 'listed' CHECK (status IN ('listed', 'loaded', 'skipped', 'failed')),
  status_detail text,
  attempts integer NOT NULL DEFAULT 0,
  load_id bigint,
  is_current boolean NOT NULL DEFAULT false,
  superseded_by text REFERENCES public.abs_filings (accession),
  listed_at timestamptz NOT NULL DEFAULT now(),
  loaded_at timestamptz
);
CREATE INDEX IF NOT EXISTS abs_filings_list_idx ON public.abs_filings (list_cik, filed, accession);
CREATE INDEX IF NOT EXISTS abs_filings_deal_idx ON public.abs_filings (deal_id, period_end, accepted_at);
CREATE INDEX IF NOT EXISTS abs_filings_status_idx ON public.abs_filings (status, filed, accession);

CREATE TABLE IF NOT EXISTS public.abs_documents (
  accession text NOT NULL REFERENCES public.abs_filings (accession) ON DELETE CASCADE,
  seq integer NOT NULL,
  doc_type text NOT NULL,
  name text NOT NULL,
  description text,
  url text NOT NULL,
  listed_bytes bigint,
  bytes bigint,
  sha256 text,
  records integer,
  namespace text,
  retrieved_at timestamptz,
  PRIMARY KEY (accession, seq)
);

CREATE TABLE IF NOT EXISTS public.abs_loads (
  load_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  accession text NOT NULL REFERENCES public.abs_filings (accession) ON DELETE CASCADE,
  parser text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'committed', 'abandoned', 'replaced')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  counts jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS abs_loads_one_open ON public.abs_loads (accession) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS abs_loads_one_committed ON public.abs_loads (accession) WHERE status = 'committed';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'abs_filings_load_fk' AND conrelid = 'public.abs_filings'::regclass) THEN
    ALTER TABLE public.abs_filings ADD CONSTRAINT abs_filings_load_fk FOREIGN KEY (load_id) REFERENCES public.abs_loads (load_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.abs_cmbs_assets (
  load_id bigint NOT NULL REFERENCES public.abs_loads (load_id) ON DELETE CASCADE,
  accession text NOT NULL,
  rec integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('loan', 'property', 'other')),
  asset_number text NOT NULL,
  asset_type_number text,
  group_id text,
  period_begin date,
  period_end date,
  originator_name text,
  origination_date date,
  original_loan_amount numeric,
  original_term_months integer,
  maturity_date date,
  original_amortization_months integer,
  original_interest_only_months integer,
  first_payment_date date,
  original_rate numeric,
  securitization_rate numeric,
  rate_type_code text,
  accrual_method_code text,
  lien_position_code text,
  loan_structure_code text,
  payment_type_code text,
  payment_frequency_code text,
  properties_securitization integer,
  properties integer,
  interest_only boolean,
  balloon boolean,
  securitization_balance numeric,
  begin_balance numeric,
  sched_end_balance numeric,
  actual_end_balance numeric,
  period_rate numeric,
  sched_interest numeric,
  sched_principal numeric,
  unsched_principal numeric,
  total_pi_due numeric,
  paid_through_date date,
  payment_status_code text,
  pi_advances_outstanding numeric,
  ti_advances_outstanding numeric,
  other_advances_outstanding numeric,
  non_recoverable boolean,
  asset_added boolean,
  period_modified boolean,
  modified boolean,
  modification_code text,
  last_modification_date date,
  realized_loss numeric,
  liquidation_prepayment_code text,
  liquidation_prepayment_date date,
  workout_strategy_code text,
  special_servicer_transfer_date date,
  master_servicer_return_date date,
  primary_servicer_name text,
  subject_to_demand boolean,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  unparsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (load_id, rec)
);
CREATE INDEX IF NOT EXISTS abs_cmbs_assets_accn_idx ON public.abs_cmbs_assets (accession, asset_number);

CREATE TABLE IF NOT EXISTS public.abs_cmbs_properties (
  load_id bigint NOT NULL REFERENCES public.abs_loads (load_id) ON DELETE CASCADE,
  accession text NOT NULL,
  rec integer NOT NULL,
  seq integer NOT NULL,
  asset_number text NOT NULL,
  loan_asset_number text NOT NULL,
  link text NOT NULL CHECK (link IN ('nested', 'number', 'none')),
  name text,
  address text,
  city text,
  state text,
  zip text,
  county text,
  type_code text,
  status_code text,
  defeased_code text,
  year_built integer,
  year_renovated integer,
  sq_ft numeric,
  sq_ft_securitization numeric,
  units numeric,
  units_securitization numeric,
  valuation_securitization numeric,
  valuation_securitization_date date,
  valuation_source_securitization text,
  valuation_recent numeric,
  valuation_recent_date date,
  valuation_recent_source text,
  occupancy_securitization numeric,
  occupancy_recent numeric,
  financials_securitization_date date,
  financials_recent_start date,
  financials_recent_end date,
  revenue_securitization numeric,
  revenue_recent numeric,
  opex_securitization numeric,
  opex_recent numeric,
  noi_securitization numeric,
  noi_recent numeric,
  ncf_securitization numeric,
  ncf_recent numeric,
  noi_ncf_code_securitization text,
  noi_ncf_code_recent text,
  debt_service_recent numeric,
  dscr_noi_securitization numeric,
  dscr_noi_recent numeric,
  dscr_ncf_securitization numeric,
  dscr_ncf_recent numeric,
  dscr_code_securitization text,
  dscr_code_recent text,
  tenant1 text,
  tenant1_sq_ft numeric,
  tenant1_lease_end date,
  tenant2 text,
  tenant2_sq_ft numeric,
  tenant2_lease_end date,
  tenant3 text,
  tenant3_sq_ft numeric,
  tenant3_lease_end date,
  lease_rollover_review_date date,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  unparsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (load_id, rec, seq)
);
CREATE INDEX IF NOT EXISTS abs_cmbs_properties_accn_idx ON public.abs_cmbs_properties (accession, loan_asset_number);

CREATE TABLE IF NOT EXISTS public.abs_pool_metrics (
  load_id bigint NOT NULL REFERENCES public.abs_loads (load_id) ON DELETE CASCADE,
  accession text NOT NULL,
  metric text NOT NULL,
  dim text NOT NULL DEFAULT '',
  bucket text NOT NULL DEFAULT '',
  value numeric,
  unit text NOT NULL CHECK (unit IN ('usd', 'count', 'fraction', 'ratio', 'months', 'score', 'as_filed')),
  n integer NOT NULL DEFAULT 0,
  n_missing integer NOT NULL DEFAULT 0,
  PRIMARY KEY (load_id, metric, dim, bucket)
);
CREATE INDEX IF NOT EXISTS abs_pool_metrics_accn_idx ON public.abs_pool_metrics (accession, metric);

-- Access. This project's default privileges grant everything, so each table starts from nothing:
-- members read, only the service role writes, and the ledger is the service role's alone.
REVOKE ALL ON public.abs_deals, public.abs_filings, public.abs_documents, public.abs_loads, public.abs_cmbs_assets, public.abs_cmbs_properties, public.abs_pool_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.abs_deals, public.abs_filings, public.abs_documents, public.abs_cmbs_assets, public.abs_cmbs_properties, public.abs_pool_metrics TO authenticated;
GRANT ALL ON public.abs_deals, public.abs_filings, public.abs_documents, public.abs_loads, public.abs_cmbs_assets, public.abs_cmbs_properties, public.abs_pool_metrics TO service_role;
ALTER TABLE public.abs_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abs_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abs_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abs_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abs_cmbs_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abs_cmbs_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abs_pool_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read ABS deals" ON public.abs_deals;
CREATE POLICY "Members read ABS deals" ON public.abs_deals FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
DROP POLICY IF EXISTS "Members read ABS filings" ON public.abs_filings;
CREATE POLICY "Members read ABS filings" ON public.abs_filings FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
DROP POLICY IF EXISTS "Members read ABS documents" ON public.abs_documents;
CREATE POLICY "Members read ABS documents" ON public.abs_documents FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
DROP POLICY IF EXISTS "Members read ABS commercial mortgage assets" ON public.abs_cmbs_assets;
CREATE POLICY "Members read ABS commercial mortgage assets" ON public.abs_cmbs_assets FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
DROP POLICY IF EXISTS "Members read ABS commercial mortgage properties" ON public.abs_cmbs_properties;
CREATE POLICY "Members read ABS commercial mortgage properties" ON public.abs_cmbs_properties FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
DROP POLICY IF EXISTS "Members read ABS pool metrics" ON public.abs_pool_metrics;
CREATE POLICY "Members read ABS pool metrics" ON public.abs_pool_metrics FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));

-- Readers: only rows of the load a loaded filing points at. A row of an open, abandoned or replaced
-- load is never shown. security_invoker keeps the tables' own row security in force.
CREATE OR REPLACE VIEW public.abs_cmbs_assets_live WITH (security_invoker = true) AS
  SELECT f.deal_id, f.form, f.filed, f.accepted_at, f.period_end AS cover_period_end, f.is_current, a.*
  FROM public.abs_cmbs_assets a JOIN public.abs_filings f ON f.accession = a.accession AND f.load_id = a.load_id AND f.status = 'loaded';
CREATE OR REPLACE VIEW public.abs_cmbs_properties_live WITH (security_invoker = true) AS
  SELECT f.deal_id, f.form, f.filed, f.accepted_at, f.period_end AS cover_period_end, f.is_current, p.*
  FROM public.abs_cmbs_properties p JOIN public.abs_filings f ON f.accession = p.accession AND f.load_id = p.load_id AND f.status = 'loaded';
CREATE OR REPLACE VIEW public.abs_pool_metrics_live WITH (security_invoker = true) AS
  SELECT f.deal_id, f.form, f.filed, f.accepted_at, f.period_start AS cover_period_start, f.period_end AS cover_period_end, f.is_current, m.*
  FROM public.abs_pool_metrics m JOIN public.abs_filings f ON f.accession = m.accession AND f.load_id = m.load_id AND f.status = 'loaded';
REVOKE ALL ON public.abs_cmbs_assets_live, public.abs_cmbs_properties_live, public.abs_pool_metrics_live FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.abs_cmbs_assets_live, public.abs_cmbs_properties_live, public.abs_pool_metrics_live TO authenticated, service_role;

-- Filings found on EDGAR for a CIK. Known accessions are left exactly as they are, so listing again
-- changes nothing. Returns how many were new.
CREATE OR REPLACE FUNCTION public.abs_register_filings(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
  total integer;
BEGIN
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'abs_register_filings: rows must be an array';
  END IF;
  total := jsonb_array_length(_rows);
  INSERT INTO abs_filings (accession, list_cik, form, filed, accepted_at)
  SELECT r.accession, r.list_cik, r.form, r.filed, r.accepted_at
  FROM jsonb_to_recordset(_rows) AS r(accession text, list_cik bigint, form text, filed date, accepted_at timestamptz)
  ON CONFLICT (accession) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('listed', n, 'known', total - n);
END
$$;

-- What the importer needs to plan a run for one CIK, oldest filing first.
CREATE OR REPLACE FUNCTION public.abs_filing_states(_list_cik bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'accession', f.accession, 'form', f.form, 'filed', f.filed, 'status', f.status, 'attempts', f.attempts,
           'is_current', f.is_current, 'parser', l.parser, 'sha256', l.source_sha256) ORDER BY f.filed, f.accession), '[]'::jsonb)
  FROM abs_filings f LEFT JOIN abs_loads l ON l.load_id = f.load_id
  WHERE f.list_cik = _list_cik
$$;

-- Open a load for a filing. An attempt that was cut off earlier is closed and its rows removed. When
-- the filing already holds a committed load of the same asset file read by the same parser, nothing is
-- opened and `skip` is true: storing the same filing twice is a no-op.
CREATE OR REPLACE FUNCTION public.abs_begin_load(_accession text, _parser text, _sha256 text, _bytes bigint, _force boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f abs_filings%ROWTYPE;
  have abs_loads%ROWTYPE;
  stale bigint;
  id bigint;
BEGIN
  SELECT * INTO f FROM abs_filings WHERE accession = _accession FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'abs_begin_load: filing % is not listed', _accession;
  END IF;
  SELECT * INTO have FROM abs_loads WHERE accession = _accession AND status = 'committed';
  IF FOUND AND NOT _force AND f.status = 'loaded' AND f.load_id = have.load_id AND have.parser = _parser AND have.source_sha256 = _sha256 THEN
    RETURN jsonb_build_object('skip', true, 'load_id', have.load_id);
  END IF;
  FOR stale IN SELECT load_id FROM abs_loads WHERE accession = _accession AND status = 'open' LOOP
    DELETE FROM abs_cmbs_assets WHERE load_id = stale;
    DELETE FROM abs_cmbs_properties WHERE load_id = stale;
    DELETE FROM abs_pool_metrics WHERE load_id = stale;
    UPDATE abs_loads SET status = 'abandoned', finished_at = now() WHERE load_id = stale;
  END LOOP;
  INSERT INTO abs_loads (accession, parser, source_sha256, source_bytes) VALUES (_accession, _parser, _sha256, _bytes) RETURNING load_id INTO id;
  RETURN jsonb_build_object('skip', false, 'load_id', id);
END
$$;

-- The rows a chunk of JSON spells, typed exactly as the tables type them. The load and accession come
-- from the ledger, never from the JSON. Storing (abs_put_rows) and checking (abs_verify_rows) both read
-- a chunk through these, so "what was stored" and "what the source says now" are compared like for like.
CREATE OR REPLACE FUNCTION public.abs_rows_cmbs_assets(_load_id bigint, _accession text, _rows jsonb)
RETURNS SETOF public.abs_cmbs_assets
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (jsonb_populate_record(NULL::abs_cmbs_assets, e || jsonb_build_object('load_id', _load_id, 'accession', _accession,
            'extra', coalesce(e->'extra', '{}'::jsonb), 'unparsed', coalesce(e->'unparsed', '{}'::jsonb)))).*
  FROM jsonb_array_elements(_rows) e
$$;
CREATE OR REPLACE FUNCTION public.abs_rows_cmbs_properties(_load_id bigint, _accession text, _rows jsonb)
RETURNS SETOF public.abs_cmbs_properties
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (jsonb_populate_record(NULL::abs_cmbs_properties, e || jsonb_build_object('load_id', _load_id, 'accession', _accession,
            'extra', coalesce(e->'extra', '{}'::jsonb), 'unparsed', coalesce(e->'unparsed', '{}'::jsonb)))).*
  FROM jsonb_array_elements(_rows) e
$$;
CREATE OR REPLACE FUNCTION public.abs_rows_metrics(_load_id bigint, _accession text, _rows jsonb)
RETURNS SETOF public.abs_pool_metrics
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (jsonb_populate_record(NULL::abs_pool_metrics, e || jsonb_build_object('load_id', _load_id, 'accession', _accession,
            'dim', coalesce(e->>'dim', ''), 'bucket', coalesce(e->>'bucket', ''), 'n', coalesce((e->>'n')::int, 0), 'n_missing', coalesce((e->>'n_missing')::int, 0)))).*
  FROM jsonb_array_elements(_rows) e
$$;

-- A key that is not a column would be dropped without a word; it is refused instead.
CREATE OR REPLACE FUNCTION public.abs_require_columns(_table text, _rows jsonb)
RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  bad text;
BEGIN
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'abs: rows must be an array';
  END IF;
  SELECT k INTO bad FROM jsonb_array_elements(_rows) e CROSS JOIN LATERAL jsonb_object_keys(e) k
  WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = ('public.' || _table)::regclass AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped)
  LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'abs: % has no column "%"', _table, bad;
  END IF;
END
$$;

-- Rows of an open load. Sending a chunk again adds nothing (same keys), so a retry after a lost reply
-- is safe; abs_commit_load counts what is there.
CREATE OR REPLACE FUNCTION public.abs_put_rows(_load_id bigint, _kind text, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l abs_loads%ROWTYPE;
  n integer;
BEGIN
  SELECT * INTO l FROM abs_loads WHERE load_id = _load_id FOR UPDATE;
  IF NOT FOUND OR l.status <> 'open' THEN
    RAISE EXCEPTION 'abs_put_rows: load % is not open', _load_id;
  END IF;
  IF _kind = 'cmbs_assets' THEN
    PERFORM abs_require_columns('abs_cmbs_assets', _rows);
    INSERT INTO abs_cmbs_assets SELECT * FROM abs_rows_cmbs_assets(l.load_id, l.accession, _rows) ON CONFLICT DO NOTHING;
  ELSIF _kind = 'cmbs_properties' THEN
    PERFORM abs_require_columns('abs_cmbs_properties', _rows);
    INSERT INTO abs_cmbs_properties SELECT * FROM abs_rows_cmbs_properties(l.load_id, l.accession, _rows) ON CONFLICT DO NOTHING;
  ELSIF _kind = 'metrics' THEN
    PERFORM abs_require_columns('abs_pool_metrics', _rows);
    INSERT INTO abs_pool_metrics SELECT * FROM abs_rows_metrics(l.load_id, l.accession, _rows) ON CONFLICT DO NOTHING;
  ELSE
    RAISE EXCEPTION 'abs_put_rows: unknown kind %', _kind;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- How many of the rows given are NOT stored exactly so in the filing's committed load: 0 means every
-- one is there, value for value. Used to check the store against a fresh read of the source.
CREATE OR REPLACE FUNCTION public.abs_verify_rows(_accession text, _kind text, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  id bigint;
  n integer;
BEGIN
  SELECT f.load_id INTO id FROM abs_filings f JOIN abs_loads l ON l.load_id = f.load_id AND l.status = 'committed' WHERE f.accession = _accession AND f.status = 'loaded';
  IF id IS NULL THEN
    RAISE EXCEPTION 'abs_verify_rows: filing % is not loaded', _accession;
  END IF;
  IF _kind = 'cmbs_assets' THEN
    PERFORM abs_require_columns('abs_cmbs_assets', _rows);
    SELECT count(*) INTO n FROM (SELECT * FROM abs_rows_cmbs_assets(id, _accession, _rows) EXCEPT SELECT * FROM abs_cmbs_assets WHERE load_id = id) d;
  ELSIF _kind = 'cmbs_properties' THEN
    PERFORM abs_require_columns('abs_cmbs_properties', _rows);
    SELECT count(*) INTO n FROM (SELECT * FROM abs_rows_cmbs_properties(id, _accession, _rows) EXCEPT SELECT * FROM abs_cmbs_properties WHERE load_id = id) d;
  ELSIF _kind = 'metrics' THEN
    PERFORM abs_require_columns('abs_pool_metrics', _rows);
    SELECT count(*) INTO n FROM (SELECT * FROM abs_rows_metrics(id, _accession, _rows) EXCEPT SELECT * FROM abs_pool_metrics WHERE load_id = id) d;
  ELSE
    RAISE EXCEPTION 'abs_verify_rows: unknown kind %', _kind;
  END IF;
  RETURN n;
END
$$;

-- The committed load of a filing, for the importer's check against the source.
CREATE OR REPLACE FUNCTION public.abs_filing_load(_accession text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('load_id', l.load_id, 'parser', l.parser, 'sha256', l.source_sha256, 'bytes', l.source_bytes, 'counts', l.counts,
           'period_start', f.period_start, 'period_end', f.period_end, 'deal_id', f.deal_id, 'is_current', f.is_current)
  FROM abs_filings f JOIN abs_loads l ON l.load_id = f.load_id AND l.status = 'committed'
  WHERE f.accession = _accession AND f.status = 'loaded'
$$;

-- Make an open load the filing's data, in one transaction: the stored rows must equal what the reader
-- counted, the previous committed load of the same filing is replaced, the header facts and documents
-- are written, and the newest accepted filing of the deal's cover period becomes the current one.
CREATE OR REPLACE FUNCTION public.abs_commit_load(_load_id bigint, _filing jsonb, _documents jsonb, _expect jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l abs_loads%ROWTYPE;
  h record;
  got jsonb;
  old bigint;
  cur text;
  fam text;
BEGIN
  SELECT * INTO l FROM abs_loads WHERE load_id = _load_id FOR UPDATE;
  IF NOT FOUND OR l.status <> 'open' THEN
    RAISE EXCEPTION 'abs_commit_load: load % is not open', _load_id;
  END IF;
  PERFORM 1 FROM abs_filings WHERE accession = l.accession FOR UPDATE;
  got := jsonb_build_object(
    'cmbs_assets', (SELECT count(*) FROM abs_cmbs_assets WHERE load_id = _load_id),
    'cmbs_properties', (SELECT count(*) FROM abs_cmbs_properties WHERE load_id = _load_id),
    'metrics', (SELECT count(*) FROM abs_pool_metrics WHERE load_id = _load_id));
  IF coalesce((_expect->>'cmbs_assets')::bigint, 0) <> (got->>'cmbs_assets')::bigint
     OR coalesce((_expect->>'cmbs_properties')::bigint, 0) <> (got->>'cmbs_properties')::bigint
     OR coalesce((_expect->>'metrics')::bigint, 0) <> (got->>'metrics')::bigint THEN
    RAISE EXCEPTION 'abs_commit_load: load % holds % but the reader counted %', _load_id, got, _expect;
  END IF;
  SELECT * INTO h FROM jsonb_to_record(_filing) AS r(
    deal_id text, issuer_cik bigint, issuer_name text, file_number text, family text, asset_class text,
    depositor_cik bigint, sponsor_cik bigint, period_start date, period_end date, accepted_at timestamptz, header_sha256 text);
  IF h.deal_id IS NULL OR h.issuer_name IS NULL OR h.family IS NULL THEN
    RAISE EXCEPTION 'abs_commit_load: filing facts need deal_id, issuer_name and family';
  END IF;
  -- a deal's family comes from its asset files and never flips; a file of another family is refused
  SELECT d.family INTO fam FROM abs_deals d WHERE d.deal_id = h.deal_id FOR UPDATE;
  IF fam IS NOT NULL AND fam <> h.family THEN
    RAISE EXCEPTION 'abs_commit_load: deal % holds % files; this file is %', h.deal_id, fam, h.family;
  END IF;
  INSERT INTO abs_deals (deal_id, issuer_cik, issuer_name, file_number, family, depositor_cik, sponsor_cik)
  VALUES (h.deal_id, h.issuer_cik, h.issuer_name, h.file_number, h.family, h.depositor_cik, h.sponsor_cik)
  ON CONFLICT (deal_id) DO NOTHING;
  SELECT load_id INTO old FROM abs_loads WHERE accession = l.accession AND status = 'committed';
  IF old IS NOT NULL THEN
    UPDATE abs_filings SET load_id = NULL WHERE accession = l.accession;
    DELETE FROM abs_cmbs_assets WHERE load_id = old;
    DELETE FROM abs_cmbs_properties WHERE load_id = old;
    DELETE FROM abs_pool_metrics WHERE load_id = old;
    UPDATE abs_loads SET status = 'replaced' WHERE load_id = old;
  END IF;
  UPDATE abs_loads SET status = 'committed', finished_at = now(), counts = _expect WHERE load_id = _load_id;
  UPDATE abs_filings SET deal_id = h.deal_id, period_start = h.period_start, period_end = h.period_end, asset_class = h.asset_class,
    issuer_cik = h.issuer_cik, issuer_name = h.issuer_name, depositor_cik = h.depositor_cik, sponsor_cik = h.sponsor_cik, file_number = h.file_number,
    accepted_at = coalesce(h.accepted_at, accepted_at), header_sha256 = h.header_sha256,
    status = 'loaded', status_detail = NULL, load_id = _load_id, loaded_at = now()
  WHERE accession = l.accession;
  DELETE FROM abs_documents WHERE accession = l.accession;
  INSERT INTO abs_documents (accession, seq, doc_type, name, description, url, listed_bytes, bytes, sha256, records, namespace, retrieved_at)
  SELECT l.accession, d.seq, d.doc_type, d.name, d.description, d.url, d.listed_bytes, d.bytes, d.sha256, d.records, d.namespace, d.retrieved_at
  FROM jsonb_to_recordset(coalesce(_documents, '[]'::jsonb)) AS d(seq integer, doc_type text, name text, description text, url text, listed_bytes bigint, bytes bigint, sha256 text, records integer, namespace text, retrieved_at timestamptz);
  -- the deal is described by its newest loaded filing (a trust can be renamed), whatever order filings are stored in
  UPDATE abs_deals d SET issuer_cik = n.issuer_cik, issuer_name = n.issuer_name, file_number = n.file_number, depositor_cik = n.depositor_cik, sponsor_cik = n.sponsor_cik, updated_at = now()
  FROM (SELECT f.issuer_cik, f.issuer_name, f.file_number, f.depositor_cik, f.sponsor_cik FROM abs_filings f
        WHERE f.status = 'loaded' AND f.deal_id = h.deal_id ORDER BY f.accepted_at DESC NULLS LAST, f.accession DESC LIMIT 1) n
  WHERE d.deal_id = h.deal_id
    AND (d.issuer_cik, d.issuer_name, d.file_number, d.depositor_cik, d.sponsor_cik) IS DISTINCT FROM (n.issuer_cik, n.issuer_name, n.file_number, n.depositor_cik, n.sponsor_cik);
  -- the deal's cover period: the filing SEC accepted last is current (accession breaks a tie)
  SELECT f.accession INTO cur FROM abs_filings f
  WHERE f.status = 'loaded' AND f.deal_id = h.deal_id AND f.period_end IS NOT DISTINCT FROM h.period_end
  ORDER BY f.accepted_at DESC NULLS LAST, f.accession DESC LIMIT 1;
  UPDATE abs_filings f SET is_current = (f.accession = cur), superseded_by = CASE WHEN f.accession = cur THEN NULL ELSE cur END
  WHERE f.status = 'loaded' AND f.deal_id = h.deal_id AND f.period_end IS NOT DISTINCT FROM h.period_end
    AND (f.is_current IS DISTINCT FROM (f.accession = cur) OR f.superseded_by IS DISTINCT FROM CASE WHEN f.accession = cur THEN NULL ELSE cur END);
  RETURN jsonb_build_object('accession', l.accession, 'load_id', _load_id, 'replaced', old, 'current', cur = l.accession, 'counts', got);
END
$$;

-- The whole of one filing in one call and one transaction (open, rows, commit), for a caller that has a
-- few seconds and cannot afford several round trips. `_rows` holds the three kinds of rows by name.
CREATE OR REPLACE FUNCTION public.abs_store_filing(_accession text, _parser text, _sha256 text, _bytes bigint, _filing jsonb, _documents jsonb, _rows jsonb, _expect jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b jsonb;
  id bigint;
BEGIN
  b := abs_begin_load(_accession, _parser, _sha256, _bytes, false);
  IF (b->>'skip')::boolean THEN
    RETURN b;
  END IF;
  id := (b->>'load_id')::bigint;
  PERFORM abs_put_rows(id, 'cmbs_assets', coalesce(_rows->'cmbs_assets', '[]'::jsonb));
  PERFORM abs_put_rows(id, 'cmbs_properties', coalesce(_rows->'cmbs_properties', '[]'::jsonb));
  PERFORM abs_put_rows(id, 'metrics', coalesce(_rows->'metrics', '[]'::jsonb));
  RETURN abs_commit_load(id, _filing, _documents, _expect) || jsonb_build_object('skip', false);
END
$$;

-- The next filing a scheduled run should store, among the CIKs it watches (`_watch`: cik and the first
-- filing date wanted). The attempt is counted before any work, so a filing the run can never finish in
-- its few seconds is tried `_max_attempts` times and then left for a person; least-tried filings go first,
-- so one stuck filing never holds up the others. Null when nothing is waiting.
CREATE OR REPLACE FUNCTION public.abs_claim_next(_watch jsonb, _max_attempts integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pick record;
BEGIN
  SELECT f.accession, f.list_cik, f.form, f.filed, f.attempts INTO pick
  FROM abs_filings f JOIN jsonb_to_recordset(coalesce(_watch, '[]'::jsonb)) AS w(cik bigint, "from" date) ON w.cik = f.list_cik
  WHERE f.filed >= coalesce(w."from", DATE '1900-01-01')
    AND (f.status = 'listed' OR (f.status = 'failed' AND f.attempts < _max_attempts))
  ORDER BY f.attempts, f.filed, f.accession
  LIMIT 1
  FOR UPDATE OF f SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE abs_filings SET status = 'failed', attempts = attempts + 1, status_detail = 'attempt started by the scheduled job and not finished'
  WHERE accession = pick.accession;
  RETURN jsonb_build_object('accession', pick.accession, 'list_cik', pick.list_cik, 'form', pick.form, 'filed', pick.filed, 'attempt', pick.attempts + 1);
END
$$;

-- Gives a claimed attempt back when the cause was SEC being unavailable, not the filing: the filing is
-- listed again and the attempt is not counted. A loaded filing is left alone.
CREATE OR REPLACE FUNCTION public.abs_release_filing(_accession text, _detail text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE abs_filings SET status = 'listed', attempts = greatest(attempts - 1, 0), status_detail = left(_detail, 500)
  WHERE accession = _accession AND status = 'failed'
$$;

-- A filing that cannot be stored: `skipped` (nothing to read, for example no asset file or an asset
-- class this reader does not cover) or `failed` (an error, counted so the importer can give up).
-- A loaded filing keeps its data and status; only the note and the attempt count change.
CREATE OR REPLACE FUNCTION public.abs_mark_filing(_accession text, _status text, _detail text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _status NOT IN ('skipped', 'failed') THEN
    RAISE EXCEPTION 'abs_mark_filing: status must be skipped or failed';
  END IF;
  UPDATE abs_filings SET
    status = CASE WHEN status = 'loaded' THEN status ELSE _status END,
    status_detail = left(_detail, 500),
    attempts = attempts + CASE WHEN _status = 'failed' THEN 1 ELSE 0 END
  WHERE accession = _accession;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'abs_mark_filing: filing % is not listed', _accession;
  END IF;
END
$$;

-- Invariants of the store; every count must be zero. The importer checks after each run.
CREATE OR REPLACE FUNCTION public.abs_check()
RETURNS TABLE(problem text, bad bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'loaded filing without a committed load', count(*) FROM abs_filings f
    WHERE f.status = 'loaded' AND NOT EXISTS (SELECT 1 FROM abs_loads l WHERE l.load_id = f.load_id AND l.status = 'committed' AND l.accession = f.accession)
  UNION ALL SELECT 'committed load its filing does not point at', count(*) FROM abs_loads l
    WHERE l.status = 'committed' AND NOT EXISTS (SELECT 1 FROM abs_filings f WHERE f.accession = l.accession AND f.load_id = l.load_id AND f.status = 'loaded')
  UNION ALL SELECT 'rows of a load that is neither open nor committed', (
    (SELECT count(*) FROM abs_cmbs_assets a JOIN abs_loads l USING (load_id) WHERE l.status NOT IN ('open', 'committed'))
    + (SELECT count(*) FROM abs_cmbs_properties p JOIN abs_loads l USING (load_id) WHERE l.status NOT IN ('open', 'committed'))
    + (SELECT count(*) FROM abs_pool_metrics m JOIN abs_loads l USING (load_id) WHERE l.status NOT IN ('open', 'committed')))
  UNION ALL SELECT 'committed load whose stored rows differ from its counts', count(*) FROM abs_loads l
    WHERE l.status = 'committed' AND (
      coalesce((l.counts->>'cmbs_assets')::bigint, 0) <> (SELECT count(*) FROM abs_cmbs_assets a WHERE a.load_id = l.load_id)
      OR coalesce((l.counts->>'cmbs_properties')::bigint, 0) <> (SELECT count(*) FROM abs_cmbs_properties p WHERE p.load_id = l.load_id)
      OR coalesce((l.counts->>'metrics')::bigint, 0) <> (SELECT count(*) FROM abs_pool_metrics m WHERE m.load_id = l.load_id))
  UNION ALL SELECT 'deal period with other than one current filing', count(*) FROM (
    SELECT 1 FROM abs_filings f WHERE f.status = 'loaded' GROUP BY f.deal_id, f.period_end HAVING count(*) FILTER (WHERE f.is_current) <> 1) g
  UNION ALL SELECT 'current filing that is not the last accepted of its deal period', count(*) FROM abs_filings f
    WHERE f.status = 'loaded' AND f.is_current AND EXISTS (
      SELECT 1 FROM abs_filings o WHERE o.status = 'loaded' AND o.deal_id = f.deal_id AND o.period_end IS NOT DISTINCT FROM f.period_end
        AND (o.accepted_at, o.accession) > (f.accepted_at, f.accession))
  UNION ALL SELECT 'superseded filing that points at a filing which is not current', count(*) FROM abs_filings f
    WHERE f.superseded_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM abs_filings o WHERE o.accession = f.superseded_by AND o.is_current)
  UNION ALL SELECT 'property whose loan record is not in the same file', count(*) FROM abs_cmbs_properties p
    JOIN abs_loads l ON l.load_id = p.load_id AND l.status = 'committed'
    WHERE p.link <> 'none' AND NOT EXISTS (SELECT 1 FROM abs_cmbs_assets a WHERE a.load_id = p.load_id AND a.asset_number = p.loan_asset_number AND a.kind = 'loan')
$$;

-- Totals for the importer's status line and for checks against the source.
CREATE OR REPLACE FUNCTION public.abs_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'deals', (SELECT count(*) FROM abs_deals),
    'filings', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) n FROM abs_filings GROUP BY status) s),
    'current', (SELECT count(*) FROM abs_filings WHERE is_current),
    'superseded', (SELECT count(*) FROM abs_filings WHERE superseded_by IS NOT NULL),
    'loads', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (SELECT status, count(*) n FROM abs_loads GROUP BY status) s),
    'cmbs_assets', (SELECT count(*) FROM abs_cmbs_assets),
    'cmbs_properties', (SELECT count(*) FROM abs_cmbs_properties),
    'metrics', (SELECT count(*) FROM abs_pool_metrics),
    'source_bytes', (SELECT coalesce(sum(source_bytes), 0) FROM abs_loads WHERE status = 'committed'))
$$;

REVOKE ALL ON FUNCTION public.abs_register_filings(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_filing_states(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_begin_load(text, text, text, bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_put_rows(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_commit_load(bigint, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_rows_cmbs_assets(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_rows_cmbs_properties(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_rows_metrics(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_require_columns(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_verify_rows(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_filing_load(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_store_filing(text, text, text, bigint, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_claim_next(jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_release_filing(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_mark_filing(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_check() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abs_register_filings(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_filing_states(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_begin_load(text, text, text, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_put_rows(bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_commit_load(bigint, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_rows_cmbs_assets(bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_rows_cmbs_properties(bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_rows_metrics(bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_require_columns(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_verify_rows(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_filing_load(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_store_filing(text, text, text, bigint, jsonb, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_claim_next(jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_release_filing(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_mark_filing(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_check() TO service_role;
GRANT EXECUTE ON FUNCTION public.abs_summary() TO service_role;
