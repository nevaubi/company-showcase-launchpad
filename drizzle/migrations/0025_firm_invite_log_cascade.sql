-- Don't log invite revocations while the whole firm is being deleted.
CREATE OR REPLACE FUNCTION public.firm_invite_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pending int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.accepted_at IS NULL AND EXISTS (SELECT 1 FROM public.firms WHERE id = OLD.firm_id) THEN
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
