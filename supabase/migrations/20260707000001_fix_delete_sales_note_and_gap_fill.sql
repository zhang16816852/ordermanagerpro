-- 1. 修復 delete_sales_note RPC：回退訂單狀態 + 回寫出貨池
-- 2. 銷貨單號碼改為遞補制（刪除後釋出的號碼重用）

-- ============================================================
-- Part 1: 更新 delete_sales_note
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_sales_note(
  p_sales_note_id UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item RECORD;
  v_new_shipped int;
  v_total_quantity int;
  v_order_ids UUID[] := '{}';
  v_pool_quantity int;
BEGIN
  -- 防止刪除已收貨的銷貨單
  IF EXISTS (SELECT 1 FROM public.sales_notes WHERE id = p_sales_note_id AND status = 'received') THEN
    RAISE EXCEPTION '無法刪除已收貨的銷貨單';
  END IF;

  -- 遍歷銷貨單的所有項目
  FOR v_item IN 
    SELECT si.order_item_id, si.quantity, oi.quantity AS total_quantity, 
           oi.shipped_quantity, oi.order_id
    FROM public.sales_note_items si
    JOIN public.order_items oi ON si.order_item_id = oi.id
    WHERE si.sales_note_id = p_sales_note_id
  LOOP
    -- 收集受影響的訂單 ID
    IF NOT (v_item.order_id = ANY(v_order_ids)) THEN
      v_order_ids := array_append(v_order_ids, v_item.order_id);
    END IF;

    -- 計算回滾後已出貨數量
    v_new_shipped := GREATEST(0, v_item.shipped_quantity - v_item.quantity);
    v_total_quantity := v_item.total_quantity;

    -- 更新 order_items（回滾 shipped_quantity 與 status）
    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped,
        status = CASE 
                    WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                    WHEN v_new_shipped < v_total_quantity THEN 'partial'::order_item_status
                    ELSE 'shipped'::order_item_status
                 END
    WHERE id = v_item.order_item_id;

    -- 回寫出貨池（累加已存在的數量）
    SELECT quantity INTO v_pool_quantity
    FROM public.shipping_pool WHERE order_item_id = v_item.order_item_id;

    IF FOUND THEN
      UPDATE public.shipping_pool
      SET quantity = v_pool_quantity + v_item.quantity
      WHERE order_item_id = v_item.order_item_id;
    ELSE
      INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
      SELECT v_item.order_item_id, v_item.quantity, o.store_id, o.created_by
      FROM public.orders o WHERE o.id = v_item.order_id;
    END IF;
  END LOOP;

  -- 刪除銷貨單項目與銷貨單
  DELETE FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id;
  DELETE FROM public.sales_notes WHERE id = p_sales_note_id;

  -- 回退訂單狀態：當所有 order_items 都沒有已出貨數量時
  UPDATE public.orders o
  SET status = 'processing'
  WHERE o.id = ANY(v_order_ids)
    AND o.status = 'shipped'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi2
      WHERE oi2.order_id = o.id
        AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
    );
END;
$$;

-- ============================================================
-- Part 2: 更新 generate_sequential_code — 銷貨單號碼遞補
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_sequential_code() 
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_date_part TEXT;
    v_seq_key TEXT;
    v_new_val INTEGER;
    v_store_code TEXT;
    v_padding INTEGER;
    v_should_generate BOOLEAN := FALSE;
BEGIN
    -- [判斷產號時機]
    IF TG_TABLE_NAME = 'orders' THEN
        IF (TG_OP = 'INSERT' AND NEW.status IN ('processing', 'shipped')) OR 
           (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status IN ('processing', 'shipped')) THEN
            v_should_generate := TRUE;
        END IF;
    ELSIF TG_TABLE_NAME = 'sales_notes' THEN
        IF (TG_OP = 'INSERT' AND NEW.status != 'draft') OR 
           (TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status != 'draft') THEN
            v_should_generate := TRUE;
        END IF;
    END IF;

    -- 已有單號或不符合產號條件則跳過
    IF NOT v_should_generate OR NEW.code IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- [產號邏輯]
    IF TG_TABLE_NAME = 'orders' THEN
        v_prefix := 'OD';
        v_date_part := to_char(NEW.created_at, 'YYMMDD');
        v_seq_key := 'order_' || v_date_part;
        v_padding := 5;
    ELSIF TG_TABLE_NAME = 'sales_notes' THEN
        v_prefix := 'SL';
        v_date_part := to_char(NEW.created_at, 'YYMM');
        SELECT COALESCE(code, substring(id::text, 1, 4)) INTO v_store_code 
        FROM public.stores WHERE id = NEW.store_id;
        v_seq_key := 'sales_' || v_date_part || '_' || NEW.store_id;
        v_prefix := v_prefix || v_date_part || COALESCE(v_store_code, 'UNK');
        v_padding := 4;
    END IF;

    IF TG_TABLE_NAME = 'orders' THEN
        -- 訂單：維持累加制
        INSERT INTO public.system_sequences (name, current_value, updated_at)
        VALUES (v_seq_key, 1, now())
        ON CONFLICT (name) DO UPDATE 
        SET current_value = system_sequences.current_value + 1, updated_at = now()
        RETURNING current_value INTO v_new_val;

        NEW.code := v_prefix || v_date_part || lpad(v_new_val::text, v_padding, '0');
    ELSE
        -- 銷貨單：遞補制，找第一個空缺號碼
        PERFORM pg_advisory_xact_lock(hashtext(v_seq_key));

        SELECT COALESCE(
            (SELECT t.n FROM generate_series(1, 9999) t(n)
             WHERE NOT EXISTS (
                 SELECT 1 FROM public.sales_notes sn
                 WHERE sn.code = v_prefix || lpad(t.n::text, v_padding, '0')
                   AND sn.store_id = NEW.store_id
                   AND (TG_OP = 'INSERT' OR sn.id != NEW.id)
             )
             ORDER BY t.n
             LIMIT 1),
            1
        ) INTO v_new_val;

        NEW.code := v_prefix || lpad(v_new_val::text, v_padding, '0');
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
