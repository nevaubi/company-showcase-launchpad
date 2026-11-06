-- Append-only log of report generations, so spend limits count every run (slots are overwritten on refresh).
CREATE TABLE public.report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  user_id uuid,
  ticker text NOT NULL,
  kind text NOT NULL,
  scope text NOT NULL,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'pregen')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ready', 'failed')),
  ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_runs_user_idx ON public.report_runs (user_id, created_at DESC);
CREATE INDEX report_runs_recent_idx ON public.report_runs (created_at DESC);

REVOKE ALL ON public.report_runs FROM anon, authenticated;
GRANT ALL ON public.report_runs TO service_role;
ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;
-- No policies: only the server (service role) reads or writes this log.