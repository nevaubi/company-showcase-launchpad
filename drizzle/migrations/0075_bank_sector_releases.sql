CREATE TABLE IF NOT EXISTS public.sector_bank_source_receipts (
  as_of date NOT NULL, ticker text NOT NULL, cik bigint NOT NULL,
  source_url text NOT NULL, source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL, PRIMARY KEY (as_of, ticker)
);
CREATE TABLE IF NOT EXISTS public.sector_release_parts (
  release_id text NOT NULL, path text NOT NULL, part integer NOT NULL CHECK (part >= 0),
  body text NOT NULL, PRIMARY KEY (release_id, path, part)
);
CREATE TABLE IF NOT EXISTS public.sector_dataset_releases (
  release_id text NOT NULL, path text NOT NULL, as_of date NOT NULL, fiscal_quarter text NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  gzip_sha256 text NOT NULL CHECK (gzip_sha256 ~ '^[a-f0-9]{64}$'),
  parts integer NOT NULL CHECK (parts > 0), activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, path)
);
ALTER TABLE public.sector_bank_source_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sector_release_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sector_dataset_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sector_bank_source_receipts, public.sector_release_parts, public.sector_dataset_releases FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sector_bank_source_receipts, public.sector_release_parts, public.sector_dataset_releases TO service_role;
CREATE OR REPLACE FUNCTION public.sector_dataset_release_v1(_path text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT coalesce(public.has_app_access(auth.uid()), false) THEN
    RAISE EXCEPTION 'App membership required' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object('release', r.release_id, 'period', r.fiscal_quarter, 'as_of', r.as_of,
      'sha256', r.gzip_sha256, 'body', (SELECT string_agg(p.body, '' ORDER BY p.part) FROM public.sector_release_parts p
          WHERE p.path=r.path AND p.release_id=r.release_id))
  FROM public.sector_dataset_releases r
  WHERE r.path=_path AND r.path IN ('sectors.json','sectors/banks.json','sectors/banks.comp.json',
                                    'sectors/financials.json','sectors/financials.comp.json')
  ORDER BY r.as_of DESC, r.activated_at DESC LIMIT 1);
END;
$$;
REVOKE ALL ON FUNCTION public.sector_dataset_release_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sector_dataset_release_v1(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.activate_bank_sector_release_v1(_release text, _as_of date, _quarter text, _manifest jsonb, _tickers text[])
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE x record; published integer := 0; actual_sha text; actual_count integer;
BEGIN
  IF jsonb_typeof(_manifest) <> 'object' OR cardinality(_tickers) < 1 OR
      (SELECT count(*) FROM public.sector_bank_source_receipts WHERE as_of=_as_of AND ticker=ANY(_tickers)) <> cardinality(_tickers) THEN
    RAISE EXCEPTION 'Incomplete issuer evidence';
  END IF;
  IF (SELECT count(*) FROM jsonb_each_text(_manifest #> '{sectors/banks.json,issuer_sha256}') expected
      JOIN public.sector_bank_source_receipts r ON r.as_of=_as_of AND r.ticker=expected.key AND r.source_sha256=expected.value
      WHERE r.ticker=ANY(_tickers)) <> cardinality(_tickers) THEN
    RAISE EXCEPTION 'Issuer source digests do not match this release';
  END IF;
  FOR x IN SELECT key AS path, value FROM jsonb_each(_manifest) LOOP
    IF x.path NOT IN ('sectors.json','sectors/banks.json','sectors/banks.comp.json','sectors/financials.json','sectors/financials.comp.json') THEN
      RAISE EXCEPTION 'Unexpected sector path';
    END IF;
    SELECT count(*), encode(extensions.digest(decode(string_agg(body, '' ORDER BY part), 'base64'), 'sha256'), 'hex')
      INTO actual_count, actual_sha FROM public.sector_release_parts WHERE release_id=_release AND path=x.path;
    IF actual_count <> (x.value->>'parts')::int OR actual_sha IS DISTINCT FROM (x.value->>'gzip_sha256') THEN
      RAISE EXCEPTION 'Invalid sector dataset for %', x.path;
    END IF;
    INSERT INTO public.sector_dataset_releases(release_id,path,as_of,fiscal_quarter,input_sha256,gzip_sha256,parts)
      VALUES(_release,x.path,_as_of,_quarter,x.value->>'input_sha256',actual_sha,actual_count) ON CONFLICT DO NOTHING;
    published := published+1;
  END LOOP;
  IF published <> 5 THEN RAISE EXCEPTION 'Incomplete sector release'; END IF;
  RETURN published;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_bank_sector_release_v1(text,date,text,jsonb,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_bank_sector_release_v1(text,date,text,jsonb,text[]) TO service_role;