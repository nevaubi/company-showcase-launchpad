-- Freshness on ingest times, job health and per-company coverage (round 2 self-healing, spec P1-4 and P1-5).
--
-- data_freshness(): same keys as 0065 (analytics_hq kept), but most keys now read when we stored
-- something instead of an event date: an event date lags by nature, and a future period end (federal
-- fiscal year 2027 rows dated 2027-09-30) made alt_contracts impossible to age.
--   market_bars, macro       updated_at of the reference series (SPY, DGS10)
--   sec_filings, insider_trades  discovered_at
--   alt_events               last ok run of the sec walk (it writes the 8-K event rows)
--   alt_ownership/recalls    last ok run of the worker's slow alt pass
--   alt_contracts            when contract rows were last stored: the newest created_at or the
--                            collector's as_of stamp (written on every collection from round 2,
--                            unaffected by upserts), never later than now and never the award date
--   alt_settlement           newest fails-to-deliver period, never a future date
--   options_daily            the newest session's fetch time only when it holds at least 80% of the
--                            previous session's rows, else the previous session's: one stored row no
--                            longer keeps it fresh
--   ir_label_map             last ok ir-canon run (the canon keeps most labels, so inserts were rare)
--   reports                  newest ready report_runs row (a lock release no longer looks like a report)
-- job_health(hours): runs, unfinished, failed, last ok, last run and the current failure streak per job
-- (counted over finished runs only; unfinished runs are reported on their own).
-- data_coverage(): per dataset, how many of the top 100 / 500 / 1,000 companies (highest 20-day dollar
-- volume, setup_series.dv20) have a row, and the median and 90th percentile age in hours of each
-- covered company's newest row, so a slow rotation shows instead of hiding behind a table-wide maximum.
-- Indexes: discovered_at lookups (freshness and the worker's filing steps).
CREATE INDEX IF NOT EXISTS sec_filings_discovered_idx ON public.sec_filings (discovered_at DESC);
CREATE INDEX IF NOT EXISTS insider_trades_discovered_idx ON public.insider_trades (discovered_at DESC);
CREATE OR REPLACE FUNCTION public.data_freshness()
RETURNS TABLE(key text, newest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage AS $$
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
$$;
REVOKE ALL ON FUNCTION public.data_freshness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_freshness() TO service_role;
CREATE OR REPLACE FUNCTION public.job_health(_hours int DEFAULT 24)
RETURNS TABLE(job text, runs bigint, unfinished bigint, failed bigint, last_ok timestamptz, last_run timestamptz, fail_streak int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (
    SELECT j.job, j.started_at, j.finished_at, j.ok,
           row_number() OVER (PARTITION BY j.job ORDER BY j.started_at DESC) AS rn,
           -- position among finished runs only: a cut-off or running row neither breaks nor extends a streak (review R9)
           CASE WHEN j.finished_at IS NOT NULL THEN row_number() OVER (PARTITION BY j.job, (j.finished_at IS NOT NULL) ORDER BY j.started_at DESC) END AS frn
    FROM job_runs j
    WHERE j.started_at > now() - make_interval(hours => least(greatest(_hours, 1), 336)) AND j.job <> 'vendor-backfill'
  )
  SELECT r.job, count(*), count(*) FILTER (WHERE r.finished_at IS NULL), count(*) FILTER (WHERE r.ok = false),
         max(r.started_at) FILTER (WHERE r.ok), max(r.started_at),
         coalesce(min(r.frn) FILTER (WHERE r.ok IS TRUE) - 1, count(*) FILTER (WHERE r.finished_at IS NOT NULL))::int
  FROM r GROUP BY r.job
$$;
REVOKE ALL ON FUNCTION public.job_health(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_health(int) TO service_role;
CREATE OR REPLACE FUNCTION public.data_coverage()
RETURNS TABLE(dataset text, top100 int, top500 int, top1000 int, median_age_hours numeric, p90_age_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH top AS (
    SELECT ticker, row_number() OVER (ORDER BY dv20 DESC, ticker)::int AS rk
    FROM setup_series WHERE dv20 > 0 ORDER BY dv20 DESC, ticker LIMIT 1000
  ),
  agg AS (
    SELECT 'analyst_estimates'::text AS ds, ticker, max(fetched_at) AS ts FROM analyst_estimates GROUP BY ticker
    UNION ALL SELECT 'ir_company_series', ticker, max(built_at) FROM ir_company_series GROUP BY ticker
    UNION ALL SELECT 'ir_documents', ticker, max(fetched_at) FROM ir_documents GROUP BY ticker
    UNION ALL SELECT 'ir_label_map', ticker, max(created_at) FROM ir_label_map GROUP BY ticker
    UNION ALL SELECT 'supply_links', ticker, max(created_at) FROM supply_links WHERE is_current GROUP BY ticker
    UNION ALL SELECT 'supply_signals', ticker, max(created_at) FROM supply_signals GROUP BY ticker
    UNION ALL SELECT 'filing_redlines', ticker, max(created_at) FROM filing_redlines GROUP BY ticker
    UNION ALL SELECT 'xbrl_concentration', ticker, max(created_at) FROM xbrl_concentration GROUP BY ticker
    UNION ALL SELECT 'reports', ticker, max(updated_at) FROM reports WHERE status = 'ready' GROUP BY ticker
    UNION ALL SELECT 'setup_signals', ticker, max(last_seen) FROM setup_signals GROUP BY ticker
  ),
  newest AS (
    SELECT 'market_bars'::text AS ds, t.ticker, (SELECT max(m.date) FROM market_bars m WHERE m.symbol = t.ticker)::timestamptz AS ts FROM top t
    UNION ALL SELECT 'short_volume', t.ticker, (SELECT max(s.date) FROM short_volume s WHERE s.symbol = t.ticker)::timestamptz FROM top t
    UNION ALL SELECT 'options_daily', t.ticker, (SELECT max(o.date) FROM options_daily o WHERE o.ticker = t.ticker)::timestamptz FROM top t
    UNION ALL SELECT 'sec_filings', t.ticker, (SELECT max(f.filed) FROM sec_filings f WHERE f.ticker = t.ticker)::timestamptz FROM top t
    UNION ALL SELECT 'earnings_events', t.ticker, (SELECT max(e.filed) FROM earnings_events e WHERE e.ticker = t.ticker)::timestamptz FROM top t
    UNION ALL SELECT 'insider_trades', t.ticker, (SELECT max(i.trade_date) FROM insider_trades i WHERE i.ticker = t.ticker)::timestamptz FROM top t
    UNION ALL SELECT 'ir_kpi_facts', t.ticker, (SELECT k.created_at FROM ir_kpi_facts k WHERE k.ticker = t.ticker ORDER BY k.id DESC LIMIT 1) FROM top t
    UNION ALL SELECT 'alt_' || d.ds, t.ticker, (SELECT max(a.date) FROM alt_data a WHERE a.ticker = t.ticker AND a.dataset = d.ds AND a.date <= current_date)::timestamptz
      FROM top t CROSS JOIN (VALUES ('events'), ('ownership'), ('settlement'), ('attention'), ('regulatory')) AS d(ds)
    UNION ALL SELECT a.ds, t.ticker, a.ts FROM top t JOIN agg a ON a.ticker = t.ticker
  ),
  ages AS (
    SELECT n.ds, t.rk, extract(epoch FROM (now() - n.ts)) / 3600.0 AS age_h
    FROM newest n JOIN top t USING (ticker) WHERE n.ts IS NOT NULL
  ),
  names AS (SELECT DISTINCT ds FROM newest UNION SELECT ds FROM agg)
  SELECT nm.ds AS dataset,
         count(a.rk) FILTER (WHERE a.rk <= 100)::int AS top100,
         count(a.rk) FILTER (WHERE a.rk <= 500)::int AS top500,
         count(a.rk)::int AS top1000,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY a.age_h)::numeric, 1) AS median_age_hours,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY a.age_h)::numeric, 1) AS p90_age_hours
  FROM names nm LEFT JOIN ages a ON a.ds = nm.ds
  GROUP BY nm.ds
$$;
REVOKE ALL ON FUNCTION public.data_coverage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_coverage() TO service_role;

-- replace_supply_signals(ticker, source_kind, rows): one company's signals of one source kind are
-- replaced in one transaction (review F16). The old save inserted the new rows and then deleted the
-- rest, so a failed delete left duplicates; delete-then-insert outside a transaction could lose the
-- stored signals. Here both happen or neither does. Every row must carry the same ticker and
-- source_kind as the arguments, and an empty list is refused (an empty answer is no evidence the
-- stored signals are wrong). Returns the number of rows stored. Only the worker's service role runs it.
CREATE OR REPLACE FUNCTION public.replace_supply_signals(_ticker text, _source_kind text, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n integer;
BEGIN
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) = 0 THEN
    RAISE EXCEPTION 'replace_supply_signals: no rows for % %', _ticker, _source_kind;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_rows) e WHERE e->>'ticker' IS DISTINCT FROM _ticker OR e->>'source_kind' IS DISTINCT FROM _source_kind) THEN
    RAISE EXCEPTION 'replace_supply_signals: every row must have ticker % and source_kind %', _ticker, _source_kind;
  END IF;
  DELETE FROM supply_signals WHERE ticker = _ticker AND source_kind = _source_kind;
  INSERT INTO supply_signals (ticker, kind, title, detail, quote, counterparty, country, amount_usd, pct, period, impact, speaker, source_kind, accn, doc, form, filed, url)
  SELECT p.ticker, p.kind, p.title, p.detail, p.quote, p.counterparty, p.country, p.amount_usd, p.pct, p.period, coalesce(p.impact, 'neutral'), p.speaker, p.source_kind, p.accn, p.doc, p.form, p.filed, p.url
  FROM jsonb_populate_recordset(NULL::supply_signals, _rows) p;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION public.replace_supply_signals(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_supply_signals(text, text, jsonb) TO service_role;
