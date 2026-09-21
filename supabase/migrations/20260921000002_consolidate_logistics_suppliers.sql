-- ============================================================
-- 20260921000002_consolidate_logistics_suppliers.sql
-- 修復 Phase A 資料：轉入運費商品時誤「每變體一間供應商」，
-- 整併回「整產品一間」（僅調整 delivery_methods 指向，刪除孤兒供應商）。
-- ⚠️ 已套用遠端；本檔保留為紀錄（內容與已執行一致：重指 + 刪除未參照者）。
-- ============================================================

DROP TABLE IF EXISTS public._tmp_dm_method_supplier CASCADE;
CREATE TEMP TABLE _tmp_dm_method_supplier AS
SELECT dm.id AS method_id, dm.supplier_id FROM public.delivery_methods dm;

DO $$
DECLARE
  v_canonical uuid;
  v_dup uuid;
BEGIN
  SELECT s.id INTO v_canonical
  FROM public.suppliers s
  JOIN public.delivery_methods dm ON dm.supplier_id = s.id
  WHERE s.is_logistics_company
  GROUP BY s.id
  HAVING count(dm.id) >= 1
  ORDER BY s.created_at, s.id
  LIMIT 1;

  IF v_canonical IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.delivery_methods dm
  SET supplier_id = v_canonical
  WHERE dm.supplier_id <> v_canonical
    AND dm.supplier_id IN (
      SELECT s.id FROM public.suppliers s
      WHERE s.is_logistics_company
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_product_mappings spm WHERE spm.supplier_id = s.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.purchase_orders po WHERE po.supplier_id = s.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.products p WHERE p.supplier_id = s.id
        )
    );

  FOR v_dup IN
    SELECT DISTINCT s.id
    FROM public.suppliers s
    JOIN _tmp_dm_method_supplier t ON t.supplier_id = s.id
    WHERE s.is_logistics_company AND s.id <> v_canonical
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_methods WHERE supplier_id = v_dup
    ) AND NOT EXISTS (
      SELECT 1 FROM public.supplier_product_mappings WHERE supplier_id = v_dup
    ) AND NOT EXISTS (
      SELECT 1 FROM public.purchase_orders WHERE supplier_id = v_dup
    ) AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE supplier_id = v_dup
    ) THEN
      DELETE FROM public.suppliers WHERE id = v_dup;
    END IF;
  END LOOP;
END;
$$;