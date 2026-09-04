-- 批次將出貨池品項移回訂單（回滾成訂單／移出出貨池）
-- 說明：加入出貨池時只建立 shipping_pool 列並將訂單改 processing，不動 order_items 數量；
--       故移出時只需批次刪除 pool 列；當訂單在出貨池已無任何剩餘品項時，才將訂單回退 pending。
CREATE OR REPLACE FUNCTION public.remove_items_from_shipping_pool(
  p_pool_ids UUID[],
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_pool_id UUID;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_deleted_count INTEGER := 0;
  v_reverted_order_ids UUID[] := '{}';
  v_result JSONB;
BEGIN
  IF p_pool_ids IS NULL OR cardinality(p_pool_ids) = 0 THEN
    RAISE EXCEPTION '請至少選擇一個要移出出貨池的品項';
  END IF;

  -- 收集這些 pool 列所屬的訂單，並逐列從出貨池移除（單一指令批次處理亦可，此處逐列收集 order 供後續回退檢查）
  FOR v_pool_id IN SELECT unnest(p_pool_ids) LOOP
    SELECT oi.order_id INTO v_order_id
    FROM public.shipping_pool sp
    JOIN public.order_items oi ON oi.id = sp.order_item_id
    WHERE sp.id = v_pool_id;

    IF v_order_id IS NULL THEN
      CONTINUE; -- 列不存在或已刪除，略過
    END IF;

    IF NOT (v_order_id = ANY(v_affected_order_ids)) THEN
      v_affected_order_ids := array_append(v_affected_order_ids, v_order_id);
    END IF;
  END LOOP;

  -- 批次刪除出貨池列
  DELETE FROM public.shipping_pool
  WHERE id = ANY(p_pool_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- 全數移出後才回退 pending：僅當該訂單在出貨池已無任何剩餘品項且目前為 processing
  FOR v_order_id IN SELECT unnest(v_affected_order_ids) LOOP
    UPDATE public.orders o
    SET status = 'pending', updated_at = NOW()
    WHERE o.id = v_order_id
      AND o.status = 'processing'
      AND NOT EXISTS (
        SELECT 1
        FROM public.shipping_pool sp2
        JOIN public.order_items oi2 ON oi2.id = sp2.order_item_id
        WHERE oi2.order_id = v_order_id
      );

    IF FOUND THEN
      v_reverted_order_ids := array_append(v_reverted_order_ids, v_order_id);
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'deleted_count', v_deleted_count,
    'reverted_order_ids', COALESCE(v_reverted_order_ids, '{}')
  );

  RETURN v_result;
END;
$$;

-- 執行權限授予已註冊 role（函式為 SECURITY DEFINER，需授予執行權）
GRANT EXECUTE ON FUNCTION public.remove_items_from_shipping_pool(UUID[], UUID) TO authenticated;
