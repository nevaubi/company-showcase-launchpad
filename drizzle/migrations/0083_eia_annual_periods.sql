-- The raw publisher cell remains available by file, row and field. Only the derived
-- search dimension of a declared EIA year can omit a footer or other non-year value.
CREATE OR REPLACE FUNCTION public.source_eia_year_field(_agency text, _columns jsonb, _ingest jsonb)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  WITH declared AS (
    SELECT CASE WHEN (_ingest->'dimensions'->>'period') ~ '^[0-9]{1,5}$'
      THEN (_ingest->'dimensions'->>'period')::integer END AS pos
  )
  SELECT pos FROM declared
  WHERE _agency = 'US EIA'
    AND _ingest->'composites'->'period' IS NULL
    AND lower(btrim(regexp_replace(_columns->pos->>'label', '^.*[|]', ''))) IN
      ('year', 'data year', 'calendar year', 'report year', 'reporting year', 'survey year')
$$;
REVOKE ALL ON FUNCTION public.source_eia_year_field(text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.source_eia_year_field(text,jsonb,jsonb) TO service_role;

-- Run once on publication, before the source snapshot becomes immutable. A dataset's
-- other source dimensions and its original cells, row numbers and file bytes stay intact.
CREATE OR REPLACE FUNCTION public.source_publish_eia_year_dimension()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE agency_name text;
BEGIN
  SELECT d.agency INTO agency_name FROM public.source_datasets d WHERE d.id = NEW.dataset_id;
  IF public.source_eia_year_field(agency_name, NEW.columns, NEW.ingest) IS NOT NULL THEN
    UPDATE public.source_records r SET period = NULL
    WHERE r.snapshot_id = NEW.id AND r.period IS NOT NULL AND r.period !~ '^[0-9]{4}$';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.source_publish_eia_year_dimension() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS source_publish_eia_year_dimension ON public.source_snapshots;
CREATE TRIGGER source_publish_eia_year_dimension BEFORE UPDATE OF status ON public.source_snapshots
FOR EACH ROW WHEN (OLD.status = 'staging' AND NEW.status = 'ready')
EXECUTE FUNCTION public.source_publish_eia_year_dimension();

-- Existing ready snapshots predate the year rule. Stage the evidence before taking
-- the writer lock, then perform and verify the metadata-only repair atomically.
DO $$
DECLARE changed integer; expected integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS source_eia_year_repair_0083 (
    snapshot_id text, row_number bigint, original_period text, original_row jsonb,
    PRIMARY KEY (snapshot_id,row_number)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.source_eia_year_repair_0083;
  INSERT INTO pg_temp.source_eia_year_repair_0083
  SELECT r.snapshot_id,r.row_number,r.period,to_jsonb(r)-'period'
  FROM public.source_datasets d JOIN public.source_snapshots s ON s.dataset_id = d.id
  CROSS JOIN LATERAL (SELECT public.source_eia_year_field(d.agency,s.columns,s.ingest) AS pos) declared
  JOIN public.source_records r ON r.snapshot_id = s.id
  WHERE d.agency='US EIA' AND s.status='ready' AND declared.pos IS NOT NULL
    AND r.period IS NOT NULL AND r.period !~ '^[0-9]{4}$'
    AND r.values->>declared.pos = r.period;
  GET DIAGNOSTICS expected = ROW_COUNT;
  IF expected = 0 THEN RETURN; END IF;

  PERFORM set_config('lock_timeout','2s',true);
  -- SHARE ROW EXCLUSIVE blocks other writers through commit and permits ordinary
  -- reads. Only the 0068 period/row guard is suspended inside this transaction.
  LOCK TABLE public.source_records IN SHARE ROW EXCLUSIVE MODE;
  ALTER TABLE public.source_records DISABLE TRIGGER source_record_guard;
  UPDATE public.source_records r SET period=NULL
    FROM pg_temp.source_eia_year_repair_0083 t
    WHERE (r.snapshot_id,r.row_number)=(t.snapshot_id,t.row_number)
      AND r.period=t.original_period AND (to_jsonb(r)-'period')=t.original_row;
  GET DIAGNOSTICS changed = ROW_COUNT;
  ALTER TABLE public.source_records ENABLE TRIGGER source_record_guard;
  IF changed <> expected OR EXISTS (
    SELECT FROM pg_temp.source_eia_year_repair_0083 t
    LEFT JOIN public.source_records r USING (snapshot_id,row_number)
    WHERE r.snapshot_id IS NULL OR r.period IS NOT NULL OR (to_jsonb(r)-'period') IS DISTINCT FROM t.original_row
  ) THEN RAISE EXCEPTION 'EIA year correction did not preserve the publisher rows'; END IF;

  WITH corrected AS (
    SELECT t.snapshot_id,min(r.period) AS first_year,max(r.period) AS last_year,count(DISTINCT r.period) AS years
    FROM (SELECT DISTINCT snapshot_id FROM pg_temp.source_eia_year_repair_0083) t
    LEFT JOIN public.source_records r ON r.snapshot_id=t.snapshot_id AND r.period IS NOT NULL
    GROUP BY t.snapshot_id
  )
  UPDATE public.source_snapshot_stats st
    SET period_min=c.first_year,period_max=c.last_year,periods=c.years
  FROM corrected c WHERE st.snapshot_id=c.snapshot_id
    AND (st.period_min,st.period_max,st.periods) IS DISTINCT FROM (c.first_year,c.last_year,c.years);
END
$$;