CREATE TABLE public.paper_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  ticker text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long','short')),
  entry_price numeric NOT NULL,
  entry_date date NOT NULL DEFAULT current_date,
  stop numeric,
  target numeric,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  closed_price numeric,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paper_trades TO authenticated;
GRANT ALL ON public.paper_trades TO service_role;
ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.paper_trades FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.paper_trades FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.paper_trades FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.paper_trades FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX ON public.paper_trades (user_id, created_at DESC);