-- lovable-cron-fallback-reviewed: historical replay scoreboard refresh, already applied in production, 48 runs/day by design
-- Historical summaries have no path into live signals, evidence grades, bot execution or nightly state.
CREATE TABLE IF NOT EXISTS public.setup_replay_scoreboards (
  as_of date PRIMARY KEY,
  generated_at timestamptz NOT NULL,
  benchmark_sha256 text NOT NULL CHECK (benchmark_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_completions jsonb NOT NULL,
  payload jsonb NOT NULL
);
ALTER TABLE public.setup_replay_scoreboards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.setup_replay_scoreboards FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.setup_replay_scoreboards TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_setup_replay_scoreboard_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET statement_timeout='75s' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('historical-replay-scoreboard-v1',0)) THEN
    RETURN jsonb_build_object('state','busy');
  END IF;
  -- One MVCC snapshot for every input. Frozen v2 catalog (strategies.ts), including trials
  -- with zero observations; the two cross-issuer strategies have a separate replay scope.
  WITH rules AS MATERIALIZED (
    SELECT strategy||':'||side||':'||hold AS key FROM (VALUES
      ('reversal',ARRAY['L','S'],ARRAY[5]),('residual',ARRAY['L','S'],ARRAY[5,10]),
      ('rsi2',ARRAY['L','S'],ARRAY[3,5]),('gap',ARRAY['L','S'],ARRAY[1,5]),
      ('volShock',ARRAY['L','S'],ARRAY[5,20]),('stressRev',ARRAY['L'],ARRAY[5]),
      ('volPremium',ARRAY['L'],ARRAY[20]),('high52',ARRAY['L'],ARRAY[10,20]),
      ('squeeze',ARRAY['L','S'],ARRAY[10,20]),('tsmom',ARRAY['L','S'],ARRAY[21]),
      ('pead',ARRAY['L','S'],ARRAY[20,40]),('earnRunup',ARRAY['L'],ARRAY[6]),
      ('insider',ARRAY['L'],ARRAY[20,40]),('shortFlow',ARRAY['L','S'],ARRAY[5,10]),
      ('fails',ARRAY['S'],ARRAY[10,20]),('confluence',ARRAY['L','S'],ARRAY[10])
    ) catalog(strategy,sides,holds) CROSS JOIN LATERAL unnest(sides) side CROSS JOIN LATERAL unnest(holds) hold
  ), cutoff AS (
    SELECT max(w.as_of) AS day FROM public.setup_replay_work w
    WHERE w.completed_at IS NOT NULL AND w.as_of <= (SELECT max(as_of) FROM public.setup_results)
  ), finished AS MATERIALIZED (
    SELECT w.*,s.replay_version FROM public.setup_replay_work w JOIN public.setup_scan s USING(ticker)
      JOIN cutoff c ON c.day=w.as_of WHERE w.completed_at IS NOT NULL
  ), eligible_receipts AS MATERIALIZED (
    SELECT f.ticker,f.as_of,f.completed_at,(f.receipt->>'firstSession')::date AS first_day,
      (f.receipt->>'samples')::integer AS expected,f.receipt->>'benchSha256' AS bench
    FROM finished f
    WHERE f.replay_version=2 AND f.token IS NULL AND f.error IS NULL
      AND f.receipt->>'scope'='single-ticker price, event and confluence strategies'
      AND f.receipt->>'asOf'=f.as_of::text AND f.receipt->>'filingCutoff'='next-session-v1'
      AND (f.receipt->>'adjustmentReview'='same-vintage-v1' OR
        (f.receipt->>'adjustmentReview' IS NULL AND NOT EXISTS (
          SELECT FROM public.setup_replay_adjustment_review a WHERE a.ticker=f.ticker AND a.as_of=f.as_of)))
      -- Independent shadow replay found three obsolete event-rule trades across these
      -- two exact source vintages. A replacement receipt qualifies normally.
      AND NOT EXISTS (
        SELECT FROM (VALUES
          ('AMT','da69b95b52f96bd04515f772f881ee4833d7e4c9e04892d719ff36ae5222f911','36d31bb8979e49d1e26573365ef8d221aa3c1eabda7dd7ddb6379dc7fab4a479','532'),
          ('BNY','19caf5e5d42746e855b9852ae579c5e83e09d33480626542d0fdcd28c7be605e','b34a20b7112c65686c28c699e8a5c26470894781557bca24edcbabbd76ae26f3','571')
        ) superseded(ticker,price,inputs,samples)
        WHERE f.as_of=DATE '2026-11-25' AND f.ticker=superseded.ticker
          AND f.receipt->>'pricesSha256'=superseded.price
          AND f.receipt->>'eventsAndOfficialBarsSha256'=superseded.inputs AND f.receipt->>'samples'=superseded.samples
      )
      AND f.receipt#>>'{sourcePackRecovery,status}' IS DISTINCT FROM 'source-vintage-mismatch'
      AND (f.receipt->>'observedSessions')::integer>=300 AND (f.receipt->>'samples')::integer>=0
      AND f.receipt->>'benchSha256' ~ '^[a-f0-9]{64}$'
      AND f.receipt->>'pricesSha256' ~ '^[a-f0-9]{64}$'
      AND f.receipt->>'eventsAndOfficialBarsSha256' ~ '^[a-f0-9]{64}$'
  ), benchmark AS (
    SELECT min(bench) AS hash FROM eligible_receipts HAVING count(DISTINCT bench)=1
  ), cohort AS MATERIALIZED (
    SELECT e.* FROM eligible_receipts e JOIN benchmark b ON b.hash=e.bench
  ), sample_keys AS MATERIALIZED (
    SELECT s.ticker,s.variant,s.d,min(s.net::double precision) AS net,count(*) AS copies,
      bool_and(s.net IS NOT NULL AND s.net > '-Infinity'::float8 AND s.net < 'Infinity'::float8
        AND s.ex IS NOT NULL AND s.ex > '-Infinity'::float8 AND s.ex < 'Infinity'::float8
        AND s.gross IS NOT NULL AND s.gross > '-Infinity'::float8 AND s.gross < 'Infinity'::float8) AS finite
    FROM public.setup_samples s JOIN cohort c ON c.ticker=s.ticker
    WHERE s.execution_version=2 AND s.d BETWEEN c.first_day AND c.as_of
      AND s.variant NOT LIKE 'custMom%' AND s.variant NOT LIKE 'pairs%'
    GROUP BY s.ticker,s.variant,s.d
  ), checked AS MATERIALIZED (
    SELECT c.ticker,c.completed_at,c.first_day FROM cohort c
    LEFT JOIN sample_keys s ON s.ticker=c.ticker LEFT JOIN rules k ON k.key=s.variant
    GROUP BY c.ticker,c.completed_at,c.first_day,c.expected,c.as_of
    HAVING count(s.d)=c.expected AND coalesce(sum(s.copies),0)=c.expected
      AND count(*) FILTER (WHERE s.d IS NOT NULL AND (s.d>=c.as_of OR k.key IS NULL OR NOT s.finite))=0
  ), oos AS MATERIALIZED (
    SELECT s.ticker,s.variant,s.d,s.net FROM sample_keys s JOIN checked c USING(ticker)
    WHERE s.d>=DATE '2022-01-01'
  ), months AS (
    SELECT variant,date_trunc('month',d) AS month,avg(net) AS month_net FROM oos GROUP BY 1,2
  ), monthly AS (
    SELECT variant,count(*) AS months,count(*) FILTER (WHERE month_net>0) AS positive,avg(month_net) AS net FROM months GROUP BY variant
  ), traded AS (
    SELECT variant,count(*) AS n,count(DISTINCT ticker) AS issuers,avg((net>0)::integer) AS hit,min(d) AS first,max(d) AS last
    FROM oos GROUP BY variant
  ), variants AS (
    SELECT jsonb_agg(jsonb_build_object('key',k.key,'trades',coalesce(t.n,0),'issuers',coalesce(t.issuers,0),
      'months',coalesce(m.months,0),'net',m.net,'positiveMonths',coalesce(m.positive,0),'hit',t.hit,'first',t.first,'last',t.last) ORDER BY k.key) AS items,
      coalesce(sum(t.n),0) AS trades FROM rules k LEFT JOIN monthly m ON m.variant=k.key LEFT JOIN traded t ON t.variant=k.key
  ), counted AS (
    SELECT count(*) AS included,min(first_day) AS first,jsonb_object_agg(ticker,to_jsonb(completed_at)) AS receipts FROM checked
  ), publication AS (
    SELECT c.day,statement_timestamp() AS stamp,b.hash,n.receipts,
      jsonb_build_object('asOf',c.day,'benchmarkSha256',b.hash,'generatedAt',statement_timestamp(),'executionVersion',2,
        'population',(SELECT count(*) FROM public.setup_scan),'completed',(SELECT count(*) FROM finished),'eligible',n.included,
        'historyStart',n.first,'oosStart','2022-01-01','variants',v.items,'oosTrades',v.trades,
        'scope','Single-issuer price, event and confluence rules',
        'methodology','Signal at the close, entry at the next open, exit at the close of the rule’s holding session. Net is the signed adjusted return relative to its sector benchmark (SPY fallback) less modeled costs. Each observed month receives equal weight. Hit rate counts individual completed trades. Descriptive history only; no live-trading or strategy eligibility decision.') AS payload
    FROM cutoff c CROSS JOIN benchmark b CROSS JOIN counted n CROSS JOIN variants v
    WHERE n.included>0
  )
  INSERT INTO public.setup_replay_scoreboards AS existing (as_of,generated_at,benchmark_sha256,receipt_completions,payload)
    SELECT day,stamp,hash,receipts,payload FROM publication
    ON CONFLICT(as_of) DO UPDATE SET generated_at=EXCLUDED.generated_at,benchmark_sha256=EXCLUDED.benchmark_sha256,
      receipt_completions=EXCLUDED.receipt_completions,payload=EXCLUDED.payload
    WHERE existing.receipt_completions IS DISTINCT FROM EXCLUDED.receipt_completions OR
      (existing.payload-'generatedAt') IS DISTINCT FROM (EXCLUDED.payload-'generatedAt')
    RETURNING jsonb_build_object('state','published','cutoff',as_of,'eligible',payload->'eligible','trades',payload->'oosTrades') INTO result;
  RETURN coalesce(result,jsonb_build_object('state','no-new-publication'));
END $$;
REVOKE ALL ON FUNCTION public.refresh_setup_replay_scoreboard_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_setup_replay_scoreboard_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.read_setup_replay_scoreboard_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT s.payload FROM public.setup_replay_scoreboards s
  WHERE ((SELECT auth.role())='service_role' OR (SELECT public.has_app_access(auth.uid())))
    AND NOT EXISTS (
      SELECT FROM jsonb_each_text(s.receipt_completions) m(ticker,completed)
      LEFT JOIN public.setup_replay_work w ON w.ticker=m.ticker
      LEFT JOIN public.setup_scan sc ON sc.ticker=m.ticker
      WHERE w.ticker IS NULL OR (w.as_of=s.as_of AND (w.completed_at IS DISTINCT FROM m.completed::timestamptz
        OR sc.replay_version IS DISTINCT FROM 2 OR w.token IS NOT NULL OR w.error IS NOT NULL
        OR w.receipt->>'benchSha256' IS DISTINCT FROM s.benchmark_sha256
        OR w.receipt#>>'{sourcePackRecovery,status}'='source-vintage-mismatch'))
    )
  ORDER BY s.as_of DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.read_setup_replay_scoreboard_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_setup_replay_scoreboard_v1() TO authenticated,service_role;

DO $$ BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('historical-replay-scoreboard','8,38 * * * *','select public.refresh_setup_replay_scoreboard_v1()');
  END IF;
END $$;
