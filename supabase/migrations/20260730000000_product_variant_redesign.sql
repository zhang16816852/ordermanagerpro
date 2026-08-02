-- ==========================================
-- Product/Variant Redesign: "All Products Are Variants"
-- 1. Flexible option system (replaces option_1/2/3)
-- 2. Product `code` as SKU prefix (replaces product.sku)
-- 3. Remove product-level pricing, status, has_variants
-- 4. Every product has at least one variant
-- ==========================================

-- ==========================================
-- PART 1: Create New Tables
-- ==========================================

-- 1a. Product Option Groups (e.g., "規格", "顏色", "尺寸")
CREATE TABLE IF NOT EXISTS public.product_option_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_option_groups_product_id ON public.product_option_groups(product_id);

CREATE TRIGGER update_product_option_groups_updated_at
BEFORE UPDATE ON public.product_option_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_option_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage option groups"
ON public.product_option_groups
FOR ALL
USING (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "Authenticated users can view option groups"
ON public.product_option_groups
FOR SELECT
USING (has_role(auth.uid(), 'admin'::system_role));

-- 1b. Product Option Values (e.g., "紅色" with hex_code='#FF0000')
CREATE TABLE IF NOT EXISTS public.product_option_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.product_option_groups(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  hex_code TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_option_values_group_id ON public.product_option_values(group_id);

CREATE TRIGGER update_product_option_values_updated_at
BEFORE UPDATE ON public.product_option_values
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_option_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage option values"
ON public.product_option_values
FOR ALL
USING (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "Authenticated users can view option values"
ON public.product_option_values
FOR SELECT
USING (has_role(auth.uid(), 'admin'::system_role));

-- 1c. Junction: variant <-> option values (one value per group per variant)
CREATE TABLE IF NOT EXISTS public.product_variant_options (
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  option_value_id UUID NOT NULL REFERENCES public.product_option_values(id) ON DELETE CASCADE,
  option_group_id UUID NOT NULL REFERENCES public.product_option_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, option_value_id),
  UNIQUE (variant_id, option_group_id)
);

CREATE INDEX IF NOT EXISTS idx_variant_options_variant_id ON public.product_variant_options(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_options_option_value_id ON public.product_variant_options(option_value_id);

ALTER TABLE public.product_variant_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage variant options"
ON public.product_variant_options
FOR ALL
USING (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "Authenticated users can view variant options"
ON public.product_variant_options
FOR SELECT
USING (has_role(auth.uid(), 'admin'::system_role));

-- ==========================================
-- PART 2: Add New Columns
-- ==========================================

-- 2a. Add `code` to products (replaces sku as product-line identifier)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code ON public.products(code) WHERE code IS NOT NULL;

-- 2b. Add `sort_order` to product_variants
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- ==========================================
-- PART 3: Data Migration
-- ==========================================

-- 3a. Populate products.code from existing products.sku
UPDATE public.products SET code = sku WHERE code IS NULL;

-- 3b. Create default variants for products without any variants
INSERT INTO public.product_variants (product_id, sku, name, wholesale_price, retail_price, status, barcode, sort_order)
SELECT
  p.id,
  p.sku,
  p.name,
  COALESCE(p.base_wholesale_price, 0),
  COALESCE(p.base_retail_price, 0),
  COALESCE(p.status, 'active'::product_status),
  p.barcode,
  0
FROM public.products p
WHERE (p.has_variants IS NULL OR p.has_variants = false)
AND NOT EXISTS (
  SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id
);

-- 3c. Migrate option_1/2/3 → new option system
DO $$
DECLARE
  v_product RECORD;
  v_group_id UUID;
  v_has_opt1 BOOLEAN;
  v_has_opt2 BOOLEAN;
  v_has_opt3 BOOLEAN;
  v_val RECORD;
  v_value_id UUID;
  v_group_sort INT;
BEGIN
  FOR v_product IN
    SELECT DISTINCT pv.product_id
    FROM public.product_variants pv
    WHERE pv.option_1 IS NOT NULL OR pv.option_2 IS NOT NULL OR pv.option_3 IS NOT NULL
  LOOP
    -- Check which option dimensions are used
    SELECT EXISTS(SELECT 1 FROM public.product_variants WHERE product_id = v_product.product_id AND option_1 IS NOT NULL) INTO v_has_opt1;
    SELECT EXISTS(SELECT 1 FROM public.product_variants WHERE product_id = v_product.product_id AND option_2 IS NOT NULL) INTO v_has_opt2;
    SELECT EXISTS(SELECT 1 FROM public.product_variants WHERE product_id = v_product.product_id AND option_3 IS NOT NULL) INTO v_has_opt3;

    v_group_sort := 0;

    -- option_1 → "規格" group
    IF v_has_opt1 THEN
      INSERT INTO public.product_option_groups (product_id, name, sort_order)
      VALUES (v_product.product_id, '規格', v_group_sort)
      RETURNING id INTO v_group_id;
      v_group_sort := v_group_sort + 1;

      FOR v_val IN
        SELECT DISTINCT option_1 AS val FROM public.product_variants
        WHERE product_id = v_product.product_id AND option_1 IS NOT NULL
      LOOP
        INSERT INTO public.product_option_values (group_id, label, value, sort_order)
        VALUES (v_group_id, v_val.val, v_val.val, 0)
        RETURNING id INTO v_value_id;

        INSERT INTO public.product_variant_options (variant_id, option_value_id, option_group_id)
        SELECT pv.id, v_value_id, v_group_id
        FROM public.product_variants pv
        WHERE pv.product_id = v_product.product_id AND pv.option_1 = v_val.val;
      END LOOP;
    END IF;

    -- option_2 → "類型" group
    IF v_has_opt2 THEN
      INSERT INTO public.product_option_groups (product_id, name, sort_order)
      VALUES (v_product.product_id, '類型', v_group_sort)
      RETURNING id INTO v_group_id;
      v_group_sort := v_group_sort + 1;

      FOR v_val IN
        SELECT DISTINCT option_2 AS val FROM public.product_variants
        WHERE product_id = v_product.product_id AND option_2 IS NOT NULL
      LOOP
        INSERT INTO public.product_option_values (group_id, label, value, sort_order)
        VALUES (v_group_id, v_val.val, v_val.val, 0)
        RETURNING id INTO v_value_id;

        INSERT INTO public.product_variant_options (variant_id, option_value_id, option_group_id)
        SELECT pv.id, v_value_id, v_group_id
        FROM public.product_variants pv
        WHERE pv.product_id = v_product.product_id AND pv.option_2 = v_val.val;
      END LOOP;
    END IF;

    -- option_3 → "顏色" group (preserve hex_code from product_colors)
    IF v_has_opt3 THEN
      INSERT INTO public.product_option_groups (product_id, name, sort_order)
      VALUES (v_product.product_id, '顏色', v_group_sort)
      RETURNING id INTO v_group_id;

      FOR v_val IN
        SELECT DISTINCT option_3 AS val FROM public.product_variants
        WHERE product_id = v_product.product_id AND option_3 IS NOT NULL
      LOOP
        INSERT INTO public.product_option_values (group_id, label, value, hex_code, sort_order)
        SELECT v_group_id, v_val.val, v_val.val, pc.hex_code, 0
        FROM (SELECT v_val.val AS val) src
        LEFT JOIN public.product_colors pc ON pc.name = src.val
        LIMIT 1
        RETURNING id INTO v_value_id;

        INSERT INTO public.product_variant_options (variant_id, option_value_id, option_group_id)
        SELECT pv.id, v_value_id, v_group_id
        FROM public.product_variants pv
        WHERE pv.product_id = v_product.product_id AND pv.option_3 = v_val.val;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- ==========================================
-- PART 4: Remove Old Columns & Constraints
-- ==========================================

-- 4a. Products: remove old columns

-- Drop triggers/functions that reference old columns
DROP TRIGGER IF EXISTS trg_sync_product_prices ON public.products;
DROP FUNCTION IF EXISTS public.trgfn_sync_product_prices();

-- Drop RLS policies that reference old columns
DROP POLICY IF EXISTS "Authenticated users can view active products" ON public.products;
DROP POLICY IF EXISTS "Admins can manage products" ON public.products;

ALTER TABLE public.products DROP COLUMN IF EXISTS has_variants;
ALTER TABLE public.products DROP COLUMN IF EXISTS base_retail_price;
ALTER TABLE public.products DROP COLUMN IF EXISTS base_wholesale_price;
ALTER TABLE public.products DROP COLUMN IF EXISTS sku;
ALTER TABLE public.products DROP COLUMN IF EXISTS status;
ALTER TABLE public.products DROP COLUMN IF EXISTS color;
ALTER TABLE public.products DROP COLUMN IF EXISTS model;
ALTER TABLE public.products DROP COLUMN IF EXISTS barcode;

-- Drop old indexes that are no longer needed
DROP INDEX IF EXISTS idx_products_barcode;

-- 4b. Product variants: remove old columns
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS option_1;
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS option_2;
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS option_3;
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS color;
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS table_settings;

-- ==========================================
-- PART 5: Version Triggers for New Tables
-- ==========================================

CREATE TRIGGER increment_product_option_groups_version
AFTER INSERT OR UPDATE OR DELETE ON public.product_option_groups
FOR EACH ROW
EXECUTE FUNCTION public.increment_data_version('product_option_groups');

CREATE TRIGGER increment_product_option_values_version
AFTER INSERT OR UPDATE OR DELETE ON public.product_option_values
FOR EACH ROW
EXECUTE FUNCTION public.increment_data_version('product_option_values');

CREATE TRIGGER increment_product_variant_options_version
AFTER INSERT OR UPDATE OR DELETE ON public.product_variant_options
FOR EACH ROW
EXECUTE FUNCTION public.increment_data_version('product_variant_options');

-- PART 6: Re-create RLS Policies for Products (no longer depend on status column)

CREATE POLICY "Authenticated users can view products"
ON public.products
FOR SELECT
USING (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "Admins can manage products"
ON public.products
FOR ALL
USING (has_role(auth.uid(), 'admin'::system_role));
