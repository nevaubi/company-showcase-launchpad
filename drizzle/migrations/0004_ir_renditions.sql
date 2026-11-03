ALTER TABLE public.ir_documents ADD COLUMN rendition_path text, ADD COLUMN pages integer;
ALTER TABLE public.ir_kpi_facts ADD COLUMN document_kind text;