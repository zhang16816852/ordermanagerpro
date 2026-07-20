-- Simplify brand_series: remove parent_id tree hierarchy, keep flat only
-- Modify products: drop series text column, add brand_series_id FK

-- A) brand_series: remove parent_id + reset unique constraints
ALTER TABLE public.brand_series DROP COLUMN IF EXISTS parent_id;

DROP INDEX IF EXISTS idx_brand_series_parent_id;
DROP INDEX IF EXISTS idx_brand_series_unique_name_per_parent;
DROP INDEX IF EXISTS idx_brand_series_unique_name_with_parent;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_series_unique_name ON public.brand_series(brand_id, name);

-- B) products: add brand_series_id FK, then drop series text column
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand_series_id UUID REFERENCES public.brand_series(id);
CREATE INDEX IF NOT EXISTS idx_products_brand_series_id ON public.products(brand_series_id);
ALTER TABLE public.products DROP COLUMN IF EXISTS series;
