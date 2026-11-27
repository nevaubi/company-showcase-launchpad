-- Reviewed issuer links are scoped to the legal registrant. A withheld link suppresses stale profile fallbacks.
CREATE TABLE IF NOT EXISTS public.issuer_directory (
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9][A-Z0-9.\-]{0,11}$'),
  cik text NOT NULL CHECK (cik ~ '^[1-9][0-9]{0,9}$'),
  kind text NOT NULL CHECK (kind IN ('website','ir')),
  status text NOT NULL CHECK (status IN ('verified','withheld')),
  url text,
  evidence_url text NOT NULL CHECK (evidence_url ~ '^https://[^[:space:]]+$'),
  evidence_text text NOT NULL CHECK (length(btrim(evidence_text)) > 0),
  checked_on date NOT NULL,
  PRIMARY KEY (ticker,cik,kind),
  CHECK ((status = 'verified' AND url IS NOT NULL AND url ~ '^https://[^[:space:]]+$') OR
         (status = 'withheld' AND url IS NULL))
);
ALTER TABLE public.issuer_directory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.issuer_directory FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.issuer_directory TO service_role;

CREATE OR REPLACE FUNCTION public.seed_issuer_directory(entries jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE touched integer;
BEGIN
  IF jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries) > 200 THEN
    RAISE EXCEPTION 'Expected up to 200 reviewed issuer links';
  END IF;
  INSERT INTO public.issuer_directory(ticker,cik,kind,status,url,evidence_url,evidence_text,checked_on)
  SELECT e.ticker,e.cik,e.kind,e.status,e.url,e.evidence_url,e.evidence_text,e.checked_on
  FROM jsonb_to_recordset(entries) AS e(ticker text,cik text,kind text,status text,url text,evidence_url text,evidence_text text,checked_on date)
  ON CONFLICT (ticker,cik,kind) DO UPDATE SET status=excluded.status,url=excluded.url,
    evidence_url=excluded.evidence_url,evidence_text=excluded.evidence_text,checked_on=excluded.checked_on
  WHERE public.issuer_directory.checked_on <= excluded.checked_on AND
    (public.issuer_directory.status,public.issuer_directory.url,public.issuer_directory.evidence_url,public.issuer_directory.evidence_text,public.issuer_directory.checked_on)
    IS DISTINCT FROM (excluded.status,excluded.url,excluded.evidence_url,excluded.evidence_text,excluded.checked_on);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END $$;
REVOKE ALL ON FUNCTION public.seed_issuer_directory(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_issuer_directory(jsonb) TO service_role;