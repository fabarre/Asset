-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE / SCRIPT: Ereditarietà dati tra utenti (Multi-Tenancy)
-- AntiGravity Hybrid FV + BESS Simulator
--
-- COSA FA:
--   1. Trova gli UUID Supabase per 'fabarre@gmail.com' (sorgente) 
--      e 'fabio.barretta@renovato.it' (destinazione).
--   2. Garantisce che le Primary Key e vincoli Unique delle tabelle siano composite con `user_id`.
--   3. Duplica dinamicamente tutte le colonne e tutte le righe dalle tabelle:
--      - plants (3 impianti)
--      - plant_generation (26.280 record orari)
--      - stabilimenti (3 stabilimenti)
--      - stabilimento_load (26.280 record orari)
--      - simulation_config (98 parametri di configurazione)
--      - hourly_telemetry (8.760 ore di telemetria)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
    v_source_email text := 'fabarre@gmail.com';
    v_target_email text := 'fabio.barretta@renovato.it';
    v_source_id uuid;
    v_target_id uuid;
    t text;
    user_tables text[] := ARRAY[
        'plants', 'plant_generation', 'stabilimenti',
        'stabilimento_load', 'simulation_config', 'hourly_telemetry'
    ];
BEGIN
    -- 1. Recupero UUID degli utenti
    SELECT id INTO v_source_id FROM auth.users WHERE email = v_source_email LIMIT 1;
    SELECT id INTO v_target_id FROM auth.users WHERE email = v_target_email LIMIT 1;

    IF v_source_id IS NULL THEN
        RAISE EXCEPTION 'Utente sorgente % non trovato in auth.users', v_source_email;
    END IF;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'Utente destinazione % non trovato in auth.users', v_target_email;
    END IF;

    RAISE NOTICE 'Clonazione dati in corso da % (%) a % (%)', v_source_email, v_source_id, v_target_email, v_target_id;

    -- 2. Adeguamento vincoli Primary Key e Unique per supportare la multi-tenancy per-utente
    ALTER TABLE public.plants DROP CONSTRAINT IF EXISTS plants_pkey CASCADE;
    ALTER TABLE public.plants ADD PRIMARY KEY (id, user_id);

    ALTER TABLE public.plant_generation DROP CONSTRAINT IF EXISTS plant_generation_pkey CASCADE;
    ALTER TABLE public.plant_generation ADD PRIMARY KEY (plant_id, hour_index, user_id);

    ALTER TABLE public.stabilimenti DROP CONSTRAINT IF EXISTS stabilimenti_pkey CASCADE;
    ALTER TABLE public.stabilimenti ADD PRIMARY KEY (id, user_id);

    ALTER TABLE public.stabilimenti DROP CONSTRAINT IF EXISTS stabilimenti_plant_id_unique CASCADE;
    ALTER TABLE public.stabilimenti ADD CONSTRAINT stabilimenti_plant_id_user_id_unique UNIQUE (plant_id, user_id);

    ALTER TABLE public.stabilimento_load DROP CONSTRAINT IF EXISTS stabilimento_load_pkey CASCADE;
    ALTER TABLE public.stabilimento_load ADD PRIMARY KEY (stabilimento_id, hour_index, user_id);

    ALTER TABLE public.simulation_config DROP CONSTRAINT IF EXISTS simulation_config_pkey CASCADE;
    ALTER TABLE public.simulation_config ADD PRIMARY KEY (parameter_key, user_id);

    ALTER TABLE public.hourly_telemetry DROP CONSTRAINT IF EXISTS hourly_telemetry_pkey CASCADE;
    ALTER TABLE public.hourly_telemetry ADD PRIMARY KEY (hour_index, user_id);

    -- 3. Copia dinamica per ogni tabella
    FOREACH t IN ARRAY user_tables LOOP
        -- Pulizia dei dati preesistenti dell'utente destinazione (idempotenza)
        EXECUTE format('DELETE FROM public.%I WHERE user_id = %L', t, v_target_id);

        -- Copia di tutte le colonne sostituendo il valore di user_id
        EXECUTE format(
            'INSERT INTO public.%I SELECT %s FROM public.%I WHERE user_id = %L',
            t,
            (
                SELECT string_agg(
                    CASE 
                        WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                        ELSE quote_ident(column_name)
                    END,
                    ', '
                )
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t
            ),
            t,
            v_source_id
        );
        
        RAISE NOTICE 'Tabella % copiata con successo per %', t, v_target_email;
    END LOOP;

    RAISE NOTICE 'Operazione completata! L''utente % ora possiede la copia esatta dei dati di %', v_target_email, v_source_email;
END $$;

COMMIT;
