-- Run on an EIA-populated database after migration 0083. The test leaves no records.
BEGIN;
DO $$
DECLARE
  fixture text := repeat('a', 31) || repeat('d', 33);
  source_id text; file_hash text;
  dictionary jsonb := '[{"key":"col0001","type":"string","label":"Utility Characteristics | Data Year"}]';
  year_input jsonb := '{"dimensions":{"period":0}}';
  blocked boolean := false;
BEGIN
  IF public.source_eia_year_field('US EIA', dictionary, year_input) IS DISTINCT FROM 0
    OR public.source_eia_year_field('Other agency', dictionary, year_input) IS NOT NULL
    OR public.source_eia_year_field('US EIA', '[{"label":"YYYYMM"}]', year_input) IS NOT NULL
    OR public.source_eia_year_field('US EIA', '[{"label":"RPT_PERIOD"}]', year_input) IS NOT NULL
    OR public.source_eia_year_field('US EIA', dictionary, year_input || '{"composites":{"period":{"format":"year_month"}}}') IS NOT NULL
    THEN RAISE EXCEPTION 'Publisher, dictionary or period-composite check failed'; END IF;

  SELECT d.id,s.file_sha256 INTO STRICT source_id,file_hash FROM public.source_datasets d
    JOIN public.source_snapshots s ON s.id=d.latest_snapshot_id WHERE d.agency='US EIA' LIMIT 1;
  INSERT INTO public.source_snapshots(id,dataset_id,file_sha256,source_path,status,expected_rows,columns,ingest)
    VALUES (fixture,source_id,file_hash,'transaction-only/eia-year-check.csv','staging',3,dictionary,year_input);
  INSERT INTO public.source_records(snapshot_id,row_number,values,period) VALUES
    (fixture,1,'["2024"]','2024'),(fixture,2,'["2025"]','2025'),(fixture,3,'["Note: revised survey definitions"]','Note: revised survey definitions');
  UPDATE public.source_snapshots SET status='ready',loaded_rows=3,published_at=now() WHERE id=fixture;
  IF (SELECT count(*) FROM public.source_records WHERE snapshot_id=fixture) <> 3
    OR (SELECT array_agg(period ORDER BY row_number) FROM public.source_records WHERE snapshot_id=fixture)
      IS DISTINCT FROM ARRAY['2024','2025',NULL]::text[]
    OR (SELECT values->>0 FROM public.source_records WHERE snapshot_id=fixture AND row_number=3)
      IS DISTINCT FROM 'Note: revised survey definitions' THEN RAISE EXCEPTION 'Published annual source or original row is incorrect'; END IF;

  PERFORM public.source_compute_snapshot_stats(fixture);
  IF NOT EXISTS (SELECT FROM public.source_snapshot_stats WHERE snapshot_id=fixture AND period_min='2024' AND period_max='2025' AND periods=2)
    THEN RAISE EXCEPTION 'Computed period range/count includes publisher notes'; END IF;
  BEGIN
    UPDATE public.source_records SET period='2026' WHERE snapshot_id=fixture AND row_number=1;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'source snapshot is not staging' THEN RAISE; END IF;
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Published source row lost its write guard'; END IF;
END
$$;
ROLLBACK;
