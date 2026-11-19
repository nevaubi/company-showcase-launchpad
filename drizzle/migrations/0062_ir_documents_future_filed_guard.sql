CREATE OR REPLACE FUNCTION public.ir_documents_filed_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.filed IS NOT NULL AND NEW.filed > (now() AT TIME ZONE 'utc')::date + 1 THEN
    NEW.filed := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ir_documents_filed_guard ON public.ir_documents;
CREATE TRIGGER ir_documents_filed_guard BEFORE INSERT OR UPDATE OF filed ON public.ir_documents
FOR EACH ROW EXECUTE FUNCTION public.ir_documents_filed_guard();