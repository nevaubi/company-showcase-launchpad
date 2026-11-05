CREATE TABLE public.alt_data (
  uid text PRIMARY KEY,
  ticker text NOT NULL,
  dataset text NOT NULL,
  kind text NOT NULL DEFAULT 'event',
  date date,
  title text NOT NULL,
  value double precision,
  unit text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alt_data_ticker_idx ON public.alt_data (ticker, dataset, date DESC);
CREATE INDEX alt_data_dataset_idx ON public.alt_data (dataset, date DESC);
GRANT SELECT ON public.alt_data TO authenticated;
GRANT ALL ON public.alt_data TO service_role;
ALTER TABLE public.alt_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read alt data" ON public.alt_data FOR SELECT TO authenticated USING (true);