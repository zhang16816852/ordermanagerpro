-- ============================================================
-- Cost FIFO Phase 3：佣金差額檢查 helper + 成本守門
-- 依賴：20261028000002 (_backfill_match_batches), cross-border M4 (register_rep_commission_adjustment)
-- ============================================================

-- ------------------------------------------------------------
-- 1. 佣金差額檢查 helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._check_commission_adjustment(
  p_order_item_id UUID,
  p_old_unit_cost NUMERIC,
  p_new_unit_cost NUMERIC,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := COALESCE(p_created_by, auth.uid());
  v_oi RECORD;
  v_sn_id UUID;
  v_rep_id UUID;
  v_qty NUMERIC;
  v_old_comm NUMERIC;
  v_new_comm NUMERIC;
  v_delta NUMERIC;
  v_has_payout BOOLEAN;
  v_rate NUMERIC;
BEGIN
  SELECT oi.id, oi.order_id, oi.quantity, oi.unit_price, o.store_id
  INTO v_oi
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_item not found');
  END IF;

  v_qty := v_oi.quantity;

  SELECT sn.id INTO v_sn_id
  FROM public.sales_notes sn
  JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
  WHERE sni.order_item_id = p_order_item_id
  LIMIT 1;

  IF v_sn_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'adjusted', false, 'reason', 'no sales note');
  END IF;

  SELECT rsa.rep_id INTO v_rep_id
  FROM public.rep_store_assignments rsa
  JOIN public.sales_notes sn ON sn.store_id = rsa.store_id
  WHERE sn.id = v_sn_id
  LIMIT 1;

  IF v_rep_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'adjusted', false, 'reason', 'no rep assigned');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.rep_commission_payouts
    WHERE rep_id = v_rep_id AND sales_note_id = v_sn_id AND kind = 'payout'
  ) INTO v_has_payout;

  IF NOT v_has_payout THEN
    RETURN jsonb_build_object('ok', true, 'adjusted', false, 'reason', 'no payout yet');
  END IF;

  SELECT COALESCE(ur.commission_rate, 0) INTO v_rate
  FROM public.user_roles ur WHERE ur.user_id = v_rep_id;

  v_old_comm := GREATEST(0, (v_oi.unit_price - COALESCE(p_old_unit_cost, 0)) * v_qty) * v_rate / 100;
  v_new_comm := GREATEST(0, (v_oi.unit_price - COALESCE(p_new_unit_cost, 0)) * v_qty) * v_rate / 100;
  v_delta := v_new_comm - v_old_comm;

  IF abs(v_delta) < 0.01 THEN
    RETURN jsonb_build_object('ok', true, 'adjusted', false, 'reason', 'delta too small');
  END IF;

  PERFORM public.register_rep_commission_adjustment(
    v_rep_id,
    v_sn_id,
    v_delta,
    CURRENT_DATE,
    '成本回溯調整：' || COALESCE(p_old_unit_cost::text, '0') || ' → ' || COALESCE(p_new_unit_cost::text, '0'),
    v_uid
  );

  RETURN jsonb_build_object('ok', true, 'adjusted', true,
    'rep_id', v_rep_id, 'sales_note_id', v_sn_id,
    'old_commission', v_old_comm, 'new_commission', v_new_comm,
    'delta', v_delta);
END;
$$;

REVOKE ALL ON FUNCTION public._check_commission_adjustment(UUID, NUMERIC, NUMERIC, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._check_commission_adjustment(UUID, NUMERIC, NUMERIC, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 2. 成本守門：rep cost < purchase cost 檢查
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rep_cost_guard(
  p_rep_id UUID,
  p_product_id UUID,
  p_variant_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_rep_cost NUMERIC;
  v_purchase_cost NUMERIC;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- 取 rep_product_costs
  SELECT rpc.cost INTO v_rep_cost
  FROM public.rep_product_costs rpc
  WHERE rpc.rep_id = p_rep_id
    AND rpc.product_id = p_product_id
    AND rpc.variant_id IS NOT DISTINCT FROM p_variant_id;

  -- 取最近進貨成本（landed_unit_cost or unit_cost）
  SELECT COALESCE(poi.landed_unit_cost, poi.unit_cost) INTO v_purchase_cost
  FROM public.purchase_order_items poi
  WHERE poi.product_id = p_product_id
    AND poi.variant_id IS NOT DISTINCT FROM p_variant_id
    AND poi.received_quantity > 0
  ORDER BY poi.created_at DESC
  LIMIT 1;

  IF v_rep_cost IS NULL OR v_purchase_cost IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'guard', 'skip', 'reason', 'missing cost data');
  END IF;

  IF v_rep_cost < v_purchase_cost THEN
    RETURN jsonb_build_object('ok', false, 'guard', 'FAIL',
      'rep_cost', v_rep_cost, 'purchase_cost', v_purchase_cost,
      'reason', '業務成本低於進貨成本，需修正');
  END IF;

  RETURN jsonb_build_object('ok', true, 'guard', 'PASS',
    'rep_cost', v_rep_cost, 'purchase_cost', v_purchase_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.check_rep_cost_guard(UUID, UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_rep_cost_guard(UUID, UUID, UUID) TO authenticated;

-- ============================================================
-- End of migration 20261028000005
-- ============================================================