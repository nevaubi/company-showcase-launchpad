CREATE TABLE public.partner_mirror (
  path text PRIMARY KEY,
  ticker text NOT NULL,
  kind text NOT NULL,
  sha256 text,
  bytes bigint,
  status text NOT NULL DEFAULT 'done',
  error text,
  mirrored_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.partner_mirror FROM anon, authenticated;
GRANT ALL ON public.partner_mirror TO service_role;
ALTER TABLE public.partner_mirror ENABLE ROW LEVEL SECURITY;
CREATE INDEX partner_mirror_ticker_idx ON public.partner_mirror (ticker);