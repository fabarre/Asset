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

