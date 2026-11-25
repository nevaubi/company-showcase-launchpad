-- Official source reads, round 4. What this adds and changes:
--   1. source_query_records: same arguments and result keys as 0068 plus "scanned" and "scanComplete". A call
--      examines at most 50,000 rows for conditions no index answers and then stops with a cursor, so a search can
--      no longer walk a whole snapshot (review rev-sql M1).
--   2. source_snapshot_stats: per published snapshot the least and greatest period strings, distinct counts of
--      periods, entities and places, and the lowercased field labels; filled by the service role
--      (source_compute_snapshot_stats, source_compute_missing_stats). This file fills labels for every published
--      snapshot and the period range of every dataset's current snapshot (index probes only).
--   3. Member reads that the app uses when they exist: source_facets (values of one dimension with row counts),
--      source_find (catalogue search over names, publishers, source ids, grain, descriptions and field labels),
--      source_library (the two small tables in one call), source_get_snapshot_stats.
--   4. Storage: a restrictive policy keeps vendor archives, operations files and raw official parts in the
--      datasets bucket private to the service role (review M2).
--   5. Autovacuum settings for source_records, so new snapshots get visibility bits and statistics within
--      200,000 rows (review S4).
-- Not changed: no grant is revoked from any role on anything that existed before this file. Members keep SELECT on
-- the four 0068 tables under their row-level security: the app's direct, bounded reads rely on it. The new
-- functions are SECURITY INVOKER like those of 0068, so row-level security decides what a caller reads, and every
-- scan of source_records is ordered by an existing index with a hard row limit. No new index.
-- The project's default privileges grant every new table and function to anon, authenticated and service_role, so
-- each new object starts from REVOKE ALL and gets explicit grants.
-- The whole file can be applied twice: every statement creates what is missing or replaces a definition with the
-- same one.

-- 1. Records page. Against 0068: an entity or geography filter reads its two index ranges (id, then name where the
--    id differs) in row order and merges them; at most 50,000 rows are examined per call for anything an index
--    cannot answer, and when that ends a call early "scanComplete" is false, "hasMore" true and "nextCursor" the last
--    row examined, so the next call continues there and never repeats or skips a row; the wide "values" cell is read
--    only for the rows returned. Tested against the 0068 function on 550 random calls (review rev-sql, M1).
CREATE OR REPLACE FUNCTION public.source_query_records(_dataset_id text, _snapshot_id text DEFAULT NULL, _entity text DEFAULT NULL, _geography text DEFAULT NULL, _period text DEFAULT NULL, _q text DEFAULT NULL, _after bigint DEFAULT 0, _limit integer DEFAULT 50, _columns integer[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s public.source_snapshots; cols integer[]; descriptors jsonb; result jsonb; r record;
  scan_cap constant integer := 50000; needle text := lower(_q); driver text; pick constant text := 'SELECT row_number,entity_id,entity_name,period,geo_code,geo_name FROM public.source_records WHERE snapshot_id = $1 AND row_number > $2';
  ids bigint[] := '{}'; taken integer := 0; examined integer := 0; more boolean := false; capped boolean := false; last_row bigint; last_examined bigint;
BEGIN
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 100 OR _after IS NULL OR _after < 0 OR length(coalesce(_q,'')) > 200 THEN RAISE EXCEPTION 'invalid source record query bounds'; END IF;
  SELECT * INTO s FROM public.source_snapshots WHERE id = coalesce(_snapshot_id,(SELECT latest_snapshot_id FROM public.source_datasets WHERE id = _dataset_id)) AND dataset_id = _dataset_id AND status = 'ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'published source snapshot not found for this dataset'; END IF;
  cols := coalesce(_columns,ARRAY(SELECT generate_series(0,least(24,jsonb_array_length(s.columns))-1)));
  IF cardinality(cols) NOT BETWEEN 1 AND 64 OR EXISTS (SELECT 1 FROM unnest(cols) c WHERE c < 0 OR c >= jsonb_array_length(s.columns) OR c IS NULL)
    OR (SELECT count(DISTINCT c) FROM unnest(cols) c) <> cardinality(cols) THEN RAISE EXCEPTION 'invalid source column projection'; END IF;
  SELECT jsonb_agg(s.columns->c ORDER BY n) INTO descriptors FROM unnest(cols) WITH ORDINALITY u(c,n);
  -- One filter drives the scan through its own index, in row order; the others are checked on its rows.
  IF _entity IS NOT NULL THEN
    driver := '(' || pick || ' AND entity_id = $3 ORDER BY row_number LIMIT $6) UNION ALL (' || pick || ' AND entity_name = $3 AND entity_id IS DISTINCT FROM $3 ORDER BY row_number LIMIT $6)';
  ELSIF _geography IS NOT NULL THEN
    driver := '(' || pick || ' AND geo_code = $4 ORDER BY row_number LIMIT $6) UNION ALL (' || pick || ' AND geo_name = $4 AND geo_code IS DISTINCT FROM $4 ORDER BY row_number LIMIT $6)';
  ELSIF _period IS NOT NULL THEN
    driver := pick || ' AND period = $5 ORDER BY row_number LIMIT $6';
  ELSE
    driver := pick || ' ORDER BY row_number LIMIT $6';
  END IF;
  FOR r IN EXECUTE 'SELECT * FROM (' || driver || ') d ORDER BY row_number LIMIT $6' USING s.id, _after, _entity, _geography, _period, scan_cap + 1 LOOP
    examined := examined + 1;
    IF examined > scan_cap THEN capped := true; EXIT; END IF;
    last_examined := r.row_number;
    CONTINUE WHEN _entity IS NOT NULL AND _geography IS NOT NULL AND NOT (coalesce(r.geo_code = _geography,false) OR coalesce(r.geo_name = _geography,false));
    CONTINUE WHEN (_entity IS NOT NULL OR _geography IS NOT NULL) AND _period IS NOT NULL AND NOT coalesce(r.period = _period,false);
    CONTINUE WHEN needle IS NOT NULL AND NOT strpos(lower(coalesce(r.entity_id,'') || ' ' || coalesce(r.entity_name,'') || ' ' || coalesce(r.geo_code,'') || ' ' || coalesce(r.geo_name,'') || ' ' || coalesce(r.period,'')),needle) > 0;
    IF taken = _limit THEN more := true; EXIT; END IF;
    ids := ids || r.row_number; taken := taken + 1; last_row := r.row_number;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('row_number',rr.row_number,'values',(SELECT jsonb_agg(rr."values"->c ORDER BY n) FROM unnest(cols) WITH ORDINALITY u(c,n)),
      'entity_id',rr.entity_id,'entity_name',rr.entity_name,'period',rr.period,'geo_level',rr.geo_level,
      'geo_code',rr.geo_code,'geo_name',rr.geo_name,'source_url',rr.source_url) ORDER BY rr.row_number),'[]'::jsonb)
    INTO result FROM public.source_records rr WHERE rr.snapshot_id = s.id AND rr.row_number = ANY(ids);
  RETURN jsonb_build_object('dataset_id',_dataset_id,'snapshot_id',s.id,'columns',descriptors,'column_indices',to_jsonb(cols),'rows',result,
    'nextCursor',CASE WHEN more THEN last_row WHEN capped THEN last_examined ELSE NULL END,'hasMore',more OR capped,'total',s.expected_rows,
    'scanned',least(examined,scan_cap),'scanComplete',NOT capped);
END $$;
GRANT EXECUTE ON FUNCTION public.source_query_records(text, text, text, text, text, text, bigint, integer, integer[]) TO authenticated, service_role;

-- 2. Snapshot statistics. A published snapshot never changes, so a row is computed once. period_min and
--    period_max are the least and greatest period strings in index order (text order, not time order). A count is
--    null until computed, and stays null when the snapshot has more distinct values than the pass may count.
--    labels is the dictionary's labels in field order, lowercased, one per line (for source_find). computed_at is
--    set when the counts were computed. Members read rows of published snapshots, like the 0068 tables.
CREATE TABLE IF NOT EXISTS public.source_snapshot_stats (
  snapshot_id text PRIMARY KEY REFERENCES public.source_snapshots(id),
  period_min text,
  period_max text,
  periods bigint CHECK (periods >= 0),
  entities bigint CHECK (entities >= 0),
  geographies bigint CHECK (geographies >= 0),
  labels text,
  computed_at timestamptz
);
ALTER TABLE public.source_snapshot_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_snapshot_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.source_snapshot_stats TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.source_snapshot_stats TO service_role;
DROP POLICY IF EXISTS "Members read statistics of published source snapshots" ON public.source_snapshot_stats;
CREATE POLICY "Members read statistics of published source snapshots" ON public.source_snapshot_stats FOR SELECT TO authenticated USING ((SELECT public.has_app_access(auth.uid())) AND EXISTS (SELECT 1 FROM public.source_snapshots s WHERE s.id = source_snapshot_stats.snapshot_id AND s.status = 'ready'));

-- The snapshot as every new read names it (the app's SourceSnapshotRef).
CREATE OR REPLACE FUNCTION public.source_snapshot_ref(s public.source_snapshots) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('datasetId', s.dataset_id, 'snapshotId', s.id, 'publishedAt', s.published_at, 'retrievedAt', s.retrieved_at,
    'fileSha256', s.file_sha256, 'rows', s.loaded_rows, 'fields', s.column_count)
$$;

-- Distinct values of one dimension of one snapshot, counted by stepping through the dimension's index from one value
-- to the next (one index probe per distinct value, whatever the number of rows). Null when there are more than
-- _max_values. For the service role.
CREATE OR REPLACE FUNCTION public.source_count_distinct(_snapshot_id text, _dimension text, _max_values integer)
RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  IF _dimension IS NULL OR _dimension NOT IN ('entity_id','entity_name','period','geo_code','geo_name') OR _max_values IS NULL OR _max_values NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'invalid source stats bounds'; END IF;
  EXECUTE format($q$
    WITH RECURSIVE t(v, n) AS (
      (SELECT r.%1$I, 1::bigint FROM public.source_records r WHERE r.snapshot_id = $1 AND r.%1$I IS NOT NULL ORDER BY r.%1$I LIMIT 1)
      UNION ALL
      SELECT nx.v, t.n + 1 FROM t CROSS JOIN LATERAL (SELECT r.%1$I AS v FROM public.source_records r WHERE r.snapshot_id = $1 AND r.%1$I > t.v ORDER BY r.%1$I LIMIT 1) nx
      WHERE t.n <= $2)
    SELECT count(*) FROM t
  $q$, _dimension) INTO n USING _snapshot_id, _max_values;
  RETURN CASE WHEN n > _max_values THEN NULL ELSE n END;
END $$;

-- Fills the statistics of one published snapshot. For the service role. entities counts distinct entity ids, or
-- distinct entity names when the snapshot fills no id; geographies likewise for codes and names.
CREATE OR REPLACE FUNCTION public.source_compute_snapshot_stats(_snapshot_id text, _max_values integer DEFAULT 100000)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.source_snapshots; pmin text; pmax text; np bigint; ne bigint := 0; ng bigint := 0; lab text; st public.source_snapshot_stats;
BEGIN
  IF _max_values IS NULL OR _max_values NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'invalid source stats bounds'; END IF;
  SELECT * INTO s FROM public.source_snapshots WHERE id = _snapshot_id AND status = 'ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'published source snapshot not found'; END IF;
  SELECT r.period INTO pmin FROM public.source_records r WHERE r.snapshot_id = s.id AND r.period IS NOT NULL ORDER BY r.period, r.row_number LIMIT 1;
  SELECT r.period INTO pmax FROM public.source_records r WHERE r.snapshot_id = s.id AND r.period IS NOT NULL ORDER BY r.period DESC, r.row_number DESC LIMIT 1;
  np := CASE WHEN pmin IS NULL THEN 0 ELSE public.source_count_distinct(s.id, 'period', _max_values) END;
  IF EXISTS (SELECT 1 FROM public.source_records r WHERE r.snapshot_id = s.id AND r.entity_id IS NOT NULL) THEN ne := public.source_count_distinct(s.id, 'entity_id', _max_values);
  ELSIF EXISTS (SELECT 1 FROM public.source_records r WHERE r.snapshot_id = s.id AND r.entity_name IS NOT NULL) THEN ne := public.source_count_distinct(s.id, 'entity_name', _max_values); END IF;
  IF EXISTS (SELECT 1 FROM public.source_records r WHERE r.snapshot_id = s.id AND r.geo_code IS NOT NULL) THEN ng := public.source_count_distinct(s.id, 'geo_code', _max_values);
  ELSIF EXISTS (SELECT 1 FROM public.source_records r WHERE r.snapshot_id = s.id AND r.geo_name IS NOT NULL) THEN ng := public.source_count_distinct(s.id, 'geo_name', _max_values); END IF;
  SELECT lower(string_agg(coalesce(e->>'label', ''), E'\n' ORDER BY o)) INTO lab FROM jsonb_array_elements(s.columns) WITH ORDINALITY x(e, o);
  INSERT INTO public.source_snapshot_stats AS t (snapshot_id, period_min, period_max, periods, entities, geographies, labels, computed_at)
    VALUES (s.id, pmin, pmax, np, ne, ng, lab, now())
    ON CONFLICT (snapshot_id) DO UPDATE SET period_min = EXCLUDED.period_min, period_max = EXCLUDED.period_max, periods = EXCLUDED.periods,
      entities = EXCLUDED.entities, geographies = EXCLUDED.geographies, labels = EXCLUDED.labels, computed_at = EXCLUDED.computed_at
    RETURNING * INTO st;
  RETURN to_jsonb(st) - 'labels';
END $$;

-- Computes the statistics of up to _max_snapshots published snapshots that have none yet, newest first. For the
-- service role (the worker calls it on a schedule). Returns how many it computed.
CREATE OR REPLACE FUNCTION public.source_compute_missing_stats(_max_snapshots integer DEFAULT 10, _max_values integer DEFAULT 100000)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE id text; n integer := 0;
BEGIN
  IF _max_snapshots IS NULL OR _max_snapshots NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid source stats bounds'; END IF;
  FOR id IN SELECT s.id FROM public.source_snapshots s LEFT JOIN public.source_snapshot_stats t ON t.snapshot_id = s.id
    WHERE s.status = 'ready' AND t.computed_at IS NULL ORDER BY s.published_at DESC NULLS LAST, s.id LIMIT _max_snapshots LOOP
    PERFORM public.source_compute_snapshot_stats(id, _max_values);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- Labels for every published snapshot, and the period range of each dataset's current snapshot: two probes of the
-- period index each (both ends), never a scan. Counts are left to the worker.
INSERT INTO public.source_snapshot_stats (snapshot_id, period_min, period_max, labels)
SELECT s.id,
  CASE WHEN d.id IS NOT NULL THEN (SELECT r.period FROM public.source_records r WHERE r.snapshot_id = s.id AND r.period IS NOT NULL ORDER BY r.period, r.row_number LIMIT 1) END,
  CASE WHEN d.id IS NOT NULL THEN (SELECT r.period FROM public.source_records r WHERE r.snapshot_id = s.id AND r.period IS NOT NULL ORDER BY r.period DESC, r.row_number DESC LIMIT 1) END,
  (SELECT lower(string_agg(coalesce(e->>'label', ''), E'\n' ORDER BY o)) FROM jsonb_array_elements(s.columns) WITH ORDINALITY x(e, o))
FROM public.source_snapshots s LEFT JOIN public.source_datasets d ON d.id = s.dataset_id AND d.latest_snapshot_id = s.id
WHERE s.status = 'ready'
ON CONFLICT (snapshot_id) DO NOTHING;

-- 3. Member reads. Each resolves the snapshot as the 0068 reads do (given, or the dataset's current one, and
--    published) and answers in the app's shapes (src/lib/sources/read-types.ts).

-- Statistics of one snapshot; nulls where they are not computed yet.
CREATE OR REPLACE FUNCTION public.source_get_snapshot_stats(_dataset_id text, _snapshot_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s public.source_snapshots; st public.source_snapshot_stats;
BEGIN
  SELECT * INTO s FROM public.source_snapshots WHERE id = coalesce(_snapshot_id,(SELECT latest_snapshot_id FROM public.source_datasets WHERE id = _dataset_id)) AND dataset_id = _dataset_id AND status = 'ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'published source snapshot not found for this dataset'; END IF;
  SELECT * INTO st FROM public.source_snapshot_stats WHERE snapshot_id = s.id;
  RETURN jsonb_build_object('snapshot', public.source_snapshot_ref(s), 'periodMin', st.period_min, 'periodMax', st.period_max,
    'periods', st.periods, 'entities', st.entities, 'geographies', st.geographies, 'computedAt', st.computed_at);
END $$;

-- Facets. Distinct values of one dimension with their row counts, in value order, read from that dimension's own
-- index (snapshot, value, row), index-only once the visibility map is set (statement 5). One call reads at most
-- _scan_limit index entries after _after. "complete" true means every value after _after is in the answer with an
-- exact count; otherwise "nextAfter" is where the next call continues. A value with more rows than the limit comes
-- back once with "exact" false and the limit as its floor. Rows whose dimension is null are not counted. _contains
-- keeps values that contain the text (lower case). An id's label is the name on the first row with that id.
CREATE OR REPLACE FUNCTION public.source_facets(_dataset_id text, _snapshot_id text DEFAULT NULL, _dimension text DEFAULT 'entity_id', _after text DEFAULT NULL, _contains text DEFAULT NULL, _limit integer DEFAULT 200, _scan_limit integer DEFAULT 250000)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE s public.source_snapshots; res jsonb; label_col text;
BEGIN
  IF _dimension IS NULL OR _dimension NOT IN ('entity_id','entity_name','period','geo_code','geo_name') OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 1000
    OR _scan_limit IS NULL OR _scan_limit NOT BETWEEN 1000 AND 1000000 OR length(coalesce(_after,'')) > 512 OR length(coalesce(_contains,'')) > 200 THEN RAISE EXCEPTION 'invalid source facet bounds'; END IF;
  SELECT * INTO s FROM public.source_snapshots WHERE id = coalesce(_snapshot_id,(SELECT latest_snapshot_id FROM public.source_datasets WHERE id = _dataset_id)) AND dataset_id = _dataset_id AND status = 'ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'published source snapshot not found for this dataset'; END IF;
  label_col := CASE _dimension WHEN 'entity_id' THEN 'entity_name' WHEN 'geo_code' THEN 'geo_name' END;
  EXECUTE format($q$
    WITH g AS MATERIALIZED (
      SELECT x.v, count(*) AS n FROM (
        SELECT r.%1$I AS v FROM public.source_records r
        WHERE r.snapshot_id = $1 AND r.%1$I IS NOT NULL %2$s
        ORDER BY r.%1$I, r.row_number LIMIT $3) x
      GROUP BY x.v),
    tot AS (SELECT coalesce(sum(n),0) AS scanned, coalesce(sum(n),0) > $4 AS overflow FROM g),
    edge AS (SELECT max(v) AS last_v, count(*) AS groups FROM g),
    ok AS (SELECT g.v, CASE WHEN tot.overflow AND g.v = edge.last_v THEN $4 ELSE g.n END AS n, NOT (tot.overflow AND g.v = edge.last_v) AS exact
           FROM g, tot, edge WHERE NOT (tot.overflow AND g.v = edge.last_v AND edge.groups > 1)),
    hit AS (SELECT * FROM ok WHERE $5::text IS NULL OR strpos(lower(v), lower($5)) > 0),
    page AS (SELECT * FROM hit ORDER BY v LIMIT $6)
    SELECT jsonb_build_object(
      'scanned', (SELECT least(scanned, $4) FROM tot),
      'complete', NOT (SELECT overflow FROM tot) AND (SELECT count(*) FROM hit) <= $6,
      'nextAfter', CASE WHEN (SELECT count(*) FROM hit) > $6 THEN (SELECT max(v) FROM page) WHEN (SELECT overflow FROM tot) THEN (SELECT max(v) FROM ok) END,
      'values', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', p.v, 'label', %3$s, 'rows', p.n, 'exact', p.exact) ORDER BY p.v), '[]'::jsonb) FROM page p))
  $q$, _dimension, CASE WHEN _after IS NULL THEN '' ELSE format('AND r.%I > $2', _dimension) END,
     CASE WHEN label_col IS NULL THEN 'NULL::text' ELSE format('(SELECT r2.%I FROM public.source_records r2 WHERE r2.snapshot_id = $1 AND r2.%I = p.v ORDER BY r2.row_number LIMIT 1)', label_col, _dimension) END)
    INTO res USING s.id, _after, _scan_limit + 1, _scan_limit, _contains, _limit;
  RETURN jsonb_build_object('snapshot', public.source_snapshot_ref(s), 'dimension', _dimension, 'scanLimit', _scan_limit) || res;
END $$;

-- Catalogue search. Every word of _q (up to 8, lower case) must occur in the dataset's name, source id, publisher,
-- grain or description, or in a field label of its current snapshot. Ranked by where the words were found (name 6,
-- source id 5, publisher 3, grain 2, description 1, field label 0.5), then by rows. Small tables only.
CREATE OR REPLACE FUNCTION public.source_find(_q text, _limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE words text[]; res jsonb;
BEGIN
  IF _q IS NULL OR length(_q) > 200 OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid source find bounds'; END IF;
  SELECT coalesce(array_agg(w ORDER BY o), '{}') INTO words FROM (
    SELECT w, min(o) AS o FROM regexp_split_to_table(lower(_q), '[[:space:]]+') WITH ORDINALITY t(w, o) WHERE w <> '' GROUP BY w ORDER BY min(o) LIMIT 8) x;
  IF cardinality(words) = 0 THEN RAISE EXCEPTION 'invalid source find bounds'; END IF;
  WITH c AS MATERIALIZED (
    SELECT d.id, d.name, d.sector, d.agency, s.id AS snapshot_id, s.loaded_rows AS rows,
      lower(d.name) AS n, lower(coalesce(d.source_id, '')) AS sid, lower(d.agency) AS a, lower(d.grain) AS g, lower(d.description) AS ds,
      coalesce(st.labels, (SELECT lower(string_agg(coalesce(e->>'label', ''), E'\n')) FROM jsonb_array_elements(s.columns) e)) AS labels
    FROM public.source_datasets d
    JOIN public.source_snapshots s ON s.id = d.latest_snapshot_id AND s.dataset_id = d.id AND s.status = 'ready'
    LEFT JOIN public.source_snapshot_stats st ON st.snapshot_id = s.id),
  w AS (
    SELECT c.id, x.word, CASE WHEN strpos(c.n, x.word) > 0 THEN 'name' WHEN strpos(c.sid, x.word) > 0 THEN 'source_id' WHEN strpos(c.a, x.word) > 0 THEN 'agency'
      WHEN strpos(c.g, x.word) > 0 THEN 'grain' WHEN strpos(c.ds, x.word) > 0 THEN 'description' WHEN strpos(c.labels, x.word) > 0 THEN 'field' END AS place
    FROM c CROSS JOIN unnest(words) x(word)),
  h AS (
    SELECT w.id, sum(CASE w.place WHEN 'name' THEN 6 WHEN 'source_id' THEN 5 WHEN 'agency' THEN 3 WHEN 'grain' THEN 2 WHEN 'description' THEN 1 ELSE 0.5 END) AS rank,
      array_agg(DISTINCT w.place) AS places
    FROM w GROUP BY w.id HAVING bool_and(w.place IS NOT NULL)),
  top AS (SELECT c.id, c.name, c.sector, c.agency, c.snapshot_id, c.rows, h.rank, h.places FROM h JOIN c ON c.id = h.id ORDER BY h.rank DESC, c.rows DESC, c.id LIMIT _limit)
  SELECT jsonb_build_object('q', _q, 'hits', coalesce(jsonb_agg(jsonb_build_object(
      'datasetId', t.id, 'name', t.name, 'sector', t.sector, 'agency', t.agency, 'rows', t.rows,
      'matched', (SELECT jsonb_agg(p ORDER BY array_position(ARRAY['name','source_id','agency','grain','description','field'], p)) FROM unnest(t.places) p),
      'fields', CASE WHEN 'field' = ANY(t.places) THEN (SELECT coalesce(jsonb_agg(f.l ORDER BY f.o), '[]'::jsonb) FROM (
          SELECT e->>'label' AS l, o FROM public.source_snapshots s2, jsonb_array_elements(s2.columns) WITH ORDINALITY x(e, o)
          WHERE s2.id = t.snapshot_id AND EXISTS (SELECT 1 FROM unnest(words) y(word) WHERE strpos(lower(e->>'label'), y.word) > 0) ORDER BY o LIMIT 3) f) ELSE '[]'::jsonb END,
      'rank', t.rank) ORDER BY t.rank DESC, t.rows DESC, t.id), '[]'::jsonb)) INTO res FROM top t;
  RETURN res;
END $$;

-- The library in one call: the dataset rows and the published snapshots the app's buildLibrary reads, in the keys of
-- its direct selects. Small tables only; never reads source_records.
CREATE OR REPLACE FUNCTION public.source_library()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'datasets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'sector', d.sector, 'agency', d.agency, 'source_id', d.source_id,
        'source_url', d.source_url, 'grain', d.grain, 'latest_snapshot_id', d.latest_snapshot_id) ORDER BY d.id), '[]'::jsonb) FROM public.source_datasets d),
    'snapshots', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'dataset_id', s.dataset_id, 'loaded_rows', s.loaded_rows, 'column_count', s.column_count,
        'published_at', s.published_at, 'retrieved_at', s.retrieved_at, 'dims', s.ingest->'dimensions', 'consts', s.ingest->'constants',
        'comp', s.ingest->'composites', 'family', s.coverage->'refresh_provenance'->>'family') ORDER BY s.id), '[]'::jsonb)
      FROM public.source_snapshots s WHERE s.status = 'ready'))
$$;

-- 4. Storage: members keep reading the app's own files in the datasets bucket, but not the vendor archives, the
--    operations files or the raw official parts kept beside them. A restrictive policy only narrows what the
--    permissive ones allow; the service role bypasses row-level security, so imports are unaffected (review M2).
DROP POLICY IF EXISTS "Vendor, ops and raw official files are private" ON storage.objects;
CREATE POLICY "Vendor, ops and raw official files are private" ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (bucket_id <> 'datasets' OR (name NOT LIKE 'vendor/%' AND name NOT LIKE 'ops/%' AND name NOT LIKE 'official/%'));

-- 5. Autovacuum for an insert-only table of this size: with the defaults a vacuum starts only after 20 % of the table
--    has been inserted (about 4 million rows), so new snapshots have no visibility bits and no statistics for days.
--    These start one after 200,000 new rows (review S4).
ALTER TABLE public.source_records SET (autovacuum_vacuum_insert_scale_factor = 0, autovacuum_vacuum_insert_threshold = 200000,
  autovacuum_analyze_scale_factor = 0, autovacuum_analyze_threshold = 200000);

-- 6. Who may run the new functions: members the reads, the service role everything. Nothing for anon or PUBLIC.
REVOKE ALL ON FUNCTION public.source_snapshot_ref(public.source_snapshots) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_snapshot_ref(public.source_snapshots) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.source_count_distinct(text, text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_count_distinct(text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.source_compute_snapshot_stats(text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_compute_snapshot_stats(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.source_compute_missing_stats(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_compute_missing_stats(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.source_get_snapshot_stats(text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_get_snapshot_stats(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.source_facets(text, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_facets(text, text, text, text, text, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.source_find(text, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_find(text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.source_library() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.source_library() TO authenticated, service_role;
