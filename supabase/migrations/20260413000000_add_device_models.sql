-- 1. 建立「型號標籤庫」
CREATE TABLE public.device_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES public.brands(id), -- 日後若需用品牌(Apple/Samsung)收納分類可選填
    name TEXT NOT NULL,                         -- 標籤名稱 (例: iPhone 15 Pro Max)
    sort_order INTEGER DEFAULT 0,               -- 排序權重
    is_active BOOLEAN DEFAULT true,             -- 開關 (淘汰不用的舊型號)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(name)
);

-- 2. 建立「產品與型號關聯表」(多對多)
CREATE TABLE public.product_model_links (
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    model_id UUID REFERENCES public.device_models(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (product_id, model_id)
);

-- 3. 設定 RLS (Row Level Security)
ALTER TABLE public.device_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_model_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage device models" 
ON public.device_models FOR ALL TO authenticated 
USING (public.has_role(auth.uid(), 'admin'::public.system_role));

CREATE POLICY "Admins can manage product model links" 
ON public.product_model_links FOR ALL TO authenticated 
USING (public.has_role(auth.uid(), 'admin'::public.system_role));

-- 針對前台/銷售人員，允許讀取權限
CREATE POLICY "Users can view device models" 
ON public.device_models FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can view product model links" 
ON public.product_model_links FOR SELECT TO authenticated USING (true);
