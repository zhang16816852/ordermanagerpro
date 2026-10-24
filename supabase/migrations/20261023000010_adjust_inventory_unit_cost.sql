-- ============================================================
-- P5 / M5：adjust_inventory 寫入 inventory_movements.unit_cost
-- 檔名：20261023000010_adjust_inventory_unit_cost.sql
-- 依賴：20261023000008 (inventory_movements.unit_cost 欄位)
-- 可獨立驗證與回滾：是（CREATE OR REPLACE，冪等）
-- 說明：手動調整庫存時，從 product_variants.wholesale_price 或
--       最近一筆 purchase_receipt 的 unit_cost 取成本寫入 movement，
--       使 inventory_movements 成為庫存成本的單一計算值。
-- ============================================================

CREATE OR REPLACE FUNCTION public.adjust_inventory(
    p_id UUID,
    p_new_quantity INTEGER,
    p_created_by UUID,
    p_note TEXT DEFAULT NULL,
    p_unit_cost NUMERIC DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_old_quantity INTEGER;
    v_product_id UUID;
    v_variant_id UUID;
    v_warehouse_id UUID;
    v_diff INTEGER;
    v_unit_cost NUMERIC;
BEGIN
    SELECT quantity, product_id, variant_id, warehouse_id
      INTO v_old_quantity, v_product_id, v_variant_id, v_warehouse_id
      FROM public.product_inventory
     WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '庫存記錄不存在';
    END IF;

    v_diff := p_new_quantity - v_old_quantity;

    -- 成本取值：使用者指定 > 變體批發價 > 最近進貨成本 > NULL
    IF p_unit_cost IS NOT NULL THEN
        v_unit_cost := p_unit_cost;
    ELSIF v_variant_id IS NOT NULL THEN
        SELECT COALESCE(pv.wholesale_price, 0)
          INTO v_unit_cost
          FROM public.product_variants pv
         WHERE pv.id = v_variant_id;
        IF v_unit_cost = 0 THEN
            -- fallback：最近一筆 purchase_receipt 的 unit_cost
            SELECT im.unit_cost INTO v_unit_cost
              FROM public.inventory_movements im
             WHERE im.variant_id = v_variant_id
               AND im.source_type = 'purchase_receipt'
               AND im.unit_cost IS NOT NULL
             ORDER BY im.created_at DESC
             LIMIT 1;
        END IF;
    ELSE
        SELECT COALESCE(p.wholesale_price, 0)
          INTO v_unit_cost
          FROM public.products p
         WHERE p.id = v_product_id;
        IF v_unit_cost = 0 THEN
            SELECT im.unit_cost INTO v_unit_cost
              FROM public.inventory_movements im
             WHERE im.product_id = v_product_id
               AND im.source_type = 'purchase_receipt'
               AND im.unit_cost IS NOT NULL
             ORDER BY im.created_at DESC
             LIMIT 1;
        END IF;
    END IF;

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, note, unit_cost, created_by)
    VALUES (v_product_id, v_variant_id, v_warehouse_id, v_diff, 'manual_adjustment', p_note, v_unit_cost, p_created_by);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory(UUID, INTEGER, UUID, TEXT, NUMERIC) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(UUID, INTEGER, UUID, TEXT, NUMERIC) TO authenticated;

-- ============================================================
-- End of migration 000010
-- ============================================================
