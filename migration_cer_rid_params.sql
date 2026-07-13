-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Optimized CER & RID Parameters (ARERA/MASE 2026)
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Aggiungi il campo per il contributo PNRR alla tabella impianti
ALTER TABLE public.plants 
ADD COLUMN IF NOT EXISTS pnrr_contribution_pct DECIMAL(12, 4) NOT NULL DEFAULT 0;

-- 2. Inserisci i parametri di default per perdite di rete e tariffe incentivanti
INSERT INTO public.simulation_config (parameter_key, parameter_value)
VALUES 
    -- Parametri perdite in immissione (Rete RID)
    ('ridLossInjectBt', '5.2'),
    ('ridLossInjectMt', '2.3'),
    ('ridLossInjectAt', '0.0'),
    
    -- Parametri perdite in prelievo (Rete Prelievo ARERA)
    ('ridLossWithdrawBt', '10.2'),
    ('ridLossWithdrawMt', '3.8'),
    ('ridLossWithdrawAt', '2.0'),
    
    -- Coefficienti perdite evitate per condivisione (TIAD cPR)
    ('cerLossCprBt', '2.6'),
    ('cerLossCprMt', '1.2'),
    ('cerLossCprAt', '0.0'),
    
    -- Costo sbilanciamento GSE
    ('ridImbalanceCost', '1.5'),
    
    -- Componenti CER & TIAD
    ('cerTras', '8.4'),
    
    -- Tariffe base (Quota Fissa) MASE per taglia
    ('cerFissaSmall', '80.0'),
    ('cerFissaMedium', '70.0'),
    ('cerFissaLarge', '60.0'),
    
    -- Massimali (Cap) tariffa premio MASE per taglia
    ('cerCapSmall', '120.0'),
    ('cerCapMedium', '110.0'),
    ('cerCapLarge', '100.0'),
    
    -- Prezzo soglia per quota variabile
    ('cerVarReferencePrice', '180.0'),
    ('cerVarMax', '40.0'),
    
    -- Correzioni Geografiche (Maggiorazioni)
    ('cerGeoNord', '10.0'),
    ('cerGeoCentro', '4.0'),
    ('cerGeoSud', '0.0')
ON CONFLICT (parameter_key) DO UPDATE 
SET parameter_value = EXCLUDED.parameter_value;
