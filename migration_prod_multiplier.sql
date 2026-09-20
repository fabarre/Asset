-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Moltiplicatore produzione per impianto (prod_multiplier)
--
-- Aggiunge prod_multiplier (numeric, default 1.0000) alla tabella plants
-- per permettere l'applicazione di un coefficiente correttivo alla produzione
-- oraria dell'impianto fotovoltaico per scenari alternativi.
--
-- PREVENTIVO: backup 2026-09-08T18-15-05_prod.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.plants
    ADD COLUMN IF NOT EXISTS prod_multiplier numeric DEFAULT 1.0000;

COMMENT ON COLUMN public.plants.prod_multiplier IS
    'Moltiplicatore applicato alla produzione oraria del profilo fotovoltaico (default: 1.0000).';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE public.plants DROP COLUMN IF EXISTS prod_multiplier;
