-- Per-user company visits, for "new since your last visit" badges on company pages, the watchlist and the digest.
CREATE TABLE public.company_visits (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  previous_seen_at timestamptz,
  PRIMARY KEY (user_id, ticker)
);
CREATE INDEX company_visits_user_idx ON public.company_visits (user_id, last_seen_at DESC);

REVOKE ALL ON public.company_visits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_visits TO authenticated;
GRANT ALL ON public.company_visits TO service_role;
ALTER TABLE public.company_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own visits select" ON public.company_visits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own visits insert" ON public.company_visits FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own visits update" ON public.company_visits FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own visits delete" ON public.company_visits FOR DELETE TO authenticated USING (auth.uid() = user_id);
