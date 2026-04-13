-- 新增供應商導入配置表
CREATE TABLE public.supplier_import_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    mapping_config JSONB NOT NULL, -- 格式如: {"date": "日期", "ext_id": "產品編號", "ext_name": "品名", "qty": "數量", "cost": "單價"}
    header_row INTEGER DEFAULT 0,  -- 標題行索引 (0-indexed)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(supplier_id)
);

-- 備註說明：此表用於儲存每個供應商 Excel 檔案的欄位對應規則。

-- 新增供應商產品對照表
CREATE TABLE public.supplier_product_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
    vendor_product_id TEXT NOT NULL, -- 廠商的產品代號
    vendor_product_name TEXT,        -- 廠商的產品名稱 (協助識別)
    internal_product_id UUID NOT NULL REFERENCES public.products(id),
    internal_variant_id UUID REFERENCES public.product_variants(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(supplier_id, vendor_product_id)
);

-- 備註說明：此表用於儲存外部廠商產品編號與系統內部產品(及規格)的對應關係。

-- 啟用 RLS 並設定政策
ALTER TABLE public.supplier_import_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_product_mappings ENABLE ROW LEVEL SECURITY;

-- 允許已登入的管理員進行所有操作
CREATE POLICY "Admins can manage import configs" 
ON public.supplier_import_configs 
FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.system_role));

CREATE POLICY "Admins can manage product mappings" 
ON public.supplier_product_mappings 
FOR ALL 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.system_role));
