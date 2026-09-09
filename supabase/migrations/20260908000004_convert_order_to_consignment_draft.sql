-- ============================================================
-- 訂單「轉寄賣」改為未出貨（建立寄賣草稿）
-- 目的：訂單列表「轉寄賣出貨」原本在前面直接呼叫 direct_ship_order
--   （立即 標 shipped + 扣庫存 + 寄賣單 active），無法手動調整。
--   改為只將訂單標記 consignment_mode=true 並建立「未出貨」的
--   send_to_store 寄賣草稿，品項停留 waiting；到寄賣管理頁
--   調整後再出貨（create_consignment_shipment）才扣庫存。
-- 重點：不建立 inventory_movements、不標 shipped、不開銷貨單。
-- ============================================================
CREATE OR REPLACE FUNCTION public.convert_order_to_consignment_draft(
  p_order_id UUID,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_co_id UUID;
  v_item RECORD;
  v_unshipped INTEGER;
  v_oi_id UUID;
  v_coi_id UUID;
BEGIN
  SELECT id, status, store_id, source_type, consignment_mode
  INTO v_order
  FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '訂單不存在');
  END IF;

  -- 已是寄賣鏡像單，不可再轉
  IF v_order.source_type = 'consignment' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此為寄賣鏡像訂單，請至寄賣管理處理');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅待確認（pending）訂單可轉寄賣草稿');
  END IF;

  -- 檢查是否有未出貨品項
  SELECT COALESCE(SUM(oi.quantity - oi.shipped_quantity), 0)::INTEGER
  INTO v_unshipped
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status NOT IN ('cancelled', 'discontinued');
  IF v_unshipped IS NULL OR v_unshipped <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此訂單沒有未出貨品項');
  END IF;

  -- 尋找既有未取消的寄賣草稿，避免重複建立
  IF v_order.consignment_mode THEN
    SELECT id INTO v_co_id
    FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND source_order_id = p_order_id
      AND status IN ('draft', 'active')
    LIMIT 1;
    IF v_co_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'consignment_order_id', v_co_id, 'order_id', p_order_id, 'reused', true);
    END IF;
  END IF;

  -- 標記寄賣模式（維持 pending，不出貨）
  IF NOT v_order.consignment_mode THEN
    UPDATE public.orders
    SET consignment_mode = true, updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  -- 建立寄賣草稿（未出貨）
  INSERT INTO public.consignment_orders (
    direction, store_id, status, source_order_id, created_by, note
  )
  SELECT 'send_to_store', v_order.store_id, 'draft', p_order_id, p_created_by,
         o.notes
  FROM public.orders o WHERE o.id = p_order_id
  RETURNING id INTO v_co_id;

  -- 逐項鏡像 order_items → consignment_order_items（不扣庫存）
  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.shipped_quantity,
           oi.unit_price, oi.unit_cost
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('cancelled', 'discontinued')
      AND (oi.quantity - oi.shipped_quantity) > 0
  LOOP
    -- 若已連結既有寄賣品項則沿用
    SELECT id INTO v_coi_id
    FROM public.consignment_order_items
    WHERE consignment_order_id = v_co_id
      AND order_item_id = v_item.id
    LIMIT 1;

    IF v_coi_id IS NULL THEN
      INSERT INTO public.consignment_order_items (
        consignment_order_id, order_item_id, product_id, variant_id,
        quantity, unit_price, unit_cost
      )
      VALUES (
        v_co_id, v_item.id, v_item.product_id, v_item.variant_id,
        v_item.quantity - v_item.shipped_quantity,
        v_item.unit_price, COALESCE(v_item.unit_cost, 0)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'consignment_order_id', v_co_id,
    'order_id', p_order_id,
    'reused', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_order_to_consignment_draft(UUID, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_order_to_consignment_draft(UUID, UUID) TO authenticated;
