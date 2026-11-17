ALTER TABLE public.ir_documents
  ADD COLUMN IF NOT EXISTS prose_status text,
  ADD COLUMN IF NOT EXISTS prose_at timestamptz,
  ADD COLUMN IF NOT EXISTS prose_facts integer;

CREATE INDEX IF NOT EXISTS ir_documents_prose_todo_idx
  ON public.ir_documents (ticker, filed DESC)
  WHERE prose_status IS NULL AND ext IN ('htm', 'html');