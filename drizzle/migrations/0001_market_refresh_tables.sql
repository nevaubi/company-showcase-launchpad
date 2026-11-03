-- Reference data refreshed by scheduled jobs. Public market/SEC data: readable by everyone,
-- written only by the service role (scheduled job handlers).

CREATE TABLE public.market_bars (
  symbol text NOT NULL,
  date date NOT NULL,
  open double precision,
  high double precision,
  low double precision,
  close double precision NOT NULL,
  adj_close double precision,
  volume bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date)
);
GRANT SELECT ON public.market_bars TO anon, authenticated;
GRANT ALL ON public.market_bars TO service_role;
ALTER TABLE public.market_bars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Market bars are public" ON public.market_bars FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.macro_observations (
  series_id text NOT NULL,
  date date NOT NULL,
  value double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, date)
);
GRANT SELECT ON public.macro_observations TO anon, authenticated;
GRANT ALL ON public.macro_observations TO service_role;
ALTER TABLE public.macro_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Macro observations are public" ON public.macro_observations FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.macro_summaries (
  series_id text PRIMARY KEY,
  summary jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.macro_summaries TO anon, authenticated;
GRANT ALL ON public.macro_summaries TO service_role;
ALTER TABLE public.macro_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Macro summaries are public" ON public.macro_summaries FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.sec_filings (
  accn text PRIMARY KEY,
  ticker text NOT NULL,
  cik text NOT NULL,
  form text NOT NULL,
  filed date NOT NULL,
  report date,
  doc text NOT NULL,
  description text,
  items text,
  ixbrl boolean NOT NULL DEFAULT false,
  size integer,
  discovered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sec_filings_ticker_filed_idx ON public.sec_filings (ticker, filed DESC);
CREATE INDEX sec_filings_filed_idx ON public.sec_filings (filed DESC);
GRANT SELECT ON public.sec_filings TO anon, authenticated;
GRANT ALL ON public.sec_filings TO service_role;
ALTER TABLE public.sec_filings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SEC filings are public" ON public.sec_filings FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.insider_trades (
  accn text NOT NULL,
  seq integer NOT NULL,
  ticker text NOT NULL,
  filed date NOT NULL,
  owner text NOT NULL,
  role text NOT NULL,
  trade_date date NOT NULL,
  code text NOT NULL,
  security text NOT NULL,
  shares double precision NOT NULL,
  price double precision,
  acquired boolean NOT NULL,
  owned_after double precision,
  direct boolean NOT NULL,
  plan_10b5 boolean NOT NULL DEFAULT false,
  doc text NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (accn, seq)
);
CREATE INDEX insider_trades_ticker_date_idx ON public.insider_trades (ticker, trade_date DESC);
CREATE INDEX insider_trades_date_idx ON public.insider_trades (trade_date DESC);
GRANT SELECT ON public.insider_trades TO anon, authenticated;
GRANT ALL ON public.insider_trades TO service_role;
ALTER TABLE public.insider_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Insider trades are public" ON public.insider_trades FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.job_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  items integer NOT NULL DEFAULT 0,
  detail jsonb
);
CREATE INDEX job_runs_job_started_idx ON public.job_runs (job, started_at DESC);
GRANT SELECT ON public.job_runs TO authenticated;
GRANT ALL ON public.job_runs TO service_role;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read job runs" ON public.job_runs FOR SELECT TO authenticated USING (true);

-- Rotation cursors for the slice-at-a-time jobs (service role only).
CREATE TABLE public.job_state (
  job text PRIMARY KEY,
  cursor integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.job_state TO service_role;
ALTER TABLE public.job_state ENABLE ROW LEVEL SECURITY;

-- Index of SEC documents mirrored into file storage.
CREATE TABLE public.filing_documents (
  accn text NOT NULL,
  doc text NOT NULL,
  path text NOT NULL,
  bytes integer NOT NULL,
  content_type text NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (accn, doc)
);
GRANT SELECT ON public.filing_documents TO authenticated;
GRANT ALL ON public.filing_documents TO service_role;
ALTER TABLE public.filing_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read the filing cache index" ON public.filing_documents FOR SELECT TO authenticated USING (true);