CREATE TABLE public.supply_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  detail text,
  quote text NOT NULL,
  counterparty text,
  country text,
  amount_usd double precision,
  pct double precision,
  period text,
  impact text NOT NULL DEFAULT 'neutral',
  speaker text,
  source_kind text NOT NULL,
  accn text,
  doc text,
  form text,
  filed text,
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supply_signals_ticker_idx ON public.supply_signals (ticker, kind);
GRANT SELECT ON public.supply_signals TO authenticated;
GRANT ALL ON public.supply_signals TO service_role;
ALTER TABLE public.supply_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read supply signals" ON public.supply_signals FOR SELECT TO authenticated USING (true);