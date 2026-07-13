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
