-- ═══════════════════════════════════════════════════════════════
-- SECURE STORAGE AND RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- 1. Block direct brute-forcing on authenticate_moderator via RPC
REVOKE EXECUTE ON FUNCTION public.authenticate_moderator(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.authenticate_moderator(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.authenticate_moderator(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_moderator(text, text) TO service_role;

-- 2. Restrict storage write & delete to owners and moderators only (not just any authenticated user)
DROP POLICY IF EXISTS "materials admin write" ON storage.objects;
DROP POLICY IF EXISTS "materials admin delete" ON storage.objects;

CREATE POLICY "materials admin write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'materials' AND
  ((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'moderator'::text])
);

CREATE POLICY "materials admin delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'materials' AND
  ((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'moderator'::text])
);
