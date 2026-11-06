-- Precomputed filing comparisons (10-K vs prior 10-K, 10-Q vs same quarter last year) with an optional cited summary.
CREATE TABLE public.filing_redlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  form text NOT NULL CHECK (form IN ('10-K', '10-Q')),
  from_accn text NOT NULL,
  to_accn text NOT NULL,
  to_filed date NOT NULL,
  version integer NOT NULL,
  stats jsonb NOT NULL DEFAULT '[]'::jsonb,
  high integer NOT NULL DEFAULT 0,
  medium integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_accn, to_accn, version)
);
CREATE INDEX filing_redlines_ticker_idx ON public.filing_redlines (ticker, form, to_filed DESC);
CREATE INDEX filing_redlines_recent_idx ON public.filing_redlines (to_filed DESC);

REVOKE ALL ON public.filing_redlines FROM anon, authenticated;
GRANT SELECT ON public.filing_redlines TO authenticated;
GRANT ALL ON public.filing_redlines TO service_role;
ALTER TABLE public.filing_redlines ENABLE ROW LEVEL SECURITY;
-- Public-filing analysis: any signed-in user can read; only the server writes.
CREATE POLICY "Signed-in users read filing redlines" ON public.filing_redlines FOR SELECT TO authenticated USING (true);