-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Potenza di prelievo da rete (grid_withdrawal_kw)
--
-- Aggiunge grid_withdrawal_kw (numeric(12,2), default 0) alla tabella plants
-- per definire la potenza massima prelevabile dalla rete per la carica BESS
-- (arbitraggio). Se pari a 0 kW, la carica da rete è disabilitata e il BESS
-- opera esclusivamente in regime di Time Shifting solare.
-- Per gli impianti già esistenti con BESS attivo, inizializza il valore a
-- min(grid_connection_kw, bess_mw * 1000) quando grid_connection_kw > 0,
-- altrimenti bess_mw * 1000, preservando il comportamento pre-migrazione.
--
-- PREVENTIVO: backup 2026-10-16T06-57-45_prod.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.plants
    ADD COLUMN IF NOT EXISTS grid_withdrawal_kw numeric(12,2) DEFAULT 0;

UPDATE public.plants
SET grid_withdrawal_kw = CASE
    WHEN COALESCE(bess_mw, 0) > 0 AND COALESCE(bess_type, 'none') <> 'none' THEN
        CASE
            WHEN COALESCE(grid_connection_kw, 0) > 0 THEN LEAST(grid_connection_kw, bess_mw * 1000)
            ELSE bess_mw * 1000
        END
    ELSE COALESCE(grid_connection_kw, 0)
END
WHERE grid_withdrawal_kw IS NULL OR grid_withdrawal_kw = 0;

COMMENT ON COLUMN public.plants.grid_withdrawal_kw IS
    'Potenza massima di prelievo dalla rete in kW per carica BESS (0 = nessun arbitraggio da rete, solo time shifting solare).';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE public.plants DROP COLUMN IF EXISTS grid_withdrawal_kw;
