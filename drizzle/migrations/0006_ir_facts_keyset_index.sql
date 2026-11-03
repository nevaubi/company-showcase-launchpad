CREATE INDEX IF NOT EXISTS ir_kpi_facts_ticker_id_idx ON public.ir_kpi_facts (ticker, id);
CREATE INDEX IF NOT EXISTS ir_documents_vision_queue_idx ON public.ir_documents (filed DESC) WHERE vision_status IS NULL;
CREATE INDEX IF NOT EXISTS ir_documents_extract_queue_idx ON public.ir_documents (filed DESC) WHERE extract_status IS NULL;