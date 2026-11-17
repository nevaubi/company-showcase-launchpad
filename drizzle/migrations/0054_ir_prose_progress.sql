CREATE INDEX IF NOT EXISTS ir_documents_prose_queue_idx
  ON public.ir_documents (filed DESC NULLS LAST)
  WHERE prose_status IS NULL AND ext IN ('htm', 'html');

CREATE OR REPLACE FUNCTION public.ir_live_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '25s' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  WITH f AS (
    SELECT ticker, count(*) n, count(*) FILTER (WHERE method = 'text') t FROM ir_kpi_facts GROUP BY ticker
  )
  SELECT jsonb_build_object(
    'lease', (SELECT jsonb_build_object('lease_until', lease_until, 'updated_at', updated_at, 'paused', paused_reason) FROM job_state WHERE job = 'ir-deep-loop'),
    'facts', (SELECT coalesce(jsonb_object_agg(ticker, n), '{}'::jsonb) FROM f),
    'text', (SELECT coalesce(jsonb_object_agg(ticker, t) FILTER (WHERE t > 0), '{}'::jsonb) FROM f),
    'recent', (SELECT coalesce(jsonb_object_agg(ticker, n), '{}'::jsonb) FROM (SELECT ticker, count(*) n FROM ir_kpi_facts WHERE created_at > now() - interval '1 hour' GROUP BY ticker) x),
    'docs', (SELECT coalesce(jsonb_object_agg(ticker, jsonb_build_array(stored, read)), '{}'::jsonb) FROM (
       SELECT ticker, count(*) FILTER (WHERE path IS NOT NULL) stored,
              count(*) FILTER (WHERE extracted_at IS NOT NULL OR vision_at IS NOT NULL OR prose_at IS NOT NULL) read
       FROM ir_documents GROUP BY ticker) d),
    'prose', (SELECT jsonb_build_object(
       'waiting', count(*) FILTER (WHERE prose_status IS NULL),
       'read', count(*) FILTER (WHERE prose_status IS NOT NULL AND prose_status <> 'working'),
       'working', count(*) FILTER (WHERE prose_status = 'working'))
       FROM ir_documents
       WHERE ext IN ('htm', 'html') AND path IS NOT NULL AND kind IN ('press-release', 'supplement', 'presentation', 'data', 'other'))
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ir_live_progress() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ir_live_progress() TO authenticated;