-- Aggiunta campi per Mercati (RID GSE vs FER X)
ALTER TABLE plants
ADD COLUMN IF NOT EXISTS market_type TEXT DEFAULT 'rid',
ADD COLUMN IF NOT EXISTS ferx_tariff_eur_mwh DECIMAL(10,2) DEFAULT 0.0;
