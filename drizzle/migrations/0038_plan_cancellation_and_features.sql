ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.effective_tier(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_user, 'admin') THEN 'pro'
    WHEN EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = _user
                 AND (
                   (s.status IN ('active','trialing','past_due') AND (s.current_period_end IS NULL OR s.current_period_end > now()))
                   OR (s.status = 'canceled' AND s.current_period_end > now())
                 ))
      THEN (SELECT tier FROM public.subscriptions WHERE user_id = _user)
    WHEN EXISTS (SELECT 1 FROM public.waitlist w WHERE w.user_id = _user AND w.status = 'approved'
                 AND COALESCE(w.decided_at, w.created_at) > now() - interval '14 days') THEN 'trial'
    WHEN public.has_app_access(_user) THEN 'expired'
    ELSE 'none'
  END
$$;

CREATE OR REPLACE FUNCTION public.tier_has_feature(_tier text, _feature text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _tier = 'pro' THEN _feature IN ('exports','alerts','deep_mode','browser','web_research','scheduled_briefs')
    WHEN _tier = 'research' THEN _feature IN ('exports','alerts')
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.require_feature(_feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.tier_has_feature(public.effective_tier(auth.uid()), _feature)
$$;

REVOKE EXECUTE ON FUNCTION public.require_feature(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.require_feature(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tier_has_feature(text, text) TO authenticated, service_role;