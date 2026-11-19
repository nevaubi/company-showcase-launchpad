CREATE TABLE public.waitlist_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  firm text,
  role text,
  use_case text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  user_id uuid
);
REVOKE ALL ON public.waitlist_requests FROM anon, authenticated;
GRANT SELECT ON public.waitlist_requests TO authenticated;
GRANT ALL ON public.waitlist_requests TO service_role;
ALTER TABLE public.waitlist_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read requests" ON public.waitlist_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.waitlist_attempts (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_attempts_ip_idx ON public.waitlist_attempts (ip_hash, created_at DESC);
CREATE INDEX waitlist_attempts_email_idx ON public.waitlist_attempts (email, created_at DESC);
REVOKE ALL ON public.waitlist_attempts FROM anon, authenticated;
GRANT ALL ON public.waitlist_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.waitlist_attempts_id_seq TO service_role;
ALTER TABLE public.waitlist_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  template text NOT NULL,
  related_table text,
  related_id text,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','waiting_sender','sent','suppressed','failed')),
  error text,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX email_log_related_idx ON public.email_log (related_table, related_id);
CREATE INDEX email_log_retry_idx ON public.email_log (status, next_attempt_at);
CREATE INDEX email_log_sent_idx ON public.email_log (sent_at DESC);
REVOKE ALL ON public.email_log FROM anon, authenticated;
GRANT SELECT ON public.email_log TO authenticated;
GRANT ALL ON public.email_log TO service_role;
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read email log" ON public.email_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.email_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  daily_cap int NOT NULL DEFAULT 200,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.email_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
REVOKE ALL ON public.email_settings FROM anon, authenticated;
GRANT SELECT ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read email settings" ON public.email_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
UPDATE public.waitlist SET trial_started_at = COALESCE(decided_at, created_at) WHERE status = 'approved' AND trial_started_at IS NULL;

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
                 AND w.trial_started_at > now() - interval '14 days') THEN 'trial'
    WHEN EXISTS (SELECT 1 FROM public.waitlist w WHERE w.user_id = _user AND w.status = 'approved'
                 AND w.trial_started_at IS NULL) THEN 'none'
    WHEN public.has_app_access(_user) THEN 'expired'
    ELSE 'none'
  END
$$;

CREATE OR REPLACE FUNCTION public.needs_trial_terms(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.has_role(_user, 'admin')
    AND EXISTS (SELECT 1 FROM public.waitlist w WHERE w.user_id = _user AND w.status = 'approved' AND w.trial_started_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = _user AND s.status IN ('active','trialing','past_due','canceled')
                    AND (s.current_period_end IS NULL OR s.current_period_end > now()))
$$;
REVOKE EXECUTE ON FUNCTION public.needs_trial_terms(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.needs_trial_terms(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_trial_terms()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.waitlist SET terms_accepted_at = now(), trial_started_at = now()
  WHERE user_id = auth.uid() AND status = 'approved' AND trial_started_at IS NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.accept_trial_terms() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.accept_trial_terms() TO authenticated;

CREATE OR REPLACE FUNCTION public.waitlist_reminder_candidates()
RETURNS TABLE (user_id uuid, email text, display_name text, decided_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.user_id, w.email, w.display_name, w.decided_at
  FROM public.waitlist w JOIN auth.users u ON u.id = w.user_id
  WHERE w.status = 'approved' AND w.decided_at < now() - interval '3 days'
    AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < w.decided_at)
$$;
REVOKE EXECUTE ON FUNCTION public.waitlist_reminder_candidates() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.waitlist_reminder_candidates() TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE pre_approved boolean;
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.watchlist (user_id, ticker)
  VALUES (NEW.id, 'AAPL'), (NEW.id, 'NVDA'), (NEW.id, 'MSFT')
  ON CONFLICT DO NOTHING;
  SELECT EXISTS (SELECT 1 FROM public.waitlist_requests r WHERE r.email = lower(NEW.email) AND r.status = 'approved') INTO pre_approved;
  INSERT INTO public.waitlist (user_id, email, display_name, status, decided_at)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
          CASE WHEN pre_approved THEN 'approved' ELSE 'pending' END, CASE WHEN pre_approved THEN now() END)
  ON CONFLICT DO NOTHING;
  UPDATE public.waitlist_requests SET user_id = NEW.id WHERE email = lower(NEW.email) AND user_id IS NULL;
  RETURN NEW;
END;
$function$;