-- Bounded intraday historical replays share the nightly ticker registry and v2 sample writer.
CREATE TABLE IF NOT EXISTS public.setup_replay_work (
  ticker text PRIMARY KEY REFERENCES public.setup_scan(ticker),
  token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz, error text, as_of date, completed_at timestamptz, receipt jsonb
);
ALTER TABLE public.setup_replay_work ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.setup_replay_work FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.setup_replay_work TO service_role;

CREATE OR REPLACE FUNCTION public.claim_setup_replay_v2(p_as_of date)
RETURNS TABLE(ticker text, sector text, token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE sym text; sec text; id uuid := gen_random_uuid();
BEGIN
  -- A fixed, fully published benchmark date. Let the nightly worker own new market sessions.
  IF p_as_of IS NULL OR p_as_of IS DISTINCT FROM (SELECT max(r.as_of) FROM public.setup_results r)
     OR p_as_of < current_date-14 OR p_as_of > current_date
     OR EXISTS (SELECT 1 FROM public.setup_cycles c WHERE c.as_of>=p_as_of AND c.phase<>'done') THEN RETURN; END IF;
  SELECT s.ticker,s.sector INTO sym,sec FROM public.setup_scan s
    LEFT JOIN public.setup_replay_work w ON w.ticker=s.ticker
    WHERE s.replay_version IS DISTINCT FROM 2 AND (s.claimed_at IS NULL OR s.claimed_at<now()-interval '3 minutes')
      AND (w.lease_until IS NULL OR w.lease_until<=now()) AND (w.retry_at IS NULL OR w.retry_at<=now())
    ORDER BY coalesce(w.attempts,0),array_position(ARRAY['JPM','AAPL','XOM','BAC','MSFT','JNJ','GS','WMT','CAT','NEE','AMT','META','LIN','AMZN'],s.ticker) NULLS LAST,s.ticker
    LIMIT 1 FOR UPDATE OF s SKIP LOCKED;
  IF sym IS NULL THEN RETURN; END IF;
  INSERT INTO public.setup_replay_work AS w(ticker,token,lease_until,attempts,as_of) VALUES(sym,id,now()+interval '4 minutes',1,p_as_of)
    ON CONFLICT ON CONSTRAINT setup_replay_work_pkey DO UPDATE SET token=id,lease_until=excluded.lease_until,
      attempts=w.attempts+1,retry_at=NULL,as_of=p_as_of,error=NULL;
  RETURN QUERY SELECT sym,sec,id;
END $$;

CREATE OR REPLACE FUNCTION public.finish_setup_replay_v2(p_ticker text,p_token uuid,p_receipt jsonb,p_rows jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.setup_replay_work%ROWTYPE; s public.setup_scan%ROWTYPE; first_date date; persisted integer;
BEGIN
  -- Same lock order as claiming work. A late response from an expired worker cannot publish.
  SELECT * INTO STRICT s FROM public.setup_scan WHERE ticker=p_ticker FOR UPDATE;
  SELECT * INTO STRICT w FROM public.setup_replay_work WHERE ticker=p_ticker FOR UPDATE;
  IF p_token IS NULL OR p_token IS DISTINCT FROM w.token OR w.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  IF s.replay_version=2 OR s.claimed_at>now()-interval '3 minutes'
    OR w.as_of IS DISTINCT FROM (SELECT max(r.as_of) FROM public.setup_results r)
    OR EXISTS (SELECT 1 FROM public.setup_cycles c WHERE c.as_of>=w.as_of AND c.phase<>'done') THEN
    UPDATE public.setup_replay_work SET token=NULL,lease_until=NULL,retry_at=now()+interval '5 minutes' WHERE ticker=p_ticker;
    RETURN false;
  END IF;
  first_date := (p_receipt->>'firstSession')::date;
  IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR first_date IS NULL OR first_date>=w.as_of OR (p_receipt->>'asOf')::date IS DISTINCT FROM w.as_of
    OR coalesce((p_receipt->>'observedSessions')::int,0)<300 OR (p_receipt->>'samples')::int IS DISTINCT FROM jsonb_array_length(p_rows)
    OR coalesce(p_receipt->>'pricesSha256','') !~ '^[a-f0-9]{64}$' OR coalesce(p_receipt->>'benchSha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(p_receipt->>'eventsAndOfficialBarsSha256','') !~ '^[a-f0-9]{64}$'
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(ticker text,variant text,d date,net real,ex real,gross real)
      WHERE r.ticker IS DISTINCT FROM p_ticker OR r.variant IS NULL OR r.variant LIKE 'custMom%' OR r.variant LIKE 'pairs%'
        OR r.d IS NULL OR r.d<first_date OR r.d>=w.as_of OR r.net IS NULL OR r.ex IS NULL OR r.gross IS NULL) THEN
    RAISE EXCEPTION 'Invalid replay receipt or sample'; END IF;
  PERFORM public.replace_setup_sample_slice_v2(ARRAY[p_ticker],first_date,w.as_of,p_rows,true,true);
  SELECT count(*) INTO persisted FROM public.setup_samples r WHERE r.ticker=p_ticker AND r.d BETWEEN first_date AND w.as_of
    AND r.execution_version=2 AND r.variant NOT LIKE 'custMom%' AND r.variant NOT LIKE 'pairs%';
  IF persisted<>jsonb_array_length(p_rows) THEN RAISE EXCEPTION 'Replay sample count mismatch'; END IF;
  UPDATE public.setup_replay_work SET completed_at=clock_timestamp(),receipt=p_receipt,error=NULL,retry_at=NULL,token=NULL,lease_until=NULL WHERE ticker=p_ticker;
  UPDATE public.setup_scan SET replay_version=2 WHERE ticker=p_ticker;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.fail_setup_replay_v2(p_ticker text,p_token uuid,p_error text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  UPDATE public.setup_replay_work SET token=NULL,lease_until=NULL,error=left(p_error,240),
    retry_at=now()+least(24,attempts)*interval '1 hour' WHERE ticker=p_ticker AND token=p_token;
$$;
REVOKE ALL ON FUNCTION public.claim_setup_replay_v2(date),public.finish_setup_replay_v2(text,uuid,jsonb,jsonb),public.fail_setup_replay_v2(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_setup_replay_v2(date),public.finish_setup_replay_v2(text,uuid,jsonb,jsonb),public.fail_setup_replay_v2(text,uuid,text) TO service_role;

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
    'short',coalesce((SELECT jsonb_agg(jsonb_build_object('date',date,'ratio',short_vol::float8/total_vol) ORDER BY date) FROM public.short_volume
      WHERE symbol=p_ticker AND date BETWEEN p_first AND p_as_of AND total_vol>0),'[]'::jsonb),
    'fails',coalesce((SELECT jsonb_agg(jsonb_build_object('end',date,'value',value) ORDER BY date,uid) FROM public.alt_data
      WHERE ticker=p_ticker AND dataset='settlement' AND date BETWEEN p_first AND p_as_of AND value IS NOT NULL),'[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.setup_replay_inputs_v2(text,date,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.setup_replay_inputs_v2(text,date,date,date) TO service_role;