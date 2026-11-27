-- Coverage ledger (docs/integration-plan.md 4.1): what the app holds, per company and corpus.
-- Rules for each state live in src/lib/coverage/corpora.ts; scripts/coverage.ts measures with
-- corpus_measure(), judges, and stores with corpus_coverage_put() once a day.

CREATE TABLE public.corpus_coverage (
  ticker text NOT NULL,
  corpus text NOT NULL,
  state text NOT NULL CHECK (state IN ('full', 'partial', 'none', 'not_applicable', 'held')),
  items integer NOT NULL DEFAULT 0,
  newest date,
  why text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, corpus)
);
CREATE INDEX corpus_coverage_corpus_state_idx ON public.corpus_coverage (corpus, state);

REVOKE ALL ON public.corpus_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.corpus_coverage TO authenticated;
GRANT ALL ON public.corpus_coverage TO service_role;
ALTER TABLE public.corpus_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "People with app access read coverage"
  ON public.corpus_coverage FOR SELECT TO authenticated
  USING ((SELECT public.has_app_access((SELECT auth.uid()))));

COMMENT ON TABLE public.corpus_coverage IS 'Coverage ledger: one row per covered company and corpus (state, items, newest, the sentence saying why). Written once a day by scripts/coverage.ts; rules in src/lib/coverage/corpora.ts.';

-- Companies in each state, per day: progress before and after every build.
CREATE TABLE public.corpus_coverage_daily (
  day date NOT NULL,
  corpus text NOT NULL,
  state text NOT NULL,
  companies integer NOT NULL,
  items bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, corpus, state)
);
REVOKE ALL ON public.corpus_coverage_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.corpus_coverage_daily TO service_role;
ALTER TABLE public.corpus_coverage_daily ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.corpus_coverage_daily IS 'Daily count of companies per corpus and coverage state. Service role only: the admin Data status page reads it through its server function.';

-- A receipt for every filing read for supply links, also when it names nobody: without it a
-- company with no links cannot be told from a company that was never read.
CREATE TABLE public.supply_scans (
  ticker text NOT NULL,
  accn text NOT NULL,
  form text NOT NULL,
  filed date NOT NULL,
  links integer NOT NULL DEFAULT 0,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, accn)
);
CREATE INDEX supply_scans_ticker_filed_idx ON public.supply_scans (ticker, filed DESC);
REVOKE ALL ON public.supply_scans FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.supply_scans TO service_role;
ALTER TABLE public.supply_scans ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.supply_scans IS 'One row per 10-K or 10-Q read for supply links (src/lib/supply/extract.server.ts), with the number of links it gave. Service role only.';

-- What is stored, per company, for one corpus: [{t: ticker, n: items, d: newest date, x: facts}].
-- One call per corpus keeps every call under the API statement limit.
CREATE FUNCTION public.corpus_measure(_corpus text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  out jsonb;
BEGIN
  IF _corpus = 'filings' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', x)) INTO out FROM (
      SELECT ticker, count(*)::int n, max(filed)::text d,
             jsonb_strip_nulls(jsonb_build_object(
               'report', max(filed) FILTER (WHERE form IN ('10-K','10-Q','10-K/A','10-Q/A','20-F','40-F')),
               'annual', max(filed) FILTER (WHERE form IN ('10-K','20-F','40-F')))) x
      FROM sec_filings GROUP BY ticker) s;

  ELSIF _corpus = 'releases' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', '{}'::jsonb)) INTO out FROM (
      SELECT ticker, count(*)::int n, max(filed)::text d FROM earnings_events GROUP BY ticker) s;

  ELSIF _corpus = 'estimates' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', 1, 'd', fetched_at::date::text, 'x', '{}'::jsonb)) INTO out FROM analyst_estimates;

  ELSIF _corpus = 'options' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', jsonb_build_object('source', src))) INTO out FROM (
      SELECT ticker, count(*)::int n, max(date)::text d, (array_agg(source ORDER BY date DESC))[1] src FROM options_daily GROUP BY ticker) s;

  ELSIF _corpus = 'ir_documents' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', x)) INTO out FROM (
      SELECT ticker, count(*)::int n, (max(filed) FILTER (WHERE filed <= current_date + 1))::text d,
             jsonb_build_object(
               'undated', count(*) FILTER (WHERE filed IS NULL),
               'unread', count(*) FILTER (WHERE extract_status IS NULL AND vision_status IS NULL AND prose_status IS NULL),
               'transcripts', count(*) FILTER (WHERE kind = 'transcript')) x
      FROM ir_documents GROUP BY ticker) s;

  ELSIF _corpus = 'ir_figures' THEN
    SELECT jsonb_agg(jsonb_build_object('t', k.ticker, 'n', coalesce(f.n, 0), 'd', f.d, 'x', jsonb_strip_nulls(jsonb_build_object(
             'statement', f.st, 'built', s.built_at::date, 'series', (s.stats->>'series')::int, 'last_period', s.stats->>'lastPeriod')))) INTO out
    FROM (SELECT ticker FROM ir_company_series UNION SELECT DISTINCT ticker FROM ir_documents WHERE coalesce(extract_facts, 0) + coalesce(prose_facts, 0) > 0) k
    LEFT JOIN (
      SELECT ticker, count(*)::int n, (max(period_end) FILTER (WHERE period_end <= current_date + 1))::text d,
             (count(*) FILTER (WHERE category = 'statement'))::int st
      FROM ir_kpi_facts GROUP BY ticker) f ON f.ticker = k.ticker
    LEFT JOIN ir_company_series s ON s.ticker = k.ticker
    WHERE coalesce(f.n, 0) > 0 OR s.ticker IS NOT NULL;

  ELSIF _corpus = 'calls' THEN
    WITH idx AS (
      SELECT split_part(a.key, ':', 3) ticker, c->>'date' d, c->>'call_id' id, c->>'sha' sha, c->>'event_type' et
      FROM ai_cache a, jsonb_array_elements(a.payload->'bundle'->'calls') c
      WHERE a.key LIKE 'issuer-index:v1:%'),
    arch AS (
      SELECT i.ticker, left(i.d, 10) d FROM idx i
      JOIN ai_cache t ON t.key = 'issuer-turns:v1:' || i.ticker || ':' || i.id || ':' || i.sha
      WHERE i.et = 'earnings' AND i.d ~ '^\d{4}-\d{2}-\d{2}'),
    web AS (
      SELECT payload->'transcript'->>'ticker' ticker, left(payload->'transcript'->>'date', 10) d
      FROM ai_cache WHERE key LIKE 'transcript:v3:%'),
    calls AS (
      SELECT ticker, d FROM arch
      UNION SELECT ticker, d FROM web WHERE ticker IS NOT NULL AND d ~ '^\d{4}-\d{2}-\d{2}'),
    agg AS (
      SELECT ticker, count(*)::int n, max(d) d,
             (count(DISTINCT date_trunc('quarter', d::date)) FILTER (WHERE d::date >= current_date - 760))::int recent
      FROM calls GROUP BY ticker),
    chk AS (
      SELECT split_part(key, ':', 3) ticker, left(payload->>'checked', 10) checked FROM ai_cache WHERE key LIKE 'call-web-ready:v1:%'),
    store AS (
      SELECT ticker, count(*)::int files FROM ir_documents WHERE kind = 'transcript' GROUP BY ticker),
    queued AS (
      SELECT substr(job, length('call-archive-demand:') + 1) ticker FROM job_state WHERE job LIKE 'call-archive-demand:%')
    SELECT jsonb_agg(jsonb_build_object('t', k.ticker, 'n', coalesce(a.n, 0), 'd', a.d, 'x', jsonb_strip_nulls(jsonb_build_object(
             'recent', a.recent, 'checked', c.checked, 'store', s.files, 'queued', (q.ticker IS NOT NULL) OR NULL)))) INTO out
    FROM (SELECT ticker FROM agg UNION SELECT ticker FROM chk UNION SELECT ticker FROM store UNION SELECT ticker FROM queued) k
    LEFT JOIN agg a ON a.ticker = k.ticker
    LEFT JOIN chk c ON c.ticker = k.ticker
    LEFT JOIN store s ON s.ticker = k.ticker
    LEFT JOIN queued q ON q.ticker = k.ticker;

  ELSIF _corpus = 'promises' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', jsonb_strip_nulls(jsonb_build_object('read', true, 'error', err)))) INTO out FROM (
      SELECT DISTINCT ON (split_part(key, ':', 3)) split_part(key, ':', 3) ticker,
             CASE WHEN jsonb_typeof(payload->'promises') = 'array' THEN jsonb_array_length(payload->'promises') ELSE 0 END n,
             left(split_part(key, ':', 4), 10) d, nullif(payload->>'error', '') err
      FROM ai_cache WHERE key LIKE 'promises:v1:%'
      ORDER BY split_part(key, ':', 3), split_part(key, ':', 4) DESC, created_at DESC) s;

  ELSIF _corpus = 'redlines' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', jsonb_build_object('summaries', summaries))) INTO out FROM (
      SELECT ticker, count(*)::int n, max(to_filed)::text d, (count(*) FILTER (WHERE summary IS NOT NULL))::int summaries
      FROM filing_redlines GROUP BY ticker) s;

  ELSIF _corpus = 'insiders' THEN
    WITH idx AS (SELECT ticker, accn FROM sec_filings WHERE form IN ('4', '4/A')),
    rd AS (
      SELECT DISTINCT accn FROM insider_trades
      UNION SELECT substr(job, length('form4-seen:') + 1) FROM job_state WHERE job LIKE 'form4-seen:%'),
    i AS (SELECT idx.ticker, count(*)::int indexed, count(rd.accn)::int rd FROM idx LEFT JOIN rd ON rd.accn = idx.accn GROUP BY idx.ticker),
    t AS (SELECT ticker, count(*)::int n, max(trade_date)::text d, min(trade_date)::text since FROM insider_trades GROUP BY ticker)
    SELECT jsonb_agg(jsonb_build_object('t', coalesce(t.ticker, i.ticker), 'n', coalesce(t.n, 0), 'd', t.d, 'x', jsonb_strip_nulls(jsonb_build_object(
             'indexed', coalesce(i.indexed, 0), 'read', coalesce(i.rd, 0), 'since', t.since)))) INTO out
    FROM t FULL OUTER JOIN i ON i.ticker = t.ticker;

  ELSIF _corpus = 'supply_links' THEN
    WITH l AS (
      SELECT ticker, count(*)::int n, max(filed)::text d, count(DISTINCT counterparty)::int cps
      FROM supply_links WHERE is_current GROUP BY ticker),
    sc AS (
      SELECT DISTINCT ON (ticker) ticker, filed::text filed, form, links, scanned_at::date::text at
      FROM supply_scans WHERE form = '10-K' ORDER BY ticker, filed DESC, scanned_at DESC)
    SELECT jsonb_agg(jsonb_build_object('t', coalesce(l.ticker, sc.ticker), 'n', coalesce(l.n, 0), 'd', l.d, 'x', jsonb_strip_nulls(jsonb_build_object(
             'counterparties', l.cps, 'scan_filed', sc.filed, 'scan_form', sc.form, 'scan_at', sc.at)))) INTO out
    FROM l FULL OUTER JOIN sc ON sc.ticker = l.ticker;

  ELSIF _corpus = 'concentration' THEN
    WITH c AS (SELECT ticker, count(*)::int n, max(filed)::text d FROM xbrl_concentration GROUP BY ticker),
    f AS (SELECT substring(name FROM '^detail/(.+)\.json$') ticker FROM storage.objects WHERE bucket_id = 'datasets' AND name LIKE 'detail/%.json')
    SELECT jsonb_agg(jsonb_build_object('t', coalesce(c.ticker, f.ticker), 'n', coalesce(c.n, 0), 'd', c.d, 'x', jsonb_build_object('file', f.ticker IS NOT NULL))) INTO out
    FROM c FULL OUTER JOIN f ON f.ticker = c.ticker;

  ELSIF _corpus = 'supply_intel' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', '{}'::jsonb)) INTO out FROM (
      SELECT ticker, count(*)::int n, max(created_at)::date::text d FROM supply_signals GROUP BY ticker) s;

  ELSIF _corpus = 'reports' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', jsonb_build_object('kinds', kinds, 'failed', failed))) INTO out FROM (
      SELECT ticker, (count(*) FILTER (WHERE status = 'ready'))::int n, (max(updated_at) FILTER (WHERE status = 'ready'))::date::text d,
             coalesce(jsonb_agg(DISTINCT kind) FILTER (WHERE status = 'ready'), '[]'::jsonb) kinds,
             coalesce(jsonb_agg(DISTINCT kind) FILTER (WHERE status = 'failed'), '[]'::jsonb) failed
      FROM reports WHERE scope = 'shared' AND ticker IS NOT NULL GROUP BY ticker) s;

  ELSIF _corpus = 'alt_data' THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', n, 'd', d, 'x', jsonb_build_object('datasets', sets))) INTO out FROM (
      SELECT ticker, count(*)::int n, (max(date) FILTER (WHERE date <= current_date + 1))::text d, count(DISTINCT dataset)::int sets
      FROM alt_data WHERE ticker IS NOT NULL GROUP BY ticker) s;

  ELSIF _corpus = 'prices' THEN
    WITH b AS (SELECT symbol ticker, count(*)::int n, max(date)::text d FROM market_bars GROUP BY symbol),
    f AS (SELECT substring(name FROM '^prices/(.+)\.json$') ticker FROM storage.objects WHERE bucket_id = 'datasets' AND name LIKE 'prices/%.json')
    SELECT jsonb_agg(jsonb_build_object('t', coalesce(b.ticker, f.ticker), 'n', coalesce(b.n, 0), 'd', b.d, 'x', jsonb_build_object('file', f.ticker IS NOT NULL))) INTO out
    FROM b FULL OUTER JOIN f ON f.ticker = b.ticker;

  ELSIF _corpus IN ('statements', 'filing_detail') THEN
    SELECT jsonb_agg(jsonb_build_object('t', ticker, 'n', 1, 'd', d, 'x', '{}'::jsonb)) INTO out FROM (
      SELECT substring(name FROM '^[a-z]+/(.+)\.json$') ticker, max(updated_at)::date::text d
      FROM storage.objects
      WHERE bucket_id = 'datasets' AND name LIKE (CASE _corpus WHEN 'statements' THEN 'companies' ELSE 'detail' END) || '/%.json'
      GROUP BY 1) s;

  ELSE
    RAISE EXCEPTION 'unknown corpus %', _corpus;
  END IF;
  RETURN coalesce(out, '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.corpus_measure(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corpus_measure(text) TO service_role;
COMMENT ON FUNCTION public.corpus_measure(text) IS 'Coverage ledger: what is stored per company for one corpus, as [{t, n, d, x}]. Service role only (scripts/coverage.ts).';

-- Store one corpus: every covered company's row, rows of companies no longer sent removed, and
-- today's count per state. A call with fewer than 100 rows is refused: it would empty the corpus.
CREATE FUNCTION public.corpus_coverage_put(_corpus text, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) < 100 THEN
    RAISE EXCEPTION 'corpus_coverage_put(%): expected every covered company, got % rows', _corpus, coalesce(jsonb_array_length(_rows), 0);
  END IF;
  INSERT INTO corpus_coverage (ticker, corpus, state, items, newest, why, checked_at)
  SELECT r->>'ticker', _corpus, r->>'state', coalesce((r->>'items')::int, 0), nullif(r->>'newest', '')::date, coalesce(r->>'why', ''), now()
  FROM jsonb_array_elements(_rows) r
  ON CONFLICT (ticker, corpus) DO UPDATE
    SET state = excluded.state, items = excluded.items, newest = excluded.newest, why = excluded.why, checked_at = excluded.checked_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM corpus_coverage c
  WHERE c.corpus = _corpus AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_rows) r WHERE r->>'ticker' = c.ticker);
  DELETE FROM corpus_coverage_daily WHERE day = current_date AND corpus = _corpus;
  INSERT INTO corpus_coverage_daily (day, corpus, state, companies, items)
  SELECT current_date, _corpus, state, count(*)::int, coalesce(sum(items), 0) FROM corpus_coverage WHERE corpus = _corpus GROUP BY state;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.corpus_coverage_put(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corpus_coverage_put(text, jsonb) TO service_role;

-- The matrix for the admin page: one string per company, one letter per corpus in the order of
-- `corpora` (f full, p partial, n none, x not applicable, h held, - no row), and 30 days of counts.
CREATE FUNCTION public.corpus_coverage_matrix()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH corp AS (SELECT DISTINCT corpus FROM corpus_coverage),
  r AS (
    SELECT t.ticker,
           string_agg(CASE c.state WHEN 'full' THEN 'f' WHEN 'partial' THEN 'p' WHEN 'none' THEN 'n' WHEN 'not_applicable' THEN 'x' WHEN 'held' THEN 'h' ELSE '-' END, '' ORDER BY k.corpus) codes
    FROM (SELECT DISTINCT ticker FROM corpus_coverage) t
    CROSS JOIN corp k
    LEFT JOIN corpus_coverage c ON c.ticker = t.ticker AND c.corpus = k.corpus
    GROUP BY t.ticker)
  SELECT jsonb_build_object(
    'checked', (SELECT max(checked_at) FROM corpus_coverage),
    'corpora', (SELECT coalesce(jsonb_agg(corpus ORDER BY corpus), '[]'::jsonb) FROM corp),
    'rows', (SELECT coalesce(jsonb_object_agg(ticker, codes), '{}'::jsonb) FROM r),
    'daily', (SELECT coalesce(jsonb_agg(jsonb_build_array(day, corpus, state, companies, items) ORDER BY day, corpus, state), '[]'::jsonb)
              FROM corpus_coverage_daily WHERE day >= current_date - 30))
$$;
REVOKE ALL ON FUNCTION public.corpus_coverage_matrix() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corpus_coverage_matrix() TO service_role;
COMMENT ON FUNCTION public.corpus_coverage_matrix() IS 'Coverage matrix and 30 days of counts for the admin Data status page. Service role only: the page''s server function checks has_role(admin) first.';

-- Every company's row for one corpus: [{t, s, n, d, w}].
CREATE FUNCTION public.corpus_coverage_rows(_corpus text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('t', ticker, 's', state, 'n', items, 'd', newest, 'w', why) ORDER BY ticker), '[]'::jsonb)
  FROM corpus_coverage WHERE corpus = _corpus
$$;
REVOKE ALL ON FUNCTION public.corpus_coverage_rows(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corpus_coverage_rows(text) TO service_role;

-- Freshness: the ledger itself must advance daily.
CREATE OR REPLACE FUNCTION public.data_freshness()
 RETURNS TABLE(key text, newest timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
  SELECT 'market_bars', (SELECT max(updated_at) FROM market_bars WHERE symbol = 'SPY')
  UNION ALL SELECT 'macro', (SELECT max(updated_at) FROM macro_observations WHERE series_id = 'DGS10')
  UNION ALL SELECT 'sec_filings', (SELECT max(discovered_at) FROM sec_filings WHERE filed >= current_date - 10)
  UNION ALL SELECT 'insider_trades', (SELECT max(discovered_at) FROM insider_trades WHERE trade_date >= current_date - 30)
  UNION ALL SELECT 'earnings_events', (SELECT max(filed)::timestamptz FROM earnings_events)
  UNION ALL SELECT 'filing_documents', (SELECT max(cached_at) FROM filing_documents)
  UNION ALL SELECT 'alt_events', (SELECT max(started_at) FROM job_runs WHERE job = 'sec' AND ok AND started_at > now() - interval '30 days')
  UNION ALL SELECT 'alt_ownership', (SELECT max(started_at) FROM job_runs WHERE job = 'alt-slow' AND ok AND started_at > now() - interval '30 days')
  UNION ALL SELECT 'alt_contracts', (SELECT least(now(), greatest(max(created_at), max(CASE WHEN meta->>'as_of' ~ '^\d{4}-\d{2}-\d{2}' THEN (meta->>'as_of')::timestamptz END))) FROM alt_data WHERE dataset = 'contracts')
  UNION ALL SELECT 'alt_recalls', (SELECT max(started_at) FROM job_runs WHERE job = 'alt-slow' AND ok AND started_at > now() - interval '30 days')
  UNION ALL SELECT 'alt_settlement', (SELECT max(date)::timestamptz FROM alt_data WHERE dataset = 'settlement' AND date <= current_date)
  UNION ALL SELECT 'alt_medicare', (SELECT max(created_at) FROM alt_data WHERE dataset = 'medicare' AND date > current_date - 800)
  UNION ALL SELECT 'analyst_estimates', (SELECT max(fetched_at) FROM analyst_estimates)
  UNION ALL SELECT 'options_daily', (
    SELECT CASE WHEN cur.n >= 0.8 * coalesce(prev.n, 0) THEN cur.f ELSE prev.f END
    FROM (SELECT count(*) n, max(fetched_at) f FROM options_daily WHERE date = (SELECT max(date) FROM options_daily)) cur,
         (SELECT count(*) n, max(fetched_at) f FROM options_daily WHERE date = (SELECT max(date) FROM options_daily WHERE date < (SELECT max(date) FROM options_daily))) prev)
  UNION ALL SELECT 'short_volume', (SELECT max(date)::timestamptz FROM short_volume)
  UNION ALL SELECT 'setup_results', (SELECT max(generated_at) FROM setup_results)
  UNION ALL SELECT 'paper_bots', (SELECT max(date)::timestamptz FROM paper_bot_equity)
  UNION ALL SELECT 'ir_documents', (SELECT max(fetched_at) FROM ir_documents)
  UNION ALL SELECT 'ir_kpi_facts', (SELECT max(created_at) FROM ir_kpi_facts)
  UNION ALL SELECT 'ir_company_series', (SELECT max(built_at) FROM ir_company_series)
  UNION ALL SELECT 'ir_label_map', (SELECT max(started_at) FROM job_runs WHERE job = 'ir-canon' AND ok AND started_at > now() - interval '30 days')
  UNION ALL SELECT 'partner_mirror', (SELECT max(mirrored_at) FROM partner_mirror)
  UNION ALL SELECT 'xbrl_concentration', (SELECT max(created_at) FROM xbrl_concentration)
  UNION ALL SELECT 'supply_links', (SELECT max(created_at) FROM supply_links)
  UNION ALL SELECT 'supply_signals', (SELECT max(created_at) FROM supply_signals)
  UNION ALL SELECT 'filing_redlines', (SELECT max(created_at) FROM filing_redlines)
  UNION ALL SELECT 'reports', (SELECT max(created_at) FROM report_runs WHERE status = 'ready')
  UNION ALL SELECT 'ai_cache', (SELECT max(created_at) FROM ai_cache)
  UNION ALL SELECT 'vendor_backfill', (SELECT max(started_at) FROM job_runs WHERE job = 'vendor-backfill' AND started_at > now() - interval '30 days')
  UNION ALL SELECT 'sec_discover', (SELECT max(started_at) FROM job_runs WHERE job = 'sec-discover' AND ok AND started_at > now() - interval '30 days')
  UNION ALL SELECT 'partner_mirror_job', (SELECT max(started_at) FROM job_runs WHERE job = 'partner-mirror' AND ok AND started_at > now() - interval '30 days')
  UNION ALL SELECT 'worker_heartbeat', (SELECT max(updated_at) FROM storage.objects WHERE bucket_id = 'ir-documents' AND name = 'ops/ir-deep-loop.json')
  UNION ALL SELECT 'analytics_markets', (SELECT max(updated_at) FROM storage.objects WHERE bucket_id = 'datasets' AND name = 'analytics/markets.json')
  UNION ALL SELECT 'analytics_auctions', (SELECT max(updated_at) FROM storage.objects WHERE bucket_id = 'datasets' AND name = 'analytics/treasury-auctions.json')
  UNION ALL SELECT 'analytics_hedge', (SELECT max(updated_at) FROM storage.objects WHERE bucket_id = 'datasets' AND name = 'analytics/hedge-funds.json')
  UNION ALL SELECT 'analytics_context', (SELECT max(updated_at) FROM storage.objects WHERE bucket_id = 'datasets' AND name LIKE 'analytics/context/%')
  UNION ALL SELECT 'analytics_hq', (SELECT max(updated_at) FROM storage.objects WHERE bucket_id = 'datasets' AND name = 'analytics/hq.json')
  UNION ALL SELECT 'universe', (SELECT max(updated_at) FROM storage.objects WHERE bucket_id = 'datasets' AND name = 'universe.json')
  UNION ALL SELECT 'corpus_coverage', (SELECT max(checked_at) FROM corpus_coverage)
$function$;