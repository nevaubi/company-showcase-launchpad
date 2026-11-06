-- Default privileges gave anon/authenticated full table rights, so column-level grants didn't apply.
-- Reset firm tables to exactly what the app needs.
REVOKE ALL ON public.firms, public.firm_members, public.firm_invites, public.firm_coverage, public.firm_notes, public.firm_activity FROM anon, authenticated;

GRANT SELECT, DELETE ON public.firms TO authenticated;
GRANT UPDATE (name, branding, logo_data, updated_at) ON public.firms TO authenticated;
GRANT SELECT ON public.firm_members TO authenticated;
GRANT UPDATE (display_name, title) ON public.firm_members TO authenticated;
GRANT SELECT, DELETE ON public.firm_invites TO authenticated;
GRANT INSERT (firm_id, email, role, invited_by) ON public.firm_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_coverage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_notes TO authenticated;
GRANT SELECT ON public.firm_activity TO authenticated;

-- Defense in depth: membership identity and role change only through the checked functions.
CREATE OR REPLACE FUNCTION public.firm_members_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
    NEW.role IS DISTINCT FROM OLD.role OR NEW.firm_id IS DISTINCT FROM OLD.firm_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.email IS DISTINCT FROM OLD.email OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
  ) THEN
    RAISE EXCEPTION 'Roles and membership change only through firm admin actions';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER firm_members_lock BEFORE UPDATE ON public.firm_members
  FOR EACH ROW EXECUTE FUNCTION public.firm_members_lock();

-- Repair: a firm whose creator lost ownership with no other owner gets it back.
UPDATE public.firm_members m SET role = 'owner'
FROM public.firms f
WHERE m.firm_id = f.id AND m.user_id = f.created_by
  AND NOT EXISTS (SELECT 1 FROM public.firm_members o WHERE o.firm_id = f.id AND o.role = 'owner');
