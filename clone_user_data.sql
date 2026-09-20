-- ═══════════════════════════════════════════════════════════════════════════
-- SCRIPT: Clonazione dati tra utenti (Multi-Tenancy)
-- AntiGravity Hybrid FV + BESS Simulator
--
-- SORGENTE:     fabarre@gmail.com
-- DESTINAZIONE: l.stadler@stafil.it
-- BACKUP PROD:  scratch/backups/2026-09-17T13-54-02_prod
--
-- COSA FA:
--   1. Risolve gli UUID Supabase per l'utente sorgente e destinazione.
--   2. Pulisce in ordine di dipendenza inversa i dati preesistenti dell'utente target.
--   3. Clona dinamicamente tutte le colonne di ogni tabella per-utente
--      (leggendo direttamente information_schema.columns con ordinamento posizionale):
--      - plants (impianti, inclusi cod_date, prod_multiplier, brp_fees, opex, ecc.)
--      - plant_generation (curve orarie 8760h per ogni impianto)
--      - plant_custom_costs (voci CAPEX/OPEX personalizzate con vat_rate e nuovo UUID)
--      - stabilimenti (off-taker industriali e associazione impianti)
--      - stabilimento_load (curve di carico 8760h per ogni stabilimento)
--      - simulation_config (parametri finanziari, scenari, capexpay, opexev, brand)
--      - hourly_telemetry (telemetria oraria calcolata)
--   4. Verifica e stampa il conteggio esatto delle righe clonate.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
    v_source_email text := 'fabarre@gmail.com';
    v_target_email text := 'l.stadler@stafil.it';
    v_source_id uuid;
    v_target_id uuid;
    t text;
    v_col_list text;
    v_select_list text;
    v_count_source integer;
    v_count_target integer;
    
    -- Ordine di pulizia (reverse dependency per rispettare foreign key):
    clean_tables text[] := ARRAY[
        'plant_custom_costs',
        'plant_generation',
        'stabilimento_load',
        'stabilimenti',
        'plants',
        'simulation_config',
        'hourly_telemetry'
    ];

    -- Ordine di inserimento (forward dependency):
    copy_tables text[] := ARRAY[
        'plants',
        'plant_generation',
        'plant_custom_costs',
        'stabilimenti',
        'stabilimento_load',
        'simulation_config',
        'hourly_telemetry'
    ];
BEGIN
    -- 1. Recupero UUID degli utenti da auth.users
    SELECT id INTO v_source_id FROM auth.users WHERE email = v_source_email LIMIT 1;
    SELECT id INTO v_target_id FROM auth.users WHERE email = v_target_email LIMIT 1;

    IF v_source_id IS NULL THEN
        RAISE EXCEPTION 'Utente sorgente % non trovato in auth.users', v_source_email;
    END IF;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'Utente destinazione % non trovato in auth.users', v_target_email;
    END IF;

    RAISE NOTICE '══════════════════════════════════════════════════════════════════';
    RAISE NOTICE 'Avvio clonazione dati:';
    RAISE NOTICE '  Sorgente:     % (%)', v_source_email, v_source_id;
    RAISE NOTICE '  Destinazione: % (%)', v_target_email, v_target_id;
    RAISE NOTICE '══════════════════════════════════════════════════════════════════';

    -- 2. Pulizia preventiva dati preesistenti dell'utente destinazione (idempotente)
    FOREACH t IN ARRAY clean_tables LOOP
        EXECUTE format('DELETE FROM public.%I WHERE user_id = %L', t, v_target_id);
    END LOOP;
    RAISE NOTICE 'Pulizia dati preesistenti per % completata.', v_target_email;

    -- 3. Copia dinamica colonna per colonna in ordine posizionale
    FOREACH t IN ARRAY copy_tables LOOP
        -- Costruzione lista colonne target e lista espressioni SELECT
        SELECT 
            string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
            string_agg(
                CASE 
                    WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                    WHEN t = 'plant_custom_costs' AND column_name = 'id' THEN 'gen_random_uuid() AS id'
                    ELSE quote_ident(column_name)
                END,
                ', '
                ORDER BY ordinal_position
            )
        INTO v_col_list, v_select_list
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t;

        IF v_col_list IS NULL THEN
            RAISE EXCEPTION 'Nessuna colonna trovata per la tabella public.%', t;
        END IF;

        -- Inserimento righe
        EXECUTE format(
            'INSERT INTO public.%I (%s) SELECT %s FROM public.%I WHERE user_id = %L',
            t, v_col_list, v_select_list, t, v_source_id
        );

        -- Verifica conteggi
        EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = %L', t, v_source_id) INTO v_count_source;
        EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = %L', t, v_target_id) INTO v_count_target;

        RAISE NOTICE 'Tabella %I: clonate %/% righe con successo.', t, v_count_target, v_count_source;
        
        IF v_count_source <> v_count_target THEN
            RAISE EXCEPTION 'Discrepanza righe su %: attese %, trovate %', t, v_count_source, v_count_target;
        END IF;
    END LOOP;

    -- 4. Assegna esplicitamente il ruolo 'editor' all'utente destinazione se non presente
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"editor"}'::jsonb
    WHERE id = v_target_id AND (raw_app_meta_data ->> 'role') IS NULL;

    RAISE NOTICE '══════════════════════════════════════════════════════════════════';
    RAISE NOTICE 'Clonazione completata al 100%% senza errori!';
    RAISE NOTICE 'L''utente % possiede ora la copia esatta dei dati di %', v_target_email, v_source_email;
    RAISE NOTICE '══════════════════════════════════════════════════════════════════';
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (in caso di necessità):
-- BEGIN;
-- DELETE FROM public.plant_custom_costs WHERE user_id = (SELECT id FROM auth.users WHERE email = 'l.stadler@stafil.it');
-- DELETE FROM public.plant_generation   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'l.stadler@stafil.it');
-- DELETE FROM public.stabilimento_load  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'l.stadler@stafil.it');
-- DELETE FROM public.stabilimenti       WHERE user_id = (SELECT id FROM auth.users WHERE email = 'l.stadler@stafil.it');
-- DELETE FROM public.plants             WHERE user_id = (SELECT id FROM auth.users WHERE email = 'l.stadler@stafil.it');
-- DELETE FROM public.simulation_config  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'l.stadler@stafil.it');
-- DELETE FROM public.hourly_telemetry   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'l.stadler@stafil.it');
-- COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
