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

-- ============================================================================================================
-- Part from unit `abs` of round 4, appended verbatim from /home/claude/work/r4/abs/0069_part_abs_read.sql
-- (SHA-256 dc36ae0b603aa2f425e45ad1a47400f7adeb997f91cbc6fef5887a449de1aca7). Unit `abs` describes it as optional: its view reads by direct selects and uses these objects as
-- a test oracle. Applied twice locally over 0067 beside the statements above; no name is shared with them.
-- ============================================================================================================
-- Part of migration 0069: what the "Securitized credit" view of the Alt data page reads.
-- Written by unit `abs` of round 4; the lead assembles the migration. Rules: src/lib/abs/AGENTS.md.
--
-- Three objects, all for signed-in members and all run as the caller, so the row security of the abs_*
-- tables (migration 0067) stays in force: a caller without app access gets empty results, not an error.
--
--   abs_filing_periods   one row per loaded filing with the period its records state and the two dated
--                        facts the page calls "offering-stage" on. Nothing is stored: the stage is read
--                        from the filing's own dates each time.
--   abs_monitor(family)  one call for the deal monitor of one family, with the coverage counts.
--   abs_deal(deal_id)    one call for a deal page: the deal, every filing, the figures of its current
--                        filings, the breakdowns of the newest one and, for commercial mortgages, the
--                        loan and property records of the newest one.
--
-- The whole file can be applied twice: every statement replaces a definition with the same one.

-- The period a filing's records state is the date-shaped bucket of the figure `records` split by
-- `period_end` (src/lib/abs/auto.ts, cmbs.ts): both readers store it for every file. A file can hold
-- records without a period (property rows of a commercial mortgage file: the bucket "(blank)"); a file
-- whose records state more than one period end is reported through `period_ends`.
--
-- Stage, by dates only. A filing dated to a period that had not ended when it was filed cannot be a
-- report on that period: it describes a pool at a cut-off, made for an offering.
--   records_after_filing  the records state a period end later than the filing date
--   cover_after_filing    the cover period in the EDGAR header ends after the filing date
-- An offering file dated to a past cut-off by both clocks is not recognised by either: nothing stored
-- says more (src/lib/abs/AGENTS.md, "Nothing here says whether a file is an offering-stage pool").
--
-- alone_amendment is the condition of abs_review(), which members cannot call: an ABS-EE/A that shares
-- its cover period with no other loaded filing of the deal, so the filing it replaces is not tied to it.
CREATE OR REPLACE VIEW public.abs_filing_periods WITH (security_invoker = true) AS
  SELECT f.accession, f.deal_id, f.list_cik, f.form, f.filed, f.accepted_at,
         f.period_start AS cover_period_start, f.period_end AS cover_period_end,
         f.is_current, f.superseded_by, f.load_id, f.loaded_at,
         p.records_period_end, p.period_ends,
         coalesce(p.records_period_end > f.filed, false) AS records_after_filing,
         coalesce(f.period_end > f.filed, false) AS cover_after_filing,
         (f.form = 'ABS-EE/A' AND NOT EXISTS (
            SELECT 1 FROM public.abs_filings o
            WHERE o.status = 'loaded' AND o.deal_id = f.deal_id AND o.accession <> f.accession
              AND o.period_end IS NOT DISTINCT FROM f.period_end)) AS alone_amendment
  FROM public.abs_filings f
  LEFT JOIN LATERAL (
    SELECT (max(m.bucket) FILTER (WHERE m.bucket ~ '^\d{4}-\d{2}-\d{2}$'))::date AS records_period_end,
           (count(*) FILTER (WHERE m.bucket ~ '^\d{4}-\d{2}-\d{2}$'))::integer AS period_ends
    FROM public.abs_pool_metrics_live m
    WHERE m.accession = f.accession AND m.load_id = f.load_id AND m.metric = 'records' AND m.dim = 'period_end'
  ) p ON true
  WHERE f.status = 'loaded';

REVOKE ALL ON public.abs_filing_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.abs_filing_periods TO authenticated, service_role;

-- The deal monitor of one family ('auto_loan', 'auto_lease', 'cmbs') and the coverage counts of all.
--
-- Per deal: how many filings are stored and in which state, the figures of the newest current filing
-- that is not offering-stage (`latest`), the trend of up to `_periods` of the deal's newest such filings,
-- oldest first, and the newest current offering-stage filing (`offering`). Figures are the stored rows
-- of abs_pool_metrics as they are: value as text, the number of records behind it and the number left
-- out. A split is {bucket: [value, n, n_missing]} of the family's end amount (metrics.ts:
-- sched_end_balance, end_balance, end_securitization_value) by payment status (commercial mortgages) or
-- days past due (auto). A trend point is [period end the records state, accession, end amount,
-- {bucket: value}]: the same split without its counts, to keep a long list of deals small.
-- Nothing is summed across deals and no share is computed here: the page derives shares and shows
-- both parts.
CREATE OR REPLACE FUNCTION public.abs_monitor(_family text, _periods integer DEFAULT 13)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH cap AS (SELECT least(greatest(coalesce(_periods, 13), 2), 120) AS n),
  keys AS (
    SELECT CASE _family WHEN 'cmbs' THEN 'sched_end_balance' WHEN 'auto_loan' THEN 'end_balance'
                        WHEN 'auto_lease' THEN 'end_securitization_value' END AS end_metric,
           CASE _family WHEN 'cmbs' THEN 'payment_status' ELSE 'delinquency' END AS status_dim
  ),
  allf AS MATERIALIZED (
    SELECT d.family, p.*, (p.records_after_filing OR p.cover_after_filing) AS offering
    FROM abs_deals d JOIN abs_filing_periods p ON p.deal_id = d.deal_id
  ),
  fil AS (SELECT * FROM allf WHERE family = _family),
  per_deal AS (
    SELECT deal_id,
           count(*) AS loaded,
           count(*) FILTER (WHERE is_current) AS current,
           count(*) FILTER (WHERE offering) AS offering,
           count(*) FILTER (WHERE is_current AND NOT offering) AS monthly,
           count(DISTINCT records_period_end) FILTER (WHERE is_current AND NOT offering) AS monthly_periods,
           count(*) FILTER (WHERE alone_amendment) AS review,
           min(records_period_end) FILTER (WHERE is_current AND NOT offering) AS first_period,
           min(filed) AS first_filed, max(filed) AS last_filed
    FROM fil GROUP BY deal_id
  ),
  ranked AS (
    SELECT fil.*, row_number() OVER (PARTITION BY deal_id ORDER BY records_period_end DESC NULLS LAST, accepted_at DESC NULLS LAST, accession DESC) AS rn
    FROM fil WHERE is_current AND NOT offering
  ),
  pts AS (
    SELECT r.deal_id, r.rn, r.accession, r.list_cik, r.form, r.filed, r.accepted_at, r.cover_period_start, r.cover_period_end,
           r.records_period_end, r.period_ends,
           (SELECT m.value::text FROM abs_pool_metrics_live m, keys k
             WHERE m.accession = r.accession AND m.load_id = r.load_id AND m.metric = k.end_metric AND m.dim = '' AND m.bucket = '') AS end_value,
           (SELECT jsonb_build_array(jsonb_object_agg(m.bucket, m.value::text), jsonb_object_agg(m.bucket, jsonb_build_array(m.value::text, m.n, m.n_missing)))
              FROM abs_pool_metrics_live m, keys k
             WHERE m.accession = r.accession AND m.load_id = r.load_id AND m.metric = k.end_metric AND m.dim = k.status_dim) AS splits,
           CASE WHEN r.rn = 1 THEN
             (SELECT jsonb_object_agg(m.metric, jsonb_build_array(m.value::text, m.n, m.n_missing)) FROM abs_pool_metrics_live m
               WHERE m.accession = r.accession AND m.load_id = r.load_id AND m.dim = '' AND m.bucket = '') END AS totals
    FROM ranked r, cap WHERE r.rn <= cap.n
  ),
  agg AS (
    SELECT p.deal_id,
           (jsonb_agg(jsonb_build_object(
              'accession', p.accession, 'list_cik', p.list_cik, 'form', p.form, 'filed', p.filed, 'accepted_at', p.accepted_at,
              'cover_start', p.cover_period_start, 'cover_end', p.cover_period_end,
              'records_end', p.records_period_end, 'period_ends', p.period_ends,
              'totals', coalesce(p.totals, '{}'::jsonb), 'split', coalesce(p.splits -> 1, '{}'::jsonb))) FILTER (WHERE p.rn = 1)) -> 0 AS latest,
           jsonb_agg(jsonb_build_array(p.records_period_end, p.accession, p.end_value, coalesce(p.splits -> 0, '{}'::jsonb))
                     ORDER BY p.rn DESC) AS trend
    FROM pts p GROUP BY p.deal_id
  ),
  off AS (
    SELECT DISTINCT ON (f.deal_id) f.deal_id, jsonb_build_object(
             'accession', f.accession, 'list_cik', f.list_cik, 'form', f.form, 'filed', f.filed,
             'cover_end', f.cover_period_end, 'records_end', f.records_period_end,
             'records_after_filing', f.records_after_filing, 'cover_after_filing', f.cover_after_filing,
             'totals', coalesce((SELECT jsonb_object_agg(m.metric, jsonb_build_array(m.value::text, m.n, m.n_missing)) FROM abs_pool_metrics_live m
                                  WHERE m.accession = f.accession AND m.load_id = f.load_id AND m.dim = '' AND m.bucket = ''), '{}'::jsonb)) AS offering
    FROM fil f WHERE f.is_current AND f.offering
    ORDER BY f.deal_id, f.filed DESC, f.accepted_at DESC NULLS LAST, f.accession DESC
  )
  SELECT jsonb_build_object(
    'family', _family,
    'periods_cap', (SELECT n FROM cap),
    'coverage', jsonb_build_object(
      'families', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'family', c.family, 'deals', c.deals, 'loaded', c.loaded, 'current', c.current, 'offering', c.offering,
                 'newest_period', c.newest_period, 'first_filed', c.first_filed, 'last_filed', c.last_filed,
                 'last_loaded_at', c.last_loaded_at) ORDER BY c.family)
        FROM (SELECT family, count(DISTINCT deal_id) AS deals, count(*) AS loaded,
                     count(*) FILTER (WHERE is_current) AS current, count(*) FILTER (WHERE offering) AS offering,
                     max(records_period_end) FILTER (WHERE is_current AND NOT offering) AS newest_period,
                     min(filed) AS first_filed, max(filed) AS last_filed, max(loaded_at) AS last_loaded_at
              FROM allf GROUP BY family) c), '[]'::jsonb),
      'filings', coalesce((SELECT jsonb_object_agg(s.status, s.n) FROM (SELECT status, count(*) AS n FROM abs_filings GROUP BY status) s), '{}'::jsonb)),
    'deals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'deal_id', d.deal_id, 'issuer_cik', d.issuer_cik, 'issuer_name', d.issuer_name, 'file_number', d.file_number,
               'depositor_cik', d.depositor_cik, 'sponsor_cik', d.sponsor_cik,
               'files', jsonb_build_object('loaded', g.loaded, 'current', g.current, 'offering', g.offering, 'monthly', g.monthly,
                                           'monthly_periods', g.monthly_periods, 'review', g.review,
                                           'first_period', g.first_period, 'first_filed', g.first_filed, 'last_filed', g.last_filed),
               'latest', a.latest,
               'trend', coalesce(a.trend, '[]'::jsonb),
               'offering', o.offering)
             ORDER BY d.issuer_name, d.deal_id)
      FROM abs_deals d JOIN per_deal g ON g.deal_id = d.deal_id
      LEFT JOIN agg a ON a.deal_id = d.deal_id
      LEFT JOIN off o ON o.deal_id = d.deal_id
      WHERE d.family = _family), '[]'::jsonb))
$$;

-- One deal. `filings` lists every loaded filing of the deal, newest filing first, with the asset file
-- that was read (name, address, size and SHA-256 of the bytes SEC served, records) and, for a current
-- filing, its figures as rows [metric, dim, bucket, value, n, n_missing]: the pool totals, the split of
-- the end amount and of the record or loan count by status and, for auto files, the payment-to-income
-- quantiles as written. `waiting`
-- counts the filings EDGAR lists under the trust's own CIK that are not stored, by state.
-- `shown` is the filing whose detail is given: the newest current filing that is not offering-stage,
-- or the newest current offering-stage filing when the deal has no other. For it: `breakdowns` (auto:
-- state, make, score band, new or used, zero-balance code) and, for commercial mortgages, `loans` and
-- `properties` as the file states them, in file order.
CREATE OR REPLACE FUNCTION public.abs_deal(_deal_id text)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH d AS (SELECT * FROM abs_deals WHERE deal_id = _deal_id),
  keys AS (
    SELECT CASE d.family WHEN 'cmbs' THEN 'sched_end_balance' WHEN 'auto_loan' THEN 'end_balance'
                         WHEN 'auto_lease' THEN 'end_securitization_value' END AS end_metric,
           CASE d.family WHEN 'cmbs' THEN 'payment_status' ELSE 'delinquency' END AS status_dim
    FROM d
  ),
  fil AS MATERIALIZED (
    SELECT p.*, (p.records_after_filing OR p.cover_after_filing) AS offering
    FROM abs_filing_periods p WHERE p.deal_id = _deal_id
  ),
  shown AS (
    SELECT * FROM fil WHERE is_current
    ORDER BY offering, records_period_end DESC NULLS LAST, accepted_at DESC NULLS LAST, accession DESC
    LIMIT 1
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM d) THEN NULL ELSE jsonb_build_object(
    'deal', (SELECT jsonb_build_object('deal_id', d.deal_id, 'issuer_cik', d.issuer_cik, 'issuer_name', d.issuer_name,
                                       'file_number', d.file_number, 'family', d.family, 'depositor_cik', d.depositor_cik,
                                       'sponsor_cik', d.sponsor_cik, 'updated_at', d.updated_at) FROM d),
    'filings', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'accession', f.accession, 'list_cik', f.list_cik, 'form', f.form, 'filed', f.filed, 'accepted_at', f.accepted_at,
               'cover_start', f.cover_period_start, 'cover_end', f.cover_period_end,
               'records_end', f.records_period_end, 'period_ends', f.period_ends,
               'records_after_filing', f.records_after_filing, 'cover_after_filing', f.cover_after_filing,
               'is_current', f.is_current, 'superseded_by', f.superseded_by, 'alone_amendment', f.alone_amendment,
               'loaded_at', f.loaded_at,
               'asset_class', x.asset_class, 'issuer_name', x.issuer_name, 'depositor_cik', x.depositor_cik,
               'sponsor_cik', x.sponsor_cik, 'file_number', x.file_number,
               'file', (SELECT jsonb_build_object('name', doc.name, 'url', doc.url, 'bytes', doc.bytes, 'sha256', doc.sha256,
                                                  'records', doc.records, 'retrieved_at', doc.retrieved_at)
                        FROM abs_documents doc WHERE doc.accession = f.accession AND doc.sha256 IS NOT NULL
                        ORDER BY doc.seq LIMIT 1),
               'figures', CASE WHEN f.is_current THEN coalesce((
                            SELECT jsonb_agg(jsonb_build_array(m.metric, m.dim, m.bucket, m.value::text, m.n, m.n_missing)
                                             ORDER BY m.metric, m.dim, m.bucket)
                            FROM abs_pool_metrics_live m, keys k
                            WHERE m.accession = f.accession AND m.load_id = f.load_id
                              AND (m.dim = '' OR m.dim = 'quantile' OR (m.dim = k.status_dim AND m.metric IN (k.end_metric, 'loans', 'records')))), '[]'::jsonb) END)
             ORDER BY f.filed DESC, f.accepted_at DESC NULLS LAST, f.accession DESC)
      FROM fil f JOIN abs_filings x ON x.accession = f.accession), '[]'::jsonb),
    'waiting', coalesce((
      SELECT jsonb_object_agg(w.status, w.n)
      FROM (SELECT o.status, count(*) AS n FROM abs_filings o, d
            WHERE o.list_cik = d.issuer_cik AND o.deal_id IS NULL AND o.status <> 'loaded' GROUP BY o.status) w), '{}'::jsonb),
    'not_stored', coalesce((
      SELECT jsonb_agg(jsonb_build_object('accession', o.accession, 'list_cik', o.list_cik, 'form', o.form, 'filed', o.filed,
                                          'status', o.status, 'status_detail', o.status_detail) ORDER BY o.filed DESC, o.accession DESC)
      FROM abs_filings o, d
      WHERE o.list_cik = d.issuer_cik AND o.deal_id IS NULL AND o.status IN ('skipped', 'failed')), '[]'::jsonb),
    'shown', (SELECT jsonb_build_object('accession', s.accession, 'offering', s.offering, 'records_end', s.records_period_end) FROM shown s),
    'breakdowns', coalesce((
      SELECT jsonb_agg(jsonb_build_array(m.metric, m.dim, m.bucket, m.value::text, m.n, m.n_missing) ORDER BY m.dim, m.metric, m.bucket)
      FROM shown s JOIN abs_pool_metrics_live m ON m.accession = s.accession AND m.load_id = s.load_id, keys k
      WHERE m.dim IN ('state', 'make', 'score_band', 'new_used', 'zero_balance_code')
        AND m.metric IN (k.end_metric, 'records')), '[]'::jsonb),
    'loans', coalesce((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.rec)
      FROM (SELECT l.rec, l.kind, l.asset_number, l.period_begin, l.period_end, l.origination_date,
                   l.original_loan_amount, l.original_term_months, l.maturity_date, l.original_rate, l.securitization_rate,
                   l.rate_type_code, l.loan_structure_code, l.payment_type_code, l.properties, l.interest_only, l.balloon,
                   l.securitization_balance, l.begin_balance, l.sched_end_balance, l.actual_end_balance, l.period_rate,
                   l.paid_through_date, l.payment_status_code, l.pi_advances_outstanding, l.non_recoverable,
                   l.modified, l.modification_code, l.last_modification_date, l.realized_loss,
                   l.liquidation_prepayment_code, l.liquidation_prepayment_date, l.workout_strategy_code,
                   l.special_servicer_transfer_date, l.master_servicer_return_date
            FROM shown s JOIN abs_cmbs_assets_live l ON l.accession = s.accession AND l.load_id = s.load_id) a), '[]'::jsonb),
    'properties', coalesce((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.rec, b.seq)
      FROM (SELECT q.rec, q.seq, q.asset_number, q.loan_asset_number, q.link, q.name, q.city, q.state, q.type_code,
                   q.status_code, q.defeased_code, q.year_built, q.sq_ft, q.units,
                   q.valuation_securitization, q.valuation_securitization_date, q.valuation_recent, q.valuation_recent_date,
                   q.occupancy_securitization, q.occupancy_recent, q.financials_recent_end,
                   q.dscr_noi_securitization, q.dscr_noi_recent, q.dscr_ncf_securitization, q.dscr_ncf_recent
            FROM shown s JOIN abs_cmbs_properties_live q ON q.accession = s.accession AND q.load_id = s.load_id) b), '[]'::jsonb))
  END
$$;

REVOKE ALL ON FUNCTION public.abs_monitor(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abs_deal(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abs_monitor(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.abs_deal(text) TO authenticated, service_role;
