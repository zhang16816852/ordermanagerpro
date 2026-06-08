-- P0.2: 原子化出貨 RPC — 將選中店家的出貨池項目合併為銷售單（單一交易）
-- 取代前端 ShippingPool.tsx 中多步驟非原子操作

CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids UUID[],
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store_id UUID;
  v_sales_note_id UUID;
  v_access_token TEXT;
  v_item RECORD;
  v_new_shipped_qty INTEGER;
  v_new_status public.order_item_status;
  v_affected_order_ids UUID[];
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_result JSONB;
BEGIN
  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    -- 1. 產生 access_token
    v_access_token := encode(gen_random_bytes(24), 'base64');

    -- 2. 建立銷售單 (status = 'shipped')
    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token)
    VALUES (v_store_id, p_created_by, 'shipped', NOW(), p_notes, v_access_token)
    RETURNING id INTO v_sales_note_id;

    -- 3. 遍歷該店家的出貨池項目
    FOR v_item IN
      SELECT sp.id AS pool_id, sp.order_item_id, sp.quantity, sp.store_id,
             oi.quantity AS total_qty, oi.shipped_quantity AS current_shipped,
             oi.order_id
      FROM public.shipping_pool sp
      JOIN public.order_items oi ON oi.id = sp.order_item_id
      WHERE sp.store_id = v_store_id
    LOOP
      -- 3a. 插入 sales_note_items
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
      VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity);

      -- 3b. 計算新的出貨數量
      v_new_shipped_qty := v_item.current_shipped + v_item.quantity;
      IF v_new_shipped_qty >= v_item.total_qty THEN
        v_new_status := 'shipped';
      ELSIF v_new_shipped_qty > 0 THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'waiting';
      END IF;

      -- 3c. 更新 order_items
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped_qty, status = v_new_status, updated_at = NOW()
      WHERE id = v_item.order_item_id;

      -- 收集受影響的訂單 ID
      IF NOT (v_item.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_item.order_id);
      END IF;

      -- 3d. 記錄稽核
      INSERT INTO public.audit_logs (entity_type, entity_id, action, performed_by, store_id, old_value, new_value)
      VALUES ('order_item', v_item.order_item_id, 'shipped_quantity_updated', p_created_by, v_store_id,
        jsonb_build_object('shipped_quantity', v_item.current_shipped),
        jsonb_build_object('shipped_quantity', v_new_shipped_qty, 'status', v_new_status::text));
    END LOOP;

    -- 4. 刪除該店家的出貨池項目
    DELETE FROM public.shipping_pool WHERE store_id = v_store_id;

    -- 5. 累積結果
    v_result := v_result || jsonb_build_object(
      'store_id', v_store_id,
      'sales_note_id', v_sales_note_id,
      'access_token', v_access_token
    );
  END LOOP;

  -- 6. 更新完全出貨的訂單狀態
  FOREACH v_order_id IN ARRAY v_affected_order_ids LOOP
    SELECT bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN ('cancelled', 'discontinued'))
    INTO v_all_shipped
    FROM public.order_items oi
    WHERE oi.order_id = v_order_id;

    IF v_all_shipped THEN
      UPDATE public.orders SET status = 'shipped' WHERE id = v_order_id;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;
