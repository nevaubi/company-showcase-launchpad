-- Firm workspaces: firms, members with roles, invites, shared coverage, notes, activity log.
CREATE TYPE public.firm_role AS ENUM ('owner', 'admin', 'analyst', 'viewer');

CREATE TABLE public.firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  created_by uuid NOT NULL,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_data text CHECK (logo_data IS NULL OR char_length(logo_data) <= 400000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.firm_members (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.firm_role NOT NULL DEFAULT 'analyst',
  email text,
  display_name text CHECK (display_name IS NULL OR char_length(display_name) <= 80),
  title text CHECK (title IS NULL OR char_length(title) <= 80),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, user_id)
);
CREATE INDEX firm_members_user_idx ON public.firm_members (user_id);

CREATE TABLE public.firm_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.firm_role NOT NULL DEFAULT 'analyst' CHECK (role <> 'owner'),
  token text NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid
);
CREATE INDEX firm_invites_firm_idx ON public.firm_invites (firm_id);
CREATE INDEX firm_invites_email_idx ON public.firm_invites (lower(email));

CREATE TABLE public.firm_coverage (
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z][A-Z0-9.\-]{0,9}$'),
  analyst_id uuid,
  rating text NOT NULL DEFAULT 'not_rated' CHECK (rating IN ('buy', 'overweight', 'hold', 'underweight', 'sell', 'not_rated')),
  target_price numeric CHECK (target_price IS NULL OR target_price > 0),
  priority smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  restricted boolean NOT NULL DEFAULT false,
  restricted_reason text CHECK (restricted_reason IS NULL OR char_length(restricted_reason) <= 200),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (firm_id, ticker)
);

CREATE TABLE public.firm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  ticker text,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 8000),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firm_notes_firm_ticker_idx ON public.firm_notes (firm_id, ticker, created_at DESC);

CREATE TABLE public.firm_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firm_id uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  ticker text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firm_activity_firm_idx ON public.firm_activity (firm_id, created_at DESC);

-- Share theses and docs with a firm.
ALTER TABLE public.theses ADD COLUMN firm_id uuid REFERENCES public.firms(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN firm_id uuid REFERENCES public.firms(id) ON DELETE SET NULL;

-- Grants (writes to members/invites go through checked functions).
GRANT SELECT, DELETE ON public.firms TO authenticated;
GRANT UPDATE (name, branding, logo_data, updated_at) ON public.firms TO authenticated;
GRANT SELECT ON public.firm_members TO authenticated;
GRANT UPDATE (display_name, title) ON public.firm_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.firm_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_coverage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_notes TO authenticated;
GRANT SELECT ON public.firm_activity TO authenticated;
GRANT ALL ON public.firms, public.firm_members, public.firm_invites, public.firm_coverage, public.firm_notes, public.firm_activity TO service_role;

ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_activity ENABLE ROW LEVEL SECURITY;

-- Role helpers (security definer avoids recursive RLS on firm_members).
CREATE OR REPLACE FUNCTION public.firm_role_rank(_role public.firm_role)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'analyst' THEN 2 ELSE 1 END
$$;

CREATE OR REPLACE FUNCTION public.has_firm_role(_firm uuid, _user uuid, _min public.firm_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.firm_members m
    WHERE m.firm_id = _firm AND m.user_id = _user
      AND public.firm_role_rank(m.role) >= public.firm_role_rank(_min)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_firm_member(_firm uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.firm_members m WHERE m.firm_id = _firm AND m.user_id = _user)
$$;

-- Policies
CREATE POLICY "Members read firm" ON public.firms FOR SELECT TO authenticated
  USING (public.is_firm_member(id, auth.uid()));
CREATE POLICY "Admins update firm" ON public.firms FOR UPDATE TO authenticated
  USING (public.has_firm_role(id, auth.uid(), 'admin')) WITH CHECK (public.has_firm_role(id, auth.uid(), 'admin'));
CREATE POLICY "Owners delete firm" ON public.firms FOR DELETE TO authenticated
  USING (public.has_firm_role(id, auth.uid(), 'owner'));

CREATE POLICY "Members read members" ON public.firm_members FOR SELECT TO authenticated
  USING (public.is_firm_member(firm_id, auth.uid()));
CREATE POLICY "Members edit own profile" ON public.firm_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins read invites" ON public.firm_invites FOR SELECT TO authenticated
  USING (public.has_firm_role(firm_id, auth.uid(), 'admin'));
CREATE POLICY "Admins create invites" ON public.firm_invites FOR INSERT TO authenticated
  WITH CHECK (public.has_firm_role(firm_id, auth.uid(), 'admin') AND invited_by = auth.uid() AND role <> 'owner' AND accepted_at IS NULL);
CREATE POLICY "Admins revoke invites" ON public.firm_invites FOR DELETE TO authenticated
  USING (public.has_firm_role(firm_id, auth.uid(), 'admin'));

CREATE POLICY "Members read coverage" ON public.firm_coverage FOR SELECT TO authenticated
  USING (public.is_firm_member(firm_id, auth.uid()));
CREATE POLICY "Analysts add coverage" ON public.firm_coverage FOR INSERT TO authenticated
  WITH CHECK (public.has_firm_role(firm_id, auth.uid(), 'analyst'));
CREATE POLICY "Analysts update coverage" ON public.firm_coverage FOR UPDATE TO authenticated
  USING (public.has_firm_role(firm_id, auth.uid(), 'analyst')) WITH CHECK (public.has_firm_role(firm_id, auth.uid(), 'analyst'));
CREATE POLICY "Admins remove coverage" ON public.firm_coverage FOR DELETE TO authenticated
  USING (public.has_firm_role(firm_id, auth.uid(), 'admin'));

CREATE POLICY "Members read notes" ON public.firm_notes FOR SELECT TO authenticated
  USING (public.is_firm_member(firm_id, auth.uid()));
CREATE POLICY "Analysts write notes" ON public.firm_notes FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.has_firm_role(firm_id, auth.uid(), 'analyst'));
CREATE POLICY "Authors or admins update notes" ON public.firm_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid() OR public.has_firm_role(firm_id, auth.uid(), 'admin'))
  WITH CHECK (public.is_firm_member(firm_id, auth.uid()));
CREATE POLICY "Authors or admins delete notes" ON public.firm_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_firm_role(firm_id, auth.uid(), 'admin'));

CREATE POLICY "Members read activity" ON public.firm_activity FOR SELECT TO authenticated
  USING (public.is_firm_member(firm_id, auth.uid()));

CREATE POLICY "Firm members read shared theses" ON public.theses FOR SELECT TO authenticated
  USING (firm_id IS NOT NULL AND public.is_firm_member(firm_id, auth.uid()));
CREATE POLICY "Firm members read shared thesis updates" ON public.thesis_updates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.theses t WHERE t.id = thesis_updates.thesis_id AND t.firm_id IS NOT NULL AND public.is_firm_member(t.firm_id, auth.uid())));
CREATE POLICY "Firm members read shared docs" ON public.documents FOR SELECT TO authenticated
  USING (firm_id IS NOT NULL AND public.is_firm_member(firm_id, auth.uid()));

-- Only share into a firm you belong to.
CREATE OR REPLACE FUNCTION public.check_firm_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.firm_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.firm_id IS DISTINCT FROM OLD.firm_id) THEN
    IF NOT public.is_firm_member(NEW.firm_id, auth.uid()) THEN
      RAISE EXCEPTION 'You can only share with a firm you belong to';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER theses_firm_share BEFORE INSERT OR UPDATE OF firm_id ON public.theses
  FOR EACH ROW EXECUTE FUNCTION public.check_firm_share();
CREATE TRIGGER documents_firm_share BEFORE INSERT OR UPDATE OF firm_id ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.check_firm_share();

-- Coverage guards: restricted list is admin-only; assigned analyst must be a member; audit trail.
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
  IF NEW.analyst_id IS NOT NULL AND NOT public.is_firm_member(NEW.firm_id, NEW.analyst_id) THEN
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
CREATE TRIGGER firm_coverage_guard BEFORE INSERT OR UPDATE ON public.firm_coverage
  FOR EACH ROW EXECUTE FUNCTION public.firm_coverage_guard();

CREATE OR REPLACE FUNCTION public.firm_coverage_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.firm_activity (firm_id, actor_id, action, ticker) VALUES (OLD.firm_id, auth.uid(), 'coverage.removed', OLD.ticker);
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.firm_activity (firm_id, actor_id, action, ticker, detail)
    VALUES (NEW.firm_id, auth.uid(), 'coverage.added', NEW.ticker, jsonb_build_object('rating', NEW.rating, 'analyst_id', NEW.analyst_id));
    RETURN NEW;
  END IF;
  IF NEW.rating IS DISTINCT FROM OLD.rating THEN d := d || jsonb_build_object('rating', jsonb_build_array(OLD.rating, NEW.rating)); END IF;
  IF NEW.target_price IS DISTINCT FROM OLD.target_price THEN d := d || jsonb_build_object('target_price', jsonb_build_array(OLD.target_price, NEW.target_price)); END IF;
  IF NEW.analyst_id IS DISTINCT FROM OLD.analyst_id THEN d := d || jsonb_build_object('analyst_id', jsonb_build_array(OLD.analyst_id, NEW.analyst_id)); END IF;
  IF NEW.restricted IS DISTINCT FROM OLD.restricted THEN d := d || jsonb_build_object('restricted', jsonb_build_array(OLD.restricted, NEW.restricted), 'reason', NEW.restricted_reason); END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN d := d || jsonb_build_object('priority', jsonb_build_array(OLD.priority, NEW.priority)); END IF;
  IF d <> '{}'::jsonb THEN
    INSERT INTO public.firm_activity (firm_id, actor_id, action, ticker, detail) VALUES (NEW.firm_id, auth.uid(), 'coverage.updated', NEW.ticker, d);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER firm_coverage_log AFTER INSERT OR UPDATE OR DELETE ON public.firm_coverage
  FOR EACH ROW EXECUTE FUNCTION public.firm_coverage_log();

CREATE OR REPLACE FUNCTION public.firm_notes_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.firm_id := OLD.firm_id;
    NEW.author_id := OLD.author_id;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  ELSE
    INSERT INTO public.firm_activity (firm_id, actor_id, action, ticker, detail)
    VALUES (NEW.firm_id, auth.uid(), 'note.added', NEW.ticker, jsonb_build_object('preview', left(NEW.body, 140)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER firm_notes_guard BEFORE INSERT OR UPDATE ON public.firm_notes
  FOR EACH ROW EXECUTE FUNCTION public.firm_notes_guard();

-- Create a firm and become its owner.
CREATE OR REPLACE FUNCTION public.create_firm(_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE fid uuid; uid uuid := auth.uid(); n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to create a firm'; END IF;
  SELECT count(*) INTO n FROM public.firms WHERE created_by = uid;
  IF n >= 5 THEN RAISE EXCEPTION 'You can create up to 5 firms'; END IF;
  INSERT INTO public.firms (name, created_by) VALUES (btrim(_name), uid) RETURNING id INTO fid;
  INSERT INTO public.firm_members (firm_id, user_id, role, email, display_name)
  VALUES (fid, uid, 'owner', auth.jwt() ->> 'email', (SELECT display_name FROM public.profiles WHERE id = uid));
  INSERT INTO public.firm_activity (firm_id, actor_id, action, detail) VALUES (fid, uid, 'firm.created', jsonb_build_object('name', btrim(_name)));
  RETURN fid;
END $$;

-- Invite preview (no token leakage beyond the holder) and acceptance.
CREATE OR REPLACE FUNCTION public.get_firm_invite(_token text)
RETURNS TABLE (firm_name text, role public.firm_role, email text, expired boolean, accepted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.name, i.role, i.email, i.expires_at < now(), i.accepted_at IS NOT NULL
  FROM public.firm_invites i JOIN public.firms f ON f.id = i.firm_id
  WHERE i.token = _token AND auth.uid() IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.my_firm_invites()
RETURNS TABLE (token text, firm_name text, role public.firm_role, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.token, f.name, i.role, i.expires_at
  FROM public.firm_invites i JOIN public.firms f ON f.id = i.firm_id
  WHERE lower(i.email) = lower(auth.jwt() ->> 'email') AND i.accepted_at IS NULL AND i.expires_at > now()
    AND NOT EXISTS (SELECT 1 FROM public.firm_members m WHERE m.firm_id = i.firm_id AND m.user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.accept_firm_invite(_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.firm_invites%ROWTYPE; uid uuid := auth.uid(); em text := auth.jwt() ->> 'email';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to accept the invite'; END IF;
  SELECT * INTO inv FROM public.firm_invites WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This invite link is not valid'; END IF;
  IF inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'This invite has already been used'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'This invite has expired — ask for a new one'; END IF;
  IF em IS NULL OR lower(em) <> lower(inv.email) THEN
    RAISE EXCEPTION 'This invite was sent to %. Sign in with that email to accept it.', inv.email;
  END IF;
  INSERT INTO public.firm_members (firm_id, user_id, role, email, display_name)
  VALUES (inv.firm_id, uid, inv.role, em, (SELECT display_name FROM public.profiles WHERE id = uid))
  ON CONFLICT (firm_id, user_id) DO NOTHING;
  UPDATE public.firm_invites SET accepted_at = now(), accepted_by = uid WHERE id = inv.id;
  INSERT INTO public.firm_activity (firm_id, actor_id, action, detail) VALUES (inv.firm_id, uid, 'member.joined', jsonb_build_object('role', inv.role, 'email', em));
  RETURN inv.firm_id;
END $$;

-- Role changes and removals with owner safety.
CREATE OR REPLACE FUNCTION public.set_firm_member_role(_firm uuid, _user uuid, _role public.firm_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur public.firm_role; me uuid := auth.uid(); owners int;
BEGIN
  SELECT role INTO cur FROM public.firm_members WHERE firm_id = _firm AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'That person is not a member'; END IF;
  IF _role = 'owner' OR cur = 'owner' THEN
    IF NOT public.has_firm_role(_firm, me, 'owner') THEN RAISE EXCEPTION 'Only an owner can grant or remove ownership'; END IF;
  ELSIF NOT public.has_firm_role(_firm, me, 'admin') THEN
    RAISE EXCEPTION 'Only firm admins can change roles';
  END IF;
  IF cur = 'owner' AND _role <> 'owner' THEN
    SELECT count(*) INTO owners FROM public.firm_members WHERE firm_id = _firm AND role = 'owner';
    IF owners <= 1 THEN RAISE EXCEPTION 'A firm needs at least one owner — make someone else owner first'; END IF;
  END IF;
  UPDATE public.firm_members SET role = _role WHERE firm_id = _firm AND user_id = _user;
  INSERT INTO public.firm_activity (firm_id, actor_id, action, detail)
  VALUES (_firm, me, 'member.role', jsonb_build_object('user_id', _user, 'from', cur, 'to', _role));
END $$;

CREATE OR REPLACE FUNCTION public.remove_firm_member(_firm uuid, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur public.firm_role; me uuid := auth.uid(); owners int;
BEGIN
  SELECT role INTO cur FROM public.firm_members WHERE firm_id = _firm AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'That person is not a member'; END IF;
  IF _user <> me THEN
    IF cur = 'owner' AND NOT public.has_firm_role(_firm, me, 'owner') THEN RAISE EXCEPTION 'Only an owner can remove an owner'; END IF;
    IF NOT public.has_firm_role(_firm, me, 'admin') THEN RAISE EXCEPTION 'Only firm admins can remove members'; END IF;
  END IF;
  IF cur = 'owner' THEN
    SELECT count(*) INTO owners FROM public.firm_members WHERE firm_id = _firm AND role = 'owner';
    IF owners <= 1 THEN RAISE EXCEPTION 'A firm needs at least one owner — make someone else owner first'; END IF;
  END IF;
  DELETE FROM public.firm_members WHERE firm_id = _firm AND user_id = _user;
  UPDATE public.firm_coverage SET analyst_id = NULL WHERE firm_id = _firm AND analyst_id = _user;
  INSERT INTO public.firm_activity (firm_id, actor_id, action, detail)
  VALUES (_firm, me, CASE WHEN _user = me THEN 'member.left' ELSE 'member.removed' END, jsonb_build_object('user_id', _user));
END $$;

REVOKE ALL ON FUNCTION public.create_firm(text), public.get_firm_invite(text), public.my_firm_invites(), public.accept_firm_invite(text),
  public.set_firm_member_role(uuid, uuid, public.firm_role), public.remove_firm_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_firm(text), public.get_firm_invite(text), public.my_firm_invites(), public.accept_firm_invite(text),
  public.set_firm_member_role(uuid, uuid, public.firm_role), public.remove_firm_member(uuid, uuid),
  public.has_firm_role(uuid, uuid, public.firm_role), public.is_firm_member(uuid, uuid) TO authenticated;
