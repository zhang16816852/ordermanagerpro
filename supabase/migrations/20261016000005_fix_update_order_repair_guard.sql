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
  v_order orders%ROWTYPE;
  v_uid UUID;
  v_elem JSONB;
  v_item_id UUID;
  v_temp_key TEXT;
  v_parent_temp TEXT;
  v_has_paid_note BOOLEAN;
  v_paid_note_code TEXT;
  v_affecting_changes BOOLEAN;
  v_shipped_deletion BOOLEAN;
  v_low_quantity BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT (
       COALESCE(public.has_role(v_uid, 'admin'), false)
       OR COALESCE(public.is_store_member(v_uid, v_order.store_id), false)
       OR COALESCE(v_order.sales_rep_id = v_uid, false)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.sales_notes sn
    JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    WHERE oi.order_id = p_order_id
      AND sn.payment_status = 'paid'
  ) INTO v_has_paid_note;

  IF v_has_paid_note THEN
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

    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS el
        JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
        WHERE (el->>'id') IS NOT NULL
          AND COALESCE(NULLIF(el->>'line_type', ''), oi.line_type) <> oi.line_type
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
        'reason', '此訂單已有已收款的銷貨單（' || COALESCE(v_paid_note_code, '') || '），修改品項、數量、單價或打單性質會導致會計紀錄不一致。請先至會計模組回退收款後再修改。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'paid_sales_note', 'code', v_paid_note_code, 'label', '已收款銷貨單'))
      );
    END IF;
  END IF;

  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.id = ANY(p_deleted_item_ids)
        AND oi.order_id = p_order_id
        AND oi.shipped_quantity > 0
    ) INTO v_shipped_deletion;

    IF v_shipped_deletion THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '有品項已出貨（shipped_quantity > 0），無法直接刪除；請先至銷貨單/寄賣管理回滾出貨後再移除。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'shipped_order_item', 'code', NULL::text, 'label', '已出貨品項'))
      );
    END IF;
  END IF;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
      WHERE (el->>'id') IS NOT NULL
        AND (el->>'quantity')::INT < oi.shipped_quantity
    ) INTO v_low_quantity;

    IF v_low_quantity THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '品項新數量不可低於已出貨數量（shipped_quantity）；請先於銷貨單/寄賣管理回滾出貨量後再調整。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'quantity_below_shipped', 'code', NULL::text, 'label', '數量低於已出貨'))
      );
    END IF;
  END IF;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      LEFT JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND (el->>'id') IS NOT NULL
      WHERE COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') = 'return'
        AND (NULLIF(el->>'return_status', '') IS NULL
             OR NULLIF(el->>'return_status', '') NOT IN ('pending', 'stock', 'exchange', 'repaired'))
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '退貨列必須指定有效的 return_status（pending/stock/exchange/repaired）');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      LEFT JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND (el->>'id') IS NOT NULL
      WHERE (
        COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') NOT IN ('return', 'exchange')
        AND (NULLIF(el->>'return_status', '') IS NOT NULL
             OR COALESCE((el->>'is_repair')::boolean, false))
      )
      OR (
        COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') = 'exchange'
        AND NULLIF(el->>'return_status', '') IS NOT NULL
      )
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '僅退貨列可設定 return_status；送修列（exchange + is_repair）不可設定 return_status');
    END IF;
  END IF;

  UPDATE orders
  SET notes = p_notes, updated_at = now()
  WHERE id = p_order_id;

  IF (p_items IS NULL OR jsonb_array_length(p_items) = 0)
     AND (p_deleted_item_ids IS NULL OR array_length(p_deleted_item_ids, 1) = 0) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    DELETE FROM order_items
    WHERE id = ANY(p_deleted_item_ids)
      AND order_id = p_order_id;
  END IF;

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
      line_type = COALESCE(NULLIF(iu.elem->>'line_type', ''), oi.line_type),
      line_note = CASE
        WHEN iu.elem ? 'line_note' THEN NULLIF(iu.elem->>'line_note', '')
        ELSE oi.line_note
      END,
      return_status = CASE
        WHEN iu.elem ? 'return_status' THEN NULLIF(iu.elem->>'return_status', '')
        ELSE oi.return_status
      END,
      is_repair = COALESCE((iu.elem->>'is_repair')::boolean, oi.is_repair),
      updated_at = now()
  FROM (
    SELECT elem
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NOT NULL
  ) iu
  WHERE oi.id = (iu.elem->>'id')::UUID
    AND oi.order_id = p_order_id;

  CREATE TEMP TABLE _new_item_map (temp_key text PRIMARY KEY, item_id uuid)
    ON COMMIT DROP;

  FOR v_elem IN
    SELECT elem FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NULL
    ORDER BY (elem->>'sort_order')::INT NULLS LAST
  LOOP
    INSERT INTO order_items (
      order_id, product_id, variant_id, quantity, unit_price,
      unit_cost, selected_model_name, store_id, sort_order, shipping_payment,
      line_type, line_note, return_status, is_repair
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
      NULLIF(v_elem->>'shipping_payment', ''),
      COALESCE(NULLIF(v_elem->>'line_type', ''), 'sale'),
      NULLIF(v_elem->>'line_note', ''),
      NULLIF(v_elem->>'return_status', ''),
      COALESCE((v_elem->>'is_repair')::boolean, false)
    FROM orders o
    WHERE o.id = p_order_id
    RETURNING id INTO v_item_id;

    v_temp_key := v_elem->>'temp_key';
    IF v_temp_key IS NOT NULL THEN
      INSERT INTO _new_item_map (temp_key, item_id) VALUES (v_temp_key, v_item_id);
    END IF;
  END LOOP;

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

REVOKE ALL ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) TO authenticated;
