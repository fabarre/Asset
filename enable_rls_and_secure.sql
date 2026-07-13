-- 1. Enable Row Level Security (RLS) on all public tables
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zonal_pun ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stabilimenti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stabilimento_load ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourly_telemetry ENABLE ROW LEVEL SECURITY;

-- 2. Create permissive policies for 'anon' and 'authenticated' roles
-- (Required since the client browser app reads/writes data directly using the anon API key)

-- Policies for plants
CREATE POLICY "Allow read for anon/auth" ON public.plants FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.plants FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.plants FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.plants FOR DELETE TO anon, authenticated USING (true);

-- Policies for plant_generation
CREATE POLICY "Allow read for anon/auth" ON public.plant_generation FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.plant_generation FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.plant_generation FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.plant_generation FOR DELETE TO anon, authenticated USING (true);

-- Policies for zonal_pun
CREATE POLICY "Allow read for anon/auth" ON public.zonal_pun FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.zonal_pun FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.zonal_pun FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.zonal_pun FOR DELETE TO anon, authenticated USING (true);

-- Policies for simulation_config
CREATE POLICY "Allow read for anon/auth" ON public.simulation_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.simulation_config FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.simulation_config FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.simulation_config FOR DELETE TO anon, authenticated USING (true);

-- Policies for stabilimenti
CREATE POLICY "Allow read for anon/auth" ON public.stabilimenti FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.stabilimenti FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.stabilimenti FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.stabilimenti FOR DELETE TO anon, authenticated USING (true);

-- Policies for stabilimento_load
CREATE POLICY "Allow read for anon/auth" ON public.stabilimento_load FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.stabilimento_load FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.stabilimento_load FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.stabilimento_load FOR DELETE TO anon, authenticated USING (true);

-- Policies for hourly_telemetry
CREATE POLICY "Allow read for anon/auth" ON public.hourly_telemetry FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert for anon/auth" ON public.hourly_telemetry FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update for anon/auth" ON public.hourly_telemetry FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow delete for anon/auth" ON public.hourly_telemetry FOR DELETE TO anon, authenticated USING (true);

-- 3. Secure the public.rls_auto_enable() function by revoking execution access
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM public, anon, authenticated;
