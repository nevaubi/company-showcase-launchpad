CREATE TABLE public.options_daily (
  ticker text NOT NULL,
  date date NOT NULL,
  price numeric NOT NULL,
  iv30 numeric,
  atm_iv numeric,
  skew25 numeric,
  pc_oi numeric,
  pc_vol numeric,
  call_oi bigint NOT NULL DEFAULT 0,
  put_oi bigint NOT NULL DEFAULT 0,
  call_vol bigint NOT NULL DEFAULT 0,
  put_vol bigint NOT NULL DEFAULT 0,
  term jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, date)
);
REVOKE ALL ON public.options_daily FROM anon, authenticated;
GRANT SELECT ON public.options_daily TO authenticated;
GRANT ALL ON public.options_daily TO service_role;
ALTER TABLE public.options_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read options snapshots" ON public.options_daily FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
CREATE INDEX options_daily_date_idx ON public.options_daily (date);

COMMENT ON TABLE public.options_daily IS 'Nightly per-stock options snapshot from Cboe delayed option chains (IV30, ATM straddle term structure, 25-delta skew, put/call OI and volume). Written by the scheduled options job.';

CREATE OR REPLACE FUNCTION public.options_board()
RETURNS TABLE(
  ticker text, date date, price numeric, iv30 numeric, atm_iv numeric, skew25 numeric, pc_oi numeric, pc_vol numeric,
  call_oi bigint, put_oi bigint, call_vol bigint, put_vol bigint, term jsonb,
  iv_n integer, iv_min numeric, iv_max numeric, iv_below integer, iv_prev numeric, vol_avg20 numeric
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
         (SELECT y.iv30 FROM public.options_daily y WHERE y.ticker = l.ticker AND y.date < l.date ORDER BY y.date DESC LIMIT 1),
         (SELECT avg(z.call_vol + z.put_vol) FROM (SELECT w.call_vol, w.put_vol FROM public.options_daily w WHERE w.ticker = l.ticker AND w.date < l.date ORDER BY w.date DESC LIMIT 20) z)
  FROM latest l
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n, min(x.iv30) AS mn, max(x.iv30) AS mx,
           (count(*) FILTER (WHERE x.iv30 < l.iv30))::integer AS below
    FROM public.options_daily x
    WHERE x.ticker = l.ticker AND x.date < l.date AND x.date >= l.date - 365 AND x.iv30 > 0
  ) h ON true
$$;
REVOKE EXECUTE ON FUNCTION public.options_board() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.options_board() TO authenticated, service_role;