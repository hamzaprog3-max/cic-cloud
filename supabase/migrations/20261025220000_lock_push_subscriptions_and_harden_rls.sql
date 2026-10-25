-- ═══════════════════════════════════════════════════════════════
-- SECURITY HARDENING: LOCK DOWN DIRECT ACCESS TO PUSH_SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════════

-- 1. Remove overly-permissive direct update and insert policies on push_subscriptions
DROP POLICY IF EXISTS "Anyone can update own push subscription" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Anyone can insert push subscription" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.push_subscriptions;

-- Ensure RLS is active
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Anonymous users cannot directly SELECT, UPDATE, or DELETE from push_subscriptions via REST API.
-- Registration is strictly channeled through the SECURITY DEFINER function:
-- public.register_push_subscription() which safely handles upserts.

-- 2. Owner maintenance access (for inspecting/cleaning push subscriptions)
CREATE POLICY "Owner can read push_subscriptions"
ON public.push_subscriptions FOR SELECT TO authenticated
USING (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = 'owner'::text);

CREATE POLICY "Owner can delete push_subscriptions"
ON public.push_subscriptions FOR DELETE TO authenticated
USING (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = 'owner'::text);

-- 3. Confirm audit_logs protection: strict owner read only
DROP POLICY IF EXISTS "Anyone can read audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Enable read for audit logs" ON public.audit_logs;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only authenticated owners can read audit logs
DROP POLICY IF EXISTS "Owner can read audit_logs" ON public.audit_logs;
CREATE POLICY "Owner can read audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (((auth.jwt() -> 'app_metadata'::text) ->> 'app_role'::text) = 'owner'::text);
