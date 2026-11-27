-- Re-runnable source data for migration 0081 (Lovable Cloud).
BEGIN;

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

-- KeyCorp's consolidated exhibits distinguish period averages, quarter-end assets and taxable-equivalent revenue.
WITH source_rows(metric, issuer_label, source_section, anchor, amounts, source_quote) AS (
  VALUES
    ('avg_deposits','Total deposits','Consolidated balance sheet highlights · Average deposits',31,
      ARRAY[151175,147577,150374], 'Dollars in millions · 3Q26 / 2Q26 / 3Q25 · Total deposits $151,175 / $147,577 / $150,374'),
    ('avg_loans','Average loans outstanding','Loan and lease loss experience · Average loans outstanding',130,
      ARRAY[111585,110072,106227], 'Dollars in millions · Three months ended 9/30/26, 6/30/26, 9/30/25 · Average loans outstanding $111,585 / $110,072 / $106,227'),
    ('loans','Total loans','Consolidated loan composition · Period end',121,
      ARRAY[112993,110430,105902], 'Dollars in millions · 9/30/26, 6/30/26, 9/30/25 · Total loans (b), (c) $112,993 / $110,430 / $105,902'),
    ('total_revenue','Total revenue','Consolidated income statement highlights · Revenue',7,
      ARRAY[2044,1956,1886], 'Dollars in millions · 3Q26 / 2Q26 / 3Q25 · Total revenue 2,044 / 1,956 / 1,886')
), periods(idx, period_end, period_label) AS (
  VALUES (1,DATE '2026-09-30','Q3 2026'), (2,DATE '2026-06-30','Q2 2026'), (3,DATE '2025-09-30','Q3 2025')
)
INSERT INTO public.verified_bank_kpi_points
  (ticker, metric, period_end, period_label, amount_usd, issuer_label, source_section, source_quote, filing_url, published_on)
SELECT 'KEY', metric, period_end, period_label, amounts[idx]::numeric * 1000000, issuer_label, source_section, source_quote,
       'https://www.sec.gov/Archives/edgar/data/91576/000009157626000020/a3q26earningsrelease.htm#i5b23a9aac8df4c89bab200acd7d7f038_' || anchor,
       DATE '2026-10-20'
FROM source_rows CROSS JOIN periods
ON CONFLICT (ticker, metric, period_end) DO NOTHING;

INSERT INTO public.verified_bank_kpi_points
  (ticker, metric, period_end, period_label, amount_usd, issuer_label, source_section, source_quote, filing_url, published_on)
SELECT 'HOMB', 'loans', period_end, period_label, printed::numeric * 1000, 'Loans receivable',
       'Consolidated end of period balance sheets · Loans receivable before allowance',
       'In thousands · 6/30/26, 3/31/26, 12/31/25, 9/30/25, 6/30/25 · Loans receivable 17,127,208 / 15,633,628 / 15,686,209 / 15,285,972 / 15,180,624',
       'https://www.sec.gov/Archives/edgar/data/1331520/000133152026000106/homb063026earningsrelease.htm#i651770db87cf402d81418b2324016302_10',
       DATE '2026-07-15'
FROM (VALUES
  (DATE '2026-06-30','Q2 2026',17127208),(DATE '2026-03-31','Q1 2026',15633628),
  (DATE '2025-12-31','Q4 2025',15686209),(DATE '2025-09-30','Q3 2025',15285972),
  (DATE '2025-06-30','Q2 2025',15180624)
) AS p(period_end, period_label, printed)
ON CONFLICT (ticker, metric, period_end) DO NOTHING;

-- Consolidated balances and directly reported GAAP revenue. Five quarterly columns in each exhibit.
WITH source_rows(ticker, metric, issuer_label, source_section, filing_url, published_on, scale, amounts, source_quote) AS (
  VALUES
    ('HOMB','loans','Loans receivable','Consolidated end of period balance sheets · Loans receivable before allowance',
      'https://www.sec.gov/Archives/edgar/data/1331520/000133152026000117/homb093026earningsrelease.htm#iecc80c99e67d4991b1c5d8f0077d40e7_10',
      DATE '2026-10-14', 1000, ARRAY[16910621,17127208,15633628,15686209,15285972],
      'In thousands · Q3 2026 through Q3 2025 · Loans receivable 16,910,621 / 17,127,208 / 15,633,628 / 15,686,209 / 15,285,972'),
    ('HBAN','loans','Loans and leases','Consolidated balance sheets · Period end, before allowance',
      'https://www.sec.gov/Archives/edgar/data/49196/000004919626000084/hban20260930_8kex992.htm#ifb230525c27c4c7ca4355e26ff8a7872_22',
      DATE '2026-10-22', 1000000, ARRAY[191449,189422,188818,149642,137956],
      'Dollars in millions · Q3 2026 through Q3 2025 · Loans and leases (1) 191,449 / 189,422 / 188,818 / 149,642 / 137,956'),
    ('HBAN','total_revenue','Total revenue (GAAP)','Consolidated GAAP reconciliation · Total revenue',
      'https://www.sec.gov/Archives/edgar/data/49196/000004919626000084/hban20260930_8kex992.htm#ifb230525c27c4c7ca4355e26ff8a7872_271',
      DATE '2026-10-22', 1000000, ARRAY[2791,2837,2573,2174,2134],
      'Dollars in millions · Q3 2026 through Q3 2025 · Total revenue (GAAP) $2,791 / $2,837 / $2,573 / $2,174 / $2,134'),
    ('WAL','loans','Loans HFI, net of deferred fees','Consolidated balance sheets · Loans held for investment before allowance',
      'https://www.sec.gov/Archives/edgar/data/1212545/000162828026066286/pressrelease-9302026.htm#i8cab46861fc343878becd2c0faee66cb_55',
      DATE '2026-10-19', 1000000, ARRAY[61549,60949,59142,58677,56646],
      'Dollars in millions · Q3 2026 through Q3 2025 · Loans HFI, net of deferred fees 61,549 / 60,949 / 59,142 / 58,677 / 56,646')
), periods(idx, period_end, period_label) AS (
  VALUES (1,DATE '2026-09-30','Q3 2026'), (2,DATE '2026-06-30','Q2 2026'),
         (3,DATE '2026-03-31','Q1 2026'), (4,DATE '2025-12-31','Q4 2025'), (5,DATE '2025-09-30','Q3 2025')
)
INSERT INTO public.verified_bank_kpi_points
  (ticker, metric, period_end, period_label, amount_usd, issuer_label, source_section, source_quote, filing_url, published_on)
SELECT ticker, metric, period_end, period_label, amounts[idx]::numeric * scale, issuer_label, source_section, source_quote, filing_url, published_on
FROM source_rows CROSS JOIN periods
ON CONFLICT (ticker, metric, period_end) DO NOTHING;

COMMIT;
