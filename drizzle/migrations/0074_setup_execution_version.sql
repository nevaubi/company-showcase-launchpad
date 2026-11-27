-- NULL is the legacy methodology. Existing jobs retain their RPCs during rollout.
ALTER TABLE public.setup_samples ADD COLUMN IF NOT EXISTS execution_version smallint;
ALTER TABLE public.setup_signals ADD COLUMN IF NOT EXISTS outcome_version smallint;
ALTER TABLE public.setup_scan ADD COLUMN IF NOT EXISTS replay_version smallint;
-- Replace only a completed replay window. PostgREST runs this entire function in one transaction.
CREATE OR REPLACE FUNCTION public.replace_setup_sample_slice_v2(
  p_tickers text[], p_from date, p_to date, p_rows jsonb, p_full boolean DEFAULT false, p_keep_links boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE sym text;
BEGIN
  IF cardinality(p_tickers) IS NULL OR cardinality(p_tickers) NOT BETWEEN 1 AND 3
    OR array_position(p_tickers, NULL) IS NOT NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to
    OR (NOT p_full AND p_to - p_from > 160) OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR p_full IS NULL OR p_keep_links IS NULL THEN
    RAISE EXCEPTION 'Invalid setup sample window';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(ticker text, variant text, d date)
    WHERE ticker IS NULL OR NOT (ticker = ANY(p_tickers)) OR variant IS NULL OR d IS NULL OR d > p_to OR d < CASE WHEN NOT p_full AND variant LIKE 'custMom%' THEN p_to - 160 ELSE p_from END) THEN
    RAISE EXCEPTION 'Setup sample outside replay window';
  END IF;
  FOR sym IN SELECT DISTINCT t FROM unnest(p_tickers) AS symbols(t) ORDER BY t LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('setup-samples:' || sym, 0));
  END LOOP;
  DELETE FROM public.setup_samples s WHERE s.ticker = ANY(p_tickers) AND (
      (s.d BETWEEN p_from AND p_to AND ((p_full AND NOT p_keep_links) OR s.variant NOT LIKE 'custMom%')) OR (s.variant LIKE 'custMom%' AND EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(ticker text, variant text, d date)
      WHERE r.ticker=s.ticker AND r.variant=s.variant AND r.d=s.d
    )));
  INSERT INTO public.setup_samples(ticker,variant,d,net,ex,gross,execution_version)
  SELECT ticker, variant, d, net, ex, gross, 2 FROM jsonb_to_recordset(p_rows)
    AS r(ticker text, variant text, d date, net real, ex real, gross real);
END $$;
REVOKE ALL ON FUNCTION public.replace_setup_sample_slice_v2(text[],date,date,jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_setup_sample_slice_v2(text[],date,date,jsonb,boolean,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.setup_variant_daily_v2(_variant text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(x.d, x.n, x.net, x.ex, x.gross, x.hits) ORDER BY x.d), '[]'::jsonb)
  FROM (
    SELECT s.d, count(*)::int AS n, sum(s.net)::float8 AS net, sum(s.ex)::float8 AS ex, sum(s.gross)::float8 AS gross, count(*) FILTER (WHERE s.net > 0)::int AS hits
    FROM public.setup_samples s WHERE s.execution_version = 2 AND s.variant = _variant GROUP BY s.d
  ) x
$$;

CREATE OR REPLACE FUNCTION public.setup_forward_stats_v2()
RETURNS TABLE (variant text, n integer, avg_net double precision, avg_ex double precision, hits integer, first_seen date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.variant, count(*)::int, avg(s.outcome_net)::float8, avg(s.outcome_ex)::float8, count(*) FILTER (WHERE s.outcome_net > 0)::int, min(s.first_seen)
  FROM public.setup_signals s
  WHERE s.outcome_version = 2 AND s.outcome_net IS NOT NULL AND s.first_seen = s.fired_at
  GROUP BY s.variant
$$;

REVOKE ALL ON FUNCTION public.setup_variant_daily_v2(text), public.setup_forward_stats_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_variant_daily_v2(text), public.setup_forward_stats_v2() TO service_role;