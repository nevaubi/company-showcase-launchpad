CREATE TABLE IF NOT EXISTS public.company_visits (
  user_id uuid NOT NULL,
  ticker text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  previous_seen_at timestamptz,
  PRIMARY KEY (user_id, ticker)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_visits TO authenticated;
GRANT ALL ON public.company_visits TO service_role;
ALTER TABLE public.company_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own visits" ON public.company_visits;
CREATE POLICY "Own visits" ON public.company_visits FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);