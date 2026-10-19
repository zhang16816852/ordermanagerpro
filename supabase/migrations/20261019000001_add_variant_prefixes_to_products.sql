-- Add default variant name/SKU prefix columns to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_variant_name_prefix text,
  ADD COLUMN IF NOT EXISTS default_variant_sku_prefix text;

-- bump data_version for products so caches refresh
SELECT public.bump_data_version('products', 'products');