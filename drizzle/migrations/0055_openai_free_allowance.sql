CREATE TABLE public.openai_allowance (
  day date NOT NULL,
  tier text NOT NULL CHECK (tier IN ('large', 'mini')),
  tokens bigint NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, tier)
);
REVOKE ALL ON public.openai_allowance FROM anon, authenticated;
GRANT ALL ON public.openai_allowance TO service_role;
ALTER TABLE public.openai_allowance ENABLE ROW LEVEL SECURITY;

-- Atomically reserve tokens for one call; false when the reservation would pass the cap.
CREATE OR REPLACE FUNCTION public.openai_allowance_take(_day date, _tier text, _tokens bigint, _cap bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  INSERT INTO openai_allowance (day, tier) VALUES (_day, _tier) ON CONFLICT DO NOTHING;
  UPDATE openai_allowance SET tokens = tokens + _tokens, calls = calls + 1, updated_at = now()
    WHERE day = _day AND tier = _tier AND tokens + _tokens <= _cap
    RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END $$;

-- Settle a reservation with the tokens the call actually used (may be negative).
CREATE OR REPLACE FUNCTION public.openai_allowance_settle(_day date, _tier text, _delta bigint)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE openai_allowance SET tokens = greatest(0, tokens + _delta), updated_at = now() WHERE day = _day AND tier = _tier;
$$;

REVOKE ALL ON FUNCTION public.openai_allowance_take(date, text, bigint, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.openai_allowance_settle(date, text, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.openai_allowance_take(date, text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.openai_allowance_settle(date, text, bigint) TO service_role;