CREATE TYPE public.app_role AS ENUM ('admin');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.waitlist (
  user_id uuid PRIMARY KEY,
  email text,
  display_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid
);
REVOKE ALL ON public.waitlist FROM anon, authenticated;
GRANT SELECT ON public.waitlist TO authenticated;
GRANT ALL ON public.waitlist TO service_role;
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin read" ON public.waitlist FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

INSERT INTO public.waitlist (user_id, email, display_name, status, decided_at)
SELECT u.id, u.email, p.display_name, 'approved', now()
FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_app_access(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user, 'admin')
    OR EXISTS (SELECT 1 FROM public.waitlist WHERE user_id = _user AND status = 'approved')
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = _user AND is_demo)
$$;

CREATE OR REPLACE FUNCTION public.decide_waitlist(_user uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _status NOT IN ('pending','approved','declined') THEN RAISE EXCEPTION 'bad status'; END IF;
  UPDATE public.waitlist SET status = _status, decided_at = now(), decided_by = auth.uid() WHERE user_id = _user;
END $$;
REVOKE EXECUTE ON FUNCTION public.decide_waitlist(uuid, text) FROM anon;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  INSERT INTO public.waitlist (user_id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;