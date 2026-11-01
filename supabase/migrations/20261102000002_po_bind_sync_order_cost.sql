-- 20261102000002 採購綁定時同步更新訂單品項成本
--
-- 問題：order_items.unit_cost 快照僅在出貨時（FIFO 消耗）才更新，
--       未出貨訂單的成本仍為 0，導致毛利/業務利潤顯示「成本未知」。
--       即使已綁定採購單，成本解析也不會自動反映 PO 單價。
--       使用者要求：有採購來源時，PO 成本優先於 FIFO 批次成本。
--
-- 修復：
--   1. 批次回填：所有已綁定的 order_items，從綁定的 PO 品項取 unit_cost 回填
--      （一律覆寫，包含已出貨訂單的 FIFO 成本，因為 PO 成本優先）
--   2. Trigger：當 purchase_order_items 的 source_order_ids 或 unit_cost
--      變更時，同步更新對應 order_items 的 unit_cost（一律覆寫）。
--
-- 注意：FIFO 批次成本仍保留在 inventory_movements.unit_cost 供追溯。
--       業務利潤（Business Profit）不使用 PO 成本，只用業務成本設定。

-- ============================================================================
-- 1. 批次回填既有資料（一律覆寫，不保留 FIFO 舊值）
-- ============================================================================
UPDATE public.order_items oi
SET unit_cost = poi.unit_cost,
    cost_recalculated_at = NOW()
FROM public.purchase_order_items poi
WHERE oi.order_id = ANY(poi.source_order_ids)
  AND oi.product_id = poi.product_id
  AND oi.variant_id IS NOT DISTINCT FROM poi.variant_id
  AND poi.unit_cost > 0
  AND poi.source_order_ids IS NOT NULL;

-- ============================================================================
-- 2. Trigger function：採購綁定時同步更新訂單品項成本（一律覆寫）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trgfn_sync_order_cost_from_po()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- 僅在 source_order_ids 有值且 unit_cost > 0 時同步
  IF NEW.source_order_ids IS NOT NULL
     AND array_length(NEW.source_order_ids, 1) > 0
     AND NEW.unit_cost > 0 THEN
    UPDATE public.order_items
    SET unit_cost = NEW.unit_cost,
        cost_recalculated_at = NOW()
    WHERE order_id = ANY(NEW.source_order_ids)
      AND product_id = NEW.product_id
      AND variant_id IS NOT DISTINCT FROM NEW.variant_id;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_sync_order_cost_from_po ON public.purchase_order_items;
CREATE TRIGGER trg_sync_order_cost_from_po
  AFTER INSERT OR UPDATE OF source_order_ids, unit_cost ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_sync_order_cost_from_po();