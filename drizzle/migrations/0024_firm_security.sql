-- Firm workspace hardening: no membership probing, tighter invite writes, size limits, invite/branding audit.

-- Role helpers only answer for the signed-in user, so they can't be used to probe other people's memberships.
CREATE OR REPLACE FUNCTION public.has_firm_role(_firm uuid, _user uuid, _min public.firm_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user IS NOT NULL AND _user = auth.uid() AND EXISTS (
    SELECT 1 FROM public.firm_members m
    WHERE m.firm_id = _firm AND m.user_id = _user
      AND public.firm_role_rank(m.role) >= public.firm_role_rank(_min)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_firm_member(_firm uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user IS NOT NULL AND _user = auth.uid()
    AND EXISTS (SELECT 1 FROM public.firm_members m WHERE m.firm_id = _firm AND m.user_id = _user)
$$;

-- Coverage guard checks the assigned analyst directly (it may be someone other than the caller).
CREATE OR REPLACE FUNCTION public.firm_coverage_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF (TG_OP = 'INSERT' AND NEW.restricted)
       OR (TG_OP = 'UPDATE' AND (NEW.restricted IS DISTINCT FROM OLD.restricted OR NEW.restricted_reason IS DISTINCT FROM OLD.restricted_reason)) THEN
      IF NOT public.has_firm_role(NEW.firm_id, auth.uid(), 'admin') THEN
        RAISE EXCEPTION 'Only firm admins can change the restricted list';
      END IF;
    END IF;
  END IF;
  IF NEW.analyst_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.firm_members m WHERE m.firm_id = NEW.firm_id AND m.user_id = NEW.analyst_id
  ) THEN
    RAISE EXCEPTION 'The assigned analyst must be a member of the firm';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.firm_id := OLD.firm_id;
    NEW.ticker := OLD.ticker;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

-- Sharing: signed-in users may only share into their own firms (service jobs are exempt).
CREATE OR REPLACE FUNCTION public.check_firm_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.firm_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.firm_id IS DISTINCT FROM OLD.firm_id) THEN
    IF NOT public.is_firm_member(NEW.firm_id, auth.uid()) THEN
      RAISE EXCEPTION 'You can only share with a firm you belong to';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Notes keep their company on edit.
CREATE OR REPLACE FUNCTION public.firm_notes_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.firm_id := OLD.firm_id;
    NEW.author_id := OLD.author_id;
    NEW.ticker := OLD.ticker;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  ELSE
    INSERT INTO public.firm_activity (firm_id, actor_id, action, ticker, detail)
    VALUES (NEW.firm_id, auth.uid(), 'note.added', NEW.ticker, jsonb_build_object('preview', left(NEW.body, 140)));
  END IF;
  RETURN NEW;
END $$;

-- Size limits on free-form JSON.
ALTER TABLE public.firms ADD CONSTRAINT firms_branding_size CHECK (octet_length(branding::text) <= 8000);
ALTER TABLE public.firm_notes ADD CONSTRAINT firm_notes_context_size CHECK (octet_length(context::text) <= 2000);
ALTER TABLE public.firm_notes ADD CONSTRAINT firm_notes_ticker_format CHECK (ticker IS NULL OR ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$');

-- Invites: clients may only set who/role; token, expiry and acceptance are server-controlled.
REVOKE INSERT ON public.firm_invites FROM authenticated;
GRANT INSERT (firm_id, email, role, invited_by) ON public.firm_invites TO authenticated;
CREATE UNIQUE INDEX firm_invites_pending_uniq ON public.firm_invites (firm_id, lower(email)) WHERE accepted_at IS NULL;

CREATE OR REPLACE FUNCTION public.firm_invite_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pending int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.accepted_at IS NULL THEN
      INSERT INTO public.firm_activity (firm_id, actor_id, action, detail)
      VALUES (OLD.firm_id, auth.uid(), 'invite.revoked', jsonb_build_object('email', OLD.email));
    END IF;
    RETURN OLD;
  END IF;
  NEW.email := lower(btrim(NEW.email));
  IF EXISTS (SELECT 1 FROM public.firm_members m WHERE m.firm_id = NEW.firm_id AND lower(m.email) = NEW.email) THEN
    RAISE EXCEPTION '% is already a member of this firm', NEW.email;
  END IF;
  DELETE FROM public.firm_invites WHERE firm_id = NEW.firm_id AND lower(email) = NEW.email AND accepted_at IS NULL AND expires_at < now();
  SELECT count(*) INTO pending FROM public.firm_invites WHERE firm_id = NEW.firm_id AND accepted_at IS NULL;
  IF pending >= 100 THEN RAISE EXCEPTION 'This firm has 100 pending invites — revoke some first'; END IF;
  INSERT INTO public.firm_activity (firm_id, actor_id, action, detail)
  VALUES (NEW.firm_id, auth.uid(), 'invite.sent', jsonb_build_object('email', NEW.email, 'role', NEW.role));
  RETURN NEW;
END $$;
CREATE TRIGGER firm_invite_guard BEFORE INSERT ON public.firm_invites
  FOR EACH ROW EXECUTE FUNCTION public.firm_invite_guard();
CREATE TRIGGER firm_invite_revoke_log AFTER DELETE ON public.firm_invites
  FOR EACH ROW EXECUTE FUNCTION public.firm_invite_guard();

-- Branding and name changes are audited; creator and creation time can't be rewritten.
CREATE OR REPLACE FUNCTION public.firm_update_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.firm_activity (firm_id, actor_id, action, detail)
    VALUES (NEW.id, auth.uid(), 'firm.renamed', jsonb_build_object('from', OLD.name, 'to', NEW.name));
  END IF;
  IF NEW.branding IS DISTINCT FROM OLD.branding OR NEW.logo_data IS DISTINCT FROM OLD.logo_data THEN
    INSERT INTO public.firm_activity (firm_id, actor_id, action, detail)
    VALUES (NEW.id, auth.uid(), 'firm.branding', jsonb_build_object('logo', NEW.logo_data IS DISTINCT FROM OLD.logo_data));
  END IF;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;
CREATE TRIGGER firm_update_log BEFORE UPDATE ON public.firms
  FOR EACH ROW EXECUTE FUNCTION public.firm_update_log();
