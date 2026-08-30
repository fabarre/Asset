-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE CF7-viewer: gate viewer sulle voci CAPEX/OPEX personalizzate
--
-- La tabella plant_custom_costs (creata in CF7) aveva policy owner-based semplici
-- senza il gate per il ruolo 'viewer'. Le altre 6 tabelle owner hanno già il gate
-- (migration_roles_viewer.sql). Allineo anche plant_custom_costs: il ruolo viewer
-- può LEGGERE le proprie voci ma non INSERT/UPDATE/DELETE.
--
-- PREVENTIVO: backup 2026-08-30T12-55-32_prod.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "owner insert" ON public.plant_custom_costs;
DROP POLICY IF EXISTS "owner update" ON public.plant_custom_costs;
DROP POLICY IF EXISTS "owner delete" ON public.plant_custom_costs;

CREATE POLICY "owner insert" ON public.plant_custom_costs FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id AND (select get_my_role()) <> 'viewer');
CREATE POLICY "owner update" ON public.plant_custom_costs FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id AND (select get_my_role()) <> 'viewer')
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "owner delete" ON public.plant_custom_costs FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id AND (select get_my_role()) <> 'viewer');

COMMIT;

-- Verifica post-migrazione:
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--   WHERE tablename='plant_custom_costs' ORDER BY policyname;

-- ROLLBACK:
-- BEGIN;
-- DROP POLICY IF EXISTS "owner insert" ON public.plant_custom_costs;
-- DROP POLICY IF EXISTS "owner update" ON public.plant_custom_costs;
-- DROP POLICY IF EXISTS "owner delete" ON public.plant_custom_costs;
-- CREATE POLICY "owner insert" ON public.plant_custom_costs FOR INSERT TO authenticated
--     WITH CHECK ((select auth.uid()) = user_id);
-- CREATE POLICY "owner update" ON public.plant_custom_costs FOR UPDATE TO authenticated
--     USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
-- CREATE POLICY "owner delete" ON public.plant_custom_costs FOR DELETE TO authenticated
--     USING ((select auth.uid()) = user_id);
-- COMMIT;
