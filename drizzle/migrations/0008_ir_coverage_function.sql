CREATE OR REPLACE FUNCTION public.ir_coverage()
RETURNS TABLE (
  ticker text,
  docs bigint,
  bytes bigint,
  readable bigint,
  read bigint,
  waiting bigint,
  vision_read bigint,
  first_filed date,
  last_filed date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.ticker,
    count(*) AS docs,
    coalesce(sum(d.bytes), 0)::bigint AS bytes,
    count(*) FILTER (WHERE d.kind IN ('press-release','supplement','presentation','data','other') AND (d.ext IN ('htm','html') OR d.rendition_path LIKE '%html')) AS readable,
    count(*) FILTER (WHERE d.extract_status LIKE 'ok%') AS read,
    count(*) FILTER (WHERE d.extract_status IS NULL AND d.kind IN ('press-release','supplement','presentation','data','other') AND (d.ext IN ('htm','html') OR d.rendition_path LIKE '%html')) AS waiting,
    count(*) FILTER (WHERE d.vision_status LIKE 'ok%') AS vision_read,
    min(d.filed) AS first_filed,
    max(d.filed) AS last_filed
  FROM public.ir_documents d
  GROUP BY d.ticker
$$;
REVOKE ALL ON FUNCTION public.ir_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ir_coverage() TO authenticated, service_role;