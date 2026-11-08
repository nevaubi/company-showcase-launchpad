CREATE OR REPLACE FUNCTION public.has_app_access(_user uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(_user, 'admin')
    OR EXISTS (SELECT 1 FROM public.waitlist WHERE user_id = _user AND status = 'approved')
$$;
COMMENT ON COLUMN public.profiles.is_demo IS 'DEPRECATED: demo workspace removed; no longer grants access';