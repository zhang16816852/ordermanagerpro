-- 1. 新增 product_status ENUM 值
ALTER TYPE product_status ADD VALUE IF NOT EXISTS 'preorder';
ALTER TYPE product_status ADD VALUE IF NOT EXISTS 'sold_out';

-- 2. 新增 Products 表欄位
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS series TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS table_settings JSONB DEFAULT '{}';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS has_variants BOOLEAN DEFAULT false;

-- 3. 建立 barcode 唯一索引（允許 NULL）
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode) WHERE barcode IS NOT NULL;

-- 4. 建立 Product Variants 表
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT,
  color TEXT,
  option_1 TEXT,
  option_2 TEXT,
  option_3 TEXT,
  wholesale_price NUMERIC NOT NULL DEFAULT 0,
  retail_price NUMERIC NOT NULL DEFAULT 0,
  table_settings JSONB DEFAULT '{}',
  status product_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. 建立索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_sku ON public.product_variants(sku);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants(product_id);

-- 6. 更新 store_products 支援變體
ALTER TABLE public.store_products ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_store_products_variant ON public.store_products(variant_id);

-- 7. 啟用 RLS
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- 8. RLS 政策
CREATE POLICY "Admins can manage product variants"
ON public.product_variants
FOR ALL
USING (has_role(auth.uid(), 'admin'::system_role));

CREATE POLICY "Authenticated users can view active variants"
ON public.product_variants
FOR SELECT
USING ((status = 'active'::product_status) OR has_role(auth.uid(), 'admin'::system_role));

-- 9. 更新時間觸發器
CREATE TRIGGER update_product_variants_updated_at
BEFORE UPDATE ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- 10. 版本追蹤觸發器
CREATE TRIGGER increment_product_variants_version
AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
FOR EACH ROW
EXECUTE FUNCTION public.increment_data_version('product_variants');