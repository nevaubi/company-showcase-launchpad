-- Skip coverage audit rows while the whole firm is being deleted (they'd point at a removed firm).
CREATE OR REPLACE FUNCTION public.firm_coverage_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.firms WHERE id = OLD.firm_id) THEN
      INSERT INTO public.firm_activity (firm_id, actor_id, action, ticker) VALUES (OLD.firm_id, auth.uid(), 'coverage.removed', OLD.ticker);
    END IF;
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
