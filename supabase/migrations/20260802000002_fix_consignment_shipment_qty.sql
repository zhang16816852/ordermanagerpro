-- ============================================================
-- 修正：create_consignment_shipment 出貨量邏輯
-- 原 bug：用 summary.remaining_quantity（= shipped - sold - returned，
--         即「店家手上未售數量」）當本次出貨量；
--         未出過貨的單 remaining 恆為 0，導致出貨無效
--         （只建出空的 order + sales_note，狀態卻轉 active）。
-- 修正：本次出貨量 = order_quantity - shipped_quantity（尚未出貨部分）。
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_order_id UUID;
  v_order_code TEXT;
  v_sn_id UUID;
  v_sn_code TEXT;
  v_access_token UUID;
  v_own_wh UUID;
  v_shipped_at TIMESTAMPTZ;
  v_item RECORD;
  v_ship_qty INTEGER;
  v_oi_id UUID;
  v_result JSONB;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '此寄賣單非店家方向，無法出貨';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '寄賣單狀態不允許出貨';
  END IF;

  v_shipped_at := COALESCE(p_shipped_at, NOW());
  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  v_access_token := gen_random_uuid();

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status)
  VALUES (v_order.store_id, p_created_by, p_notes, 'consignment', 'shipped')
  RETURNING id, code INTO v_order_id, v_order_code;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (v_order.store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_own_wh)
  RETURNING id, code INTO v_sn_id, v_sn_code;

  FOR v_item IN
    SELECT s.consignment_order_item_id, s.unit_price,
           s.order_quantity - s.shipped_quantity AS remaining,
           coi.product_id, coi.variant_id
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
  LOOP
    v_ship_qty := v_item.remaining;
    CONTINUE WHEN v_ship_qty <= 0;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, shipped_quantity, status
    )
    VALUES (
      v_order_id, v_item.product_id, v_item.variant_id, v_order.store_id,
      v_ship_qty, v_item.unit_price, v_ship_qty, 'shipped'
    )
    RETURNING id INTO v_oi_id;

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sn_id, v_oi_id, v_ship_qty, 'store_consignment');

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      sales_note_id, consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_item.product_id, v_item.variant_id, v_own_wh, -v_ship_qty, 'consignment_out_shipment',
      v_sn_id, p_consignment_order_id, v_item.consignment_order_item_id,
      v_sn_code, 'store_consignment', p_created_by
    );
  END LOOP;

  UPDATE public.consignment_orders
  SET status = 'active', updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';

  v_result := jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'sales_note_id', v_sn_id,
    'sales_note_code', v_sn_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 清理孤兒資料：測試期因 bug 產生的空單
-- （source_type='consignment' 且無 order_items 的 order，
--  以及無 sales_note_items 的 shipped sales_note）
-- ============================================================
DELETE FROM public.orders o
WHERE o.source_type = 'consignment'
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id);

DELETE FROM public.sales_notes sn
WHERE sn.status = 'shipped'
  AND NOT EXISTS (SELECT 1 FROM public.sales_note_items sni WHERE sni.sales_note_id = sn.id);
