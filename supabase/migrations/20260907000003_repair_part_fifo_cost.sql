-- ============================================================
-- 維修零件成本：進貨批次 FIFO + 可選批次（2026-09-07）
-- - purchase_order_items.consumed_quantity：已被維修單消耗的數量
-- - repair_order_items.purchase_order_item_id：所用進貨批次
-- - list_repair_part_batches：列出某零件可用的進貨批次（FIFO 排序）
-- - deduct_repair_part_stock 重寫：依指定批次扣數量、回填 unit_cost
-- ============================================================

-- 1. purchase_order_items 追蹤已被維修單消耗的數量
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS consumed_quantity INTEGER NOT NULL DEFAULT 0;

-- 2. repair_order_items 記錄所用進貨批次
ALTER TABLE public.repair_order_items
  ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID REFERENCES public.purchase_order_items(id);

-- 3. 列出零件可用進貨批次（FIFO：最早進貨優先），SECURITY DEFINER 供 admin/fixengineer 讀取
CREATE OR REPLACE FUNCTION public.list_repair_part_batches(
  p_product_id UUID,
  p_variant_id UUID
)
RETURNS TABLE (
  id UUID,
  purchase_order_id UUID,
  unit_cost NUMERIC,
  received_date DATE,
  received_at TIMESTAMPTZ,
  remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT poi.id, poi.purchase_order_id, poi.unit_cost,
         po.received_date, po.created_at,
         (poi.received_quantity - poi.consumed_quantity)::INTEGER AS remaining
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.product_id IS NOT DISTINCT FROM p_product_id
    AND poi.variant_id IS NOT DISTINCT FROM p_variant_id
    AND poi.received_quantity > poi.consumed_quantity
    AND po.status <> 'cancelled'
  ORDER BY COALESCE(po.received_date, po.order_date, po.created_at::DATE) ASC, poi.created_at ASC, poi.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_repair_part_batches(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_repair_part_batches(UUID, UUID) TO authenticated;

-- 4a. 移除舊 6 參數版本（CREATE OR REPLACE 無法改參數，會殘留 overload）
DROP FUNCTION IF EXISTS public.deduct_repair_part_stock(UUID, UUID, UUID, UUID, INTEGER, UUID);

-- 4. 重寫 deduct_repair_part_stock：依進貨批次扣數量、回填成本
CREATE OR REPLACE FUNCTION public.deduct_repair_part_stock(
  p_repair_order_id UUID,
  p_item_id         UUID,
  p_product_id      UUID,
  p_variant_id      UUID,
  p_quantity        INTEGER,
  p_created_by      UUID,
  p_purchase_order_item_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_warehouse_id   UUID;
  v_balance        INTEGER;
  v_variant        UUID;
  v_batch_id       UUID;
  v_batch_cost     NUMERIC;
  v_batch_remaining INTEGER;
BEGIN
  SELECT id INTO v_warehouse_id
  FROM warehouses
  WHERE code = 'own' OR type = '自有倉'
  ORDER BY (code = 'own') DESC, is_active DESC
  LIMIT 1;

  IF v_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '找不到自有倉庫');
  END IF;

  v_variant := p_variant_id;

  SELECT quantity INTO v_balance
  FROM product_inventory
  WHERE product_id = p_product_id
    AND variant_id IS NOT DISTINCT FROM v_variant
    AND warehouse_id = v_warehouse_id
  LIMIT 1;

  IF v_balance IS NULL OR v_balance < p_quantity THEN
    RETURN jsonb_build_object('ok', false, 'error',
      '庫存不足（目前 ' || COALESCE(v_balance::TEXT, '0') || '，需要 ' || p_quantity || '）');
  END IF;

  -- 批次解析：指定 p_purchase_order_item_id 時驗證該批次剩餘量；未指定時抓 FIFO 最早批次
  IF p_purchase_order_item_id IS NOT NULL THEN
    SELECT poi.id, poi.unit_cost, poi.received_quantity - poi.consumed_quantity
      INTO v_batch_id, v_batch_cost, v_batch_remaining
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.id = p_purchase_order_item_id
      AND poi.product_id IS NOT DISTINCT FROM p_product_id
      AND poi.variant_id IS NOT DISTINCT FROM v_variant
      AND po.status <> 'cancelled';
    IF v_batch_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', '指定進貨批次不存在或已取消');
    END IF;
    IF v_batch_remaining < p_quantity THEN
      RETURN jsonb_build_object('ok', false, 'error',
        '該進貨批次剩餘不足（剩 ' || v_batch_remaining || '，需要 ' || p_quantity || '）');
    END IF;
  ELSE
    SELECT poi.id, poi.unit_cost, poi.received_quantity - poi.consumed_quantity
      INTO v_batch_id, v_batch_cost, v_batch_remaining
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.product_id IS NOT DISTINCT FROM p_product_id
      AND poi.variant_id IS NOT DISTINCT FROM v_variant
      AND (poi.received_quantity - poi.consumed_quantity) >= p_quantity
      AND po.status <> 'cancelled'
    ORDER BY COALESCE(po.received_date, po.order_date, po.created_at::DATE) ASC, poi.created_at ASC, poi.id ASC
    LIMIT 1;
    IF v_batch_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', '無可用進貨批次（請先進貨並收貨）');
    END IF;
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, variant_id, warehouse_id, quantity_change, balance_after,
    source_type, repair_order_id, note, created_by
  )
  VALUES (
    p_product_id, v_variant, v_warehouse_id, -p_quantity,
    v_balance - p_quantity,
    'repair_part_usage', p_repair_order_id,
    '維修單零件出庫', p_created_by
  );

  UPDATE public.purchase_order_items
  SET consumed_quantity = consumed_quantity + p_quantity
  WHERE id = v_batch_id;

  UPDATE public.repair_order_items
  SET is_stock_deducted = true,
      purchase_order_item_id = v_batch_id,
      unit_cost = COALESCE(v_batch_cost, 0)
  WHERE id = p_item_id AND repair_order_id = p_repair_order_id;

  RETURN jsonb_build_object('ok', true,
    'warehouse_id', v_warehouse_id, 'balance_after', v_balance - p_quantity,
    'batch_id', v_batch_id, 'unit_cost', v_batch_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_repair_part_stock(UUID, UUID, UUID, UUID, INTEGER, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_repair_part_stock(UUID, UUID, UUID, INTEGER, UUID, UUID) TO authenticated;