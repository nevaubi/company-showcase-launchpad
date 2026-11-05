CREATE TABLE public.analyst_estimates (
  ticker text PRIMARY KEY,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.analyst_estimates TO authenticated;
GRANT ALL ON public.analyst_estimates TO service_role;
ALTER TABLE public.analyst_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read estimates" ON public.analyst_estimates FOR SELECT TO authenticated USING (true);