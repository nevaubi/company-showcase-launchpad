ALTER TABLE public.ir_company_series ALTER COLUMN payload DROP NOT NULL;
ALTER TABLE public.ir_company_series ADD COLUMN IF NOT EXISTS payload_path text;
ALTER TABLE public.ir_company_series ADD COLUMN IF NOT EXISTS payload_bytes integer;