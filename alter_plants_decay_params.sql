-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Annual Decay Factors for Plants
-- Esegui questo script nel SQL Editor di Supabase per aggiungere le nuove colonne
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS degrade_rid_pct DECIMAL(12, 4) NOT NULL DEFAULT 2.0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS degrade_timeshifting_pct DECIMAL(12, 4) NOT NULL DEFAULT 2.0;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS degrade_arbitrage_pct DECIMAL(12, 4) NOT NULL DEFAULT 2.0;
