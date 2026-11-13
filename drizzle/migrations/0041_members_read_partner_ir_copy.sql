CREATE POLICY "Members read partner IR copy" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ir-documents' AND name LIKE 'partner/%' AND public.has_app_access(auth.uid()));