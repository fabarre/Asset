-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Bearish Scenario with Zonal PUN Floor Parameters
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- Inserisci i nuovi parametri di configurazione con valori di default
INSERT INTO public.simulation_config (parameter_key, parameter_value)
VALUES 
    ('priceScenarioType', 'base'),
    ('punZonalFloor', '60.0'),
    ('punBearishDecayRate', '0.05')
ON CONFLICT (parameter_key) DO NOTHING;
