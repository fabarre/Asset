-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Least privilege per il ruolo anon (hardening residuo)
-- AntiGravity Hybrid FV + BESS Simulator — PRODUZIONE
--
-- CONTESTO (audit STEP 0.1/A2): le policy RLS owner-based sono già attive e
-- anon non ha GRANT di SELECT/INSERT/UPDATE/DELETE. Restano però i GRANT
-- residui REFERENCES, TRIGGER e TRUNCATE (eredità dei GRANT ALL originali).
-- TRUNCATE in particolare NON è soggetto a RLS: va revocato per difesa in
-- profondità. REFERENCES/TRIGGER non sono esponibili via PostgREST ma sono
-- privilegi inutili per il ruolo anonimo.
--
-- PREVENTIVO: eseguito dopo backup completo
--   (tools/backup.mjs run prod -> scratch/backups/<timestamp>_prod).
--
-- ROLLBACK: sezione commentata in fondo al file.
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
        EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon', t);
    END LOOP;
END $$;

COMMIT;

-- Verifica post-migrazione (da eseguire separatamente):
--   SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
--   FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND grantee='anon'
--   GROUP BY grantee, table_name ORDER BY table_name;
-- Atteso: nessuna riga (zero privilegi per anon).

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (ripristino GRANT residui — decommentare ed eseguire):
--
-- BEGIN;
-- DO $$
-- DECLARE
--     t text;
--     tables text[] := ARRAY['hourly_telemetry','plant_generation','plants',
--         'simulation_config','stabilimenti','stabilimento_load','zonal_pun'];
-- BEGIN
--     FOREACH t IN ARRAY tables LOOP
--         EXECUTE format('GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I TO anon', t);
--     END LOOP;
-- END $$;
-- COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
