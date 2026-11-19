GRANT UPDATE ON public.waitlist TO authenticated;

CREATE POLICY "own re-request"
ON public.waitlist
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND status = 'pending');