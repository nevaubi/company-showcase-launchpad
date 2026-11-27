-- Archive corrections verified from issuer event announcements and the period spoken on each call.
-- Keep the independent publication date from the publisher URL. Never change recorded speaker text.
BEGIN;
CREATE TEMP TABLE reviewed_transcript_dates(ticker text, fy int, fq int, event_date date, source_url text, PRIMARY KEY(ticker,fy,fq)) ON COMMIT DROP;
INSERT INTO reviewed_transcript_dates VALUES
  ('WFC',2026,3,'2026-10-13','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/third-quarter-2026-earnings.pdf'),
  ('WFC',2026,2,'2026-07-14','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/second-quarter-2026-earnings.pdf'),
  ('WFC',2026,1,'2026-04-14','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/first-quarter-2026-earnings.pdf'),
  ('WFC',2025,4,'2026-01-14','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/fourth-quarter-2025-earnings.pdf'),
  ('WFC',2025,3,'2025-10-14','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/third-quarter-2025-earnings.pdf'),
  ('WFC',2025,2,'2025-07-15','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/second-quarter-2025-earnings.pdf'),
  ('WFC',2023,4,'2024-01-12','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/fourth-quarter-2023-earnings.pdf'),
  ('WFC',2023,2,'2023-07-14','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/second-quarter-2023-earnings.pdf'),
  ('WFC',2022,1,'2022-04-14','https://www.wellsfargo.com/assets/pdf/about/investor-relations/earnings/first-quarter-2022-earnings.pdf'),
  ('AAPL',2026,3,'2026-07-30','https://www.apple.com/newsroom/2026/07/apple-reports-third-quarter-results/'),
  ('AAPL',2026,4,'2026-11-02','https://images.apple.com/newsroom/2026/11/apple-reports-fourth-quarter-results/'),
  ('AMZN',2026,3,'2026-10-29','https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-to-Webcast-Third-Quarter-2026-Financial-Results-Conference-Call/'),
  ('AVGO',2026,3,'2026-09-02','https://investors.broadcom.com/news-releases/news-release-details/broadcom-inc-announce-third-quarter-fiscal-year-2026-financial'),
  ('AVGO',2024,3,'2024-09-05','https://investors.broadcom.com/news-releases/news-release-details/broadcom-inc-announce-third-quarter-fiscal-year-2024-financial'),
  ('WELL',2025,1,'2025-04-29','https://welltower.com/investors/press-release-details/?id=785'),
  ('CMCSA',2024,3,'2024-10-31','https://www.cmcsa.com/news-releases/news-release-details/comcast-reports-3rd-quarter-2024-results'),
  ('T',2025,2,'2025-07-23','https://investors.att.com/~/media/Files/A/ATT-IR-V2/financial-reports/2q25-call-transcript.pdf'),
  ('LLY',2025,2,'2025-08-07','https://investor.lilly.com/news-releases/news-release-details/lilly-reports-second-quarter-2025-financial-results-and-raises'),
  ('FERG',2025,1,'2024-12-10','https://www.corporate.ferguson.com/pressroom/news-releases/news-details/2024/Ferguson-Reports-First-Quarter-Results/default.aspx'),
  ('FERG',2025,2,'2025-03-11','https://www.corporate.ferguson.com/investor/events-results-and-reports/Event-Details/2025/FY25-Second-Quarter-Results/default.aspx'),
  ('MSFT',2027,1,'2026-10-28','https://www.microsoft.com/en-us/investor/earnings/FY-2027-Q1/Document/DownloadDocument/36/TranscriptQandAFY27Q1.docx');
INSERT INTO reviewed_transcript_dates
SELECT c->>'ticker',2000+right(c->>'label',2)::int,substring(c->>'label' from 2 for 1)::int,
  (c->>'date')::date, a.payload->'bundle'->'docs'->(c->>'doc')->>'sourcePage'
FROM public.ai_cache a CROSS JOIN LATERAL jsonb_array_elements(a.payload->'bundle'->'calls') c
WHERE a.key LIKE 'issuer-direct-index:v1:%' AND c->>'label' ~ '^Q[1-4] FY[0-9]{2}$' AND c->>'event_type'='earnings'
ON CONFLICT DO NOTHING;
INSERT INTO public.ai_cache(key,payload,created_at)
SELECT 'issuer-call-date:v1:'||ticker||':'||fy||'-Q'||fq,
  jsonb_build_object('ticker',ticker,'date',event_date,'url',source_url),now()
FROM reviewed_transcript_dates ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, created_at=excluded.created_at
WHERE public.ai_cache.payload IS DISTINCT FROM excluded.payload;

CREATE TEMP TABLE transcript_date_patch ON COMMIT DROP AS
SELECT a.key,d.ticker,t->>'url' AS url,jsonb_build_object('date',d.event_date,'dateBasis','event',
  'publishedDate',replace(substring(t->>'url' from '/call-transcripts/([0-9]{4}/[0-9]{2}/[0-9]{2})/'),'/','-'),
  'eventSourceUrl',d.source_url) AS changes
FROM public.ai_cache a CROSS JOIN LATERAL (SELECT a.payload->'transcript' t) tr
JOIN reviewed_transcript_dates d ON d.ticker=t->>'ticker' AND d.fy=(t->>'fy')::int AND d.fq=(t->>'fq')::int
WHERE a.key LIKE 'transcript:v3:%'
  AND t->>'url' ~ '^https://www\.fool\.com/earnings/call-transcripts/[0-9]{4}/[0-9]{2}/[0-9]{2}/[a-z0-9-]+/?$'
  AND d.event_date<=replace(substring(t->>'url' from '/call-transcripts/([0-9]{4}/[0-9]{2}/[0-9]{2})/'),'/','-')::date;
UPDATE public.ai_cache a SET payload=jsonb_set(a.payload,'{transcript}',(a.payload->'transcript')||p.changes)
FROM transcript_date_patch p WHERE a.key=p.key AND NOT(a.payload->'transcript' @> p.changes);

-- Select the ready index under a row lock so a concurrent worker retains its current call list.
DO $ready$
DECLARE a record; revised jsonb;
BEGIN
  FOR a IN SELECT key,payload FROM public.ai_cache WHERE key IN(SELECT DISTINCT 'call-web-ready:v1:'||ticker FROM transcript_date_patch) FOR UPDATE LOOP
    SELECT jsonb_agg(v ORDER BY v->>'date' DESC,v->>'url') INTO revised
    FROM (
      SELECT CASE WHEN p.url IS NULL THEN call ELSE call||p.changes END AS v
      FROM jsonb_array_elements(a.payload->'calls') call
      LEFT JOIN transcript_date_patch p ON p.url=call->>'url' AND a.key='call-web-ready:v1:'||p.ticker
    ) refs;
    IF revised IS NOT NULL AND revised IS DISTINCT FROM a.payload->'calls' THEN
      UPDATE public.ai_cache SET payload=jsonb_set(payload,'{calls}',revised) WHERE key=a.key;
    END IF;
  END LOOP;
END $ready$;
COMMIT;
