-- Check the published summary against native trade rows at a single database snapshot.
-- This transaction does not persist a refresh, a signal, a cycle or a portfolio record.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='70s';
DO $$
DECLARE s public.setup_replay_scoreboards; report jsonb; trial jsonb; actual record; total bigint;
BEGIN
  PERFORM public.refresh_setup_replay_scoreboard_v1();
  SELECT * INTO STRICT s FROM public.setup_replay_scoreboards ORDER BY as_of DESC LIMIT 1;
  report:=public.refresh_setup_replay_scoreboard_v1();
  IF report->>'state' IS DISTINCT FROM 'no-new-publication' THEN RAISE EXCEPTION 'Unchanged history was republished'; END IF;
  IF jsonb_array_length(s.payload->'variants')<>43 OR EXISTS (
    SELECT FROM jsonb_array_elements(s.payload->'variants') v WHERE v->>'key' LIKE 'custMom%' OR v->>'key' LIKE 'pairs%'
  ) OR NOT ((s.payload->>'eligible')::int <= (s.payload->>'completed')::int AND
    (s.payload->>'completed')::int <= (s.payload->>'population')::int) THEN RAISE EXCEPTION 'Invalid trial scope or coverage'; END IF;

  SELECT v INTO STRICT trial FROM jsonb_array_elements(s.payload->'variants') v WHERE v->>'key'='rsi2:L:3';
  WITH trades AS (
    SELECT t.ticker,t.d,t.net::double precision AS net FROM public.setup_samples t
    JOIN jsonb_each_text(s.receipt_completions) a(ticker,stamp) ON a.ticker=t.ticker
    JOIN public.setup_replay_work w ON w.ticker=a.ticker AND w.completed_at=a.stamp::timestamptz
    WHERE t.variant='rsi2:L:3' AND t.execution_version=2 AND t.d>=DATE '2022-01-01'
      AND t.d>=(w.receipt->>'firstSession')::date AND t.d<s.as_of
  ), monthly AS (
    SELECT to_char(d,'YYYY-MM') AS signal_month,sum(net)/count(*) AS mean FROM trades GROUP BY 1
  )
  SELECT count(*) n,count(DISTINCT ticker) issuers,avg((net>0)::int) hit,
    (SELECT count(*) FROM monthly) months,(SELECT count(*) FROM monthly WHERE mean>0) positive,
    (SELECT avg(mean) FROM monthly) net INTO actual FROM trades;
  IF (trial->>'trades')::int<>actual.n OR (trial->>'issuers')::int<>actual.issuers OR
    (trial->>'months')::int<>actual.months OR (trial->>'positiveMonths')::int<>actual.positive OR
    abs((trial->>'hit')::double precision-actual.hit)>1e-10 OR abs((trial->>'net')::double precision-actual.net)>1e-10
    THEN RAISE EXCEPTION 'Independent returns or issuer/month coverage differs'; END IF;
  SELECT sum((v->>'trades')::int) INTO total FROM jsonb_array_elements(s.payload->'variants') v;
  IF total<>(s.payload->>'oosTrades')::bigint THEN RAISE EXCEPTION 'Trial coverage does not sum to publication'; END IF;

  IF has_function_privilege('anon','public.read_setup_replay_scoreboard_v1()','EXECUTE') OR
    has_function_privilege('authenticated','public.refresh_setup_replay_scoreboard_v1()','EXECUTE') OR
    has_table_privilege('authenticated','public.setup_replay_scoreboards','SELECT') THEN RAISE EXCEPTION 'Access boundary differs'; END IF;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  IF public.read_setup_replay_scoreboard_v1() IS DISTINCT FROM s.payload THEN RAISE EXCEPTION 'Authorized reader failed'; END IF;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-b000-000000000000"}',true);
  IF public.read_setup_replay_scoreboard_v1() IS NOT NULL THEN RAISE EXCEPTION 'Unapproved identity received historical data'; END IF;
END $$;
ROLLBACK;
