-- ============================================================
-- 20260911000005_order_edit_paid_guard.sql
-- update_order_with_items 加入已收款守門：
-- 若訂單已有已收款的銷貨單（payment_status='paid'），
-- 則擋下單價/數量/刪除操作，避免會計紀錄與實際不一致。
-- 僅允許修改備註欄位。
-- ============================================================

DROP FUNCTION IF EXISTS public.update_order_with_items(uuid, text, jsonb, uuid[]);

CREATE OR REPLACE FUNCTION public.update_order_with_items(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_deleted_item_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_item_id UUID;
  v_temp_key TEXT;
  v_parent_temp TEXT;
  v_has_paid_note BOOLEAN;
  v_paid_note_code TEXT;
  v_affecting_changes BOOLEAN;
BEGIN
  -- 守門：若訂單已有已收款的銷貨單，擋下會影響會計的品項變更
  --（sales_notes 經 sales_note_items.order_item_id → order_items 關聯訂單）
  SELECT EXISTS (
    SELECT 1 FROM public.sales_notes sn
    JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    WHERE oi.order_id = p_order_id
      AND sn.payment_status = 'paid'
  ) INTO v_has_paid_note;

  IF v_has_paid_note THEN
    -- 判斷是否有「會影響會計金額」的變更：
    -- 1) 有要刪除的既有品項
    -- 2) 有新品項（id IS NULL）
    -- 3) 既有品項的 quantity 或 unit_price 與 DB 不一致
    v_affecting_changes := false;

    IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.id = ANY(p_deleted_item_ids) AND oi.order_id = p_order_id
      ) THEN
        v_affecting_changes := true;
      END IF;
    END IF;

    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) AS el
        WHERE (el->>'id') IS NULL
      ) THEN
        v_affecting_changes := true;
      END IF;
    END IF;

    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS el
        JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
        WHERE (el->>'id') IS NOT NULL
          AND (
            oi.quantity <> (el->>'quantity')::INT
            OR oi.unit_price <> (el->>'unit_price')::NUMERIC
          )
      ) INTO v_affecting_changes;
    END IF;

    IF v_affecting_changes THEN
      SELECT sn.code INTO v_paid_note_code
      FROM public.sales_notes sn
      JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      WHERE oi.order_id = p_order_id AND sn.payment_status = 'paid'
      LIMIT 1;
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '此訂單已有已收款的銷貨單（' || COALESCE(v_paid_note_code, '') || '），修改品項、數量或單價會導致會計紀錄不一致。請先至會計模組回退收款後再修改。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'paid_sales_note', 'code', v_paid_note_code, 'label', '已收款銷貨單'))
      );
    END IF;
    -- 僅備註/排序變更：允許繼續
  END IF;

  -- 1. 更新訂單備註
  UPDATE orders
  SET notes = p_notes, updated_at = now()
  WHERE id = p_order_id;

  -- 若只有備註變更，直接返回
  IF (p_items IS NULL OR jsonb_array_length(p_items) = 0)
     AND (p_deleted_item_ids IS NULL OR array_length(p_deleted_item_ids, 1) = 0) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- 2. 刪除被移除的品項（軟刪除後端提交；子行因 ON DELETE CASCADE 隨父行刪除）
  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    DELETE FROM order_items
    WHERE id = ANY(p_deleted_item_ids)
      AND order_id = p_order_id;
  END IF;

  -- 3. 更新既有品項（id IS NOT NULL）
  UPDATE order_items oi
  SET quantity = (iu.elem->>'quantity')::INT,
      unit_price = (iu.elem->>'unit_price')::NUMERIC,
      unit_cost = COALESCE(NULLIF((iu.elem->>'unit_cost'), '')::NUMERIC, 0),
      sort_order = (iu.elem->>'sort_order')::INT,
      selected_model_name = (iu.elem->>'selected_model_name')::TEXT,
      parent_order_item_id = CASE
        WHEN (iu.elem->>'parent_temp_key') IS NOT NULL THEN NULL
        ELSE NULLIF(iu.elem->>'parent_order_item_id', '')::UUID
      END,
      shipping_payment = NULLIF(iu.elem->>'shipping_payment', ''),
      updated_at = now()
  FROM (
    SELECT elem
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NOT NULL
  ) iu
  WHERE oi.id = (iu.elem->>'id')::UUID
    AND oi.order_id = p_order_id;

  -- 4. 插入新品項（id IS NULL）——先全數插入並紀錄 temp_key → 新 id
  CREATE TEMP TABLE _new_item_map (temp_key text PRIMARY KEY, item_id uuid)
    ON COMMIT DROP;

  FOR v_elem IN
    SELECT elem FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NULL
    ORDER BY (elem->>'sort_order')::INT NULLS LAST
  LOOP
    INSERT INTO order_items (
      order_id, product_id, variant_id, quantity, unit_price,
      unit_cost, selected_model_name, store_id, sort_order, shipping_payment
    )
    SELECT
      p_order_id,
      (v_elem->>'product_id')::UUID,
      NULLIF(v_elem->>'variant_id', '')::UUID,
      (v_elem->>'quantity')::INT,
      (v_elem->>'unit_price')::NUMERIC,
      COALESCE(NULLIF(v_elem->>'unit_cost', '')::NUMERIC, 0),
      NULLIF(v_elem->>'selected_model_name', ''),
      o.store_id,
      (v_elem->>'sort_order')::INT,
      NULLIF(v_elem->>'shipping_payment', '')
    FROM orders o
    WHERE o.id = p_order_id
    RETURNING id INTO v_item_id;

    v_temp_key := v_elem->>'temp_key';
    IF v_temp_key IS NOT NULL THEN
      INSERT INTO _new_item_map (temp_key, item_id) VALUES (v_temp_key, v_item_id);
    END IF;
  END LOOP;

  -- 5. 承接子行：以 parent_temp_key 找到父行新 id
  FOR v_elem, v_temp_key, v_parent_temp IN
    SELECT elem, elem->>'temp_key', elem->>'parent_temp_key'
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NULL
      AND (elem->>'parent_temp_key') IS NOT NULL
  LOOP
    UPDATE order_items oi
    SET parent_order_item_id = m.item_id
    FROM _new_item_map m
    WHERE m.temp_key = v_parent_temp
      AND oi.id = (SELECT item_id FROM _new_item_map WHERE temp_key = v_temp_key)
      AND oi.order_id = p_order_id;
  END LOOP;

  DROP TABLE _new_item_map;

  RETURN jsonb_build_object('ok', true);
END;
$$;
