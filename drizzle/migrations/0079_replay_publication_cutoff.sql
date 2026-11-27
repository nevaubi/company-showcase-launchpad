-- FINRA files are published after the trade date's close. Preserve when this installation actually saw each recent file.
CREATE TABLE IF NOT EXISTS public.setup_finra_publications (
  trade_date date PRIMARY KEY, first_observed_at timestamptz NOT NULL,
  available_on date GENERATED ALWAYS AS ((first_observed_at AT TIME ZONE 'America/New_York')::date + 1) STORED
);
ALTER TABLE public.setup_finra_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.setup_finra_publications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.setup_finra_publications TO service_role;

CREATE OR REPLACE FUNCTION public.record_setup_short_publication_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  INSERT INTO public.setup_finra_publications AS f(trade_date,first_observed_at) VALUES((NEW.detail->>'date')::date,NEW.finished_at)
    ON CONFLICT(trade_date) DO UPDATE SET first_observed_at=least(f.first_observed_at,excluded.first_observed_at);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_setup_short_publication_v2() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS setup_finra_publication_v2 ON public.job_runs;
CREATE TRIGGER setup_finra_publication_v2 AFTER INSERT OR UPDATE OF finished_at,ok,items,detail ON public.job_runs
  FOR EACH ROW WHEN (NEW.job='short-volume' AND NEW.ok AND NEW.items>0 AND NEW.finished_at IS NOT NULL
    AND NEW.detail->>'date' ~ '^\d{4}-\d{2}-\d{2}$') EXECUTE FUNCTION public.record_setup_short_publication_v2();
INSERT INTO public.setup_finra_publications AS f(trade_date,first_observed_at)
  SELECT (detail->>'date')::date,min(finished_at) FROM public.job_runs WHERE job='short-volume' AND ok AND items>0 AND finished_at IS NOT NULL
    AND detail->>'date' ~ '^\d{4}-\d{2}-\d{2}$' GROUP BY 1
  ON CONFLICT(trade_date) DO UPDATE SET first_observed_at=least(f.first_observed_at,excluded.first_observed_at);

-- A single consistent database snapshot for the dated inputs this ticker can see through the cutoff.
CREATE OR REPLACE FUNCTION public.setup_replay_inputs_v2(p_ticker text,p_first date,p_official_from date,p_as_of date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'official',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.date) FROM (
      SELECT date,open,high,low,close,adj_close,volume FROM public.market_bars
      WHERE symbol=p_ticker AND date BETWEEN p_official_from AND p_as_of) b),'[]'::jsonb),
    'earnings',coalesce((SELECT jsonb_agg(DISTINCT filed ORDER BY filed) FROM public.earnings_events
      WHERE ticker=p_ticker AND filed<=p_as_of),'[]'::jsonb),
    'buys',coalesce((SELECT jsonb_agg(jsonb_build_object('filed',filed,'owner',owner,'value',coalesce(value,0),'plan',coalesce(plan_10b5,false)) ORDER BY accn,owner)
      FROM public.insider_buys WHERE ticker=p_ticker AND filed<=p_as_of),'[]'::jsonb),
    'short',coalesce((SELECT jsonb_agg(jsonb_build_object('date',v.date,'ratio',v.short_vol::float8/v.total_vol,'availableOn',f.available_on) ORDER BY v.date) FROM public.short_volume v
      LEFT JOIN public.setup_finra_publications f ON f.trade_date=v.date
      WHERE v.symbol=p_ticker AND v.date BETWEEN p_first AND p_as_of AND v.total_vol>0
        AND (v.date<'2026-11-16' OR f.available_on<=p_as_of)),'[]'::jsonb),
    'fails',coalesce((SELECT jsonb_agg(jsonb_build_object('end',date,'value',value) ORDER BY date,uid) FROM public.alt_data
      WHERE ticker=p_ticker AND dataset='settlement' AND date BETWEEN p_first AND p_as_of AND value IS NOT NULL),'[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.setup_replay_inputs_v2(text,date,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.setup_replay_inputs_v2(text,date,date,date) TO service_role;