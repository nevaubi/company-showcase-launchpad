CREATE TABLE public.browser_runs (
  run_id text PRIMARY KEY,
  user_id uuid NOT NULL,
  goal text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX browser_runs_user_day ON public.browser_runs (user_id, created_at DESC);
REVOKE ALL ON public.browser_runs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.browser_runs TO authenticated;
GRANT ALL ON public.browser_runs TO service_role;
ALTER TABLE public.browser_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own browser runs read" ON public.browser_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own browser runs insert" ON public.browser_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);