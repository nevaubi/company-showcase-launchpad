ALTER TABLE public.options_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'cboe',
  ADD COLUMN IF NOT EXISTS meta jsonb;

ALTER TABLE public.options_daily
  ADD CONSTRAINT options_daily_source_check CHECK (source IN ('cboe', 'yahoo'));

COMMENT ON COLUMN public.options_daily.source IS 'Where the day''s quotes came from: cboe (delayed chains, to 19 Nov 2026) or yahoo (Yahoo Finance chains; implied volatility, delta and the 30-day figure computed from the quoted prices).';
COMMENT ON COLUMN public.options_daily.meta IS 'How the day was read: quote time and market state, the rate used for discounting and its date, counts of contracts and two-sided quotes, the basis of the 30-day volatility, and the route (direct or page reader).';
COMMENT ON TABLE public.options_daily IS 'One options snapshot per stock and trading day (30-day implied volatility, at-the-money straddle term structure, 25-delta skew, put/call open interest and volume), with its source. Written by the options collector.';

CREATE INDEX IF NOT EXISTS options_daily_ticker_source_date_idx ON public.options_daily (ticker, source, date);

CREATE FUNCTION public.options_board_v2()
RETURNS TABLE(
  ticker text, date date, price numeric, iv30 numeric, atm_iv numeric, skew25 numeric, pc_oi numeric, pc_vol numeric,
  call_oi bigint, put_oi bigint, call_vol bigint, put_vol bigint, term jsonb,
  iv_n integer, iv_min numeric, iv_max numeric, iv_below integer, iv_prev numeric, vol_avg20 numeric,
  source text, meta jsonb, fetched_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ok AS (SELECT public.has_app_access(auth.uid()) AS allowed),
  latest AS (
    SELECT DISTINCT ON (o.ticker) o.*
    FROM public.options_daily o, ok
    WHERE ok.allowed AND o.date >= (SELECT max(d.date) FROM public.options_daily d) - 7
    ORDER BY o.ticker, o.date DESC
  )
  SELECT l.ticker, l.date, l.price, l.iv30, l.atm_iv, l.skew25, l.pc_oi, l.pc_vol,
         l.call_oi, l.put_oi, l.call_vol, l.put_vol, l.term,
         h.n, h.mn, h.mx, h.below,
         (SELECT y.iv30 FROM public.options_daily y WHERE y.ticker = l.ticker AND y.source = l.source AND y.date < l.date ORDER BY y.date DESC LIMIT 1),
         (SELECT avg(z.call_vol + z.put_vol) FROM (SELECT w.call_vol, w.put_vol FROM public.options_daily w WHERE w.ticker = l.ticker AND w.source = l.source AND w.date < l.date ORDER BY w.date DESC LIMIT 20) z),
         l.source, l.meta, l.fetched_at
  FROM latest l
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n, min(x.iv30) AS mn, max(x.iv30) AS mx,
           (count(*) FILTER (WHERE x.iv30 < l.iv30))::integer AS below
    FROM public.options_daily x
    WHERE x.ticker = l.ticker AND x.source = l.source AND x.date < l.date AND x.date >= l.date - 365 AND x.iv30 > 0
  ) h ON true
$$;
REVOKE EXECUTE ON FUNCTION public.options_board_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.options_board_v2() TO authenticated, service_role;

COMMENT ON FUNCTION public.options_board_v2() IS 'Latest options snapshot per stock with its history figures, each computed only from earlier days of the same source.';
COMMENT ON FUNCTION public.options_board() IS 'DEPRECATED: replaced by options_board_v2 (source-aware history). Kept for app builds published before 27 Nov 2026.';