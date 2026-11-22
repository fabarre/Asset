-- Migrazione: aggiunta parametro brp_fee_basis sulla tabella plants
-- Consente di scegliere se il premio/fee BRP (€/MWh) è applicato:
--   - 'gross'   : energia lorda perdite convenzionali -> (PUN + fee) * (1 + perdite) [default retrocompatibile]
--   - 'metered' : energia misurata al contatore       -> PUN * (1 + perdite) + fee
-- Backup pre-migrazione eseguito: 2026-11-22T06-48-22_prod

BEGIN;

ALTER TABLE public.plants
    ADD COLUMN IF NOT EXISTS brp_fee_basis text NOT NULL DEFAULT 'gross';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'plants_brp_fee_basis_check'
    ) THEN
        ALTER TABLE public.plants
            ADD CONSTRAINT plants_brp_fee_basis_check
            CHECK (brp_fee_basis IN ('gross', 'metered'));
    END IF;
END $$;

COMMIT;

-- ROLLBACK:
-- BEGIN;
-- ALTER TABLE public.plants DROP CONSTRAINT IF EXISTS plants_brp_fee_basis_check;
-- ALTER TABLE public.plants DROP COLUMN IF EXISTS brp_fee_basis;
-- COMMIT;
