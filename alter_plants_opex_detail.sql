-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Detailed OPEX fields in plants table
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_om_bess NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_insurance NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_taxes NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_security NUMERIC(12,4) DEFAULT 0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS opex_asset_management NUMERIC(12,4) DEFAULT 0;
