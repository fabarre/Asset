-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE: Copia integrale configurazioni da fabarre@gmail.com a t.canova@stafil.it
-- Progetto: Business_Plan_OVH (bfszzyeysqijxrqxsofk)
-- 
-- Sorgente: 451531a7-5b56-480e-8391-ca1a218da417 (fabarre@gmail.com)
-- Destinazione: 1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b (t.canova@stafil.it)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Aggiornamento ruolo utente a 'editor' per t.canova@stafil.it (piena operatività RLS)
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"editor"}'::jsonb
WHERE id = '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid;

-- 2. PLANTS (3 impianti configurati con tutti i 75 campi inclusi COD, BRP, grid_withdrawal_kw, ecc.)
INSERT INTO public.plants (
    id, name, capacity_kwp, zone, capex_kwp, opex_eur, created_at, connection_cost_eur,
    land_type, land_cost_eur, development_cost_eur, spv_acquisition_cost_eur,
    bess_mw, bess_mwh, bess_efficiency, bess_degradation, bess_capex_kwh, bess_type, bess_connection,
    grid_connection_kw, grid_voltage, inverter_brand, inverter_model, inverter_power_kw,
    inverter_efficiency, inverter_mppt_count, inverter_max_dc_v, bess_dod, bess_soc_min, bess_soc_max,
    bess_temp_min, bess_temp_max, bess_cycles, bess_warranty_years, pvgis_latitude, pvgis_longitude,
    pvgis_elevation, pvgis_slope, pvgis_azimuth, pvgis_system_losses, pvgis_tracking, pvgis_database,
    pvgis_yield, pvgis_annual_production, opex_om_bess, opex_insurance, opex_taxes, opex_security,
    opex_asset_management, earnout_type, earnout_val, service_type, service_val, earnout_years,
    service_years, trader_contract_type, trader_spread_eur_mwh, trader_disp_eur_mwh, grid_losses_pct,
    gse_imbalance_eur_mwh, degrade_rid_pct, degrade_timeshifting_pct, degrade_arbitrage_pct,
    pnrr_contribution_pct, market_type, ferx_tariff_eur_mwh, user_id, brp_fee1, brp_fee1_months,
    brp_fee2, brp_fee2_months, brp_fee3, cod_date, prod_multiplier, grid_withdrawal_kw
)
SELECT 
    id, name, capacity_kwp, zone, capex_kwp, opex_eur, created_at, connection_cost_eur,
    land_type, land_cost_eur, development_cost_eur, spv_acquisition_cost_eur,
    bess_mw, bess_mwh, bess_efficiency, bess_degradation, bess_capex_kwh, bess_type, bess_connection,
    grid_connection_kw, grid_voltage, inverter_brand, inverter_model, inverter_power_kw,
    inverter_efficiency, inverter_mppt_count, inverter_max_dc_v, bess_dod, bess_soc_min, bess_soc_max,
    bess_temp_min, bess_temp_max, bess_cycles, bess_warranty_years, pvgis_latitude, pvgis_longitude,
    pvgis_elevation, pvgis_slope, pvgis_azimuth, pvgis_system_losses, pvgis_tracking, pvgis_database,
    pvgis_yield, pvgis_annual_production, opex_om_bess, opex_insurance, opex_taxes, opex_security,
    opex_asset_management, earnout_type, earnout_val, service_type, service_val, earnout_years,
    service_years, trader_contract_type, trader_spread_eur_mwh, trader_disp_eur_mwh, grid_losses_pct,
    gse_imbalance_eur_mwh, degrade_rid_pct, degrade_timeshifting_pct, degrade_arbitrage_pct,
    pnrr_contribution_pct, market_type, ferx_tariff_eur_mwh, '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid,
    brp_fee1, brp_fee1_months, brp_fee2, brp_fee2_months, brp_fee3, cod_date, prod_multiplier,
    grid_withdrawal_kw
FROM public.plants
WHERE user_id = '451531a7-5b56-480e-8391-ca1a218da417'
ON CONFLICT (id, user_id) DO UPDATE SET
    name = EXCLUDED.name,
    capacity_kwp = EXCLUDED.capacity_kwp,
    zone = EXCLUDED.zone,
    capex_kwp = EXCLUDED.capex_kwp,
    opex_eur = EXCLUDED.opex_eur,
    connection_cost_eur = EXCLUDED.connection_cost_eur,
    land_type = EXCLUDED.land_type,
    land_cost_eur = EXCLUDED.land_cost_eur,
    development_cost_eur = EXCLUDED.development_cost_eur,
    spv_acquisition_cost_eur = EXCLUDED.spv_acquisition_cost_eur,
    bess_mw = EXCLUDED.bess_mw,
    bess_mwh = EXCLUDED.bess_mwh,
    bess_efficiency = EXCLUDED.bess_efficiency,
    bess_degradation = EXCLUDED.bess_degradation,
    bess_capex_kwh = EXCLUDED.bess_capex_kwh,
    bess_type = EXCLUDED.bess_type,
    bess_connection = EXCLUDED.bess_connection,
    grid_connection_kw = EXCLUDED.grid_connection_kw,
    grid_voltage = EXCLUDED.grid_voltage,
    inverter_brand = EXCLUDED.inverter_brand,
    inverter_model = EXCLUDED.inverter_model,
    inverter_power_kw = EXCLUDED.inverter_power_kw,
    inverter_efficiency = EXCLUDED.inverter_efficiency,
    inverter_mppt_count = EXCLUDED.inverter_mppt_count,
    inverter_max_dc_v = EXCLUDED.inverter_max_dc_v,
    bess_dod = EXCLUDED.bess_dod,
    bess_soc_min = EXCLUDED.bess_soc_min,
    bess_soc_max = EXCLUDED.bess_soc_max,
    bess_temp_min = EXCLUDED.bess_temp_min,
    bess_temp_max = EXCLUDED.bess_temp_max,
    bess_cycles = EXCLUDED.bess_cycles,
    bess_warranty_years = EXCLUDED.bess_warranty_years,
    pvgis_latitude = EXCLUDED.pvgis_latitude,
    pvgis_longitude = EXCLUDED.pvgis_longitude,
    pvgis_elevation = EXCLUDED.pvgis_elevation,
    pvgis_slope = EXCLUDED.pvgis_slope,
    pvgis_azimuth = EXCLUDED.pvgis_azimuth,
    pvgis_system_losses = EXCLUDED.pvgis_system_losses,
    pvgis_tracking = EXCLUDED.pvgis_tracking,
    pvgis_database = EXCLUDED.pvgis_database,
    pvgis_yield = EXCLUDED.pvgis_yield,
    pvgis_annual_production = EXCLUDED.pvgis_annual_production,
    opex_om_bess = EXCLUDED.opex_om_bess,
    opex_insurance = EXCLUDED.opex_insurance,
    opex_taxes = EXCLUDED.opex_taxes,
    opex_security = EXCLUDED.opex_security,
    opex_asset_management = EXCLUDED.opex_asset_management,
    earnout_type = EXCLUDED.earnout_type,
    earnout_val = EXCLUDED.earnout_val,
    service_type = EXCLUDED.service_type,
    service_val = EXCLUDED.service_val,
    earnout_years = EXCLUDED.earnout_years,
    service_years = EXCLUDED.service_years,
    trader_contract_type = EXCLUDED.trader_contract_type,
    trader_spread_eur_mwh = EXCLUDED.trader_spread_eur_mwh,
    trader_disp_eur_mwh = EXCLUDED.trader_disp_eur_mwh,
    grid_losses_pct = EXCLUDED.grid_losses_pct,
    gse_imbalance_eur_mwh = EXCLUDED.gse_imbalance_eur_mwh,
    degrade_rid_pct = EXCLUDED.degrade_rid_pct,
    degrade_timeshifting_pct = EXCLUDED.degrade_timeshifting_pct,
    degrade_arbitrage_pct = EXCLUDED.degrade_arbitrage_pct,
    pnrr_contribution_pct = EXCLUDED.pnrr_contribution_pct,
    market_type = EXCLUDED.market_type,
    ferx_tariff_eur_mwh = EXCLUDED.ferx_tariff_eur_mwh,
    brp_fee1 = EXCLUDED.brp_fee1,
    brp_fee1_months = EXCLUDED.brp_fee1_months,
    brp_fee2 = EXCLUDED.brp_fee2,
    brp_fee2_months = EXCLUDED.brp_fee2_months,
    brp_fee3 = EXCLUDED.brp_fee3,
    cod_date = EXCLUDED.cod_date,
    prod_multiplier = EXCLUDED.prod_multiplier,
    grid_withdrawal_kw = EXCLUDED.grid_withdrawal_kw;

-- 3. STABILIMENTI (3 stabilimenti collegati agli impianti)
INSERT INTO public.stabilimenti (
    id, name, plant_id, ppa_type, ppa_price, ppa_duration, annual_consumption_mwh,
    works_saturday, works_sunday, works_holidays, shift_type, load_source,
    created_at, updated_at, cer_share_type, user_id
)
SELECT 
    id, name, plant_id, ppa_type, ppa_price, ppa_duration, annual_consumption_mwh,
    works_saturday, works_sunday, works_holidays, shift_type, load_source,
    created_at, updated_at, cer_share_type, '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid
FROM public.stabilimenti
WHERE user_id = '451531a7-5b56-480e-8391-ca1a218da417'
ON CONFLICT (id, user_id) DO UPDATE SET
    name = EXCLUDED.name,
    plant_id = EXCLUDED.plant_id,
    ppa_type = EXCLUDED.ppa_type,
    ppa_price = EXCLUDED.ppa_price,
    ppa_duration = EXCLUDED.ppa_duration,
    annual_consumption_mwh = EXCLUDED.annual_consumption_mwh,
    works_saturday = EXCLUDED.works_saturday,
    works_sunday = EXCLUDED.works_sunday,
    works_holidays = EXCLUDED.works_holidays,
    shift_type = EXCLUDED.shift_type,
    load_source = EXCLUDED.load_source,
    cer_share_type = EXCLUDED.cer_share_type;

-- 4. PLANT_CUSTOM_COSTS (con supporto aliquota vat_rate CF11)
INSERT INTO public.plant_custom_costs (
    id, plant_id, cost_type, label, amount_eur, unit, user_id, created_at, vat_rate
)
SELECT 
    gen_random_uuid(), plant_id, cost_type, label, amount_eur, unit, '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid, created_at, vat_rate
FROM public.plant_custom_costs
WHERE user_id = '451531a7-5b56-480e-8391-ca1a218da417';

-- 5. SIMULATION_CONFIG (219 parametri, formule, rate, slider, branding)
INSERT INTO public.simulation_config (
    parameter_key, parameter_value, updated_at, user_id
)
SELECT 
    parameter_key, parameter_value, updated_at, '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid
FROM public.simulation_config
WHERE user_id = '451531a7-5b56-480e-8391-ca1a218da417'
ON CONFLICT (parameter_key, user_id) DO UPDATE SET
    parameter_value = EXCLUDED.parameter_value,
    updated_at = EXCLUDED.updated_at;

-- 6. PLANT_GENERATION (curve di generazione solare oraria - 26.280 ore)
INSERT INTO public.plant_generation (
    plant_id, hour_index, generation_kw, user_id
)
SELECT 
    plant_id, hour_index, generation_kw, '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid
FROM public.plant_generation
WHERE user_id = '451531a7-5b56-480e-8391-ca1a218da417'
ON CONFLICT (plant_id, hour_index, user_id) DO UPDATE SET
    generation_kw = EXCLUDED.generation_kw;

-- 7. STABILIMENTO_LOAD (curve di carico industriale orario - 26.280 ore)
INSERT INTO public.stabilimento_load (
    stabilimento_id, hour_index, load_kw, user_id
)
SELECT 
    stabilimento_id, hour_index, load_kw, '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid
FROM public.stabilimento_load
WHERE user_id = '451531a7-5b56-480e-8391-ca1a218da417'
ON CONFLICT (stabilimento_id, hour_index, user_id) DO UPDATE SET
    load_kw = EXCLUDED.load_kw;

-- 8. HOURLY_TELEMETRY (vettore annuale completo - 8.760 ore con tutte le 23 metriche orarie)
INSERT INTO public.hourly_telemetry (
    hour_index, generation_kw, price_eur_mwh, bess_soc_kwh, bess_charge_kw, bess_discharge_kw,
    updated_at, bess_charge_solar_kw, bess_charge_grid_kw, bess_discharge_grid_kw,
    bess_discharge_ppa_kw, self_consumption_solar_kw, self_consumption_bess_kw, bess_losses_kw,
    pv_grid_feed_kw, revenue_rid_pure_eur, revenue_rid_actual_eur, revenue_arbitrage_grid_eur,
    revenue_ppa_pv_eur, revenue_ppa_bess_eur, revenue_timeshifting_eur, cost_withdrawal_bess_eur, user_id
)
SELECT 
    hour_index, generation_kw, price_eur_mwh, bess_soc_kwh, bess_charge_kw, bess_discharge_kw,
    updated_at, bess_charge_solar_kw, bess_charge_grid_kw, bess_discharge_grid_kw,
    bess_discharge_ppa_kw, self_consumption_solar_kw, self_consumption_bess_kw, bess_losses_kw,
    pv_grid_feed_kw, revenue_rid_pure_eur, revenue_rid_actual_eur, revenue_arbitrage_grid_eur,
    revenue_ppa_pv_eur, revenue_ppa_bess_eur, revenue_timeshifting_eur, cost_withdrawal_bess_eur,
    '1d5095b0-e61c-4a27-a91a-2fbc9ee99a1b'::uuid
FROM public.hourly_telemetry
WHERE user_id = '451531a7-5b56-480e-8391-ca1a218da417'
ON CONFLICT (hour_index, user_id) DO UPDATE SET
    generation_kw = EXCLUDED.generation_kw,
    price_eur_mwh = EXCLUDED.price_eur_mwh,
    bess_soc_kwh = EXCLUDED.bess_soc_kwh,
    bess_charge_kw = EXCLUDED.bess_charge_kw,
    bess_discharge_kw = EXCLUDED.bess_discharge_kw,
    updated_at = EXCLUDED.updated_at,
    bess_charge_solar_kw = EXCLUDED.bess_charge_solar_kw,
    bess_charge_grid_kw = EXCLUDED.bess_charge_grid_kw,
    bess_discharge_grid_kw = EXCLUDED.bess_discharge_grid_kw,
    bess_discharge_ppa_kw = EXCLUDED.bess_discharge_ppa_kw,
    self_consumption_solar_kw = EXCLUDED.self_consumption_solar_kw,
    self_consumption_bess_kw = EXCLUDED.self_consumption_bess_kw,
    bess_losses_kw = EXCLUDED.bess_losses_kw,
    pv_grid_feed_kw = EXCLUDED.pv_grid_feed_kw,
    revenue_rid_pure_eur = EXCLUDED.revenue_rid_pure_eur,
    revenue_rid_actual_eur = EXCLUDED.revenue_rid_actual_eur,
    revenue_arbitrage_grid_eur = EXCLUDED.revenue_arbitrage_grid_eur,
    revenue_ppa_pv_eur = EXCLUDED.revenue_ppa_pv_eur,
    revenue_ppa_bess_eur = EXCLUDED.revenue_ppa_bess_eur,
    revenue_timeshifting_eur = EXCLUDED.revenue_timeshifting_eur,
    cost_withdrawal_bess_eur = EXCLUDED.cost_withdrawal_bess_eur;

COMMIT;
