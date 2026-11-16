-- Customer, supplier and geographic concentration tagged in 10-K/10-Q XBRL (ConcentrationRiskPercentage),
-- one row per filing, item and period, so concentrations can be compared across companies.
CREATE TABLE public.xbrl_concentration (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticker text NOT NULL,
  accn text NOT NULL,
  form text NOT NULL,
  filed date NOT NULL,
  period_start date,
  period_end date NOT NULL,
  kind text NOT NULL,
  benchmark text NOT NULL,
  benchmark_label text NOT NULL DEFAULT '',
  member text NOT NULL,
  label text NOT NULL,
  pct numeric NOT NULL,
  element_id text,
  counterparty text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticker, accn, kind, benchmark, member, period_end)
);
CREATE INDEX xbrl_concentration_ticker ON public.xbrl_concentration (ticker, period_end DESC);
CREATE INDEX xbrl_concentration_counterparty ON public.xbrl_concentration (counterparty) WHERE counterparty IS NOT NULL;

REVOKE ALL ON public.xbrl_concentration FROM anon, authenticated;
GRANT SELECT ON public.xbrl_concentration TO authenticated;
GRANT ALL ON public.xbrl_concentration TO service_role;

ALTER TABLE public.xbrl_concentration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read XBRL concentration" ON public.xbrl_concentration FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()));
