-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Multi-tenancy selettiva (dati per-utente + listini globali)
-- AntiGravity Hybrid FV + BESS Simulator
--
-- PER-UTENTE (owner = auth.uid()): plants, plant_generation, stabilimenti,
--   stabilimento_load, simulation_config (config/scenari/audit), hourly_telemetry
-- GLOBALE CONDIVISO: zonal_pun (listini prezzi — lettura/scrittura autenticati)
--
-- Backfill: tutte le righe esistenti vengono assegnate all'utente
--   fabarre@gmail.com (admin). I nuovi utenti partono da portafoglio vuoto
--   + configurazione default (seminata dall'app al primo login).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Colonne user_id ──
ALTER TABLE public.plants             ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.plant_generation   ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.stabilimenti       ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.stabilimento_load  ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.simulation_config  ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.hourly_telemetry   ADD COLUMN IF NOT EXISTS user_id uuid;

-- ── 2. Backfill verso admin ──
DO $$
DECLARE
    admin_id uuid;
BEGIN
    SELECT id INTO admin_id FROM auth.users WHERE email = 'fabarre@gmail.com' LIMIT 1;
    IF admin_id IS NULL THEN
        RAISE EXCEPTION 'Utente fabarre@gmail.com non trovato in auth.users';
    END IF;
    EXECUTE format('UPDATE public.plants            SET user_id = %L WHERE user_id IS NULL', admin_id);
    EXECUTE format('UPDATE public.plant_generation  SET user_id = %L WHERE user_id IS NULL', admin_id);
    EXECUTE format('UPDATE public.stabilimenti      SET user_id = %L WHERE user_id IS NULL', admin_id);
    EXECUTE format('UPDATE public.stabilimento_load SET user_id = %L WHERE user_id IS NULL', admin_id);
    EXECUTE format('UPDATE public.simulation_config SET user_id = %L WHERE user_id IS NULL', admin_id);
    EXECUTE format('UPDATE public.hourly_telemetry  SET user_id = %L WHERE user_id IS NULL', admin_id);
END $$;

-- ── 3. Vincoli: PK composite dove serve ──
ALTER TABLE public.simulation_config DROP CONSTRAINT simulation_config_pkey;
ALTER TABLE public.simulation_config ADD PRIMARY KEY (parameter_key, user_id);

ALTER TABLE public.hourly_telemetry DROP CONSTRAINT hourly_telemetry_pkey;
ALTER TABLE public.hourly_telemetry ADD PRIMARY KEY (hour_index, user_id);

-- NOT NULL dopo backfill (le nuove scritture lo impostano sempre)
ALTER TABLE public.plants             ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.plant_generation   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.stabilimenti       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.stabilimento_load  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.simulation_config  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.hourly_telemetry   ALTER COLUMN user_id SET NOT NULL;

-- ── 4. Indici per le policy ──
CREATE INDEX IF NOT EXISTS idx_plants_user             ON public.plants (user_id);
CREATE INDEX IF NOT EXISTS idx_plant_generation_user   ON public.plant_generation (user_id);
CREATE INDEX IF NOT EXISTS idx_stabilimenti_user       ON public.stabilimenti (user_id);
CREATE INDEX IF NOT EXISTS idx_stabilimento_load_user  ON public.stabilimento_load (user_id);
CREATE INDEX IF NOT EXISTS idx_simulation_config_user  ON public.simulation_config (user_id);
CREATE INDEX IF NOT EXISTS idx_hourly_telemetry_user   ON public.hourly_telemetry (user_id);

-- ── 5. Policy: ownership per tabelle utente, globali per zonal_pun ──
DO $$
DECLARE
    t text;
    user_tables text[] := ARRAY[
        'plants', 'plant_generation', 'stabilimenti',
        'stabilimento_load', 'simulation_config', 'hourly_telemetry'
    ];
BEGIN
    FOREACH t IN ARRAY user_tables LOOP
        EXECUTE format('DROP POLICY IF EXISTS "auth read"   ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth insert" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth update" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "auth delete" ON public.%I', t);
        -- varianti legacy (progetti senza migration_auth_rls)
        EXECUTE format('DROP POLICY IF EXISTS "Allow read for anon/auth"   ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow insert for anon/auth" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow update for anon/auth" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow delete for anon/auth" ON public.%I', t);
        -- idempotenza: drop anche eventuali owner policy preesistenti
        EXECUTE format('DROP POLICY IF EXISTS "owner read"   ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "owner insert" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "owner update" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "owner delete" ON public.%I', t);

        EXECUTE format('CREATE POLICY "owner read"   ON public.%I FOR SELECT TO authenticated USING ((select auth.uid()) = user_id)', t);
        EXECUTE format('CREATE POLICY "owner insert" ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id)', t);
        EXECUTE format('CREATE POLICY "owner update" ON public.%I FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id)', t);
        EXECUTE format('CREATE POLICY "owner delete" ON public.%I FOR DELETE TO authenticated USING ((select auth.uid()) = user_id)', t);
    END LOOP;
END $$;

-- zonal_pun resta globale: policy "auth *" esistenti invariate (lettura/scrittura autenticati)

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ripristino workspace condiviso — decommentare ed eseguire):
--
-- BEGIN;
-- ALTER TABLE public.simulation_config DROP CONSTRAINT simulation_config_pkey;
-- ALTER TABLE public.simulation_config ADD PRIMARY KEY (parameter_key);
-- ALTER TABLE public.hourly_telemetry DROP CONSTRAINT hourly_telemetry_pkey;
-- ALTER TABLE public.hourly_telemetry ADD PRIMARY KEY (hour_index);
-- DO $$
-- DECLARE t text;
--     user_tables text[] := ARRAY['plants','plant_generation','stabilimenti','stabilimento_load','simulation_config','hourly_telemetry'];
-- BEGIN
--     FOREACH t IN ARRAY user_tables LOOP
--         EXECUTE format('DROP POLICY IF EXISTS "owner read"   ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "owner insert" ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "owner update" ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "owner delete" ON public.%I', t);
--         EXECUTE format('CREATE POLICY "auth read"   ON public.%I FOR SELECT TO authenticated USING (true)', t);
--         EXECUTE format('CREATE POLICY "auth insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t);
--         EXECUTE format('CREATE POLICY "auth update" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
--         EXECUTE format('CREATE POLICY "auth delete" ON public.%I FOR DELETE TO authenticated USING (true)', t);
--         EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id DROP NOT NULL', t);
--     END LOOP;
-- END $$;
-- COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
