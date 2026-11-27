-- One bounded review of previously scanned issuers whose official bars show a material adjustment
-- within one fetch. Separately updated quotes can have different adjustment bases without an event.
LOCK TABLE public.setup_scan,public.setup_replay_work IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS public.setup_replay_adjustment_review (
  ticker text NOT NULL REFERENCES public.setup_scan(ticker), as_of date NOT NULL, event_dates date[] NOT NULL,
  prior_receipt jsonb, PRIMARY KEY(ticker,as_of)
);
ALTER TABLE public.setup_replay_adjustment_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.setup_replay_adjustment_review FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.setup_replay_adjustment_review TO service_role;

WITH cutoff AS (SELECT max(as_of) as_of FROM public.setup_results), days AS (
  SELECT date FROM public.market_bars WHERE symbol='SPY' AND date<=(SELECT as_of FROM cutoff) ORDER BY date DESC LIMIT 45
), ordered AS (
  SELECT b.symbol,b.date,b.close,b.adj_close,b.updated_at,b.volume,lag(b.date) OVER w prev_date,lag(b.close) OVER w prev_close,
    lag(b.adj_close) OVER w prev_adj,lag(b.updated_at) OVER w prev_stamp,lag(b.volume) OVER w prev_vol
  FROM public.market_bars b JOIN days d ON b.date=d.date JOIN public.setup_scan s ON s.ticker=b.symbol
  WINDOW w AS (PARTITION BY b.symbol ORDER BY b.date)
), candidates AS (
  SELECT symbol,date FROM ordered WHERE updated_at=prev_stamp AND date-prev_date<=7 AND volume>0 AND prev_vol>0
    AND close>0 AND adj_close>0 AND prev_close>0 AND prev_adj>0
    AND (adj_close/nullif(close,0))/(prev_adj/nullif(prev_close,0))>1+greatest(0.0005,0.0001*(1/close+1/adj_close+1/prev_close+1/prev_adj))
) INSERT INTO public.setup_replay_adjustment_review(ticker,as_of,event_dates)
  SELECT symbol,(SELECT as_of FROM cutoff),array_agg(date ORDER BY date) FROM candidates GROUP BY symbol ON CONFLICT DO NOTHING;

-- Score quarantine is narrower than the review queue. Only quarantine a recorded gross return if
-- both fills and a material intervening adjustment are corroborated by a common official snapshot.
WITH cal AS (SELECT date,row_number() OVER(ORDER BY date) n FROM public.market_bars WHERE symbol='SPY'), bad AS (
  SELECT s.ticker,s.variant,s.d FROM public.setup_samples s JOIN public.setup_replay_adjustment_review r ON r.ticker=s.ticker
    JOIN public.setup_replay_work w ON w.ticker=r.ticker AND w.as_of=r.as_of AND w.completed_at IS NOT NULL AND w.receipt->>'adjustmentReview' IS DISTINCT FROM 'same-vintage-v1'
    JOIN cal fire ON fire.date=s.d JOIN cal en ON en.n=fire.n+1 JOIN cal ex ON ex.n=fire.n+split_part(s.variant,':',3)::int
    JOIN public.market_bars entry ON entry.symbol=s.ticker AND entry.date=en.date
    JOIN public.market_bars exitbar ON exitbar.symbol=s.ticker AND exitbar.date=ex.date
  WHERE s.execution_version=2 AND s.variant NOT LIKE 'custMom%' AND s.variant NOT LIKE 'pairs%' AND entry.updated_at=exitbar.updated_at
    AND entry.volume>0 AND exitbar.volume>0 AND entry.open>0 AND entry.close>0 AND entry.adj_close>0 AND exitbar.adj_close>0
    AND EXISTS (SELECT 1 FROM unnest(r.event_dates) day WHERE day>en.date AND day<=ex.date)
    AND abs(s.gross-(CASE WHEN split_part(s.variant,':',2)='L' THEN 1 ELSE -1 END)*
      (exitbar.adj_close/(entry.open*entry.adj_close/nullif(entry.close,0))-1))>greatest(.00005,.0001*(1/entry.open+1/entry.close+1/entry.adj_close+1/exitbar.adj_close))
) UPDATE public.setup_samples s SET execution_version=NULL FROM bad b WHERE (s.ticker,s.variant,s.d)=(b.ticker,b.variant,b.d);

UPDATE public.setup_replay_adjustment_review r SET prior_receipt=jsonb_build_object('finishedAt',w.completed_at,'receipt',w.receipt)
  FROM public.setup_replay_work w WHERE w.ticker=r.ticker AND w.as_of=r.as_of AND r.prior_receipt IS NULL AND w.completed_at IS NOT NULL
    AND w.receipt->>'adjustmentReview' IS DISTINCT FROM 'same-vintage-v1';
UPDATE public.setup_scan s SET replay_version=NULL FROM public.setup_replay_work w JOIN public.setup_replay_adjustment_review r ON w.ticker=r.ticker AND w.as_of=r.as_of
  WHERE s.ticker=w.ticker AND w.completed_at IS NOT NULL AND w.receipt->>'adjustmentReview' IS DISTINCT FROM 'same-vintage-v1';
UPDATE public.setup_replay_work w SET completed_at=NULL,receipt=NULL,token=NULL,lease_until=NULL,retry_at=NULL,attempts=0,error=NULL
  FROM public.setup_replay_adjustment_review r WHERE w.ticker=r.ticker AND w.as_of=r.as_of AND w.completed_at IS NOT NULL
    AND w.receipt->>'adjustmentReview' IS DISTINCT FROM 'same-vintage-v1';

DO $$ BEGIN
  IF to_regprocedure('public.claim_setup_replay_adjusted_v2(date)') IS NULL THEN
    ALTER FUNCTION public.claim_setup_replay_after_filing_v2(date) RENAME TO claim_setup_replay_adjusted_v2;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.claim_setup_replay_after_filing_v2(p_as_of date) RETURNS TABLE(ticker text,sector text,token uuid)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT NULL::text,NULL::text,NULL::uuid WHERE false $$;
REVOKE ALL ON FUNCTION public.claim_setup_replay_after_filing_v2(date),public.claim_setup_replay_adjusted_v2(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_setup_replay_after_filing_v2(date),public.claim_setup_replay_adjusted_v2(date) TO service_role;
CREATE OR REPLACE FUNCTION public.require_setup_replay_cutoff() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND (NEW.receipt->>'filingCutoff' IS DISTINCT FROM 'next-session-v1' OR
     (NEW.receipt->>'adjustmentReview' IS DISTINCT FROM 'same-vintage-v1' AND EXISTS (
       SELECT 1 FROM public.setup_replay_adjustment_review r WHERE r.ticker=NEW.ticker AND r.as_of=NEW.as_of))) THEN
    RAISE EXCEPTION 'Stale replay receipt convention'; END IF;
  RETURN NEW;
END $$;

-- A single consistent database snapshot for the dated inputs this ticker can see through the cutoff.
CREATE OR REPLACE FUNCTION public.setup_replay_inputs_v2(p_ticker text,p_first date,p_official_from date,p_as_of date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'official',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.date) FROM (
      SELECT date,open,high,low,close,adj_close,volume,updated_at FROM public.market_bars
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