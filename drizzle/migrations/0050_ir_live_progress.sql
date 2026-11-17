CREATE OR REPLACE FUNCTION public.ir_live_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public SET statement_timeout = '20s' AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT jsonb_build_object(
    'lease', (SELECT jsonb_build_object('lease_until', lease_until, 'updated_at', updated_at, 'paused', paused_reason) FROM job_state WHERE job = 'ir-deep-loop'),
    'facts', (SELECT coalesce(jsonb_object_agg(ticker, n), '{}'::jsonb) FROM (SELECT ticker, count(*) n FROM ir_kpi_facts GROUP BY ticker) f),
    'recent', (SELECT coalesce(jsonb_object_agg(ticker, n), '{}'::jsonb) FROM (SELECT ticker, count(*) n FROM ir_kpi_facts WHERE created_at > now() - interval '1 hour' GROUP BY ticker) f),
    'docs', (SELECT coalesce(jsonb_object_agg(ticker, jsonb_build_array(stored, read)), '{}'::jsonb) FROM (
       SELECT ticker, count(*) FILTER (WHERE path IS NOT NULL) stored,
              count(*) FILTER (WHERE extracted_at IS NOT NULL OR vision_at IS NOT NULL OR prose_at IS NOT NULL) read
       FROM ir_documents GROUP BY ticker) d)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ir_live_progress() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ir_live_progress() TO authenticated;
CREATE INDEX IF NOT EXISTS ir_kpi_facts_created_idx ON public.ir_kpi_facts (created_at);