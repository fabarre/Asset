


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."hourly_telemetry" (
    "hour_index" integer NOT NULL,
    "generation_kw" numeric(12,4) NOT NULL,
    "price_eur_mwh" numeric(12,4) NOT NULL,
    "bess_soc_kwh" numeric(12,4) NOT NULL,
    "bess_charge_kw" numeric(12,4) NOT NULL,
    "bess_discharge_kw" numeric(12,4) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "bess_charge_solar_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "bess_charge_grid_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "bess_discharge_grid_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "bess_discharge_ppa_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "self_consumption_solar_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "self_consumption_bess_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "bess_losses_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "pv_grid_feed_kw" numeric(12,4) DEFAULT 0 NOT NULL,
    "revenue_rid_pure_eur" numeric(12,4) DEFAULT 0 NOT NULL,
    "revenue_rid_actual_eur" numeric(12,4) DEFAULT 0 NOT NULL,
    "revenue_arbitrage_grid_eur" numeric(12,4) DEFAULT 0 NOT NULL,
    "revenue_ppa_pv_eur" numeric(12,4) DEFAULT 0 NOT NULL,
    "revenue_ppa_bess_eur" numeric(12,4) DEFAULT 0 NOT NULL,
    "revenue_timeshifting_eur" numeric(12,4) DEFAULT 0 NOT NULL,
    "cost_withdrawal_bess_eur" numeric(12,4) DEFAULT 0 NOT NULL,
    CONSTRAINT "hourly_telemetry_hour_index_check" CHECK ((("hour_index" >= 0) AND ("hour_index" < 8760)))
);


ALTER TABLE "public"."hourly_telemetry" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plant_generation" (
    "plant_id" character varying(255) NOT NULL,
    "hour_index" integer NOT NULL,
    "generation_kw" numeric(12,4) NOT NULL,
    CONSTRAINT "plant_generation_hour_index_check" CHECK ((("hour_index" >= 0) AND ("hour_index" < 8760)))
);


ALTER TABLE "public"."plant_generation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plants" (
    "id" character varying(255) NOT NULL,
    "name" character varying(255) NOT NULL,
    "capacity_kwp" numeric(12,4) NOT NULL,
    "zone" character varying(50) NOT NULL,
    "capex_kwp" numeric(12,4) NOT NULL,
    "opex_eur" numeric(12,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "connection_cost_eur" numeric(12,4) DEFAULT 0,
    "land_type" character varying(50) DEFAULT 'acquisto'::character varying,
    "land_cost_eur" numeric(12,4) DEFAULT 0,
    "development_cost_eur" numeric(12,4) DEFAULT 0,
    "spv_acquisition_cost_eur" numeric(12,4) DEFAULT 0,
    "bess_mw" numeric(12,4) DEFAULT 0,
    "bess_mwh" numeric(12,4) DEFAULT 0,
    "bess_efficiency" numeric(12,4) DEFAULT 0.90,
    "bess_degradation" numeric(12,4) DEFAULT 0.018,
    "bess_capex_kwh" numeric(12,4) DEFAULT 300,
    "bess_type" character varying(50) DEFAULT 'lfp'::character varying,
    "bess_connection" character varying(50) DEFAULT 'ac'::character varying,
    "grid_connection_kw" numeric(12,2) DEFAULT 0,
    "grid_voltage" "text" DEFAULT 'none'::"text",
    "inverter_brand" "text" DEFAULT ''::"text",
    "inverter_model" "text" DEFAULT ''::"text",
    "inverter_power_kw" numeric(12,2) DEFAULT 0,
    "inverter_efficiency" numeric(6,3) DEFAULT 0,
    "inverter_mppt_count" integer DEFAULT 0,
    "inverter_max_dc_v" numeric(8,2) DEFAULT 0,
    "bess_dod" numeric(6,2) DEFAULT 0,
    "bess_soc_min" numeric(6,2) DEFAULT 0,
    "bess_soc_max" numeric(6,2) DEFAULT 0,
    "bess_temp_min" numeric(6,2) DEFAULT 0,
    "bess_temp_max" numeric(6,2) DEFAULT 0,
    "bess_cycles" integer DEFAULT 0,
    "bess_warranty_years" integer DEFAULT 0,
    "pvgis_latitude" numeric(10,6) DEFAULT NULL::numeric,
    "pvgis_longitude" numeric(10,6) DEFAULT NULL::numeric,
    "pvgis_elevation" numeric(8,2) DEFAULT NULL::numeric,
    "pvgis_slope" numeric(6,2) DEFAULT NULL::numeric,
    "pvgis_azimuth" "text",
    "pvgis_system_losses" numeric(6,2) DEFAULT NULL::numeric,
    "pvgis_tracking" "text",
    "pvgis_database" "text",
    "pvgis_yield" numeric(10,2) DEFAULT NULL::numeric,
    "pvgis_annual_production" numeric(12,2) DEFAULT NULL::numeric,
    "opex_om_bess" numeric(12,4) DEFAULT 0,
    "opex_insurance" numeric(12,4) DEFAULT 0,
    "opex_taxes" numeric(12,4) DEFAULT 0,
    "opex_security" numeric(12,4) DEFAULT 0,
    "opex_asset_management" numeric(12,4) DEFAULT 0,
    "earnout_type" "text" DEFAULT 'none'::"text" NOT NULL,
    "earnout_val" numeric(12,4) DEFAULT 0 NOT NULL,
    "service_type" "text" DEFAULT 'none'::"text" NOT NULL,
    "service_val" numeric(12,4) DEFAULT 0 NOT NULL,
    "earnout_years" integer DEFAULT 20 NOT NULL,
    "service_years" integer DEFAULT 20 NOT NULL,
    "trader_contract_type" "text" DEFAULT 'pun_orario'::"text" NOT NULL,
    "trader_spread_eur_mwh" numeric(12,4) DEFAULT 0 NOT NULL,
    "trader_disp_eur_mwh" numeric(12,4) DEFAULT 0 NOT NULL,
    "grid_losses_pct" numeric(12,4) DEFAULT 0 NOT NULL,
    "gse_imbalance_eur_mwh" numeric(12,4) DEFAULT 0 NOT NULL,
    "degrade_rid_pct" numeric(12,4) DEFAULT 2.0 NOT NULL,
    "degrade_timeshifting_pct" numeric(12,4) DEFAULT 2.0 NOT NULL,
    "degrade_arbitrage_pct" numeric(12,4) DEFAULT 2.0 NOT NULL,
    "pnrr_contribution_pct" numeric(12,4) DEFAULT 0 NOT NULL,
    "market_type" character varying(50) DEFAULT 'rid'::character varying NOT NULL,
    "ferx_tariff_eur_mwh" numeric(12,4) DEFAULT 60.0 NOT NULL
);


ALTER TABLE "public"."plants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."simulation_config" (
    "parameter_key" character varying(255) NOT NULL,
    "parameter_value" character varying(255) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."simulation_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stabilimenti" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "plant_id" "text" NOT NULL,
    "ppa_type" "text" DEFAULT 'on-site'::"text" NOT NULL,
    "ppa_price" numeric(10,4) DEFAULT 0 NOT NULL,
    "ppa_duration" integer DEFAULT 15 NOT NULL,
    "annual_consumption_mwh" numeric(12,4) DEFAULT 0,
    "works_saturday" boolean DEFAULT false,
    "works_sunday" boolean DEFAULT false,
    "works_holidays" boolean DEFAULT false,
    "shift_type" "text" DEFAULT 'office'::"text",
    "load_source" "text" DEFAULT 'generated'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "cer_share_type" "text" DEFAULT 'shared_energy'::"text" NOT NULL
);


ALTER TABLE "public"."stabilimenti" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stabilimento_load" (
    "stabilimento_id" "text" NOT NULL,
    "hour_index" integer NOT NULL,
    "load_kw" numeric(10,4) DEFAULT 0 NOT NULL,
    CONSTRAINT "stabilimento_load_hour_index_check" CHECK ((("hour_index" >= 0) AND ("hour_index" < 8760)))
);


ALTER TABLE "public"."stabilimento_load" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."zonal_pun" (
    "hour_index" integer NOT NULL,
    "nord" numeric(12,4) NOT NULL,
    "cnor" numeric(12,4) NOT NULL,
    "csud" numeric(12,4) NOT NULL,
    "sud" numeric(12,4) NOT NULL,
    "sici" numeric(12,4) NOT NULL,
    "sard" numeric(12,4) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "zonal_pun_hour_index_check" CHECK ((("hour_index" >= 0) AND ("hour_index" < 8760)))
);


ALTER TABLE "public"."zonal_pun" OWNER TO "postgres";


ALTER TABLE ONLY "public"."hourly_telemetry"
    ADD CONSTRAINT "hourly_telemetry_pkey" PRIMARY KEY ("hour_index");



ALTER TABLE ONLY "public"."plant_generation"
    ADD CONSTRAINT "plant_generation_pkey" PRIMARY KEY ("plant_id", "hour_index");



ALTER TABLE ONLY "public"."plants"
    ADD CONSTRAINT "plants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."simulation_config"
    ADD CONSTRAINT "simulation_config_pkey" PRIMARY KEY ("parameter_key");



ALTER TABLE ONLY "public"."stabilimenti"
    ADD CONSTRAINT "stabilimenti_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stabilimenti"
    ADD CONSTRAINT "stabilimenti_plant_id_unique" UNIQUE ("plant_id");



ALTER TABLE ONLY "public"."stabilimento_load"
    ADD CONSTRAINT "stabilimento_load_pkey" PRIMARY KEY ("stabilimento_id", "hour_index");



ALTER TABLE ONLY "public"."zonal_pun"
    ADD CONSTRAINT "zonal_pun_pkey" PRIMARY KEY ("hour_index");



CREATE INDEX "idx_plant_generation_plant_id" ON "public"."plant_generation" USING "btree" ("plant_id");



CREATE INDEX "idx_stabilimenti_plant_id" ON "public"."stabilimenti" USING "btree" ("plant_id");



CREATE INDEX "idx_stabilimento_load_hour" ON "public"."stabilimento_load" USING "btree" ("stabilimento_id", "hour_index");



CREATE INDEX "idx_stabilimento_load_stab_id" ON "public"."stabilimento_load" USING "btree" ("stabilimento_id");



ALTER TABLE ONLY "public"."stabilimento_load"
    ADD CONSTRAINT "fk_stabilimento_load_stab" FOREIGN KEY ("stabilimento_id") REFERENCES "public"."stabilimenti"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plant_generation"
    ADD CONSTRAINT "plant_generation_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE CASCADE;



CREATE POLICY "Allow delete for anon/auth" ON "public"."hourly_telemetry" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow delete for anon/auth" ON "public"."plant_generation" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow delete for anon/auth" ON "public"."plants" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow delete for anon/auth" ON "public"."simulation_config" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow delete for anon/auth" ON "public"."stabilimenti" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow delete for anon/auth" ON "public"."stabilimento_load" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow delete for anon/auth" ON "public"."zonal_pun" FOR DELETE TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow insert for anon/auth" ON "public"."hourly_telemetry" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow insert for anon/auth" ON "public"."plant_generation" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow insert for anon/auth" ON "public"."plants" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow insert for anon/auth" ON "public"."simulation_config" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow insert for anon/auth" ON "public"."stabilimenti" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow insert for anon/auth" ON "public"."stabilimento_load" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow insert for anon/auth" ON "public"."zonal_pun" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Allow read for anon/auth" ON "public"."hourly_telemetry" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow read for anon/auth" ON "public"."plant_generation" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow read for anon/auth" ON "public"."plants" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow read for anon/auth" ON "public"."simulation_config" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow read for anon/auth" ON "public"."stabilimenti" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow read for anon/auth" ON "public"."stabilimento_load" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow read for anon/auth" ON "public"."zonal_pun" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Allow update for anon/auth" ON "public"."hourly_telemetry" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow update for anon/auth" ON "public"."plant_generation" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow update for anon/auth" ON "public"."plants" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow update for anon/auth" ON "public"."simulation_config" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow update for anon/auth" ON "public"."stabilimenti" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow update for anon/auth" ON "public"."stabilimento_load" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow update for anon/auth" ON "public"."zonal_pun" FOR UPDATE TO "authenticated", "anon" USING (true) WITH CHECK (true);



ALTER TABLE "public"."hourly_telemetry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plant_generation" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."simulation_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stabilimenti" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stabilimento_load" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."zonal_pun" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


















GRANT ALL ON TABLE "public"."hourly_telemetry" TO "anon";
GRANT ALL ON TABLE "public"."hourly_telemetry" TO "authenticated";
GRANT ALL ON TABLE "public"."hourly_telemetry" TO "service_role";



GRANT ALL ON TABLE "public"."plant_generation" TO "anon";
GRANT ALL ON TABLE "public"."plant_generation" TO "authenticated";
GRANT ALL ON TABLE "public"."plant_generation" TO "service_role";



GRANT ALL ON TABLE "public"."plants" TO "anon";
GRANT ALL ON TABLE "public"."plants" TO "authenticated";
GRANT ALL ON TABLE "public"."plants" TO "service_role";



GRANT ALL ON TABLE "public"."simulation_config" TO "anon";
GRANT ALL ON TABLE "public"."simulation_config" TO "authenticated";
GRANT ALL ON TABLE "public"."simulation_config" TO "service_role";



GRANT ALL ON TABLE "public"."stabilimenti" TO "anon";
GRANT ALL ON TABLE "public"."stabilimenti" TO "authenticated";
GRANT ALL ON TABLE "public"."stabilimenti" TO "service_role";



GRANT ALL ON TABLE "public"."stabilimento_load" TO "anon";
GRANT ALL ON TABLE "public"."stabilimento_load" TO "authenticated";
GRANT ALL ON TABLE "public"."stabilimento_load" TO "service_role";



GRANT ALL ON TABLE "public"."zonal_pun" TO "anon";
GRANT ALL ON TABLE "public"."zonal_pun" TO "authenticated";
GRANT ALL ON TABLE "public"."zonal_pun" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































-- 1. Enable Row Level Security (RLS) on all public tables
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zonal_pun ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stabilimenti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stabilimento_load ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourly_telemetry ENABLE ROW LEVEL SECURITY;

-- 2. Create permissive policies for 'anon' and 'authenticated' roles
-- (Required since the client browser app reads/writes data directly using the anon API key)

-- Policies for plants
CREATE POLICY "Allow read for anon/auth" ON public.plants FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.plants FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.plants FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.plants FOR DELETE TO anon, authenticated USING (true);

-- Policies for plant_generation
CREATE POLICY "Allow read for anon/auth" ON public.plant_generation FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.plant_generation FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.plant_generation FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.plant_generation FOR DELETE TO anon, authenticated USING (true);

-- Policies for zonal_pun
CREATE POLICY "Allow read for anon/auth" ON public.zonal_pun FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.zonal_pun FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.zonal_pun FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.zonal_pun FOR DELETE TO anon, authenticated USING (true);

-- Policies for simulation_config
CREATE POLICY "Allow read for anon/auth" ON public.simulation_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.simulation_config FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.simulation_config FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.simulation_config FOR DELETE TO anon, authenticated USING (true);

-- Policies for stabilimenti
CREATE POLICY "Allow read for anon/auth" ON public.stabilimenti FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.stabilimenti FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.stabilimenti FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.stabilimenti FOR DELETE TO anon, authenticated USING (true);

-- Policies for stabilimento_load
CREATE POLICY "Allow read for anon/auth" ON public.stabilimento_load FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.stabilimento_load FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.stabilimento_load FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.stabilimento_load FOR DELETE TO anon, authenticated USING (true);

-- Policies for hourly_telemetry
CREATE POLICY "Allow read for anon/auth" ON public.hourly_telemetry FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.hourly_telemetry FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.hourly_telemetry FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.hourly_telemetry FOR DELETE TO anon, authenticated USING (true);

-- 3. Secure the public.rls_auto_enable() function by revoking execution access
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM public, anon, authenticated;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Detailed Hourly Telemetry (BESS & Self-Consumption)
-- Esegui questo script nel SQL Editor di Supabase per aggiungere le nuove colonne
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS bess_charge_solar_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS bess_charge_grid_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS bess_discharge_grid_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS bess_discharge_ppa_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS self_consumption_solar_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS self_consumption_bess_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS bess_losses_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Detailed Hourly Telemetry & Economics Additions
-- Esegui questo script nel SQL Editor di Supabase per aggiungere le nuove colonne
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS pv_grid_feed_kw DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS revenue_rid_pure_eur DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS revenue_rid_actual_eur DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS revenue_arbitrage_grid_eur DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS revenue_ppa_pv_eur DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS revenue_ppa_bess_eur DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS revenue_timeshifting_eur DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.hourly_telemetry ADD COLUMN IF NOT EXISTS cost_withdrawal_bess_eur DECIMAL(12, 4) NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: BESS Trader Contract & Network parameters
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS trader_contract_type TEXT NOT NULL DEFAULT 'pun_orario';
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS trader_spread_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS trader_disp_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS grid_losses_pct DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS gse_imbalance_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 0;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Annual Decay Factors for Plants
-- Esegui questo script nel SQL Editor di Supabase per aggiungere le nuove colonne
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS degrade_rid_pct DECIMAL(12, 4) NOT NULL DEFAULT 2.0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS degrade_timeshifting_pct DECIMAL(12, 4) NOT NULL DEFAULT 2.0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS degrade_arbitrage_pct DECIMAL(12, 4) NOT NULL DEFAULT 2.0;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Earn-Out & PPA Commercial Service fields in plants table
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS earnout_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS earnout_val DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS earnout_years INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS service_val DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS service_years INTEGER NOT NULL DEFAULT 0;


-- Aggiunta campi per Mercati (RID GSE vs FER X)
ALTER TABLE plants
ADD COLUMN IF NOT EXISTS market_type TEXT DEFAULT 'rid',
ADD COLUMN IF NOT EXISTS ferx_tariff_eur_mwh DECIMAL(10,2) DEFAULT 0.0;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Detailed OPEX fields in plants table
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_om_bess NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_insurance NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_taxes NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_security NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_asset_management NUMERIC(12,4) DEFAULT 0;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Optimized CER & RID Parameters (ARERA/MASE 2026)
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Aggiungi il campo per il contributo PNRR alla tabella impianti
ALTER TABLE public.plants 
ADD COLUMN IF NOT EXISTS pnrr_contribution_pct DECIMAL(12, 4) NOT NULL DEFAULT 0;

-- 2. Inserisci i parametri di default per perdite di rete e tariffe incentivanti
INSERT INTO public.simulation_config (parameter_key, parameter_value)
VALUES 
    -- Parametri perdite in immissione (Rete RID)
    ('ridLossInjectBt', '5.2'),
    ('ridLossInjectMt', '2.3'),
    ('ridLossInjectAt', '0.0'),
    
    -- Parametri perdite in prelievo (Rete Prelievo ARERA)
    ('ridLossWithdrawBt', '10.2'),
    ('ridLossWithdrawMt', '3.8'),
    ('ridLossWithdrawAt', '2.0'),
    
    -- Coefficienti perdite evitate per condivisione (TIAD cPR)
    ('cerLossCprBt', '2.6'),
    ('cerLossCprMt', '1.2'),
    ('cerLossCprAt', '0.0'),
    
    -- Costo sbilanciamento GSE
    ('ridImbalanceCost', '1.5'),
    
    -- Componenti CER & TIAD
    ('cerTras', '8.4'),
    
    -- Tariffe base (Quota Fissa) MASE per taglia
    ('cerFissaSmall', '80.0'),
    ('cerFissaMedium', '70.0'),
    ('cerFissaLarge', '60.0'),
    
    -- Massimali (Cap) tariffa premio MASE per taglia
    ('cerCapSmall', '120.0'),
    ('cerCapMedium', '110.0'),
    ('cerCapLarge', '100.0'),
    
    -- Prezzo soglia per quota variabile
    ('cerVarReferencePrice', '180.0'),
    ('cerVarMax', '40.0'),
    
    -- Correzioni Geografiche (Maggiorazioni)
    ('cerGeoNord', '10.0'),
    ('cerGeoCentro', '4.0'),
    ('cerGeoSud', '0.0')
ON CONFLICT (parameter_key) DO UPDATE 
SET parameter_value = EXCLUDED.parameter_value;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Market Type and FER X Parameters
-- Esegui questo script nel SQL Editor di Supabase per aggiornare lo schema
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants 
ADD COLUMN IF NOT EXISTS market_type VARCHAR(50) NOT NULL DEFAULT 'rid',
ADD COLUMN IF NOT EXISTS ferx_tariff_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 60.0;

-- Opzionale: Notifica a PostgREST di ricaricare la schema cache
NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Bearish Scenario with Zonal PUN Floor Parameters
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- Inserisci i nuovi parametri di configurazione con valori di default
INSERT INTO public.simulation_config (parameter_key, parameter_value)
VALUES 
    ('priceScenarioType', 'base'),
    ('punZonalFloor', '60.0'),
    ('punBearishDecayRate', '0.05')
ON CONFLICT (parameter_key) DO NOTHING;
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: CER (Comunità Energetiche Rinnovabili) Support
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- Aggiungi la colonna cer_share_type alla tabella stabilimenti
ALTER TABLE public.stabilimenti 
ADD COLUMN IF NOT EXISTS cer_share_type TEXT NOT NULL DEFAULT 'shared_energy';
-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Stabilimenti & PPA Module
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- TABLE: stabilimenti
CREATE TABLE IF NOT EXISTS stabilimenti (
    id                     TEXT PRIMARY KEY,
    name                   TEXT NOT NULL,
    plant_id               TEXT NOT NULL,
    ppa_type               TEXT NOT NULL DEFAULT 'on-site',
    ppa_price              DECIMAL(10, 4) NOT NULL DEFAULT 0,
    ppa_duration           INTEGER NOT NULL DEFAULT 15,
    annual_consumption_mwh DECIMAL(12, 4) DEFAULT 0,
    works_saturday         BOOLEAN DEFAULT FALSE,
    works_sunday           BOOLEAN DEFAULT FALSE,
    works_holidays         BOOLEAN DEFAULT FALSE,
    shift_type             TEXT DEFAULT 'office',
    load_source            TEXT DEFAULT 'generated',
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT stabilimenti_plant_id_unique UNIQUE (plant_id)
);

-- TABLE: stabilimento_load (8760 righe per stabilimento)
CREATE TABLE IF NOT EXISTS stabilimento_load (
    stabilimento_id TEXT NOT NULL,
    hour_index      INTEGER NOT NULL CHECK (hour_index >= 0 AND hour_index < 8760),
    load_kw         DECIMAL(10, 4) NOT NULL DEFAULT 0,
    PRIMARY KEY (stabilimento_id, hour_index),
    CONSTRAINT fk_stabilimento_load_stab
        FOREIGN KEY (stabilimento_id) REFERENCES stabilimenti(id) ON DELETE CASCADE
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_stabilimento_load_stab_id ON stabilimento_load (stabilimento_id);
CREATE INDEX IF NOT EXISTS idx_stabilimento_load_hour ON stabilimento_load (stabilimento_id, hour_index);
CREATE INDEX IF NOT EXISTS idx_stabilimenti_plant_id ON stabilimenti (plant_id);

-- Disable Row-Level Security (RLS) to allow direct CRUD operations from frontend using the anon API key
ALTER TABLE public.stabilimenti DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stabilimento_load DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.plants
ADD COLUMN brp_fee1 numeric(12,4) DEFAULT 0,
ADD COLUMN brp_fee1_months integer DEFAULT 0,
ADD COLUMN brp_fee2 numeric(12,4) DEFAULT 0,
ADD COLUMN brp_fee2_months integer DEFAULT 0,
ADD COLUMN brp_fee3 numeric(12,4) DEFAULT 0;
