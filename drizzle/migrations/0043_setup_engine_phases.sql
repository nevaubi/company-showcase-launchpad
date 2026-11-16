ALTER TABLE public.setup_cycles ADD COLUMN lease_until timestamptz;
ALTER TABLE public.setup_series
  ADD COLUMN r5 real,
  ADD COLUMN r21 real,
  ADD COLUMN vol60 real,
  ADD COLUMN above200 boolean,
  ADD COLUMN near_high boolean,
  ADD COLUMN short5 real;
CREATE INDEX setup_signals_fired_idx ON public.setup_signals (fired_at);

-- One run at a time for single-step phases (lease expires so a cancelled run never blocks the cycle).
CREATE OR REPLACE FUNCTION public.setup_lease(_as_of date, _phase text, _secs integer)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE public.setup_cycles SET lease_until = now() + make_interval(secs => _secs), updated_at = now()
    WHERE as_of = _as_of AND phase = _phase AND (lease_until IS NULL OR lease_until < now())
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM u)
$$;

-- Atomically take the next _n work items of a chunked phase; returns the first index taken.
CREATE OR REPLACE FUNCTION public.setup_take(_as_of date, _phase text, _n integer)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.setup_cycles SET cursor = cursor + _n, updated_at = now()
  WHERE as_of = _as_of AND phase = _phase
  RETURNING cursor - _n
$$;

-- Move to the next phase only from the expected one (first caller wins).
CREATE OR REPLACE FUNCTION public.setup_advance(_as_of date, _from text, _to text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE public.setup_cycles SET phase = _to, cursor = 0, lease_until = NULL, updated_at = now(),
      finished_at = CASE WHEN _to = 'done' THEN now() ELSE finished_at END
    WHERE as_of = _as_of AND phase = _from
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM u)
$$;

REVOKE ALL ON FUNCTION public.setup_lease(date, text, integer), public.setup_take(date, text, integer), public.setup_advance(date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_lease(date, text, integer), public.setup_take(date, text, integer), public.setup_advance(date, text, text) TO service_role;