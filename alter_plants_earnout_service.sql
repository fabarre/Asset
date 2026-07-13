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


