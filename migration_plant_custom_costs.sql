-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE CF7: voci CAPEX/OPEX personalizzate per impianto
--
-- Ogni riga è una voce di costo aggiuntiva legata a un impianto:
--   cost_type 'capex' | 'opex'
--   unit 'total' (€ una tantum per CAPEX, €/anno per OPEX) | 'per_kwp' (€/kWp)
-- Le voci entrano in tutti i calcoli: CAPEX totale (debito, IDC, ammortamenti,
-- LCOE) e OPEX annuo (EBITDA, P&L, imposte, cash flow mensile).
--
-- PREVENTIVO: backup 2026-08-30T05-34-25_prod.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.plant_custom_costs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id text NOT NULL,
    cost_type text NOT NULL CHECK (cost_type IN ('capex', 'opex')),
    label text NOT NULL DEFAULT '',
    amount_eur numeric NOT NULL DEFAULT 0 CHECK (amount_eur >= 0),
    unit text NOT NULL DEFAULT 'total' CHECK (unit IN ('total', 'per_kwp')),
    user_id uuid NOT NULL DEFAULT auth.uid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (plant_id, user_id) REFERENCES public.plants(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plant_custom_costs_plant
    ON public.plant_custom_costs (plant_id);

ALTER TABLE public.plant_custom_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner read"   ON public.plant_custom_costs;
DROP POLICY IF EXISTS "owner insert" ON public.plant_custom_costs;
DROP POLICY IF EXISTS "owner update" ON public.plant_custom_costs;
DROP POLICY IF EXISTS "owner delete" ON public.plant_custom_costs;

CREATE POLICY "owner read"   ON public.plant_custom_costs FOR SELECT TO authenticated
    USING ((select auth.uid()) = user_id);
CREATE POLICY "owner insert" ON public.plant_custom_costs FOR INSERT TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "owner update" ON public.plant_custom_costs FOR UPDATE TO authenticated
    USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "owner delete" ON public.plant_custom_costs FOR DELETE TO authenticated
    USING ((select auth.uid()) = user_id);

COMMIT;

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.plant_custom_costs;
