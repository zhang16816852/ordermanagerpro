-- ============================================================
-- Fix: _consume_fifo_batches 使用不存在的 source_id 欄位
-- 改用依 source_type 對應的 FK 欄位
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

  FOR v_batch IN
    SELECT pb.id AS batch_id, pb.unit_cost,
           pbi.id AS inv_id, pbi.quantity AS inv_qty
    FROM public.product_batches pb
    JOIN public.product_batch_inventory pbi ON pbi.batch_id = pb.id
    WHERE pb.variant_id IS NOT DISTINCT FROM p_variant_id
      AND pbi.warehouse_id = v_warehouse_id
      AND pbi.quantity > 0
      AND pb.status = 'active'
    ORDER BY pb.received_at ASC, pb.created_at ASC
    FOR UPDATE OF pbi
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_consume_qty := LEAST(v_remaining, v_batch.inv_qty);
    IF v_consume_qty <= 0 THEN CONTINUE; END IF;
    v_unit_cost := COALESCE(v_batch.unit_cost, 0);

    -- 依 source_type 寫入對應 FK 欄位
    IF p_source_type = 'sales_shipment' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, sales_note_id, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_consume_qty, 0,
        p_source_type, p_source_id, p_reference_code, v_batch.batch_id,
        v_unit_cost, 'confirmed', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    ELSIF p_source_type = 'consignment_out_shipment' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, consignment_order_id, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_consume_qty, 0,
        p_source_type, p_source_id, p_reference_code, v_batch.batch_id,
        v_unit_cost, 'confirmed', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    ELSIF p_source_type = 'purchase_receipt' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, purchase_order_id, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_consume_qty, 0,
        p_source_type, p_source_id, p_reference_code, v_batch.batch_id,
        v_unit_cost, 'confirmed', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    ELSIF p_source_type = 'repair_part_usage' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, repair_order_id, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_consume_qty, 0,
        p_source_type, p_source_id, p_reference_code, v_batch.batch_id,
        v_unit_cost, 'confirmed', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    ELSE
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_consume_qty, 0,
        p_source_type, p_reference_code, v_batch.batch_id,
        v_unit_cost, 'confirmed', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    END IF;

    UPDATE public.product_batch_inventory
    SET quantity = quantity - v_consume_qty, updated_at = NOW()
    WHERE id = v_batch.inv_id;

    UPDATE public.product_inventory
    SET available_quantity = GREATEST(0, available_quantity - v_consume_qty),
        updated_at = NOW()
    WHERE product_id = p_product_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id
      AND warehouse_id = v_warehouse_id;

    v_remaining := v_remaining - v_consume_qty;
    v_total_consumed := v_total_consumed + v_consume_qty;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'batch_id', v_batch.batch_id, 'movement_id', v_movement_id,
      'consumed_qty', v_consume_qty, 'unit_cost', v_unit_cost
    ));
  END LOOP;

  IF v_remaining > 0 AND p_is_suspense THEN
    v_suspense_qty := v_remaining;

    IF p_source_type = 'sales_shipment' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, sales_note_id, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_suspense_qty, 0,
        p_source_type, p_source_id, p_reference_code, NULL,
        NULL, 'pending_match', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    ELSIF p_source_type = 'consignment_out_shipment' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, consignment_order_id, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_suspense_qty, 0,
        p_source_type, p_source_id, p_reference_code, NULL,
        NULL, 'pending_match', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    ELSE
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, reference_code, batch_id, unit_cost,
        cost_match_status, order_item_id, created_by
      )
      VALUES (
        p_product_id, p_variant_id, v_warehouse_id, -v_suspense_qty, 0,
        p_source_type, p_reference_code, NULL,
        NULL, 'pending_match', p_order_item_id, p_created_by
      )
      RETURNING id INTO v_movement_id;
    END IF;

    UPDATE public.product_inventory
    SET suspense_quantity = suspense_quantity + v_suspense_qty,
        updated_at = NOW()
    WHERE product_id = p_product_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id
      AND warehouse_id = v_warehouse_id;

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'movement_id', v_movement_id, 'suspense_qty', v_suspense_qty,
      'status', 'pending_match'
    ));

    v_remaining := 0;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'consumed', v_total_consumed, 'suspense', v_suspense_qty,
    'total_requested', p_quantity, 'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public._consume_fifo_batches(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT, UUID, UUID, BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._consume_fifo_batches(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT, UUID, UUID, BOOLEAN) TO authenticated;