-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: BESS Trader Contract & Network parameters
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS trader_contract_type TEXT NOT NULL DEFAULT 'pun_orario';
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS trader_spread_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS trader_disp_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS grid_losses_pct DECIMAL(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS gse_imbalance_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 0;
