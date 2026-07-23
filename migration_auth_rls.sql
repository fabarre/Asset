-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Autenticazione & RLS restrittive
-- AntiGravity Hybrid FV + BESS Simulator
--
-- COSA FA: sostituisce le policy permissive ("Allow ... for anon/auth", accesso
-- anonimo completo) con policy riservate al ruolo `authenticated`.
-- Dopo questa migrazione SOLO gli utenti autenticati possono leggere/scrivere.
--
-- PREREQUISITI (fare PRIMA in Supabase Dashboard):
--   1. Authentication → Users → "Add user" → creare almeno un utente email/password
--      (oppure usare il tasto "Registra nuovo utente" nella schermata di login
--       dell'app, e poi disabilitare i signup pubblici in
--       Authentication → Sign In / Providers → Email → "Allow new users to sign up")
--   2. Eseguire questo script in SQL Editor.
--
-- ROLLBACK: in fondo al file c'è la sezione di ripristino (commentata).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'hourly_telemetry',
        'plant_generation',
        'plants',
        'simulation_config',
        'stabilimenti',
        'stabilimento_load',
        'zonal_pun'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        -- 1. Rimuove le vecchie policy permissive (anon + authenticated)
        EXECUTE format('DROP POLICY IF EXISTS "Allow read for anon/auth"   ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow insert for anon/auth" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow update for anon/auth" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow delete for anon/auth" ON public.%I', t);

        -- 2. Crea policy solo-authenticated (workspace condiviso tra utenti loggati)
        EXECUTE format('CREATE POLICY "auth read"   ON public.%I FOR SELECT TO authenticated USING (true)', t);
        EXECUTE format('CREATE POLICY "auth insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t);
        EXECUTE format('CREATE POLICY "auth update" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
        EXECUTE format('CREATE POLICY "auth delete" ON public.%I FOR DELETE TO authenticated USING (true)', t);

        -- 3. Permessi di ruolo: revoca scrittura agli anon, grant agli autenticati
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon', t);
        EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    END LOOP;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ripristino accesso anonimo completo — decommentare ed eseguire):
--
-- DO $$
-- DECLARE
--     t text;
--     tables text[] := ARRAY['hourly_telemetry','plant_generation','plants','simulation_config','stabilimenti','stabilimento_load','zonal_pun'];
-- BEGIN
--     FOREACH t IN ARRAY tables LOOP
--         EXECUTE format('DROP POLICY IF EXISTS "auth read"   ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "auth insert" ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "auth update" ON public.%I', t);
--         EXECUTE format('DROP POLICY IF EXISTS "auth delete" ON public.%I', t);
--         EXECUTE format('CREATE POLICY "Allow read for anon/auth"   ON public.%I FOR SELECT TO authenticated, anon USING (true)', t);
--         EXECUTE format('CREATE POLICY "Allow insert for anon/auth" ON public.%I FOR INSERT TO authenticated, anon WITH CHECK (true)', t);
--         EXECUTE format('CREATE POLICY "Allow update for anon/auth" ON public.%I FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true)', t);
--         EXECUTE format('CREATE POLICY "Allow delete for anon/auth" ON public.%I FOR DELETE TO authenticated, anon USING (true)', t);
--         EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO anon', t);
--     END LOOP;
-- END $$;
-- ═══════════════════════════════════════════════════════════════════════════
