-- ============================================================================
-- sync_variant_product_transfer
-- 原子化同步「變體轉移至新主產品」後的附屬資料一致性
--
-- 當產品匯入將既有變體 (product_variants.product_id) 更新為新主產品時，
-- 其餘以 variant_id / product_id 為鍵的附屬表 (庫存帳、門市價格、供應商對照、
-- 庫存異動 audit trail) 必須同步，避免「變體已移、帳仍指舊產品」的半套狀態。
--
-- 授權：僅 admin；SECURITY DEFINER；search_path 固定。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_variant_product_transfer(
    p_old_product_id uuid,
    p_new_product_id uuid,
    p_variant_ids    uuid[],
    p_sync_movements boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated_inventory  int := 0;
    v_updated_store      int := 0;
    v_updated_mappings   int := 0;
    v_updated_movements  int := 0;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
        RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行變體轉移同步');
    END IF;

    IF p_old_product_id IS NULL OR p_new_product_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', '新/舊產品 id 不可為空');
    END IF;

    IF p_variant_ids IS NULL OR array_length(p_variant_ids, 1) IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'updated_inventory', 0, 'updated_store_products', 0,
                                  'updated_mappings', 0, 'updated_movements', 0);
    END IF;

    -- 1. 庫存帳：variant_id 不變，product_id 歸到新產品
    UPDATE public.product_inventory
       SET product_id = p_new_product_id
     WHERE variant_id = ANY(p_variant_ids);
    GET DIAGNOSTICS v_updated_inventory = ROW_COUNT;

    -- 2. 門市價格：變體層級列 + 統一價格的產品層級列 (variant_id IS NULL)
    UPDATE public.store_products
       SET product_id = p_new_product_id
     WHERE variant_id = ANY(p_variant_ids)
        OR (variant_id IS NULL AND product_id = p_old_product_id);
    GET DIAGNOSTICS v_updated_store = ROW_COUNT;

    -- 3. 供應商對照：internal_product_id 與 internal_variant_id 保持一致
    UPDATE public.supplier_product_mappings
       SET internal_product_id = p_new_product_id
     WHERE internal_variant_id = ANY(p_variant_ids);
    GET DIAGNOSTICS v_updated_mappings = ROW_COUNT;

    -- 4. 庫存異動 audit trail（依呼叫端決定是否同步）
    IF p_sync_movements THEN
        UPDATE public.inventory_movements
           SET product_id = p_new_product_id
         WHERE variant_id = ANY(p_variant_ids);
        GET DIAGNOSTICS v_updated_movements = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'updated_inventory',     v_updated_inventory,
        'updated_store_products', v_updated_store,
        'updated_mappings',      v_updated_mappings,
        'updated_movements',     v_updated_movements
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_variant_product_transfer(uuid, uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_variant_product_transfer(uuid, uuid, uuid[], boolean) TO authenticated;