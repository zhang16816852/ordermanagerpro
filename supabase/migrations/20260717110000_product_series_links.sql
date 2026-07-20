-- Convert products.brand_series_id (single FK) to product_series_links junction table (many-to-many)
-- Follows the same pattern as product_category_links

-- A) Create junction table
CREATE TABLE IF NOT EXISTS public.product_series_links (
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  brand_series_id UUID REFERENCES public.brand_series(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, brand_series_id)
);

-- B) Migrate existing data
INSERT INTO public.product_series_links (product_id, brand_series_id)
SELECT id, brand_series_id FROM public.products WHERE brand_series_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- C) Drop the old single FK column
ALTER TABLE public.products DROP COLUMN IF EXISTS brand_series_id;
