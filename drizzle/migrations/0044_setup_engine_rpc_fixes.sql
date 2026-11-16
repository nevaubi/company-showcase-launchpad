DROP FUNCTION IF EXISTS public.setup_variant_daily(text);
CREATE FUNCTION public.setup_variant_daily(_variant text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_array(x.d, x.n, x.net, x.ex, x.gross, x.hits) ORDER BY x.d), '[]'::jsonb)
  FROM (
    SELECT s.d, count(*)::int AS n, sum(s.net)::float8 AS net, sum(s.ex)::float8 AS ex, sum(s.gross)::float8 AS gross, count(*) FILTER (WHERE s.net > 0)::int AS hits
    FROM public.setup_samples s WHERE s.variant = _variant GROUP BY s.d
  ) x
$$;

CREATE OR REPLACE FUNCTION public.setup_forward_stats()
RETURNS TABLE (variant text, n integer, avg_net double precision, avg_ex double precision, hits integer, first_seen date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.variant, count(*)::int, avg(s.outcome_net)::float8, avg(s.outcome_ex)::float8, count(*) FILTER (WHERE s.outcome_net > 0)::int, min(s.first_seen)
  FROM public.setup_signals s
  WHERE s.outcome_net IS NOT NULL AND s.first_seen = s.fired_at
  GROUP BY s.variant
$$;

REVOKE ALL ON FUNCTION public.setup_variant_daily(text), public.setup_forward_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_variant_daily(text), public.setup_forward_stats() TO service_role;