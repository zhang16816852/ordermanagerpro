-- 1. 建立獨立的設備品牌表
CREATE TABLE public.device_brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 設定 RLS
ALTER TABLE public.device_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage device brands" ON public.device_brands FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.system_role));
CREATE POLICY "Users can view device brands" ON public.device_brands FOR SELECT TO authenticated USING (true);


-- 3. 移除原本掛在產品 brands 表上的關聯
ALTER TABLE public.device_models DROP CONSTRAINT IF EXISTS device_models_brand_id_fkey;

-- 4. 清除任何已被設定的錯誤外鍵資料 (因為它們原本對應到產品品牌)
UPDATE public.device_models SET brand_id = NULL;

-- 5. 重新建立關聯到新的 device_brands 表
ALTER TABLE public.device_models ADD CONSTRAINT device_models_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.device_brands(id) ON DELETE SET NULL;
