-- ===== Market data used by the strategies =====
CREATE TABLE public.short_volume (
  symbol text NOT NULL,
  date date NOT NULL,
  short_vol real NOT NULL,
  exempt_vol real NOT NULL DEFAULT 0,
  total_vol real NOT NULL,
  PRIMARY KEY (symbol, date)
);
CREATE INDEX short_volume_date_idx ON public.short_volume (date);

CREATE TABLE public.earnings_events (
  ticker text NOT NULL,
  accn text NOT NULL,
  filed date NOT NULL,
  source text NOT NULL DEFAULT 'sec-8k-2.02',
  PRIMARY KEY (ticker, accn)
);
CREATE INDEX earnings_events_ticker_filed_idx ON public.earnings_events (ticker, filed);

CREATE TABLE public.insider_buys (
  ticker text NOT NULL,
  accn text NOT NULL,
  owner text NOT NULL,
  role text,
  is_officer boolean NOT NULL DEFAULT false,
  is_director boolean NOT NULL DEFAULT false,
  trade_date date,
  filed date NOT NULL,
  shares double precision,
  value double precision,
  plan_10b5 boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'sec-form4',
  PRIMARY KEY (accn, owner)
);
CREATE INDEX insider_buys_ticker_filed_idx ON public.insider_buys (ticker, filed);

-- ===== Strategy engine =====
CREATE TABLE public.setup_cycles (
  as_of date PRIMARY KEY,
  phase text NOT NULL DEFAULT 'context',
  cursor integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.setup_scan (
  ticker text PRIMARY KEY,
  sector text,
  scanned_for date,
  claimed_at timestamptz,
  bars integer,
  samples integer,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.setup_samples (
  ticker text NOT NULL,
  variant text NOT NULL,
  d date NOT NULL,
  net real NOT NULL,
  ex real NOT NULL,
  gross real NOT NULL
);
CREATE INDEX setup_samples_variant_d_idx ON public.setup_samples (variant, d);
CREATE INDEX setup_samples_ticker_idx ON public.setup_samples (ticker);

CREATE TABLE public.setup_series (
  ticker text PRIMARY KEY,
  sector text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  o real[] NOT NULL,
  c real[] NOT NULL,
  dv20 real,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX setup_series_sector_idx ON public.setup_series (sector, dv20 DESC);

CREATE TABLE public.setup_signals (
  ticker text NOT NULL,
  variant text NOT NULL,
  fired_at date NOT NULL,
  first_seen date NOT NULL,
  last_seen date NOT NULL,
  name text,
  sector text,
  strategy text NOT NULL,
  side smallint NOT NULL,
  horizon smallint NOT NULL,
  strength real,
  detail text,
  price real,
  atr real,
  dv20 real,
  cost real,
  spark real[],
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_net real,
  outcome_ex real,
  outcome_at date,
  PRIMARY KEY (ticker, variant, fired_at)
);
CREATE INDEX setup_signals_last_seen_idx ON public.setup_signals (last_seen DESC);
CREATE INDEX setup_signals_variant_idx ON public.setup_signals (variant, fired_at);

CREATE TABLE public.setup_variant_stats (
  variant text PRIMARY KEY,
  as_of date NOT NULL,
  stats jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.setup_results (
  as_of date PRIMARY KEY,
  generated_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

-- Service-side helpers
CREATE OR REPLACE FUNCTION public.setup_claim_tickers(_as_of date, _n integer)
RETURNS TABLE (ticker text, sector text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.setup_scan s SET claimed_at = now()
  WHERE s.ticker IN (
    SELECT x.ticker FROM public.setup_scan x
    WHERE (x.scanned_for IS NULL OR x.scanned_for < _as_of)
      AND (x.claimed_at IS NULL OR x.claimed_at < now() - interval '3 minutes')
    ORDER BY x.scanned_for NULLS FIRST, x.ticker
    LIMIT _n
    FOR UPDATE SKIP LOCKED
  )
  RETURNING s.ticker, s.sector
$$;

CREATE OR REPLACE FUNCTION public.setup_variant_daily(_variant text)
RETURNS TABLE (d date, n integer, net double precision, ex double precision, gross double precision, hits integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.d, count(*)::int, sum(s.net)::float8, sum(s.ex)::float8, sum(s.gross)::float8, count(*) FILTER (WHERE s.net > 0)::int
  FROM public.setup_samples s WHERE s.variant = _variant GROUP BY s.d ORDER BY s.d
$$;

CREATE OR REPLACE FUNCTION public.setup_variant_list()
RETURNS TABLE (variant text, n integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.variant, count(*)::int FROM public.setup_samples s GROUP BY s.variant ORDER BY s.variant
$$;

CREATE OR REPLACE FUNCTION public.setup_forward_stats()
RETURNS TABLE (variant text, n integer, avg_net double precision, avg_ex double precision, hits integer, first_seen date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.variant, count(*)::int, avg(s.outcome_net)::float8, avg(s.outcome_ex)::float8, count(*) FILTER (WHERE s.outcome_net > 0)::int, min(s.first_seen)
  FROM public.setup_signals s WHERE s.outcome_net IS NOT NULL GROUP BY s.variant
$$;

-- ===== Paper autopilots =====
CREATE TABLE public.paper_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  slug text UNIQUE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  capital numeric NOT NULL DEFAULT 100000 CHECK (capital >= 1000 AND capital <= 100000000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  started_on date NOT NULL DEFAULT current_date,
  last_as_of date,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_bots_user_idx ON public.paper_bots (user_id);

CREATE TABLE public.paper_bot_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES public.paper_bots(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  name text,
  sector text,
  variant text NOT NULL,
  strategy text NOT NULL,
  side smallint NOT NULL CHECK (side IN (-1, 1)),
  horizon smallint NOT NULL,
  signal_date date NOT NULL,
  signal_price real,
  stop real,
  target real,
  atr real,
  cost real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','open','closed','cancelled')),
  entry_date date,
  entry_price real,
  shares real,
  notional real,
  spy_entry real,
  exit_date date,
  exit_price real,
  exit_reason text,
  pnl real,
  ret real,
  ret_spy real,
  close_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_bot_positions_bot_idx ON public.paper_bot_positions (bot_id, status);
CREATE UNIQUE INDEX paper_bot_positions_unique_signal ON public.paper_bot_positions (bot_id, ticker, variant, signal_date);

CREATE TABLE public.paper_bot_equity (
  bot_id uuid NOT NULL REFERENCES public.paper_bots(id) ON DELETE CASCADE,
  date date NOT NULL,
  equity double precision NOT NULL,
  invested double precision NOT NULL DEFAULT 0,
  realized double precision NOT NULL DEFAULT 0,
  open_positions integer NOT NULL DEFAULT 0,
  spy double precision,
  PRIMARY KEY (bot_id, date)
);

-- Plan limit for personal autopilots (automations lock when the trial ends).
CREATE OR REPLACE FUNCTION public.paper_bot_limit(_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.effective_tier(_user) WHEN 'pro' THEN 25 WHEN 'research' THEN 5 WHEN 'trial' THEN 2 ELSE 0 END
$$;

-- Signed-in callers (role authenticated) are checked; the background job and migrations are not.
CREATE OR REPLACE FUNCTION public.paper_bots_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller text := coalesce(auth.role(), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF caller NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
    IF NEW.user_id IS NULL OR NEW.user_id <> auth.uid() THEN RAISE EXCEPTION 'You can only create your own autopilots'; END IF;
    IF (SELECT count(*) FROM public.paper_bots WHERE user_id = NEW.user_id) >= public.paper_bot_limit(NEW.user_id) THEN
      RAISE EXCEPTION 'Your plan allows % personal autopilots', public.paper_bot_limit(NEW.user_id);
    END IF;
    NEW.slug := NULL;
    NEW.started_on := current_date;
    NEW.last_as_of := NULL;
    NEW.last_run_at := NULL;
    NEW.last_error := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF caller IN ('authenticated', 'anon') AND NEW.status = 'active' AND OLD.status = 'paused' AND public.paper_bot_limit(NEW.user_id) = 0 THEN
      RAISE EXCEPTION 'Automations are locked after the trial; choose a plan on the Billing page';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER paper_bots_guard BEFORE INSERT OR UPDATE ON public.paper_bots FOR EACH ROW EXECUTE FUNCTION public.paper_bots_guard();

CREATE OR REPLACE FUNCTION public.request_bot_close(_position uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.paper_bot_positions p SET close_requested = true, updated_at = now()
  FROM public.paper_bots b
  WHERE p.id = _position AND b.id = p.bot_id AND b.user_id = auth.uid() AND p.status IN ('pending','open');
  IF NOT FOUND THEN RAISE EXCEPTION 'Position not found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reset_paper_bot(_bot uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.paper_bots WHERE id = _bot AND user_id = auth.uid()) THEN RAISE EXCEPTION 'Autopilot not found'; END IF;
  DELETE FROM public.paper_bot_positions WHERE bot_id = _bot;
  DELETE FROM public.paper_bot_equity WHERE bot_id = _bot;
  UPDATE public.paper_bots SET started_on = current_date, last_as_of = NULL, last_run_at = NULL, last_error = NULL WHERE id = _bot;
END $$;

-- ===== Privileges (this project's defaults grant everything, so revoke first) =====
REVOKE ALL ON public.short_volume, public.earnings_events, public.insider_buys, public.setup_cycles, public.setup_scan,
  public.setup_samples, public.setup_series, public.setup_signals, public.setup_variant_stats, public.setup_results,
  public.paper_bots, public.paper_bot_positions, public.paper_bot_equity FROM anon, authenticated;
GRANT ALL ON public.short_volume, public.earnings_events, public.insider_buys, public.setup_cycles, public.setup_scan,
  public.setup_samples, public.setup_series, public.setup_signals, public.setup_variant_stats, public.setup_results,
  public.paper_bots, public.paper_bot_positions, public.paper_bot_equity TO service_role;
GRANT SELECT ON public.short_volume, public.earnings_events, public.insider_buys, public.setup_signals, public.setup_results,
  public.setup_variant_stats, public.paper_bots, public.paper_bot_positions, public.paper_bot_equity TO authenticated;
GRANT INSERT (name, description, rules, capital, status, user_id) ON public.paper_bots TO authenticated;
GRANT UPDATE (name, description, rules, status) ON public.paper_bots TO authenticated;
GRANT DELETE ON public.paper_bots TO authenticated;

ALTER TABLE public.short_volume ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earnings_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insider_buys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_scan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_variant_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setup_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_bot_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paper_bot_equity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read short volume" ON public.short_volume FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
CREATE POLICY "Members read earnings events" ON public.earnings_events FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
CREATE POLICY "Members read insider buys" ON public.insider_buys FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
CREATE POLICY "Members read setup signals" ON public.setup_signals FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
CREATE POLICY "Members read setup results" ON public.setup_results FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
CREATE POLICY "Members read variant stats" ON public.setup_variant_stats FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));

CREATE POLICY "Read house and own autopilots" ON public.paper_bots FOR SELECT TO authenticated
  USING (public.has_app_access(auth.uid()) AND (user_id IS NULL OR user_id = auth.uid()));
CREATE POLICY "Create own autopilots" ON public.paper_bots FOR INSERT TO authenticated
  WITH CHECK (public.has_app_access(auth.uid()) AND user_id = auth.uid());
CREATE POLICY "Edit own autopilots" ON public.paper_bots FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Delete own autopilots" ON public.paper_bots FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Read visible autopilot positions" ON public.paper_bot_positions FOR SELECT TO authenticated
  USING (public.has_app_access(auth.uid()) AND EXISTS (SELECT 1 FROM public.paper_bots b WHERE b.id = bot_id AND (b.user_id IS NULL OR b.user_id = auth.uid())));
CREATE POLICY "Read visible autopilot equity" ON public.paper_bot_equity FOR SELECT TO authenticated
  USING (public.has_app_access(auth.uid()) AND EXISTS (SELECT 1 FROM public.paper_bots b WHERE b.id = bot_id AND (b.user_id IS NULL OR b.user_id = auth.uid())));

REVOKE ALL ON FUNCTION public.setup_claim_tickers(date, integer), public.setup_variant_daily(text), public.setup_variant_list(), public.setup_forward_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_claim_tickers(date, integer), public.setup_variant_daily(text), public.setup_variant_list(), public.setup_forward_stats() TO service_role;
REVOKE ALL ON FUNCTION public.paper_bot_limit(uuid), public.request_bot_close(uuid), public.reset_paper_bot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paper_bot_limit(uuid), public.request_bot_close(uuid), public.reset_paper_bot(uuid) TO authenticated, service_role;

-- ===== House autopilots =====
INSERT INTO public.paper_bots (user_id, slug, name, description, rules, capital, started_on) VALUES
  (NULL, 'house-proven', 'Proven setups', 'Trades only strategies that pass every statistical check, in the current market regime.', '{"select":"proven","side":"both","maxPositions":10,"positionPct":0.1,"maxPerSector":3,"minStrength":0}'::jsonb, 100000, current_date),
  (NULL, 'house-watch', 'Closest candidates', 'Forward test of the watch-only near misses: positive after costs since 2022 but not yet proven.', '{"select":"watch","side":"both","maxPositions":12,"positionPct":0.08,"maxPerSector":3,"minStrength":0}'::jsonb, 100000, current_date),
  (NULL, 'house-snapback', 'Snap-back basket', 'Forward test of every overreaction strategy (weekly, sector-adjusted, RSI 2, gaps, volume shocks, stress reversals).', '{"select":"family","families":["reversal"],"side":"both","maxPositions":15,"positionPct":0.06,"maxPerSector":4,"minStrength":0}'::jsonb, 100000, current_date),
  (NULL, 'house-momentum', 'Momentum basket', 'Forward test of every momentum strategy (52-week highs, squeezes, trend, attention).', '{"select":"family","families":["momentum"],"side":"both","maxPositions":15,"positionPct":0.06,"maxPerSector":4,"minStrength":0}'::jsonb, 100000, current_date),
  (NULL, 'house-events', 'Events basket', 'Forward test of the event strategies: earnings drift, earnings run-ups, insider buying clusters and short-selling flow.', '{"select":"family","families":["events"],"side":"both","maxPositions":15,"positionPct":0.06,"maxPerSector":4,"minStrength":0}'::jsonb, 100000, current_date);