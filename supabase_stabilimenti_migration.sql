-- ═══════════════════════════════════════════════════════════════════════════
-- ASSET Platform — Migration: Stabilimenti & PPA Module
-- Esegui questo script nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════════════════

-- TABLE: stabilimenti
CREATE TABLE IF NOT EXISTS stabilimenti (
    id                     TEXT PRIMARY KEY,
    name                   TEXT NOT NULL,
    plant_id               TEXT NOT NULL,
    ppa_type               TEXT NOT NULL DEFAULT 'on-site',
    ppa_price              DECIMAL(10, 4) NOT NULL DEFAULT 0,
    ppa_duration           INTEGER NOT NULL DEFAULT 15,
    annual_consumption_mwh DECIMAL(12, 4) DEFAULT 0,
    works_saturday         BOOLEAN DEFAULT FALSE,
    works_sunday           BOOLEAN DEFAULT FALSE,
    works_holidays         BOOLEAN DEFAULT FALSE,
    shift_type             TEXT DEFAULT 'office',
    load_source            TEXT DEFAULT 'generated',
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT stabilimenti_plant_id_unique UNIQUE (plant_id)
);

-- TABLE: stabilimento_load (8760 righe per stabilimento)
CREATE TABLE IF NOT EXISTS stabilimento_load (
    stabilimento_id TEXT NOT NULL,
    hour_index      INTEGER NOT NULL CHECK (hour_index >= 0 AND hour_index < 8760),
    load_kw         DECIMAL(10, 4) NOT NULL DEFAULT 0,
    PRIMARY KEY (stabilimento_id, hour_index),
    CONSTRAINT fk_stabilimento_load_stab
        FOREIGN KEY (stabilimento_id) REFERENCES stabilimenti(id) ON DELETE CASCADE
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_stabilimento_load_stab_id ON stabilimento_load (stabilimento_id);
CREATE INDEX IF NOT EXISTS idx_stabilimento_load_hour ON stabilimento_load (stabilimento_id, hour_index);
CREATE INDEX IF NOT EXISTS idx_stabilimenti_plant_id ON stabilimenti (plant_id);

-- Disable Row-Level Security (RLS) to allow direct CRUD operations from frontend using the anon API key
ALTER TABLE public.stabilimenti DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stabilimento_load DISABLE ROW LEVEL SECURITY;

