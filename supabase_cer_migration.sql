-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: CER (Comunità Energetiche Rinnovabili) Support
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- Aggiungi la colonna cer_share_type alla tabella stabilimenti
ALTER TABLE public.stabilimenti 
ADD COLUMN IF NOT EXISTS cer_share_type TEXT NOT NULL DEFAULT 'shared_energy';
