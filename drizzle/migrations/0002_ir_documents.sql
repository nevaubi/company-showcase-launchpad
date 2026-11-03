CREATE TABLE public.ir_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  source text NOT NULL DEFAULT 'sec-exhibit',
  source_url text NOT NULL UNIQUE,
  accn text,
  exhibit text,
  kind text NOT NULL DEFAULT 'other',
  title text NOT NULL DEFAULT '',
  period text,
  filed date,
  content_type text,
  ext text,
  bytes integer,
  sha256 text,
  path text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ir_documents_ticker_idx ON public.ir_documents (ticker, filed DESC);
GRANT SELECT ON public.ir_documents TO authenticated;
GRANT ALL ON public.ir_documents TO service_role;
ALTER TABLE public.ir_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read IR documents" ON public.ir_documents FOR SELECT TO authenticated USING (true);

CREATE TABLE public.ir_kpi_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.ir_documents(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  category text NOT NULL,
  parent text,
  label text NOT NULL,
  period_label text NOT NULL,
  period_end date,
  months integer,
  value double precision NOT NULL,
  unit text NOT NULL DEFAULT 'usd',
  locator jsonb NOT NULL DEFAULT '{}'::jsonb,
  derived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ir_kpi_facts_ticker_idx ON public.ir_kpi_facts (ticker, category, label);
GRANT SELECT ON public.ir_kpi_facts TO authenticated;
GRANT ALL ON public.ir_kpi_facts TO service_role;
ALTER TABLE public.ir_kpi_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read IR KPI facts" ON public.ir_kpi_facts FOR SELECT TO authenticated USING (true);