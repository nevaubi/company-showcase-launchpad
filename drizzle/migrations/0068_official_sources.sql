-- Native official-source records, separate from the company's derived alt_data series.
-- Each source file is immutable and addressed by SHA-256. Files larger than 32 MiB are stored as
-- ordered content-addressed parts in the private datasets bucket. No credential is stored here.
-- An incomplete snapshot stays invisible. Publication checks the complete row count, every width,
-- and the presence/length of its verified raw objects before changing the dataset's current pointer.

CREATE OR REPLACE FUNCTION public.source_columns_valid(_columns jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE c jsonb; names text[] := '{}';
BEGIN
  IF jsonb_typeof(_columns) IS DISTINCT FROM 'array' OR jsonb_array_length(_columns) NOT BETWEEN 1 AND 16384 THEN RETURN false; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(_columns) LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(c->'key') IS DISTINCT FROM 'string' OR coalesce(c->>'key','') = ''
      OR jsonb_typeof(c->'label') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'type') IS DISTINCT FROM 'string'
      OR c->>'key' = ANY(names) THEN RETURN false; END IF;
    names := array_append(names, c->>'key');
  END LOOP;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.source_values_valid(_values jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN jsonb_typeof(_values) = 'array' THEN
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_values) v WHERE jsonb_typeof(v) NOT IN ('string','null'))
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.source_chunks_valid(_chunks jsonb, _bytes bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE c jsonb; i integer := 0; total bigint := 0; n bigint;
BEGIN
  IF jsonb_typeof(_chunks) IS DISTINCT FROM 'array' OR _bytes IS NULL OR _bytes < 0 THEN RETURN false; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(_chunks) LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR coalesce(c->>'index','') !~ '^\d+$' OR (c->>'index')::integer <> i
      OR coalesce(c->>'sha256','') !~ '^[0-9a-f]{64}$'
      OR c->>'path' IS DISTINCT FROM 'official/objects/' || (c->>'sha256')
      OR coalesce(c->>'bytes','') !~ '^\d+$' THEN RETURN false; END IF;
    n := (c->>'bytes')::bigint;
    IF n NOT BETWEEN 1 AND 33554432 THEN RETURN false; END IF;
    total := total + n; i := i + 1;
  END LOOP;
  RETURN total = _bytes;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN false;
END $$;

CREATE TABLE IF NOT EXISTS public.source_files (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint NOT NULL CHECK (bytes >= 0),
  content_type text NOT NULL,
  chunks jsonb NOT NULL CHECK (public.source_chunks_valid(chunks, bytes)),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.source_datasets (
  id text PRIMARY KEY,
  name text NOT NULL,
  sector text NOT NULL,
  agency text NOT NULL,
  source_id text,
  source_url text,
  description text NOT NULL DEFAULT '',
  grain text NOT NULL DEFAULT '',
  units text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  latest_snapshot_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS source_datasets_sector_idx ON public.source_datasets (sector, id);
CREATE INDEX IF NOT EXISTS source_datasets_agency_idx ON public.source_datasets (agency, id);

CREATE TABLE IF NOT EXISTS public.source_snapshots (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  dataset_id text NOT NULL REFERENCES public.source_datasets(id),
  file_sha256 text NOT NULL REFERENCES public.source_files(sha256),
  source_path text NOT NULL,
  retrieved_at timestamptz,
  status text NOT NULL DEFAULT 'staging' CHECK (status IN ('staging','ready','failed')),
  expected_rows bigint NOT NULL CHECK (expected_rows >= 0),
  loaded_rows bigint NOT NULL DEFAULT 0 CHECK (loaded_rows >= 0 AND loaded_rows <= expected_rows),
  columns jsonb NOT NULL CHECK (public.source_columns_valid(columns)),
  column_count integer GENERATED ALWAYS AS (jsonb_array_length(columns)) STORED,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage) = 'object'),
  quality jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quality) = 'object'),
  ingest jsonb NOT NULL CHECK (jsonb_typeof(ingest) = 'object'),
  lease_owner text,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (dataset_id, id)
);
CREATE INDEX IF NOT EXISTS source_snapshots_pending_idx ON public.source_snapshots (status, lease_until, id);
CREATE INDEX IF NOT EXISTS source_snapshots_dataset_idx ON public.source_snapshots (dataset_id, created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_datasets_latest_fk' AND conrelid = 'public.source_datasets'::regclass) THEN
    ALTER TABLE public.source_datasets ADD CONSTRAINT source_datasets_latest_fk
      FOREIGN KEY (id, latest_snapshot_id) REFERENCES public.source_snapshots(dataset_id, id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.source_records (
  snapshot_id text NOT NULL REFERENCES public.source_snapshots(id),
  row_number bigint NOT NULL CHECK (row_number > 0),
  "values" jsonb NOT NULL CHECK (public.source_values_valid("values")),
  entity_id text,
  entity_name text,
  period text,
  geo_level text,
  geo_code text,
  geo_name text,
  source_url text,
  PRIMARY KEY (snapshot_id, row_number)
);
CREATE INDEX IF NOT EXISTS source_records_entity_idx ON public.source_records (snapshot_id, entity_id, row_number) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_records_entity_name_idx ON public.source_records (snapshot_id, entity_name, row_number) WHERE entity_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_records_geo_idx ON public.source_records (snapshot_id, geo_code, row_number) WHERE geo_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_records_geo_name_idx ON public.source_records (snapshot_id, geo_name, row_number) WHERE geo_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS source_records_period_idx ON public.source_records (snapshot_id, period, row_number) WHERE period IS NOT NULL;

CREATE OR REPLACE FUNCTION public.source_guard_record() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE st text; expected bigint; width integer;
BEGIN
  -- SHARE conflicts with publication's UPDATE lock: no row can slip in during the final count.
  SELECT status,expected_rows,column_count INTO STRICT st,expected,width FROM public.source_snapshots WHERE id = NEW.snapshot_id FOR SHARE;
  IF st <> 'staging' THEN RAISE EXCEPTION 'source snapshot is not staging'; END IF;
  IF NEW.row_number > expected THEN RAISE EXCEPTION 'source row exceeds expected count'; END IF;
  IF jsonb_array_length(NEW."values") <> width THEN RAISE EXCEPTION 'source row width does not match columns'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS source_record_guard ON public.source_records;
CREATE TRIGGER source_record_guard BEFORE INSERT OR UPDATE ON public.source_records FOR EACH ROW EXECUTE FUNCTION public.source_guard_record();

CREATE OR REPLACE FUNCTION public.source_guard_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'ready' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'published source snapshot is immutable'; END IF;
  IF (NEW.file_sha256, NEW.dataset_id, NEW.columns, NEW.expected_rows, NEW.ingest)
     IS DISTINCT FROM (OLD.file_sha256, OLD.dataset_id, OLD.columns, OLD.expected_rows, OLD.ingest)
     AND (OLD.loaded_rows > 0 OR EXISTS (SELECT 1 FROM public.source_records WHERE snapshot_id = OLD.id)) THEN RAISE EXCEPTION 'source snapshot definition with stored rows is immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS source_snapshot_guard ON public.source_snapshots;
CREATE TRIGGER source_snapshot_guard BEFORE UPDATE ON public.source_snapshots FOR EACH ROW EXECUTE FUNCTION public.source_guard_snapshot();

CREATE OR REPLACE FUNCTION public.source_guard_file() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (OLD.verified_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.source_snapshots WHERE file_sha256=OLD.sha256 AND loaded_rows>0)) AND (NEW.sha256,NEW.bytes,NEW.chunks) IS DISTINCT FROM (OLD.sha256,OLD.bytes,OLD.chunks)
    THEN RAISE EXCEPTION 'verified source file bytes and chunks are immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS source_file_guard ON public.source_files;
CREATE TRIGGER source_file_guard BEFORE UPDATE ON public.source_files FOR EACH ROW EXECUTE FUNCTION public.source_guard_file();

CREATE OR REPLACE FUNCTION public.source_claim_snapshot(_owner text, _snapshot_id text DEFAULT NULL, _ttl_seconds integer DEFAULT 180, _retry_failed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.source_snapshots;
BEGIN
  IF coalesce(length(_owner),0) NOT BETWEEN 1 AND 200 OR _ttl_seconds IS NULL OR _ttl_seconds NOT BETWEEN 30 AND 1200 THEN RAISE EXCEPTION 'invalid source lease'; END IF;
  SELECT * INTO s FROM public.source_snapshots
  WHERE (status = 'staging' OR (_retry_failed AND status = 'failed'))
    AND NOT (quality @> '{"quarantined":true}'::jsonb)
    AND (_snapshot_id IS NULL OR id = _snapshot_id)
    AND (lease_until IS NULL OR lease_until < now() OR lease_owner = _owner)
  ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.source_snapshots SET status = 'staging', lease_owner = _owner,
    lease_until = now() + make_interval(secs => _ttl_seconds), attempts = attempts + 1, last_error = NULL
    WHERE id = s.id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.source_renew_lease(_snapshot_id text, _owner text, _ttl_seconds integer DEFAULT 180)
RETURNS boolean LANGUAGE plpgsql SET search_path = public AS $$
DECLARE changed integer;
BEGIN
  IF coalesce(length(_owner),0) NOT BETWEEN 1 AND 200 OR _ttl_seconds IS NULL OR _ttl_seconds NOT BETWEEN 30 AND 1200 THEN RAISE EXCEPTION 'invalid source lease'; END IF;
  UPDATE public.source_snapshots SET lease_until = now() + make_interval(secs => _ttl_seconds)
    WHERE id = _snapshot_id AND status = 'staging' AND lease_owner = _owner AND lease_until > now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE OR REPLACE FUNCTION public.source_put_records(_snapshot_id text, _owner text, _rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.source_snapshots; item jsonb; inserted integer; incoming bigint; first_new bigint; last_new bigint;
BEGIN
  IF coalesce(length(_owner),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid source lease owner'; END IF;
  SELECT * INTO STRICT s FROM public.source_snapshots WHERE id = _snapshot_id FOR UPDATE;
  IF s.status <> 'staging' OR s.lease_owner IS DISTINCT FROM _owner OR s.lease_until IS NULL OR s.lease_until <= now() THEN RAISE EXCEPTION 'source lease is not held'; END IF;
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) NOT BETWEEN 1 AND 5000 OR octet_length(_rows::text) > 8388608 THEN RAISE EXCEPTION 'source batch must be 1 to 5000 rows and at most 8 MiB'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    IF jsonb_typeof(item) <> 'object' OR coalesce(item->>'row_number','') !~ '^\d+$'
      OR NOT coalesce(public.source_values_valid(item->'values'),false)
      OR jsonb_array_length(item->'values') <> s.column_count THEN RAISE EXCEPTION 'invalid source row or width'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('row_number','values','entity_id','entity_name','period','geo_level','geo_code','geo_name','source_url')) THEN RAISE EXCEPTION 'unknown source row field'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(item) e WHERE e.key NOT IN ('row_number','values') AND jsonb_typeof(e.value) NOT IN ('string','null')) THEN RAISE EXCEPTION 'source dimensions must be native strings'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_rows) j GROUP BY j->>'row_number' HAVING count(*) > 1) THEN RAISE EXCEPTION 'duplicate source row in batch'; END IF;
  -- A retry is harmless only if it is exactly the same row. Never silently replace native data.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rows) j JOIN public.source_records r
      ON r.snapshot_id = _snapshot_id AND r.row_number = (j->>'row_number')::bigint
    WHERE (r."values",r.entity_id,r.entity_name,r.period,r.geo_level,r.geo_code,r.geo_name,r.source_url)
      IS DISTINCT FROM (j->'values',j->>'entity_id',j->>'entity_name',j->>'period',j->>'geo_level',j->>'geo_code',j->>'geo_name',j->>'source_url')
  ) THEN RAISE EXCEPTION 'source retry differs from stored row'; END IF;
  SELECT count(*),min((j->>'row_number')::bigint),max((j->>'row_number')::bigint) INTO incoming,first_new,last_new
    FROM jsonb_array_elements(_rows) j LEFT JOIN public.source_records old
      ON old.snapshot_id=_snapshot_id AND old.row_number=(j->>'row_number')::bigint WHERE old.snapshot_id IS NULL;
  IF incoming > 0 AND (first_new <> s.loaded_rows+1 OR last_new <> s.loaded_rows+incoming) THEN RAISE EXCEPTION 'source rows must extend the stored contiguous prefix'; END IF;
  INSERT INTO public.source_records(snapshot_id,row_number,"values",entity_id,entity_name,period,geo_level,geo_code,geo_name,source_url)
    SELECT _snapshot_id,(j->>'row_number')::bigint,j->'values',j->>'entity_id',j->>'entity_name',j->>'period',j->>'geo_level',j->>'geo_code',j->>'geo_name',j->>'source_url'
    FROM jsonb_array_elements(_rows) j ON CONFLICT (snapshot_id,row_number) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  UPDATE public.source_snapshots SET loaded_rows = loaded_rows + inserted, lease_until = now() + interval '3 minutes'
    WHERE id = _snapshot_id RETURNING * INTO s;
  RETURN jsonb_build_object('inserted',inserted,'loaded_rows',s.loaded_rows,'expected_rows',s.expected_rows);
END $$;

CREATE OR REPLACE FUNCTION public.source_publish_snapshot(_snapshot_id text, _owner text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.source_snapshots; f public.source_files; n bigint; first_row bigint; last_row bigint;
  previous_id text; previous public.source_snapshots; advance boolean;
BEGIN
  IF coalesce(length(_owner),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid source lease owner'; END IF;
  SELECT * INTO STRICT s FROM public.source_snapshots WHERE id = _snapshot_id FOR UPDATE;
  IF s.status = 'ready' THEN RETURN jsonb_build_object('published',false,'rows',s.loaded_rows); END IF;
  IF s.status <> 'staging' OR s.lease_owner IS DISTINCT FROM _owner OR s.lease_until IS NULL OR s.lease_until <= now() THEN RAISE EXCEPTION 'source lease is not held'; END IF;
  IF s.quality @> '{"quarantined":true}'::jsonb THEN RAISE EXCEPTION 'quarantined source snapshot cannot be published'; END IF;
  SELECT * INTO STRICT f FROM public.source_files WHERE sha256 = s.file_sha256;
  IF f.verified_at IS NULL THEN RAISE EXCEPTION 'source file hash has not been verified'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(f.chunks) c WHERE NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'datasets' AND o.name = c->>'path'
      AND (o.metadata->>'size')::bigint = (c->>'bytes')::bigint
  )) THEN RAISE EXCEPTION 'source file object is missing or its byte length differs'; END IF;
  -- The CHECK and row trigger already validate every native cell and width; the definition cannot
  -- change once rows exist. Final publication needs only an index scan, not a multi-GB JSON scan.
  SELECT count(*),min(row_number),max(row_number) INTO n,first_row,last_row FROM public.source_records WHERE snapshot_id = _snapshot_id;
  IF n <> s.expected_rows OR (n > 0 AND (first_row <> 1 OR last_row <> n)) THEN RAISE EXCEPTION 'source publish refused: expected %, stored %, row range % to %',s.expected_rows,n,first_row,last_row; END IF;
  SELECT latest_snapshot_id INTO previous_id FROM public.source_datasets WHERE id=s.dataset_id FOR UPDATE;
  SELECT * INTO previous FROM public.source_snapshots WHERE id=previous_id;
  -- Actual retrieval times outrank unknown ones; later imports cannot silently roll a dataset back.
  advance := previous_id IS NULL OR
    (coalesce(s.retrieved_at,'-infinity'::timestamptz),s.created_at,s.id) >
    (coalesce(previous.retrieved_at,'-infinity'::timestamptz),previous.created_at,previous.id);
  UPDATE public.source_snapshots SET status = 'ready', loaded_rows = n, published_at = now(), lease_owner = NULL, lease_until = NULL, last_error = NULL WHERE id = _snapshot_id;
  IF advance THEN UPDATE public.source_datasets SET latest_snapshot_id = _snapshot_id, updated_at = now() WHERE id = s.dataset_id; END IF;
  RETURN jsonb_build_object('published',true,'current',advance,'rows',n);
END $$;

CREATE OR REPLACE FUNCTION public.source_release_snapshot(_snapshot_id text, _owner text, _failed boolean DEFAULT false, _error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SET search_path = public AS $$
DECLARE changed integer;
BEGIN
  IF coalesce(length(_owner),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid source lease owner'; END IF;
  UPDATE public.source_snapshots SET status = CASE WHEN _failed THEN 'failed' ELSE 'staging' END,
    lease_owner = NULL, lease_until = NULL, last_error = left(_error,2000)
    WHERE id = _snapshot_id AND status = 'staging' AND lease_owner = _owner;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

REVOKE ALL ON public.source_files,public.source_datasets,public.source_snapshots,public.source_records FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.source_files,public.source_datasets,public.source_snapshots,public.source_records TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.source_files,public.source_datasets,public.source_snapshots TO service_role;
GRANT SELECT,INSERT ON public.source_records TO service_role;
ALTER TABLE public.source_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members read published source snapshots" ON public.source_snapshots;
CREATE POLICY "Members read published source snapshots" ON public.source_snapshots FOR SELECT TO authenticated USING ((SELECT public.has_app_access(auth.uid())) AND status = 'ready');
DROP POLICY IF EXISTS "Members read published source datasets" ON public.source_datasets;
CREATE POLICY "Members read published source datasets" ON public.source_datasets FOR SELECT TO authenticated USING ((SELECT public.has_app_access(auth.uid())) AND EXISTS (SELECT 1 FROM public.source_snapshots s WHERE s.dataset_id = source_datasets.id AND s.id = source_datasets.latest_snapshot_id AND s.status = 'ready'));
DROP POLICY IF EXISTS "Members read published source records" ON public.source_records;
CREATE POLICY "Members read published source records" ON public.source_records FOR SELECT TO authenticated USING ((SELECT public.has_app_access(auth.uid())) AND EXISTS (SELECT 1 FROM public.source_snapshots s WHERE s.id = source_records.snapshot_id AND s.status = 'ready'));
DROP POLICY IF EXISTS "Members read published source files" ON public.source_files;
CREATE POLICY "Members read published source files" ON public.source_files FOR SELECT TO authenticated USING ((SELECT public.has_app_access(auth.uid())) AND EXISTS (SELECT 1 FROM public.source_snapshots s WHERE s.file_sha256 = source_files.sha256 AND s.status = 'ready'));
-- Upload tickets contain temporary object-scoped capabilities. They have their own private bucket;
-- this restrictive policy also covers installations with an existing permissive catch-all policy.
-- The private 5 MiB ticket bucket is provisioned through the Storage API, outside managed SQL.
DROP POLICY IF EXISTS "Official source upload tickets are private" ON storage.objects;
CREATE POLICY "Official source upload tickets are private" ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING (bucket_id <> 'official-ingest-tickets');

CREATE OR REPLACE FUNCTION public.source_list_datasets(_sector text DEFAULT NULL, _agency text DEFAULT NULL, _q text DEFAULT NULL, _after text DEFAULT NULL, _limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE result jsonb; total bigint; sectors jsonb; agencies jsonb;
BEGIN
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 1000 OR length(coalesce(_q,'')) > 200 THEN RAISE EXCEPTION 'invalid source list bounds'; END IF;
  SELECT count(*) INTO total FROM public.source_datasets d WHERE (_sector IS NULL OR d.sector = _sector) AND (_agency IS NULL OR d.agency = _agency)
    AND (_q IS NULL OR strpos(lower(d.name || ' ' || d.description || ' ' || d.agency),lower(_q)) > 0);
  SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO sectors FROM (SELECT DISTINCT sector v FROM public.source_datasets) x;
  SELECT coalesce(jsonb_agg(v ORDER BY v),'[]'::jsonb) INTO agencies FROM (SELECT DISTINCT agency v FROM public.source_datasets) x;
  SELECT coalesce(jsonb_agg(x.row ORDER BY x.id),'[]'::jsonb) INTO result FROM (
    SELECT d.id,to_jsonb(d) || jsonb_build_object('latest_snapshot',jsonb_build_object('id',s.id,'status',s.status,'expected_rows',s.expected_rows,'loaded_rows',s.loaded_rows,'retrieved_at',s.retrieved_at,'published_at',s.published_at,'coverage',s.coverage,'quality',s.quality)) AS row
    FROM public.source_datasets d JOIN public.source_snapshots s ON s.id = d.latest_snapshot_id
    WHERE (_sector IS NULL OR d.sector = _sector) AND (_agency IS NULL OR d.agency = _agency)
      AND (_after IS NULL OR d.id > _after) AND (_q IS NULL OR strpos(lower(d.name || ' ' || d.description || ' ' || d.agency),lower(_q)) > 0)
    ORDER BY d.id LIMIT _limit
  ) x;
  RETURN jsonb_build_object('datasets',result,'total',total,'sectors',sectors,'agencies',agencies,
    'nextCursor',CASE WHEN jsonb_array_length(result) = _limit THEN result->-1->>'id' ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION public.source_get_dataset(_id text, _snapshot_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE d public.source_datasets; s public.source_snapshots; f public.source_files;
BEGIN
  SELECT * INTO d FROM public.source_datasets WHERE id = _id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.source_snapshots WHERE id = coalesce(_snapshot_id,d.latest_snapshot_id) AND dataset_id = d.id AND status = 'ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'published source snapshot not found for this dataset'; END IF;
  SELECT * INTO f FROM public.source_files WHERE sha256 = s.file_sha256;
  RETURN jsonb_build_object('dataset',to_jsonb(d),'snapshot',to_jsonb(s) - 'lease_owner' - 'lease_until' - 'last_error','file',to_jsonb(f));
END $$;

CREATE OR REPLACE FUNCTION public.source_query_records(_dataset_id text, _snapshot_id text DEFAULT NULL, _entity text DEFAULT NULL, _geography text DEFAULT NULL, _period text DEFAULT NULL, _q text DEFAULT NULL, _after bigint DEFAULT 0, _limit integer DEFAULT 50, _columns integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s public.source_snapshots; cols integer[]; descriptors jsonb; result jsonb := '[]'::jsonb;
  r public.source_records; projected jsonb; more boolean := false; last_row bigint; taken integer := 0;
BEGIN
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 OR _after IS NULL OR _after < 0 OR length(coalesce(_q,'')) > 200 THEN RAISE EXCEPTION 'invalid source record query bounds'; END IF;
  SELECT * INTO s FROM public.source_snapshots WHERE id = coalesce(_snapshot_id,(SELECT latest_snapshot_id FROM public.source_datasets WHERE id = _dataset_id)) AND dataset_id = _dataset_id AND status = 'ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'published source snapshot not found for this dataset'; END IF;
  cols := coalesce(_columns,ARRAY(SELECT generate_series(0,least(24,jsonb_array_length(s.columns))-1)));
  IF cardinality(cols) NOT BETWEEN 1 AND 64 OR EXISTS (SELECT 1 FROM unnest(cols) c WHERE c < 0 OR c >= jsonb_array_length(s.columns) OR c IS NULL)
    OR (SELECT count(DISTINCT c) FROM unnest(cols) c) <> cardinality(cols) THEN RAISE EXCEPTION 'invalid source column projection'; END IF;
  SELECT jsonb_agg(s.columns->c ORDER BY n) INTO descriptors FROM unnest(cols) WITH ORDINALITY u(c,n);
  FOR r IN SELECT * FROM public.source_records rr WHERE rr.snapshot_id = s.id AND rr.row_number > _after
    AND (_entity IS NULL OR rr.entity_id = _entity OR rr.entity_name = _entity)
    AND (_geography IS NULL OR rr.geo_code = _geography OR rr.geo_name = _geography)
    AND (_period IS NULL OR rr.period = _period)
    AND (_q IS NULL OR strpos(lower(coalesce(rr.entity_id,'') || ' ' || coalesce(rr.entity_name,'') || ' ' || coalesce(rr.geo_code,'') || ' ' || coalesce(rr.geo_name,'') || ' ' || coalesce(rr.period,'')),lower(_q)) > 0)
    ORDER BY rr.row_number LIMIT _limit + 1 LOOP
    IF taken = _limit THEN more := true; EXIT; END IF;
    SELECT jsonb_agg(r."values"->c ORDER BY n) INTO projected FROM unnest(cols) WITH ORDINALITY u(c,n);
    result := result || jsonb_build_array(jsonb_build_object('row_number',r.row_number,'values',projected,
      'entity_id',r.entity_id,'entity_name',r.entity_name,'period',r.period,'geo_level',r.geo_level,
      'geo_code',r.geo_code,'geo_name',r.geo_name,'source_url',r.source_url));
    last_row := r.row_number; taken := taken + 1;
  END LOOP;
  RETURN jsonb_build_object('dataset_id',_dataset_id,'snapshot_id',s.id,'columns',descriptors,'column_indices',to_jsonb(cols),'rows',result,'nextCursor',CASE WHEN more THEN last_row ELSE NULL END,'hasMore',more,'total',s.expected_rows);
END $$;

-- No default PUBLIC function execution, no anonymous research access, and no public write RPC.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'source\_%' LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || f.sig || ' FROM PUBLIC,anon,authenticated,service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f.sig || ' TO service_role';
    IF f.proname IN ('source_list_datasets','source_get_dataset','source_query_records') THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION ' || f.sig || ' TO authenticated';
    END IF;
  END LOOP;
END $$;
