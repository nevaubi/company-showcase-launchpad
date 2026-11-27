-- Replace only a completed replay window. PostgREST runs this entire function in one transaction.
CREATE OR REPLACE FUNCTION public.replace_setup_sample_slice(
  p_tickers text[], p_from date, p_to date, p_rows jsonb, p_full boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE sym text;
BEGIN
  IF cardinality(p_tickers) IS NULL OR cardinality(p_tickers) NOT BETWEEN 1 AND 3
    OR array_position(p_tickers, NULL) IS NOT NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to
    OR (NOT p_full AND p_to - p_from > 160) OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR p_full IS NULL THEN
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
      (s.d BETWEEN p_from AND p_to AND (p_full OR s.variant NOT LIKE 'custMom%')) OR (s.variant LIKE 'custMom%' AND EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(ticker text, variant text, d date)
      WHERE r.ticker=s.ticker AND r.variant=s.variant AND r.d=s.d
    )));
  INSERT INTO public.setup_samples(ticker,variant,d,net,ex,gross)
  SELECT ticker, variant, d, net, ex, gross FROM jsonb_to_recordset(p_rows)
    AS r(ticker text, variant text, d date, net real, ex real, gross real);
END $$;
REVOKE ALL ON FUNCTION public.replace_setup_sample_slice(text[],date,date,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_setup_sample_slice(text[],date,date,jsonb,boolean) TO service_role;