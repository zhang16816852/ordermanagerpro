-- 1. 建立 storefront_items 表
CREATE TABLE IF NOT EXISTS public.storefront_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
    model_id UUID REFERENCES public.device_models(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(variant_id, model_id) -- 確保同一個變體與型號不會產生重複的虛擬商品
);

-- 2. 為了前台效能，建立索引
CREATE INDEX IF NOT EXISTS idx_storefront_items_product_id ON public.storefront_items(product_id);
CREATE INDEX IF NOT EXISTS idx_storefront_items_variant_id ON public.storefront_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_storefront_items_model_id ON public.storefront_items(model_id);
CREATE INDEX IF NOT EXISTS idx_storefront_items_status ON public.storefront_items(status);

-- 3. 在 order_items 表新增 selected_model_name 欄位
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS selected_model_name TEXT;

-- 4. 建立同步 RPC
CREATE OR REPLACE FUNCTION public.sync_storefront_items(p_product_id UUID)
RETURNS void AS $$
DECLARE
    v_variant RECORD;
    v_model RECORD;
    v_display_name TEXT;
    v_slug TEXT;
    v_active_models UUID[];
BEGIN
    -- 對於該產品的每一個變體
    FOR v_variant IN 
        SELECT id, name FROM public.product_variants WHERE product_id = p_product_id
    LOOP
        v_active_models := ARRAY[]::UUID[];
        
        -- 找出所有關聯的型號 (直接關聯 + 群組關聯，並排除黑名單)
        FOR v_model IN
            WITH variant_models AS (
                -- 直接關聯的型號
                SELECT model_id FROM public.device_model_links 
                WHERE entity_id = v_variant.id AND entity_type = 'variant'
                UNION
                -- 產品層級直接關聯的型號
                SELECT model_id FROM public.device_model_links 
                WHERE entity_id = p_product_id AND entity_type = 'product'
                UNION
                -- 變體層級群組關聯的型號
                SELECT i.model_id FROM public.device_model_group_links gl
                JOIN public.device_model_group_items i ON gl.group_id = i.group_id
                WHERE gl.entity_id = v_variant.id AND gl.entity_type = 'variant'
                UNION
                -- 產品層級群組關聯的型號
                SELECT i.model_id FROM public.device_model_group_links gl
                JOIN public.device_model_group_items i ON gl.group_id = i.group_id
                WHERE gl.entity_id = p_product_id AND gl.entity_type = 'product'
            ),
            exclusions AS (
                -- 變體層級排除
                SELECT model_id FROM public.device_model_exclusions
                WHERE entity_id = v_variant.id AND entity_type = 'variant'
                UNION
                -- 產品層級排除
                SELECT model_id FROM public.device_model_exclusions
                WHERE entity_id = p_product_id AND entity_type = 'product'
            )
            SELECT m.id, m.name 
            FROM variant_models vm
            JOIN public.device_models m ON vm.model_id = m.id
            WHERE vm.model_id NOT IN (SELECT model_id FROM exclusions)
        LOOP
            -- 決定顯示名稱
            IF v_variant.name LIKE '%{model}%' THEN
                v_display_name := REPLACE(v_variant.name, '{model}', v_model.name);
            ELSE
                v_display_name := '(' || v_model.name || ') ' || v_variant.name;
            END IF;

            -- 產生唯一的 slug (確保 URL 友善與唯一性)
            -- 由於 PostgreSQL 原生產生友善 slug 較複雜，這裡使用簡單的 MD5 或組合字串
            -- 如果有擴充功能 (如 unaccent) 會更好，這裡先用 base64 或 hex 確保不衝突
            v_slug := 'item-' || encode(digest(v_variant.id::text || v_model.id::text, 'sha1'), 'hex');

            -- 寫入或更新 storefront_items
            INSERT INTO public.storefront_items (product_id, variant_id, model_id, display_name, slug, updated_at)
            VALUES (p_product_id, v_variant.id, v_model.id, v_display_name, v_slug, now())
            ON CONFLICT (variant_id, model_id) DO UPDATE 
            SET display_name = EXCLUDED.display_name,
                updated_at = now();

            v_active_models := array_append(v_active_models, v_model.id);
        END LOOP;

        -- 刪除不再關聯的虛擬商品
        DELETE FROM public.storefront_items 
        WHERE variant_id = v_variant.id 
        AND model_id != ALL(v_active_models);

    END LOOP;

    -- 如果產品沒有任何變體，我們應該刪除所有相關的 storefront_items
    DELETE FROM public.storefront_items
    WHERE product_id = p_product_id 
    AND variant_id NOT IN (SELECT id FROM public.product_variants WHERE product_id = p_product_id);

    -- 觸發版本更新
    PERFORM public.bump_data_version('storefront_items'::text, NULL::text);
END;
$$ LANGUAGE plpgsql;

-- 5. 如果系統有安裝 pgcrypto 才能用 digest，確保啟用
CREATE EXTENSION IF NOT EXISTS pgcrypto;
