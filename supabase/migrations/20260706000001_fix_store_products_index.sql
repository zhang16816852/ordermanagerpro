-- Fix store_products unique index to support variant-level pricing
-- Product-level: (brand, product_id) WHERE variant_id IS NULL
-- Variant-level: (brand, product_id, variant_id) WHERE variant_id IS NOT NULL

DROP INDEX IF EXISTS idx_store_products_brand_product;

CREATE UNIQUE INDEX idx_store_products_brand_product
  ON public.store_products(brand, product_id)
  WHERE variant_id IS NULL AND brand IS NOT NULL;

CREATE UNIQUE INDEX idx_store_products_brand_product_variant
  ON public.store_products(brand, product_id, variant_id)
  WHERE variant_id IS NOT NULL AND brand IS NOT NULL;
