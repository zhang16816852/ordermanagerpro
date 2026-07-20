-- ============================================================
-- Migration: Add brand series, filter groups, and extend product_category_links
-- brand_series = 產品品牌的系列 (犀牛盾→CLEAR, MODNX)
-- device_brands = 適用裝置品牌 (Apple, Samsung) — 不同概念
-- ============================================================

-- 1. Add slug and logo fields to categories and device_brands
-- ============================================================

-- Categories: add slug
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON public.categories(slug) WHERE slug IS NOT NULL;

-- Device Brands: add slug, logo_url, banner_url
ALTER TABLE public.device_brands ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE public.device_brands ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.device_brands ADD COLUMN IF NOT EXISTS banner_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_brands_slug ON public.device_brands(slug) WHERE slug IS NOT NULL;


-- 2. Create brand_series table (產品品牌的系列)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.brand_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  description TEXT,
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_series_slug ON public.brand_series(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brand_series_brand_id ON public.brand_series(brand_id);

-- Enable RLS
ALTER TABLE public.brand_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to read brand_series"
  ON public.brand_series FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert brand_series"
  ON public.brand_series FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update brand_series"
  ON public.brand_series FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to delete brand_series"
  ON public.brand_series FOR DELETE TO authenticated USING (true);


-- 3. Create product_series_bindings table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_series_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  series_id UUID NOT NULL REFERENCES public.brand_series(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, series_id)
);

CREATE INDEX IF NOT EXISTS idx_psb_product_id ON public.product_series_bindings(product_id);
CREATE INDEX IF NOT EXISTS idx_psb_series_id ON public.product_series_bindings(series_id);

-- Enable RLS
ALTER TABLE public.product_series_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to read product_series_bindings"
  ON public.product_series_bindings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert product_series_bindings"
  ON public.product_series_bindings FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update product_series_bindings"
  ON public.product_series_bindings FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to delete product_series_bindings"
  ON public.product_series_bindings FOR DELETE TO authenticated USING (true);


-- 4. Extend product_category_links to support variant_id
-- ============================================================

ALTER TABLE public.product_category_links
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pcl_variant_id ON public.product_category_links(variant_id) WHERE variant_id IS NOT NULL;


-- 5. Create filter_groups table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.filter_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT,
  icon_url TEXT,
  filter_type TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.filter_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to read filter_groups"
  ON public.filter_groups FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert filter_groups"
  ON public.filter_groups FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update filter_groups"
  ON public.filter_groups FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to delete filter_groups"
  ON public.filter_groups FOR DELETE TO authenticated USING (true);


-- 6. Create filter_group_items table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.filter_group_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.filter_groups(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fgi_group_id ON public.filter_group_items(group_id);

-- Enable RLS
ALTER TABLE public.filter_group_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all authenticated users to read filter_group_items"
  ON public.filter_group_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert filter_group_items"
  ON public.filter_group_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update filter_group_items"
  ON public.filter_group_items FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to delete filter_group_items"
  ON public.filter_group_items FOR DELETE TO authenticated USING (true);


-- 7. Seed default filter groups
-- ============================================================

INSERT INTO public.filter_groups (name, slug, filter_type, sort_order) VALUES
  ('品牌分類', 'brand', 'brand', 1),
  ('型號分類', 'model', 'model', 2),
  ('熱門商品', 'hot', 'hot', 3),
  ('新品上市', 'new', 'new', 4)
ON CONFLICT DO NOTHING;
