-- ============================================================
-- Cost FIFO Phase 4：驗算 RPC reconcile_fifo_integrity
-- 依賴：20261028000001 (schema)
-- ============================================================

CREATE OR REPLACE FUNCTION public.reconcile_fifo_integrity(
  p_product_id UUID DEFAULT NULL,
  p_variant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_checks JSONB := '[]'::JSONB;
  v_ok BOOLEAN := true;
  v_detail JSONB;
  -- Check 1: inventory_movements sum = product_inventory.quantity
  v_movement_qty INTEGER;
  v_inventory_qty INTEGER;
  -- Check 2: product_batch_inventory sum = product_inventory.quantity
  v_batch_inv_qty INTEGER;
  -- Check 3: matched + remaining = total suspense
  v_suspense_total INTEGER;
  v_matched_total INTEGER;
  v_pending_total INTEGER;
  -- Check 4: consumed_quantity <= received_quantity
  v_over_consumed INTEGER;
  -- Check 5: allocation sum <= movement qty
  v_over_allocated INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Check 1: movement sum per (product, variant, warehouse) = inventory quantity
  FOR v_detail IN
    SELECT im.product_id, im.variant_id, im.warehouse_id,
           COALESCE(SUM(im.quantity_change), 0) AS movement_qty,
           COALESCE(pi.quantity, 0) AS inventory_qty
    FROM public.inventory_movements im
    LEFT JOIN public.product_inventory pi
      ON pi.product_id = im.product_id
     AND pi.variant_id IS NOT DISTINCT FROM im.variant_id
     AND pi.warehouse_id = im.warehouse_id
    WHERE (p_product_id IS NULL OR im.product_id = p_product_id)
      AND (p_variant_id IS NULL OR im.variant_id IS NOT DISTINCT FROM p_variant_id)
    GROUP BY im.product_id, im.variant_id, im.warehouse_id, pi.quantity
  LOOP
    IF (v_detail->>'movement_qty')::INTEGER <> (v_detail->>'inventory_qty')::INTEGER THEN
      v_ok := false;
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'check', 'movement_vs_inventory',
        'status', 'FAIL',
        'product_id', v_detail->>'product_id',
        'variant_id', v_detail->>'variant_id',
        'warehouse_id', v_detail->>'warehouse_id',
        'movement_qty', (v_detail->>'movement_qty')::INTEGER,
        'inventory_qty', (v_detail->>'inventory_qty')::INTEGER,
        'delta', (v_detail->>'movement_qty')::INTEGER - (v_detail->>'inventory_qty')::INTEGER
      ));
    ELSE
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'check', 'movement_vs_inventory',
        'status', 'PASS',
        'product_id', v_detail->>'product_id',
        'variant_id', v_detail->>'variant_id',
        'warehouse_id', v_detail->>'warehouse_id'
      ));
    END IF;
  END LOOP;

  -- Check 2: batch_inventory sum per (product, variant) = inventory quantity
  FOR v_detail IN
    SELECT pb.variant_id,
           (SELECT pv.product_id FROM public.product_variants pv WHERE pv.id = pb.variant_id) AS product_id,
           COALESCE(SUM(pbi.quantity), 0) AS batch_qty
    FROM public.product_batches pb
    JOIN public.product_batch_inventory pbi ON pbi.batch_id = pb.id
    WHERE (p_variant_id IS NULL OR pb.variant_id IS NOT DISTINCT FROM p_variant_id)
    GROUP BY pb.variant_id
  LOOP
    SELECT COALESCE(SUM(pi.quantity), 0) INTO v_inventory_qty
    FROM public.product_inventory pi
    WHERE pi.variant_id IS NOT DISTINCT FROM (v_detail->>'variant_id')::UUID
      AND (p_product_id IS NULL OR pi.product_id = p_product_id);

    IF (v_detail->>'batch_qty')::INTEGER <> v_inventory_qty THEN
      v_ok := false;
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'check', 'batch_vs_inventory',
        'status', 'FAIL',
        'variant_id', v_detail->>'variant_id',
        'batch_qty', (v_detail->>'batch_qty')::INTEGER,
        'inventory_qty', v_inventory_qty
      ));
    ELSE
      v_checks := v_checks || jsonb_build_array(jsonb_build_object(
        'check', 'batch_vs_inventory',
        'status', 'PASS',
        'variant_id', v_detail->>'variant_id'
      ));
    END IF;
  END LOOP;

  -- Check 3: suspense movements (pending_match + matched + unmatched counts)
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE cost_match_status = 'pending_match'), 0),
    COALESCE(COUNT(*) FILTER (WHERE cost_match_status = 'matched'), 0)
  INTO v_pending_total, v_matched_total
  FROM public.inventory_movements
  WHERE source_type IN ('sales_shipment','consignment_out_shipment','repair_part_usage')
    AND (p_product_id IS NULL OR product_id = p_product_id)
    AND (p_variant_id IS NULL OR variant_id IS NOT DISTINCT FROM p_variant_id);

  v_checks := v_checks || jsonb_build_array(jsonb_build_object(
    'check', 'suspense_summary',
    'status', 'INFO',
    'pending_match_count', v_pending_total,
    'matched_count', v_matched_total
  ));

  -- Check 4: consumed_quantity <= received_quantity
  SELECT COALESCE(COUNT(*), 0) INTO v_over_consumed
  FROM public.purchase_order_items poi
  WHERE poi.consumed_quantity > poi.received_quantity
    AND (p_product_id IS NULL OR poi.product_id = p_product_id)
    AND (p_variant_id IS NULL OR poi.variant_id IS NOT DISTINCT FROM p_variant_id);

  IF v_over_consumed > 0 THEN
    v_ok := false;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'check', 'consumed_vs_received',
      'status', 'FAIL',
      'over_consumed_count', v_over_consumed
    ));
  ELSE
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'check', 'consumed_vs_received',
      'status', 'PASS'
    ));
  END IF;

  -- Check 5: allocation sum <= movement quantity
  SELECT COALESCE(COUNT(*), 0) INTO v_over_allocated
  FROM (
    SELECT im.id, ABS(im.quantity_change) AS movement_qty,
           COALESCE(SUM(imca.matched_quantity), 0) AS allocated_qty
    FROM public.inventory_movements im
    LEFT JOIN public.inventory_movement_cost_allocations imca ON imca.movement_id = im.id
    WHERE im.cost_match_status IN ('matched','pending_match')
      AND (p_product_id IS NULL OR im.product_id = p_product_id)
      AND (p_variant_id IS NULL OR im.variant_id IS NOT DISTINCT FROM p_variant_id)
    GROUP BY im.id, im.quantity_change
    HAVING COALESCE(SUM(imca.matched_quantity), 0) > ABS(im.quantity_change)
  ) sub;

  IF v_over_allocated > 0 THEN
    v_ok := false;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'check', 'allocation_vs_movement',
      'status', 'FAIL',
      'over_allocated_count', v_over_allocated
    ));
  ELSE
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'check', 'allocation_vs_movement',
      'status', 'PASS'
    ));
  END IF;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'checks', v_checks,
    'product_id', p_product_id,
    'variant_id', p_variant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_fifo_integrity(UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_fifo_integrity(UUID, UUID) TO authenticated;