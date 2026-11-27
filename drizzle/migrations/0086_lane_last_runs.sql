CREATE FUNCTION public.lane_last_runs(_jobs text[])
RETURNS TABLE(
  job text, started_at timestamptz, finished_at timestamptz, ok boolean, items integer, detail jsonb,
  runs_24h integer, failed_24h integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT j.job, l.started_at, l.finished_at, l.ok, l.items, l.detail, COALESCE(c.runs, 0), COALESCE(c.failed, 0)
  FROM unnest(_jobs) AS j(job)
  JOIN LATERAL (
    SELECT r.started_at, r.finished_at, r.ok, r.items, r.detail
    FROM public.job_runs r
    WHERE r.job = j.job
    ORDER BY r.started_at DESC
    LIMIT 1
  ) l ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS runs, (count(*) FILTER (WHERE r.ok IS FALSE))::integer AS failed
    FROM public.job_runs r
    WHERE r.job = j.job AND r.started_at >= now() - interval '24 hours'
  ) c ON true
$$;

REVOKE ALL ON FUNCTION public.lane_last_runs(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lane_last_runs(text[]) TO service_role;

COMMENT ON FUNCTION public.lane_last_runs(text[]) IS 'Newest job_runs row and 24-hour run counts for each named lane. Service role only: the admin lane board calls it after checking has_role(admin).';