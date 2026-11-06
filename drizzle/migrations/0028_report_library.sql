-- Report library: generated primers / previews / recaps / IC memos, shared or per firm / user, plus templates.
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  kind text NOT NULL CHECK (kind IN ('primer', 'preview', 'recap', 'memo')),
  scope text NOT NULL CHECK (scope IN ('shared', 'firm', 'user')),
  firm_id uuid REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id uuid,
  variant text NOT NULL DEFAULT 'base' CHECK (char_length(variant) <= 40),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_version text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('generating', 'ready', 'failed')),
  content jsonb,
  error text,
  title text,
  requested_by uuid,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'shared' AND firm_id IS NULL AND user_id IS NULL)
      OR (scope = 'firm' AND firm_id IS NOT NULL AND user_id IS NULL)
      OR (scope = 'user' AND user_id IS NOT NULL AND firm_id IS NULL))
);
CREATE UNIQUE INDEX reports_slot_uniq ON public.reports (ticker, kind, scope, COALESCE(firm_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), variant);
CREATE INDEX reports_recent_idx ON public.reports (updated_at DESC);
CREATE INDEX reports_firm_idx ON public.reports (firm_id) WHERE firm_id IS NOT NULL;
CREATE INDEX reports_user_idx ON public.reports (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id uuid,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('primer', 'preview', 'recap', 'memo')),
  options jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(options::text) <= 4000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((firm_id IS NULL) <> (user_id IS NULL))
);
CREATE INDEX report_templates_firm_idx ON public.report_templates (firm_id);

-- This project's default privileges grant everything; reset to exactly what the app needs.
REVOKE ALL ON public.reports, public.report_templates FROM anon, authenticated;
GRANT SELECT, DELETE ON public.reports TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.report_templates TO authenticated;
GRANT UPDATE (name, options) ON public.report_templates TO authenticated;
GRANT ALL ON public.reports, public.report_templates TO service_role;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

-- Reports are written only by the server after source checks.
CREATE POLICY "Read shared, firm and own reports" ON public.reports FOR SELECT TO authenticated
  USING (scope = 'shared'
    OR (scope = 'firm' AND public.is_firm_member(firm_id, auth.uid()))
    OR (scope = 'user' AND user_id = auth.uid()));
CREATE POLICY "Delete own or firm reports" ON public.reports FOR DELETE TO authenticated
  USING ((scope = 'user' AND user_id = auth.uid())
    OR (scope = 'firm' AND public.has_firm_role(firm_id, auth.uid(), 'analyst')));

CREATE POLICY "Read firm and own templates" ON public.report_templates FOR SELECT TO authenticated
  USING ((firm_id IS NOT NULL AND public.is_firm_member(firm_id, auth.uid())) OR user_id = auth.uid());
CREATE POLICY "Create templates" ON public.report_templates FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND (
    (firm_id IS NOT NULL AND public.has_firm_role(firm_id, auth.uid(), 'analyst')) OR (firm_id IS NULL AND user_id = auth.uid())));
CREATE POLICY "Edit templates" ON public.report_templates FOR UPDATE TO authenticated
  USING ((firm_id IS NOT NULL AND public.has_firm_role(firm_id, auth.uid(), 'analyst')) OR user_id = auth.uid())
  WITH CHECK ((firm_id IS NOT NULL AND public.has_firm_role(firm_id, auth.uid(), 'analyst')) OR user_id = auth.uid());
CREATE POLICY "Delete templates" ON public.report_templates FOR DELETE TO authenticated
  USING ((firm_id IS NOT NULL AND public.has_firm_role(firm_id, auth.uid(), 'analyst')) OR user_id = auth.uid());
