-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Market Type and FER X Parameters
-- Esegui questo script nel SQL Editor di Supabase per aggiornare lo schema
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plants 
ADD COLUMN IF NOT EXISTS market_type VARCHAR(50) NOT NULL DEFAULT 'rid',
ADD COLUMN IF NOT EXISTS ferx_tariff_eur_mwh DECIMAL(12, 4) NOT NULL DEFAULT 60.0;

-- Opzionale: Notifica a PostgREST di ricaricare la schema cache
NOTIFY pgrst, 'reload schema';
