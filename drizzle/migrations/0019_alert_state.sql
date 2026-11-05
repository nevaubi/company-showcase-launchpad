CREATE TABLE public.alert_state (
  user_id uuid PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.alert_state TO authenticated;
GRANT ALL ON public.alert_state TO service_role;
ALTER TABLE public.alert_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own alert state read" ON public.alert_state FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own alert state insert" ON public.alert_state FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own alert state update" ON public.alert_state FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);