-- ============================================================
-- P5 / M6：inventory_movements BEFORE INSERT trigger 自動填補 unit_cost
-- 檔名：20261023000011_inventory_movement_unit_cost_trigger.sql
-- 依賴：20261023000008 (inventory_movements.unit_cost 欄位)
-- 可獨立驗證與回滾：是
-- 說明：
--   為了讓 inventory_movements 成為庫存成本的「單一計算值」，
--   而不必逐一修改 9+ 支 RPC 的 INSERT 陳述式，
--   建立 BEFORE INSERT trigger：當 unit_cost 為 NULL 時，
--   依優先序自動填補：
--     1. batch_id 對應的 product_batches.unit_cost（追蹤品項）
--     2. 同變體/商品最近一筆 purchase_receipt 的 unit_cost
--     3. product_variants.wholesale_price / products.wholesale_price
--   已明確設定 unit_cost 的 INSERT（如 receive_purchase_items、adjust_inventory）
--   不會被覆寫（trigger 先檢查 NEW.unit_cost IS NOT NULL）。
--   未來新增的 RPC 只要不帶 unit_cost，trigger 會自動填補。
-- ============================================================

CREATE OR REPLACE FUNCTION public.trgfn_inventory_movement_unit_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.unit_cost IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Priority 1: batch cost（追蹤品項：serial / batch）
  IF NEW.batch_id IS NOT NULL THEN
    SELECT pb.unit_cost INTO NEW.unit_cost
      FROM public.product_batches pb
     WHERE pb.id = NEW.batch_id;
  END IF;

  -- Priority 2: 同變體最近一筆進貨成本
  IF NEW.unit_cost IS NULL AND NEW.variant_id IS NOT NULL THEN
    SELECT im.unit_cost INTO NEW.unit_cost
      FROM public.inventory_movements im
     WHERE im.variant_id = NEW.variant_id
       AND im.source_type = 'purchase_receipt'
       AND im.unit_cost IS NOT NULL
     ORDER BY im.created_at DESC
     LIMIT 1;
  END IF;

  -- Priority 3: 同商品（無變體）最近一筆進貨成本
  IF NEW.unit_cost IS NULL AND NEW.variant_id IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT im.unit_cost INTO NEW.unit_cost
      FROM public.inventory_movements im
     WHERE im.product_id = NEW.product_id
       AND im.source_type = 'purchase_receipt'
       AND im.unit_cost IS NOT NULL
     ORDER BY im.created_at DESC
     LIMIT 1;
  END IF;

  -- Priority 4: 變體批發價
  IF NEW.unit_cost IS NULL AND NEW.variant_id IS NOT NULL THEN
    SELECT NULLIF(pv.wholesale_price, 0) INTO NEW.unit_cost
      FROM public.product_variants pv
     WHERE pv.id = NEW.variant_id;
  END IF;

  -- Priority 5: 商品統一批發價（products 無 wholesale_price 欄，僅 unified_wholesale_price）
  IF NEW.unit_cost IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT NULLIF(p.unified_wholesale_price, 0) INTO NEW.unit_cost
      FROM public.products p
     WHERE p.id = NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_movement_unit_cost ON public.inventory_movements;
CREATE TRIGGER trg_inventory_movement_unit_cost
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_inventory_movement_unit_cost();

REVOKE ALL ON FUNCTION public.trgfn_inventory_movement_unit_cost() FROM public, anon, authenticated;

-- ============================================================
-- End of migration 000011
-- ============================================================
