-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE CF2: data COD per impianto (cash flow mensilizzato date-aware)
--
-- Aggiunge la colonna cod_date a plants. NULL = comportamento legacy
-- (produzione piena da gennaio dell'anno 1 del modello).
-- I lag di incasso per regime (RID/BRP/CER/FER X) non richiedono schema:
-- sono parametri numerici in simulation_config (State.inputs).
--
-- PREVENTIVO: eseguito dopo backup completo
--   (tools/backup.mjs run prod -> scratch/backups/2026-08-28T12-36-54_prod).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.plants
    ADD COLUMN IF NOT EXISTS cod_date date DEFAULT NULL;

COMMENT ON COLUMN public.plants.cod_date IS
    'Commercial Operation Date (data di entrata in esercizio). NULL = produzione piena da gennaio anno 1.';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE public.plants DROP COLUMN IF EXISTS cod_date;
