-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE CF11: aliquota IVA per voce CAPEX/OPEX personalizzata
--
-- Aggiunge vat_rate (numeric, %) alla tabella plant_custom_costs così ogni
-- voce CAPEX/OPEX personalizzata può dichiarare la propria aliquota IVA.
-- NULL = usa l'aliquota di default della categoria.
--
-- PREVENTIVO: backup 2026-08-30T13-53-55_prod.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.plant_custom_costs
    ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT NULL;

COMMENT ON COLUMN public.plant_custom_costs.vat_rate IS
    'Aliquota IVA (%) della voce personalizzata. NULL = default di categoria.';

COMMIT;

-- ROLLBACK:
-- ALTER TABLE public.plant_custom_costs DROP COLUMN IF EXISTS vat_rate;
