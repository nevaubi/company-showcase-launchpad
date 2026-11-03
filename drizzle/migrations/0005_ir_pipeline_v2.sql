-- Extraction provenance and cost tracking per document
ALTER TABLE public.ir_documents
  ADD COLUMN extract_model text,
  ADD COLUMN extract_usage jsonb,
  ADD COLUMN vision_status text,
  ADD COLUMN vision_at timestamptz;

-- Breakdown dimension name, extraction method and model per fact
ALTER TABLE public.ir_kpi_facts
  ADD COLUMN breakdown text,
  ADD COLUMN method text NOT NULL DEFAULT 'table',
  ADD COLUMN model text;

CREATE INDEX IF NOT EXISTS ir_kpi_facts_ticker_idx ON public.ir_kpi_facts (ticker);
CREATE INDEX IF NOT EXISTS ir_kpi_facts_document_idx ON public.ir_kpi_facts (document_id);
CREATE INDEX IF NOT EXISTS ir_documents_ticker_filed_idx ON public.ir_documents (ticker, filed);

-- Pipeline pause/lease state for batch runners (circuit breaker + single-flight)
ALTER TABLE public.job_state
  ADD COLUMN paused_reason text,
  ADD COLUMN lease_until timestamptz;

-- Cross-period label mapping decided per company (renames, merges, category/parent fixes)
CREATE TABLE public.ir_label_map (
  ticker text NOT NULL,
  raw_key text NOT NULL,
  canonical jsonb NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, raw_key)
);
GRANT ALL ON public.ir_label_map TO service_role;
ALTER TABLE public.ir_label_map ENABLE ROW LEVEL SECURITY;

-- Precomputed segment/KPI series per company (built from facts + label map)
CREATE TABLE public.ir_company_series (
  ticker text PRIMARY KEY,
  payload jsonb NOT NULL,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  built_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ir_company_series TO authenticated;
GRANT ALL ON public.ir_company_series TO service_role;
ALTER TABLE public.ir_company_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read IR series"
  ON public.ir_company_series FOR SELECT TO authenticated USING (true);