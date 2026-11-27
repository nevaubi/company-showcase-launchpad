-- lovable-cron-fallback-reviewed: already applied in production at this cadence; one issuer per run must cycle the archive promptly
-- Check cited earnings themes, guidance and analyst questions against native, source-hashed turns.
-- Each run handles one issuer and at most four calls. All schedulers share the same transaction lock.
CREATE OR REPLACE FUNCTION public.check_call_archive_evidence()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  started timestamptz := clock_timestamp();
  tick text;
  total integer;
  at_issuer integer;
  updated integer := 0;
  doc jsonb;
  c jsonb;
  receipt text;
  evidence jsonb;
  raw jsonb;
  primary_url text;
  expected integer;
  priority text[] := ARRAY['JPM','C','BAC','NVDA','MSFT','AAPL','WFC','GS','MS','SCHW'];
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('call-archive-evidence', 0)) THEN RETURN 0; END IF;
  INSERT INTO public.job_state(job) VALUES ('call-archive-evidence') ON CONFLICT(job) DO NOTHING;
  SELECT count(*)::integer INTO total FROM public.ai_cache WHERE key LIKE 'issuer-index:v1:%';
  IF total = 0 THEN RETURN 0; END IF;
  SELECT coalesce(cursor,0) % total INTO at_issuer FROM public.job_state WHERE job='call-archive-evidence';
  SELECT substring(key from length('issuer-index:v1:')+1) INTO tick FROM public.ai_cache WHERE key LIKE 'issuer-index:v1:%'
    ORDER BY array_position(priority,substring(key from length('issuer-index:v1:')+1)) NULLS LAST,key OFFSET at_issuer LIMIT 1;
  SELECT payload->'bundle' INTO doc FROM public.ai_cache WHERE key='issuer-index:v1:'||tick;
  FOR c IN
    SELECT x FROM jsonb_array_elements(doc->'calls') AS x
    WHERE x->>'ticker'=tick AND x->>'event_type'='earnings' AND x->>'kind' IN ('transcript','remarks')
      AND coalesce(x->>'pending','false')='false' AND length(x->>'summary')>0
      AND NOT EXISTS(SELECT 1 FROM public.ai_cache verified
        WHERE verified.key='issuer-evidence:v1:'||tick||':'||(x->>'call_id')||':'||(x->>'sha')
          AND (verified.payload->>'analysisAt') IS NOT DISTINCT FROM (x->>'analyzed_at'))
    ORDER BY x->>'date' DESC, x->>'call_id' LIMIT 4
  LOOP
    primary_url := doc->'docs'->(c->>'doc')->>'url';
    SELECT payload->'file' INTO raw FROM public.ai_cache
      WHERE key='issuer-turns:v1:'||tick||':'||(c->>'call_id')||':'||(c->>'sha')
        AND payload->>'ticker'=tick AND payload->>'sourceHash'=c->>'sha'
        AND payload->>'sourceUrl'=primary_url AND payload->>'kind'=c->>'kind'
        AND payload->'file'->>'call_id'=c->>'call_id';
    IF raw IS NULL THEN CONTINUE; END IF;
    WITH quotes AS (
      SELECT 1 AS group_order, n, 'theme' AS section, t->>'label' AS label, t->'quotes'->0 AS q
      FROM jsonb_array_elements(coalesce(nullif(c->'themes','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY AS th(t,n)
      UNION ALL SELECT 2,n,'guidance',g->>'metric',g->'quote'
      FROM jsonb_array_elements(coalesce(nullif(c->'guidance','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY AS gs(g,n)
      UNION ALL SELECT 3,n,'question',e->>'concern',e->'concern_quote'
      FROM jsonb_array_elements(coalesce(nullif(c->'exchanges','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY AS es(e,n)
    ), linked AS (
      SELECT q.*,raw->'turns'->(CASE WHEN q.q->>'t' ~ '^[0-9]{1,6}$' THEN (q.q->>'t')::integer END) AS turn
      FROM quotes q WHERE length(btrim(q.q->>'q'))>0
    ), checked AS (
      SELECT l.*,s->>'name' AS speaker,
        (turn->>'i'=q->>'t' AND s->>'name' IS NOT NULL AND
         strpos(regexp_replace(turn->>'x','[[:space:]]+',' ','g'),regexp_replace(btrim(q->>'q'),'[[:space:]]+',' ','g'))>0) AS exact
      FROM linked l LEFT JOIN LATERAL (
        SELECT roster FROM jsonb_array_elements(c->'speakers') roster WHERE roster->>'idx'=l.turn->>'sp' LIMIT 1
      ) sp(s) ON true
    )
    SELECT count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('section',section,'label',label,
      'detail',q->>'q','turn',(q->>'t')::integer,'speaker',speaker) ORDER BY group_order,n) FILTER(WHERE exact),'[]'::jsonb)
    INTO expected,evidence FROM checked;
    receipt := 'issuer-evidence:v1:'||tick||':'||(c->>'call_id')||':'||(c->>'sha');
    INSERT INTO public.ai_cache(key,payload,created_at) VALUES(receipt,jsonb_build_object(
      'analysisAt',c->>'analyzed_at','sourceHash',c->>'sha','sourceUrl',primary_url,
      'candidates',expected,'quotes',evidence),now())
    ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload, created_at=EXCLUDED.created_at
      WHERE public.ai_cache.payload IS DISTINCT FROM EXCLUDED.payload;
    updated := updated + 1;
  END LOOP;
  UPDATE public.job_state SET cursor=CASE WHEN updated=4 THEN at_issuer ELSE (at_issuer+1)%total END,
    updated_at=clock_timestamp(),paused_reason=NULL WHERE job='call-archive-evidence';
  INSERT INTO public.job_runs(job,started_at,finished_at,ok,items,detail)
    VALUES ('call-archive-evidence',started,clock_timestamp(),true,updated,jsonb_build_object('ticker',tick));
  RETURN updated;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.job_runs(job,started_at,finished_at,ok,items,detail)
    VALUES ('call-archive-evidence',started,clock_timestamp(),false,0,jsonb_build_object('error',left(SQLERRM,240)));
  RETURN 0;
END $$;
REVOKE ALL ON FUNCTION public.check_call_archive_evidence() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_call_archive_evidence() TO service_role;

DO $schedule$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('call-archive-evidence','* * * * *','select public.check_call_archive_evidence()');
  END IF;
END $schedule$;
