CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY,
  tier text NOT NULL DEFAULT 'research' CHECK (tier IN ('research','pro')),
  status text NOT NULL DEFAULT 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  price_id text,
  current_period_end timestamptz,
  environment text NOT NULL DEFAULT 'sandbox',
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription read" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.usage_counters (
  user_id uuid NOT NULL,
  kind text NOT NULL,
  period text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, period)
);
REVOKE ALL ON public.usage_counters FROM anon, authenticated;
GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own usage read" ON public.usage_counters FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Effective plan: admin/demo -> pro; active paid sub -> its tier; within 14 days of approval -> trial; else expired.
CREATE OR REPLACE FUNCTION public.effective_tier(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_user, 'admin') THEN 'pro'
    WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = _user
                 AND s.status IN ('active','trialing','past_due')
                 AND (s.current_period_end IS NULL OR s.current_period_end > now()))
      THEN (SELECT tier FROM public.subscriptions WHERE user_id = _user)
    WHEN EXISTS (SELECT 1 FROM public.waitlist w WHERE w.user_id = _user AND w.status = 'approved'
                 AND COALESCE(w.decided_at, w.created_at) > now() - interval '14 days') THEN 'trial'
    WHEN public.has_app_access(_user) THEN 'expired'
    ELSE 'none'
  END
$$;

CREATE OR REPLACE FUNCTION public.plan_limit(_tier text, _kind text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _tier || ':' || _kind
    WHEN 'trial:agent' THEN 10   WHEN 'research:agent' THEN 15   WHEN 'pro:agent' THEN 150
    WHEN 'trial:report' THEN 2   WHEN 'research:report' THEN 5   WHEN 'pro:report' THEN 60
    ELSE 0 END
$$;

-- agent = per day, report = per month. Atomically counts one use or refuses.
CREATE OR REPLACE FUNCTION public.consume_usage(_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _tier text;
  _limit int;
  _period text;
  _used int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'signed_out'); END IF;
  IF _kind NOT IN ('agent','report') THEN RAISE EXCEPTION 'bad kind'; END IF;
  _tier := public.effective_tier(_uid);
  _limit := public.plan_limit(_tier, _kind);
  _period := CASE WHEN _kind = 'agent' THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                  ELSE to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') END;
  INSERT INTO public.usage_counters (user_id, kind, period, used) VALUES (_uid, _kind, _period, 1)
  ON CONFLICT (user_id, kind, period) DO UPDATE SET used = usage_counters.used + 1
    WHERE usage_counters.used < _limit
  RETURNING used INTO _used;
  IF _used IS NULL OR _used > _limit THEN
    IF _used = 1 AND _limit = 0 THEN DELETE FROM public.usage_counters WHERE user_id=_uid AND kind=_kind AND period=_period; END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'limit', 'tier', _tier, 'limit', _limit);
  END IF;
  RETURN jsonb_build_object('ok', true, 'tier', _tier, 'used', _used, 'limit', _limit);
END $$;

REVOKE EXECUTE ON FUNCTION public.effective_tier(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.consume_usage(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.effective_tier(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_usage(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.plan_limit(text, text) TO authenticated, service_role;