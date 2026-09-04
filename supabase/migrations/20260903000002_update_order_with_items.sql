-- update_order_with_items: 伺服器端批次 upsert + delete 品項
-- 前端只需一次呼叫，取代逐筆 for...of 的 N+1 模式
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
BEGIN
  -- 1. 更新訂單備註
  UPDATE orders
  SET notes = p_notes, updated_at = now()
  WHERE id = p_order_id;

  -- 2. 刪除被移除的品項（軟刪除後端提交）
  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    DELETE FROM order_items
    WHERE id = ANY(p_deleted_item_ids)
      AND order_id = p_order_id;
  END IF;

  -- 3. 更新既有品項（id IS NOT NULL）
  UPDATE order_items oi
  SET quantity = (iu.elem->>'quantity')::INT,
      unit_price = (iu.elem->>'unit_price')::NUMERIC,
      sort_order = (iu.elem->>'sort_order')::INT,
      selected_model_name = (iu.elem->>'selected_model_name')::TEXT,
      updated_at = now()
  FROM (
    SELECT elem
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NOT NULL
  ) iu
  WHERE oi.id = (iu.elem->>'id')::UUID
    AND oi.order_id = p_order_id;

  -- 4. 插入新品項（id IS NULL）
  INSERT INTO order_items (
    order_id, product_id, variant_id, quantity, unit_price,
    selected_model_name, store_id, sort_order
  )
  SELECT
    p_order_id,
    (elem->>'product_id')::UUID,
    NULLIF(elem->>'variant_id', '')::UUID,
    (elem->>'quantity')::INT,
    (elem->>'unit_price')::NUMERIC,
    NULLIF(elem->>'selected_model_name', ''),
    o.store_id,
    (elem->>'sort_order')::INT
  FROM jsonb_array_elements(p_items) AS elem
  CROSS JOIN orders o
  WHERE o.id = p_order_id
    AND (elem->>'id') IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;
