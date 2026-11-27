-- Fence older in-flight workers before replaying the revised close-of-session information set.
DO $$ BEGIN
  IF to_regprocedure('public.claim_setup_replay_after_filing_v2(date)') IS NULL THEN
    ALTER FUNCTION public.claim_setup_replay_v2(date) RENAME TO claim_setup_replay_after_filing_v2;
  END IF;
  IF to_regprocedure('public.save_setup_replay_v2(text,uuid,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.finish_setup_replay_v2(text,uuid,jsonb,jsonb) RENAME TO save_setup_replay_v2;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.claim_setup_replay_v2(p_as_of date) RETURNS TABLE(ticker text,sector text,token uuid)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT NULL::text,NULL::text,NULL::uuid WHERE false $$;
CREATE OR REPLACE FUNCTION public.finish_setup_replay_v2(p_ticker text,p_token uuid,p_receipt jsonb,p_rows jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF p_receipt->>'filingCutoff' IS DISTINCT FROM 'next-session-v1' THEN RETURN false; END IF;
  RETURN public.save_setup_replay_v2(p_ticker,p_token,p_receipt,p_rows);
END $$;
CREATE OR REPLACE FUNCTION public.require_setup_replay_cutoff() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND NEW.receipt->>'filingCutoff' IS DISTINCT FROM 'next-session-v1' THEN
    RAISE EXCEPTION 'Stale replay filing cutoff'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS require_setup_replay_cutoff ON public.setup_replay_work;
CREATE TRIGGER require_setup_replay_cutoff BEFORE INSERT OR UPDATE OF receipt,completed_at ON public.setup_replay_work
  FOR EACH ROW EXECUTE FUNCTION public.require_setup_replay_cutoff();
REVOKE ALL ON FUNCTION public.claim_setup_replay_v2(date),public.claim_setup_replay_after_filing_v2(date),public.finish_setup_replay_v2(text,uuid,jsonb,jsonb),public.save_setup_replay_v2(text,uuid,jsonb,jsonb),public.require_setup_replay_cutoff() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_setup_replay_v2(date),public.claim_setup_replay_after_filing_v2(date),public.finish_setup_replay_v2(text,uuid,jsonb,jsonb),public.save_setup_replay_v2(text,uuid,jsonb,jsonb) TO service_role;

-- Preserve the superseded native source receipts for audit; retain unaffected price-only evidence.
ALTER TABLE public.setup_replay_work ADD COLUMN IF NOT EXISTS superseded_receipt jsonb;
ALTER TABLE public.setup_replay_work ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
DO $$ BEGIN
  UPDATE public.setup_samples s SET execution_version=NULL FROM public.setup_replay_work w
    WHERE w.ticker=s.ticker AND w.completed_at IS NOT NULL AND w.receipt->>'filingCutoff' IS DISTINCT FROM 'next-session-v1'
      AND s.execution_version=2 AND split_part(s.variant,':',1) IN ('insider','earnRunup','confluence');
  UPDATE public.setup_scan s SET replay_version=NULL FROM public.setup_replay_work w
    WHERE s.ticker=w.ticker AND w.completed_at IS NOT NULL AND w.receipt->>'filingCutoff' IS DISTINCT FROM 'next-session-v1';
  UPDATE public.setup_replay_work SET superseded_receipt=receipt,superseded_at=now(),completed_at=NULL,receipt=NULL,
    token=NULL,lease_until=NULL,retry_at=NULL,attempts=0,error=NULL WHERE completed_at IS NOT NULL AND receipt->>'filingCutoff' IS DISTINCT FROM 'next-session-v1';
  -- Abandoned tokens from the disabled entry point expire naturally; newer valid leases are never cleared on reapplication.
END $$;