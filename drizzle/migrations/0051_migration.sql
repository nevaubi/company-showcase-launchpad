CREATE TABLE public.office_files (
  id text PRIMARY KEY,
  owner uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('docx','xlsx','pptx','pdf')),
  title text NOT NULL DEFAULT 'Untitled',
  storage_path text,
  size_bytes bigint NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_files TO authenticated;
GRANT ALL ON public.office_files TO service_role;
ALTER TABLE public.office_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "office own select" ON public.office_files FOR SELECT TO authenticated USING (owner = auth.uid() AND public.has_app_access(auth.uid()));
CREATE POLICY "office own insert" ON public.office_files FOR INSERT TO authenticated WITH CHECK (owner = auth.uid() AND public.has_app_access(auth.uid()));
CREATE POLICY "office own update" ON public.office_files FOR UPDATE TO authenticated USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());
CREATE POLICY "office own delete" ON public.office_files FOR DELETE TO authenticated USING (owner = auth.uid());
CREATE INDEX office_files_owner_idx ON public.office_files(owner, updated_at DESC);