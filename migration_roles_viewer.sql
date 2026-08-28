-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Ruoli utente — viewer read-only + listini zonal_pun admin-only
-- AntiGravity Hybrid FV + BESS Simulator — PRODUZIONE
--
-- MODELLO RUOLI (claim JWT app_metadata.role, stesso meccanismo dell'admin):
--   'admin'  → gestione utenti + scrittura listini zonal_pun
--   'editor' → default: pieno controllo del proprio workspace
--   'viewer' → sola lettura del proprio workspace (SELECT owner)
--
-- COSA FA:
--   1. public.get_my_role(): ruolo del chiamante (default 'editor')
--   2. public.admin_set_role(target, role): gestione ruoli riservata ad admin
--   3. admin_list_users(): ora espone anche il campo 'role'
--   4. Policy owner insert/update/delete sulle 6 tabelle utente: bloccate per
--      il ruolo 'viewer' (la SELECT owner resta sempre)
--   5. zonal_pun: INSERT/UPDATE/DELETE riservati ad 'admin' (SELECT resta
--      per tutti gli autenticati)
--
-- PREVENTIVO: eseguire dopo backup completo
--   (tools/backup.mjs run prod -> scratch/backups/<timestamp>_prod).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Ruolo del chiamante (default 'editor') ──
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'editor');
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- ── 2. Gestione ruoli riservata ad admin ──
CREATE OR REPLACE FUNCTION public.admin_set_role(target uuid, new_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;
  IF new_role IS NULL OR new_role NOT IN ('admin', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'invalid role: %', new_role;
  END IF;
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', new_role)
  WHERE id = target;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, text) TO authenticated;

-- ── 3. admin_list_users con campo role ──
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' THEN
    RAISE EXCEPTION 'access denied: admin role required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'role', COALESCE(u.raw_app_meta_data ->> 'role', 'editor'),
      'created_at', u.created_at,
      'confirmed', (u.email_confirmed_at IS NOT NULL),
      'last_sign_in_at', u.last_sign_in_at,
      'sessions_active', COALESCE(s.active_count, 0),
      'last_activity', s.last_activity
    ) ORDER BY u.created_at DESC), '[]'::jsonb)
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE sess.not_after IS NULL OR sess.not_after > now()) AS active_count,
        max(sess.updated_at) AS last_activity
      FROM auth.sessions sess
      WHERE sess.user_id = u.id
    ) s ON true
  );
END;
$$;

-- ── 4. Viewer read-only sulle tabelle owner ──
DO $$
DECLARE
    t text;
    user_tables text[] := ARRAY[
        'plants', 'plant_generation', 'stabilimenti',
        'stabilimento_load', 'simulation_config', 'hourly_telemetry'
    ];
BEGIN
    FOREACH t IN ARRAY user_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "owner insert" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "owner update" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "owner delete" ON public.%I', t);
        EXECUTE format('CREATE POLICY "owner insert" ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id AND (select public.get_my_role()) <> ''viewer'')', t);
        EXECUTE format('CREATE POLICY "owner update" ON public.%I FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id AND (select public.get_my_role()) <> ''viewer'') WITH CHECK ((select auth.uid()) = user_id)', t);
        EXECUTE format('CREATE POLICY "owner delete" ON public.%I FOR DELETE TO authenticated USING ((select auth.uid()) = user_id AND (select public.get_my_role()) <> ''viewer'')', t);
    END LOOP;
END $$;

-- ── 5. zonal_pun: scrittura solo admin ──
DO $$
DECLARE
    t text := 'zonal_pun';
BEGIN
    EXECUTE format('DROP POLICY IF EXISTS "auth insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "auth delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "admin insert" ON public.%I FOR INSERT TO authenticated WITH CHECK ((select public.get_my_role()) = ''admin'')', t);
    EXECUTE format('CREATE POLICY "admin update" ON public.%I FOR UPDATE TO authenticated USING ((select public.get_my_role()) = ''admin'') WITH CHECK ((select public.get_my_role()) = ''admin'')', t);
    EXECUTE format('CREATE POLICY "admin delete" ON public.%I FOR DELETE TO authenticated USING ((select public.get_my_role()) = ''admin'')', t);
END $$;

COMMIT;

-- Verifica post-migrazione (da eseguire separatamente):
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname='public' ORDER BY tablename, policyname;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ripristino editor full-write e zonal_pun condivisa):
--
-- BEGIN;
-- DO $$
-- DECLARE t text;
--     user_tables text[] := ARRAY['plants','plant_generation','stabilimenti','stabilimento_load','simulation_config','hourly_telemetry'];
-- BEGIN
--     FOREACH t IN ARRAY user_tables LOOP
--         EXECUTE format('DROP POLICY IF EXISTS "owner insert" ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "owner update" ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "owner delete" ON public.%I', t);
--         EXECUTE format('CREATE POLICY "owner insert" ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id)', t);
--         EXECUTE format('CREATE POLICY "owner update" ON public.%I FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id)', t);
--         EXECUTE format('CREATE POLICY "owner delete" ON public.%I FOR DELETE TO authenticated USING ((select auth.uid()) = user_id)', t);
--     END LOOP;
--     EXECUTE 'DROP POLICY IF EXISTS "admin insert" ON public.zonal_pun';
--     EXECUTE 'DROP POLICY IF EXISTS "admin update" ON public.zonal_pun';
--     EXECUTE 'DROP POLICY IF EXISTS "admin delete" ON public.zonal_pun';
--     EXECUTE 'CREATE POLICY "auth insert" ON public.zonal_pun FOR INSERT TO authenticated WITH CHECK (true)';
--     EXECUTE 'CREATE POLICY "auth update" ON public.zonal_pun FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
--     EXECUTE 'CREATE POLICY "auth delete" ON public.zonal_pun FOR DELETE TO authenticated USING (true)';
-- END $$;
-- DROP FUNCTION IF EXISTS public.admin_set_role(uuid, text);
-- DROP FUNCTION IF EXISTS public.get_my_role();
-- COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
