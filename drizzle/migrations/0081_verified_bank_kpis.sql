CREATE TABLE IF NOT EXISTS public.verified_bank_kpi_points (
  ticker text NOT NULL,
  metric text NOT NULL,
  period_end date NOT NULL,
  period_label text NOT NULL,
  amount_usd numeric NOT NULL,
  issuer_label text NOT NULL,
  source_section text NOT NULL,
  source_quote text NOT NULL,
  filing_url text NOT NULL CHECK (filing_url LIKE 'https://www.sec.gov/Archives/edgar/data/%'),
  published_on date NOT NULL CHECK (published_on >= period_end),
  PRIMARY KEY (ticker, metric, period_end)
);
ALTER TABLE public.verified_bank_kpi_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verified_bank_kpi_points FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.verified_bank_kpi_points TO authenticated;
GRANT ALL ON public.verified_bank_kpi_points TO service_role;
DROP POLICY IF EXISTS verified_bank_kpi_read ON public.verified_bank_kpi_points;
CREATE POLICY verified_bank_kpi_read ON public.verified_bank_kpi_points FOR SELECT TO authenticated
  USING ((SELECT public.has_app_access(auth.uid())));

-- Companywide measures in PNC's Oct. 15, 2026 Exhibit 99.1. Section HTML IDs point to the exact tables.
WITH source_rows(metric, issuer_label, source_section, anchor, scale, amounts, source_quote) AS (
  VALUES
    ('avg_deposits','Average deposits','Consolidated balance sheet review · Deposits · Average',70,1000000000,
      ARRAY[461.2,457.0,431.8], 'In billions · 3Q26 / 2Q26 / 3Q25 · Average deposits $461.2 / $457.0 / $431.8'),
    ('avg_loans','Average loans','Consolidated balance sheet review · Loans · Average',58,1000000000,
      ARRAY[372.2,363.2,325.9], 'In billions · 3Q26 / 2Q26 / 3Q25 · Average loans $372.2 / $363.2 / $325.9'),
    ('loans','Total loans','Consolidated balance sheet review · Loans · Quarter end',58,1000000000,
      ARRAY[378.8,368.0,326.6], 'In billions · 3Q26 / 2Q26 / 3Q25 · Total loans $378.8 / $368.0 / $326.6'),
    ('total_revenue','Total revenue','Consolidated revenue review',37,1000000,
      ARRAY[6562,6875,5915], 'In millions · 3Q26 / 2Q26 / 3Q25 · Total revenue $6,562 / $6,875 / $5,915')
), periods(idx, period_end, period_label) AS (
  VALUES (1,DATE '2026-09-30','Q3 2026'), (2,DATE '2026-06-30','Q2 2026'), (3,DATE '2025-09-30','Q3 2025')
)
INSERT INTO public.verified_bank_kpi_points
  (ticker, metric, period_end, period_label, amount_usd, issuer_label, source_section, source_quote, filing_url, published_on)
SELECT 'PNC', metric, period_end, period_label, amounts[idx] * scale, issuer_label, source_section, source_quote,
       'https://www.sec.gov/Archives/edgar/data/713676/000162828026065936/q32026financialhighlightsa.htm#icc540d77ffcd43f386e693d5e4a4fb3d_' || anchor,
       DATE '2026-10-15'
FROM source_rows CROSS JOIN periods
ON CONFLICT (ticker, metric, period_end) DO NOTHING;