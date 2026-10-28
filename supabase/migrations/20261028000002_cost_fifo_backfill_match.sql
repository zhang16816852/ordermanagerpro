-- ============================================================
-- Cost FIFO Phase 2：後補配對 helper _backfill_match_batches
-- 依賴：20261028000001 (schema), 20261023000005 (receive landed cost)
-- ============================================================

CREATE OR REPLACE FUNCTION public._backfill_match_batches(
  p_purchase_order_item_id UUID,
  p_new_batch_id UUID,
  p_variant_id UUID,
  p_product_id UUID,
  p_available_qty INTEGER,
  p_receipt_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_batch_unit_cost NUMERIC;
  v_remaining_qty INTEGER := p_available_qty;
  v_matched_count INTEGER := 0;
  v_matched_qty INTEGER := 0;
  v_movement RECORD;
  v_match_qty INTEGER;
  v_po_source_orders JSONB;
  v_directed_order_ids UUID[];
  v_details JSONB := '[]'::JSONB;
BEGIN
  -- 取得新批次的 unit_cost
  SELECT unit_cost INTO v_batch_unit_cost
  FROM public.product_batches
  WHERE id = p_new_batch_id;

  IF v_batch_unit_cost IS NULL THEN
    v_batch_unit_cost := 0;
  END IF;

  -- 取得 PO item 的 source_order_ids（定向配對用）
  SELECT poi.source_quantities INTO v_po_source_orders
  FROM public.purchase_order_items poi
  WHERE poi.id = p_purchase_order_item_id;

  -- Step A：定向配對（優先匹配 source_order_ids 中的訂單）
  IF v_po_source_orders IS NOT NULL AND jsonb_typeof(v_po_source_orders) = 'object' THEN
    v_directed_order_ids := ARRAY(
      SELECT (key)::UUID FROM jsonb_object_keys(v_po_source_orders) AS key
    );

    FOR v_movement IN
      SELECT im.id, im.quantity_change, im.order_item_id, im.created_at
      FROM public.inventory_movements im
      WHERE im.cost_match_status = 'pending_match'
        AND im.batch_id IS NULL
        AND (im.variant_id IS NOT DISTINCT FROM p_variant_id)
        AND (p_variant_id IS NULL OR im.product_id = p_product_id)
        AND im.order_item_id IN (
          SELECT oi.id FROM public.order_items oi
          WHERE oi.order_id = ANY(v_directed_order_ids)
            AND (oi.variant_id IS NOT DISTINCT FROM p_variant_id)
        )
      ORDER BY im.created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_qty <= 0;

      v_match_qty := LEAST(v_remaining_qty, ABS(v_movement.quantity_change));
      IF v_match_qty <= 0 THEN
        CONTINUE;
      END IF;

      -- 更新 movement
      UPDATE public.inventory_movements
      SET matched_batch_id = p_new_batch_id,
          cost_match_status = 'matched',
          unit_cost = v_batch_unit_cost,
          original_cost_status = COALESCE(original_cost_status, cost_match_status)
      WHERE id = v_movement.id;

      -- 寫入配對明細
      INSERT INTO public.inventory_movement_cost_allocations (movement_id, batch_id, matched_quantity, unit_cost)
      VALUES (v_movement.id, p_new_batch_id, v_match_qty, v_batch_unit_cost)
      ON CONFLICT (movement_id, batch_id) DO UPDATE
        SET matched_quantity = inventory_movement_cost_allocations.matched_quantity + EXCLUDED.matched_quantity;

      -- 更新 order_item
      IF v_movement.order_item_id IS NOT NULL THEN
        UPDATE public.order_items
        SET cost_source_batch_id = p_new_batch_id,
            cost_match_status = 'matched',
            cost_recalculated_at = NOW()
        WHERE id = v_movement.order_item_id;
      END IF;

      v_remaining_qty := v_remaining_qty - v_match_qty;
      v_matched_count := v_matched_count + 1;
      v_matched_qty := v_matched_qty + v_match_qty;

      v_details := v_details || jsonb_build_object(
        'movement_id', v_movement.id,
        'matched_qty', v_match_qty,
        'directed', true
      );
    END LOOP;
  END IF;

  -- Step B：FIFO 追溯（匹配剩餘的懸空 movement）
  IF v_remaining_qty > 0 THEN
    FOR v_movement IN
      SELECT im.id, im.quantity_change, im.order_item_id, im.created_at
      FROM public.inventory_movements im
      WHERE im.cost_match_status = 'pending_match'
        AND im.batch_id IS NULL
        AND (im.variant_id IS NOT DISTINCT FROM p_variant_id)
        AND (p_variant_id IS NULL OR im.product_id = p_product_id)
      ORDER BY im.created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_qty <= 0;

      v_match_qty := LEAST(v_remaining_qty, ABS(v_movement.quantity_change));
      IF v_match_qty <= 0 THEN
        CONTINUE;
      END IF;

      UPDATE public.inventory_movements
      SET matched_batch_id = p_new_batch_id,
          cost_match_status = 'matched',
          unit_cost = v_batch_unit_cost,
          original_cost_status = COALESCE(original_cost_status, cost_match_status)
      WHERE id = v_movement.id;

      INSERT INTO public.inventory_movement_cost_allocations (movement_id, batch_id, matched_quantity, unit_cost)
      VALUES (v_movement.id, p_new_batch_id, v_match_qty, v_batch_unit_cost)
      ON CONFLICT (movement_id, batch_id) DO UPDATE
        SET matched_quantity = inventory_movement_cost_allocations.matched_quantity + EXCLUDED.matched_quantity;

      IF v_movement.order_item_id IS NOT NULL THEN
        UPDATE public.order_items
        SET cost_source_batch_id = p_new_batch_id,
            cost_match_status = 'matched',
            cost_recalculated_at = NOW()
        WHERE id = v_movement.order_item_id;
      END IF;

      v_remaining_qty := v_remaining_qty - v_match_qty;
      v_matched_count := v_matched_count + 1;
      v_matched_qty := v_matched_qty + v_match_qty;

      v_details := v_details || jsonb_build_object(
        'movement_id', v_movement.id,
        'matched_qty', v_match_qty,
        'directed', false
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'matched_count', v_matched_count,
    'matched_qty', v_matched_qty,
    'remaining_qty', v_remaining_qty,
    'batch_unit_cost', v_batch_unit_cost,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public._backfill_match_batches(UUID, UUID, UUID, UUID, INTEGER, UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._backfill_match_batches(UUID, UUID, UUID, UUID, INTEGER, UUID) TO authenticated;

-- ============================================================
-- End of migration 20261028000002
-- ============================================================