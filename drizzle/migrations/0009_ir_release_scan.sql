CREATE TABLE public.ir_release_scan (
  accn text PRIMARY KEY,
  ticker text NOT NULL,
  files integer NOT NULL DEFAULT 0,
  stored integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('done', 'partial', 'empty')),
  scanned_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ir_release_scan TO service_role;
ALTER TABLE public.ir_release_scan ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ir_release_scan IS 'Scheduled IR collector bookkeeping: which recent 8-K releases were fully stored, cut short, or had no exhibits. Service role only.';