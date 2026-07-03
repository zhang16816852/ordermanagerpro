-- RPC: 刪除銷貨單並回滾庫存（反向操作 ship_from_pool）
-- 由管理員銷售單頁面呼叫

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
BEGIN
  -- 遍歷銷貨單的所有項目
  FOR v_item IN 
    SELECT si.order_item_id, si.quantity, oi.quantity AS total_quantity, oi.shipped_quantity
    FROM sales_note_items si
    JOIN order_items oi ON si.order_item_id = oi.id
    WHERE si.sales_note_id = p_sales_note_id
  LOOP
    -- 計算回滾後已出貨數量
    v_new_shipped := GREATEST(0, v_item.shipped_quantity - v_item.quantity);
    v_total_quantity := v_item.total_quantity;

    -- 根據回滾後數量設定 order_item_status
    UPDATE order_items
    SET shipped_quantity = v_new_shipped,
        status = CASE 
                    WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                    WHEN v_new_shipped < v_total_quantity THEN 'partial'::order_item_status
                    ELSE 'shipped'::order_item_status
                 END
    WHERE id = v_item.order_item_id;
  END LOOP;

  -- 刪除銷貨單項目
  DELETE FROM sales_note_items WHERE sales_note_id = p_sales_note_id;

  -- 刪除銷貨單
  DELETE FROM sales_notes WHERE id = p_sales_note_id;
END;
$$;
