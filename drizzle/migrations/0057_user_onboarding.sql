CREATE TABLE public.user_onboarding (
  user_id uuid PRIMARY KEY,
  seeded_at timestamptz,
  tour_done_at timestamptz,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  dismissed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.user_onboarding FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_onboarding TO authenticated;
GRANT ALL ON public.user_onboarding TO service_role;
ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own onboarding read" ON public.user_onboarding FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own onboarding insert" ON public.user_onboarding FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own onboarding update" ON public.user_onboarding FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);