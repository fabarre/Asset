ALTER TABLE public.plants
ADD COLUMN brp_fee1 numeric(12,4) DEFAULT 0,
ADD COLUMN brp_durata_fee1 integer DEFAULT 0,
ADD COLUMN brp_fee2 numeric(12,4) DEFAULT 0,
ADD COLUMN brp_durata_fee2 integer DEFAULT 0,
ADD COLUMN brp_fee3 numeric(12,4) DEFAULT 0;
