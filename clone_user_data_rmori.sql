-- ═══════════════════════════════════════════════════════════════════════════
-- SCRIPT: Clonazione selettiva dati tra utenti (Multi-Tenancy)
-- AntiGravity Hybrid FV + BESS Simulator
--
-- SORGENTE:     fabarre@gmail.com
-- DESTINAZIONE: r.mori@benacoenergia.it
-- ESCLUSIONI:   Impianti e stabilimenti di Castenaso e Guasticce
-- BACKUP PROD:  scratch/backups/2026-10-22T07-50-58_prod
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
    v_source_email text := 'fabarre@gmail.com';
    v_target_email text := 'r.mori@benacoenergia.it';
    v_source_id uuid;
    v_target_id uuid;
    v_col_list text;
    v_select_list text;
    t text;
    v_cnt integer;
    
    clean_tables text[] := ARRAY[
        'plant_custom_costs',
        'plant_generation',
        'stabilimento_load',
        'stabilimenti',
        'plants',
        'simulation_config',
        'hourly_telemetry'
    ];
BEGIN
    -- 1. Risoluzione UUID utenti
    SELECT id INTO v_source_id FROM auth.users WHERE email = v_source_email LIMIT 1;
    SELECT id INTO v_target_id FROM auth.users WHERE email = v_target_email LIMIT 1;

    IF v_source_id IS NULL THEN
        RAISE EXCEPTION 'Utente sorgente % non trovato in auth.users', v_source_email;
    END IF;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'Utente destinazione % non trovato in auth.users', v_target_email;
    END IF;

    RAISE NOTICE '══════════════════════════════════════════════════════════════════';
    RAISE NOTICE 'Avvio clonazione selettiva dati:';
    RAISE NOTICE '  Sorgente:     % (%)', v_source_email, v_source_id;
    RAISE NOTICE '  Destinazione: % (%)', v_target_email, v_target_id;
    RAISE NOTICE '  Esclusioni:   Castenaso, Guasticce';
    RAISE NOTICE '══════════════════════════════════════════════════════════════════';

    -- 2. Pulizia preventiva dati preesistenti dell'utente destinazione (idempotente)
    FOREACH t IN ARRAY clean_tables LOOP
        EXECUTE format('DELETE FROM public.%I WHERE user_id = %L', t, v_target_id);
    END LOOP;
    RAISE NOTICE 'Pulizia dati preesistenti per % completata.', v_target_email;

    -- 3. Clona public.plants (escludendo Castenaso e Guasticce)
    SELECT 
        string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
        string_agg(
            CASE 
                WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                ELSE quote_ident(column_name)
            END,
            ', '
            ORDER BY ordinal_position
        )
    INTO v_col_list, v_select_list
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plants';

    EXECUTE format(
        'INSERT INTO public.plants (%s) 
         SELECT %s 
         FROM public.plants 
         WHERE user_id = %L 
           AND name NOT ILIKE ''%%Castenaso%%'' 
           AND name NOT ILIKE ''%%Guasticce%%''',
        v_col_list, v_select_list, v_source_id
    );
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE 'Tabella plants: clonate % righe (Manerbio CER).', v_cnt;

    -- 4. Clona public.plant_generation (solo per gli impianti clonati)
    SELECT 
        string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
        string_agg(
            CASE 
                WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                ELSE quote_ident(column_name)
            END,
            ', '
            ORDER BY ordinal_position
        )
    INTO v_col_list, v_select_list
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plant_generation';

    EXECUTE format(
        'INSERT INTO public.plant_generation (%s) 
         SELECT %s 
         FROM public.plant_generation 
         WHERE user_id = %L 
           AND plant_id IN (SELECT id FROM public.plants WHERE user_id = %L)',
        v_col_list, v_select_list, v_source_id, v_target_id
    );
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE 'Tabella plant_generation: clonate % righe.', v_cnt;

    -- 5. Clona public.plant_custom_costs (se presenti per gli impianti clonati)
    SELECT 
        string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
        string_agg(
            CASE 
                WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                WHEN column_name = 'id' THEN 'gen_random_uuid() AS id'
                ELSE quote_ident(column_name)
            END,
            ', '
            ORDER BY ordinal_position
        )
    INTO v_col_list, v_select_list
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plant_custom_costs';

    EXECUTE format(
        'INSERT INTO public.plant_custom_costs (%s) 
         SELECT %s 
         FROM public.plant_custom_costs 
         WHERE user_id = %L 
           AND plant_id IN (SELECT id FROM public.plants WHERE user_id = %L)',
        v_col_list, v_select_list, v_source_id, v_target_id
    );
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE 'Tabella plant_custom_costs: clonate % righe.', v_cnt;

    -- 6. Clona public.stabilimenti (escludendo Castenaso e Guasticce)
    SELECT 
        string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
        string_agg(
            CASE 
                WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                ELSE quote_ident(column_name)
            END,
            ', '
            ORDER BY ordinal_position
        )
    INTO v_col_list, v_select_list
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stabilimenti';

    EXECUTE format(
        'INSERT INTO public.stabilimenti (%s) 
         SELECT %s 
         FROM public.stabilimenti 
         WHERE user_id = %L 
           AND name NOT ILIKE ''%%Castenaso%%'' 
           AND name NOT ILIKE ''%%Guasticce%%''
           AND plant_id IN (SELECT id FROM public.plants WHERE user_id = %L)',
        v_col_list, v_select_list, v_source_id, v_target_id
    );
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE 'Tabella stabilimenti: clonate % righe (Manerbio CER).', v_cnt;

    -- 7. Clona public.stabilimento_load (solo per gli stabilimenti clonati)
    SELECT 
        string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
        string_agg(
            CASE 
                WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                ELSE quote_ident(column_name)
            END,
            ', '
            ORDER BY ordinal_position
        )
    INTO v_col_list, v_select_list
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stabilimento_load';

    EXECUTE format(
        'INSERT INTO public.stabilimento_load (%s) 
         SELECT %s 
         FROM public.stabilimento_load 
         WHERE user_id = %L 
           AND stabilimento_id IN (SELECT id FROM public.stabilimenti WHERE user_id = %L)',
        v_col_list, v_select_list, v_source_id, v_target_id
    );
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE 'Tabella stabilimento_load: clonate % righe.', v_cnt;

    -- 8. Clona public.simulation_config
    -- Esclude capexpay/opexev per impianti non presenti, e filtra audit logs non pertinenti
    SELECT 
        string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
        string_agg(
            CASE 
                WHEN column_name = 'user_id' THEN quote_literal(v_target_id) || '::uuid AS user_id'
                ELSE quote_ident(column_name)
            END,
            ', '
            ORDER BY ordinal_position
        )
    INTO v_col_list, v_select_list
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'simulation_config';

    EXECUTE format(
        'INSERT INTO public.simulation_config (%s) 
         SELECT %s 
         FROM public.simulation_config 
         WHERE user_id = %L 
           AND parameter_key NOT LIKE ''capexpay::%%''
           AND parameter_key NOT LIKE ''opexev::%%''
           AND parameter_key NOT IN (''disabledPlants'', ''disabledStabilimenti'', ''selectedBessPlantIds'', ''selectedGmePlantIds'')
           AND (parameter_key NOT LIKE ''audit::%%'' OR (parameter_value NOT LIKE ''%%Castenaso%%'' AND parameter_value NOT LIKE ''%%Guasticce%%''))',
        v_col_list, v_select_list, v_source_id
    );
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    RAISE NOTICE 'Tabella simulation_config (parametri generali): clonate % righe.', v_cnt;

    -- Inserisci configurazioni di selezione impianti appropriate per il target
    INSERT INTO public.simulation_config (parameter_key, parameter_value, user_id, updated_at)
    VALUES 
        ('disabledPlants', '[]', v_target_id, now()),
        ('disabledStabilimenti', '[]', v_target_id, now()),
        ('selectedBessPlantIds', '["plant-1780309918035"]', v_target_id, now()),
        ('selectedGmePlantIds', '["plant-1780309918035"]', v_target_id, now())
    ON CONFLICT (parameter_key, user_id) 
    DO UPDATE SET parameter_value = EXCLUDED.parameter_value, updated_at = now();
    RAISE NOTICE 'Tabella simulation_config: configurata attivazione Manerbio CER.';

    -- 9. Assegna il ruolo "editor" all''utente in auth.users se non presente
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"editor"}'::jsonb
    WHERE id = v_target_id AND (raw_app_meta_data ->> 'role') IS NULL;
    RAISE NOTICE 'Ruolo editor assegnato a % in auth.users.', v_target_email;

    RAISE NOTICE '══════════════════════════════════════════════════════════════════';
    RAISE NOTICE 'Clonazione selettiva completata al 100%% senza errori!';
    RAISE NOTICE '══════════════════════════════════════════════════════════════════';
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (in caso di necessità):
-- BEGIN;
-- DELETE FROM public.plant_custom_costs WHERE user_id = '2c070643-f901-41f1-85eb-ef1b23510688';
-- DELETE FROM public.plant_generation   WHERE user_id = '2c070643-f901-41f1-85eb-ef1b23510688';
-- DELETE FROM public.stabilimento_load  WHERE user_id = '2c070643-f901-41f1-85eb-ef1b23510688';
-- DELETE FROM public.stabilimenti       WHERE user_id = '2c070643-f901-41f1-85eb-ef1b23510688';
-- DELETE FROM public.plants             WHERE user_id = '2c070643-f901-41f1-85eb-ef1b23510688';
-- DELETE FROM public.simulation_config  WHERE user_id = '2c070643-f901-41f1-85eb-ef1b23510688';
-- DELETE FROM public.hourly_telemetry   WHERE user_id = '2c070643-f901-41f1-85eb-ef1b23510688';
-- COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
