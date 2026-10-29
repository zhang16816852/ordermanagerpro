-- ============================================================
-- Cost FIFO Phase 1：_consume_fifo_batches helper
-- 依賴：20261023000008 (inventory_movements.unit_cost), product_batches, product_batch_inventory
-- ============================================================
-- 功能：FIFO 消耗批次，寫入 inventory_movements (batch_id + unit_cost + confirmed)
--      庫存不足時可標記為 suspense (pending_match)
-- ============================================================

CREATE OR REPLACE FUNCTION public._consume_fifo_batches(
  p_product_id UUID,
  p_variant_id UUID,
  p_warehouse_id UUID,
  p_quantity INTEGER,
  p_source_type TEXT,
  p_source_id UUID DEFAULT NULL,
  p_reference_code TEXT DEFAULT NULL,
  p_order_item_id UUID DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_is_suspense BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_remaining INTEGER := p_quantity;
  v_batch RECORD;
  v_consume_qty INTEGER;
  v_batch_inv RECORD;
  v_total_consumed INTEGER := 0;
  v_suspense_qty INTEGER := 0;
  v_movement_id UUID;
  v_unit_cost NUMERIC;
  v_details JSONB := '[]'::JSONB;
  v_warehouse_id UUID := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));
BEGIN
  IF p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'consumed', 0, 'suspense', 0, 'details', '[]'::JSONB);
  END IF;

  -- FIFO: 按 received_at ASC 消耗批次
  FOR v_batch IN
    SELECT pb.id AS batch_id, pb.unit_cost, pb.tracking_mode,
           pbi.id AS inv_id, pbi.quantity AS inv_qty, pbi.warehouse_id
    FROM public.product_batches pb
    JOIN public.product_batch_inventory pbi ON pbi.batch_id = pb.id
    WHERE pb.variant_id IS NOT DISTINCT FROM p_variant_id
      AND (p_variant_id IS NULL OR pb.variant_id = p_variant_id)
      AND pbi.warehouse_id = v_warehouse_id
      AND pbi.quantity > 0
      AND pb.status = 'active'
    ORDER BY pb.received_at ASC, pb.created_at ASC
    FOR UPDATE OF pbi
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_consume_qty := LEAST(v_remaining, v_batch.inv_qty);
    IF v_consume_qty <= 0 THEN
      CONTINUE;
    END IF;

    v_unit_cost := COALESCE(v_batch.unit_cost, 0);

    -- 寫入 inventory_movement (confirmed, with batch_id)
    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, balance_after,
      source_type, source_id, reference_code, batch_id, unit_cost,
      cost_match_status, order_item_id, created_by
    )
    VALUES (
      p_product_id, p_variant_id, v_warehouse_id, -v_consume_qty, 0,
      p_source_type, p_source_id, p_reference_code, v_batch.batch_id,
      v_unit_cost, 'confirmed', p_order_item_id, p_created_by
    )
    RETURNING id INTO v_movement_id;

    -- 更新 batch_inventory
    UPDATE public.product_batch_inventory
    SET quantity = quantity - v_consume_qty,
        updated_at = NOW()
    WHERE id = v_batch.inv_id;

    -- 更新 product_inventory available_quantity
    UPDATE public.product_inventory
    SET available_quantity = GREATEST(0, available_quantity - v_consume_qty),
        updated_at = NOW()
    WHERE product_id = p_product_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id
      AND warehouse_id = v_warehouse_id;

    v_remaining := v_remaining - v_consume_qty;
    v_total_consumed := v_total_consumed + v_consume_qty;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch.batch_id,
      'movement_id', v_movement_id,
      'consumed_qty', v_consume_qty,
      'unit_cost', v_unit_cost
    ));
  END LOOP;

  -- 庫存不足：寫入 suspense movement (pending_match)
  IF v_remaining > 0 AND p_is_suspense THEN
    v_suspense_qty := v_remaining;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, balance_after,
      source_type, source_id, reference_code, batch_id, unit_cost,
      cost_match_status, order_item_id, created_by
    )
    VALUES (
      p_product_id, p_variant_id, v_warehouse_id, -v_suspense_qty, 0,
      p_source_type, p_source_id, p_reference_code, NULL,
      NULL, 'pending_match', p_order_item_id, p_created_by
    )
    RETURNING id INTO v_movement_id;

    -- 更新 suspense_quantity
    UPDATE public.product_inventory
    SET suspense_quantity = suspense_quantity + v_suspense_qty,
        updated_at = NOW()
    WHERE product_id = p_product_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id
      AND warehouse_id = v_warehouse_id;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'movement_id', v_movement_id,
      'suspense_qty', v_suspense_qty,
      'status', 'pending_match'
    ));

    v_remaining := 0;
  END IF;

  -- 更新 product_inventory 總量（trigger 會同步，但這裡確保 available 正確）
  -- balance_after 由 trigger trg_sync_inventory_on_movement 處理

  RETURN jsonb_build_object(
    'ok', true,
    'consumed', v_total_consumed,
    'suspense', v_suspense_qty,
    'total_requested', p_quantity,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public._consume_fifo_batches(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT, UUID, UUID, BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._consume_fifo_batches(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT, UUID, UUID, BOOLEAN) TO authenticated;

-- ============================================================
-- End of migration 20261029000001
-- ============================================================