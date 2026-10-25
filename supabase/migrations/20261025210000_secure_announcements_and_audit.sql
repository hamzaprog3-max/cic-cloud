-- ═══════════════════════════════════════════════════════════════
-- SECURE ANNOUNCEMENTS, NOTIFICATION_TEMPLATES, AUDIT_LOGS
-- ═══════════════════════════════════════════════════════════════

-- 1. SECURE ANNOUNCEMENTS
DROP POLICY IF EXISTS "Allow inserts on announcements" ON public.announcements;
DROP POLICY IF EXISTS "Allow deletes on announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can delete announcements" ON public.announcements;
DROP POLICY IF EXISTS "Enable read access for all users on announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can read announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admin can delete announcements" ON public.announcements;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read announcements"
ON public.announcements FOR SELECT TO public
USING (true);

CREATE POLICY "Admin can insert announcements"
ON public.announcements FOR INSERT TO authenticated
WITH CHECK (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'moderator'::text]));

CREATE POLICY "Admin can update announcements"
ON public.announcements FOR UPDATE TO authenticated
USING (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'moderator'::text]))
WITH CHECK (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'moderator'::text]));

CREATE POLICY "Admin can delete announcements"
ON public.announcements FOR DELETE TO authenticated
USING (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = ANY (ARRAY['owner'::text, 'moderator'::text]));

-- 2. SECURE NOTIFICATION_TEMPLATES
DROP POLICY IF EXISTS "Allow owner to update notification_templates" ON public.notification_templates;
CREATE POLICY "Owner can manage notification_templates"
ON public.notification_templates FOR ALL TO authenticated
USING (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = 'owner'::text)
WITH CHECK (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = 'owner'::text);

-- 3. SECURE AUDIT_LOGS
DROP POLICY IF EXISTS "Allow inserts into audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Enable read for audit logs" ON public.audit_logs;
