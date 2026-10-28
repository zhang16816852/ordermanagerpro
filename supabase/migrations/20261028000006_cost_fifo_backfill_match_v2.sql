-- ============================================================
-- Cost FIFO Phase 3：重發 _backfill_match_batches
-- 新增：匹配時同步更新 order_items.unit_cost + 佣金差額檢查
-- 依賴：20261028000005 (_check_commission_adjustment)
-- ============================================================

-- 由於函式體積大，此 migration 以 CREATE OR REPLACE 重發
-- 僅在 UPDATE order_items 時加入 unit_cost 更新 + _check_commission_adjustment 呼叫

-- 為避免重複 150 行 SQL，改用 trigger 方式：
-- 在 inventory_movement_cost_allocations AFTER INSERT 時，
-- 查找對應 order_item，更新 unit_cost，並檢查佣金差額

CREATE OR REPLACE FUNCTION public.trgfn_post_match_cost_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_movement RECORD;
  v_old_unit_cost NUMERIC;
  v_new_unit_cost NUMERIC;
  v_order_item_id UUID;
BEGIN
  -- 取得 movement 資訊
  SELECT im.order_item_id, im.unit_cost INTO v_movement
  FROM public.inventory_movements im
  WHERE im.id = NEW.movement_id;

  v_order_item_id := v_movement.order_item_id;
  IF v_order_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 取得 order_item 目前的 unit_cost（old）
  SELECT oi.unit_cost INTO v_old_unit_cost
  FROM public.order_items oi
  WHERE oi.id = v_order_item_id;

  -- 取得新 unit_cost（from batch）
  v_new_unit_cost := NEW.unit_cost;

  -- 更新 order_item unit_cost
  UPDATE public.order_items
  SET unit_cost = v_new_unit_cost,
      cost_source_batch_id = NEW.batch_id,
      cost_match_status = 'matched',
      cost_recalculated_at = NOW()
  WHERE id = v_order_item_id;

  -- 檢查佣金差額
  PERFORM public._check_commission_adjustment(
    v_order_item_id,
    v_old_unit_cost,
    v_new_unit_cost,
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_match_cost_update ON public.inventory_movement_cost_allocations;
CREATE TRIGGER trg_post_match_cost_update
  AFTER INSERT ON public.inventory_movement_cost_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.trgfn_post_match_cost_update();

REVOKE ALL ON FUNCTION public.trgfn_post_match_cost_update() FROM public, anon, authenticated;

-- ============================================================
-- End of migration 20261028000006
-- ============================================================