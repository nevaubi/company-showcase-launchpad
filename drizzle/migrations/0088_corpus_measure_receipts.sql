CREATE OR REPLACE FUNCTION public.corpus_measure(_corpus text)
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
    -- `estimates-none:<T>`: the provider had no analyst coverage for the company when it was last asked
    SELECT jsonb_agg(jsonb_build_object('t', coalesce(e.ticker, z.ticker), 'n', CASE WHEN e.ticker IS NULL THEN 0 ELSE 1 END, 'd', e.fetched_at::date::text,
             'x', jsonb_strip_nulls(jsonb_build_object('none_at', z.at)))) INTO out
    FROM analyst_estimates e
    FULL OUTER JOIN (SELECT substr(job, length('estimates-none:') + 1) ticker, updated_at::date::text at FROM job_state WHERE job LIKE 'estimates-none:%') z ON z.ticker = e.ticker;

  ELSIF _corpus = 'options' THEN
    -- `options-none:<T>`: the source listed no options for the company when it was last looked at
    SELECT jsonb_agg(jsonb_build_object('t', coalesce(s.ticker, z.ticker), 'n', coalesce(s.n, 0), 'd', s.d,
             'x', jsonb_strip_nulls(jsonb_build_object('source', s.src, 'none_at', z.at)))) INTO out
    FROM (SELECT ticker, count(*)::int n, max(date)::text d, (array_agg(source ORDER BY date DESC))[1] src FROM options_daily GROUP BY ticker) s
    FULL OUTER JOIN (SELECT substr(job, length('options-none:') + 1) ticker, updated_at::date::text at FROM job_state WHERE job LIKE 'options-none:%') z ON z.ticker = s.ticker;

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
    -- current links; links kept only as history; and the newest 10-K on record as read (supply_scans)
    WITH l AS (
      SELECT ticker, (count(*) FILTER (WHERE is_current))::int n, (max(filed) FILTER (WHERE is_current))::text d,
             (count(DISTINCT counterparty) FILTER (WHERE is_current))::int cps,
             (count(*) FILTER (WHERE NOT is_current))::int history, (max(filed) FILTER (WHERE NOT is_current))::text history_newest
      FROM supply_links GROUP BY ticker),
    sc AS (
      SELECT DISTINCT ON (ticker) ticker, filed::text filed, form, links, scanned_at::date::text at
      FROM supply_scans WHERE form = '10-K' ORDER BY ticker, filed DESC, scanned_at DESC)
    SELECT jsonb_agg(jsonb_build_object('t', coalesce(l.ticker, sc.ticker), 'n', coalesce(l.n, 0), 'd', l.d, 'x', jsonb_strip_nulls(jsonb_build_object(
             'counterparties', l.cps, 'history', nullif(l.history, 0), 'history_newest', l.history_newest,
             'scan_filed', sc.filed, 'scan_form', sc.form, 'scan_at', sc.at, 'scan_links', sc.links)))) INTO out
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