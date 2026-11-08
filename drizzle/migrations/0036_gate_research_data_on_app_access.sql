DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname='public' AND cmd='SELECT' AND qual='true'
      AND tablename IN ('alt_data','analyst_estimates','filing_documents','filing_redlines','insider_trades','ir_company_series','ir_documents','ir_kpi_facts','sec_filings','supply_links','supply_signals')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format('CREATE POLICY "Members read %s" ON public.%I FOR SELECT TO authenticated USING (public.has_app_access(auth.uid()))', r.tablename, r.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Signed-in users read datasets" ON storage.objects;
CREATE POLICY "Members read datasets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'datasets' AND public.has_app_access(auth.uid()));

REVOKE EXECUTE ON FUNCTION public.decide_waitlist FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_app_access(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_firm_role FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_firm_member FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_app_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_firm_role TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_firm_member TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decide_waitlist TO authenticated, service_role;