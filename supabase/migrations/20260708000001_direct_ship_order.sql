-- RPC: 直接從既有訂單建立銷貨單（跳過出貨池）
-- 將 processing 訂單的所有剩餘品項全額出貨

CREATE OR REPLACE FUNCTION public.direct_ship_order(
  p_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_remaining_qty INTEGER;
  v_new_shipped_qty INTEGER;
  v_sn_notes TEXT;
  v_result JSONB;
BEGIN
  -- 1. 取得訂單資訊（確認存在且為 processing）
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;

  IF v_order.status NOT IN ('processing', 'pending') THEN
    RAISE EXCEPTION '僅能對處理中或待確認的訂單執行轉銷貨單';
  END IF;

  -- 2. 產生 access_token
  v_access_token := gen_random_uuid();

  -- 3. 合併備註：訂單原有備註 + 此次出貨備註
  v_sn_notes := CASE
    WHEN v_order.notes IS NOT NULL AND p_notes IS NOT NULL THEN v_order.notes || ' | ' || p_notes
    WHEN v_order.notes IS NOT NULL THEN v_order.notes
    ELSE p_notes
  END;

  -- 5. 建立銷售單 (status = 'shipped')
  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token)
  VALUES (v_order.store_id, p_created_by, 'shipped', NOW(), v_sn_notes, v_access_token)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

  -- 6. 遍歷訂單品項，將剩餘數量出貨
  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.shipped_quantity,
           oi.unit_price, oi.selected_model_name, oi.store_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('cancelled', 'discontinued')
  LOOP
    -- 計算剩餘數量
    v_remaining_qty := v_item.quantity - v_item.shipped_quantity;
    CONTINUE WHEN v_remaining_qty <= 0;

    -- 6a. 插入 sales_note_items
    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
    VALUES (v_sales_note_id, v_item.id, v_remaining_qty);

    -- 6b. 計算新的出貨數量
    v_new_shipped_qty := v_item.shipped_quantity + v_remaining_qty;

    -- 6c. 更新 order_items
    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped_qty,
        status = 'shipped',
        updated_at = NOW()
    WHERE id = v_item.id;
  END LOOP;

  -- 7. 更新訂單狀態為 shipped
  UPDATE public.orders
  SET status = 'shipped', updated_at = NOW()
  WHERE id = p_order_id;

  -- 8. 回傳結果
  v_result := jsonb_build_object(
    'sales_note_id', v_sales_note_id,
    'sales_note_code', v_sales_note_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;
