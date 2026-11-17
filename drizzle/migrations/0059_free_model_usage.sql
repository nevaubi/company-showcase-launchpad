CREATE TABLE public.free_model_usage (
  day date PRIMARY KEY,
  requests integer NOT NULL DEFAULT 0,
  confirms integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.free_model_usage TO service_role;
ALTER TABLE public.free_model_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.free_model_take(_day date, _cap integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO free_model_usage(day) VALUES (_day) ON CONFLICT (day) DO NOTHING;
  UPDATE free_model_usage SET requests = requests + 1, updated_at = now()
    WHERE day = _day AND requests < _cap RETURNING requests INTO n;
  RETURN n IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.free_model_take(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_model_take(date, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.free_model_note(_day date, _ok boolean, _confirms integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE free_model_usage SET confirms = confirms + _confirms, failures = failures + (CASE WHEN _ok THEN 0 ELSE 1 END), updated_at = now() WHERE day = _day;
$$;
REVOKE ALL ON FUNCTION public.free_model_note(date, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_model_note(date, boolean, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.free_model_today()
RETURNS TABLE(requests integer, confirms integer, failures integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT requests, confirms, failures FROM free_model_usage
  WHERE day = (now() AT TIME ZONE 'utc')::date AND public.has_role(auth.uid(), 'admin');
$$;
REVOKE ALL ON FUNCTION public.free_model_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.free_model_today() TO authenticated;