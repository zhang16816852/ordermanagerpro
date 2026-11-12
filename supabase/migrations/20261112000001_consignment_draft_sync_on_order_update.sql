-- 20261112000001_consignment_draft_sync_on_order_update.sql
-- 訂單編輯時，同步回寫寄賣草稿（draft）品項；已出貨寄賣單（active/settled）需先回滾出貨
--
-- 規則：
--   1. 若訂單有 active/settled 寄賣單，且本次編輯有品項層級變更
--      （刪除品項 / 新增品項 / 數量、單價、商品、變體變更），
--      則阻擋整個 update_order_with_items，回傳 {ok:false, reason}，
--      提示使用者先回滾出貨後再修改。
--   2. notes-only 編輯（品項完全相同、無增刪）在 active/settled 狀態下仍允許。
--   3. 若訂單有 draft 寄賣單，則在 item upsert/delete 完成後，
--      以訂單為準重建 consignment_order_items（quantity = quantity - shipped_quantity，
--      僅保留剩餘未出貨量；價格/成本同步）。
--   receive_from_supplier 方向的寄賣單無 source_order_id，不受影響。
--
-- 以遠端當前 prosrc 為基底做 in-place patch，避免把狀態收斂等後續修正還原。

DO $$
DECLARE
  v_body text;
BEGIN
  SELECT prosrc INTO v_body FROM pg_proc WHERE proname = 'update_order_with_items' LIMIT 1;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'update_order_with_items not found';
  END IF;

  -- 已套用則跳過
  IF position('consignment draft sync on order update' in v_body) > 0 THEN
    RETURN;
  END IF;

  -- A. 守門：active/settled 寄賣單存在時，品項層級變更需先回滾出貨
  --    插入於 line_type 守門之前
  v_body := regexp_replace(
    v_body,
    '  -- 3\) line_type',
    $guard$  -- 寄賣已出貨守門：active/settled 寄賣單存在時，品項層級變更需先回滾出貨
  -- consignment draft sync on order update: guard
  IF (
    (p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0)
    OR (p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_items) AS el WHERE (el->>'id') IS NULL
    ))
    OR (p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_items) AS el
         JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
         WHERE (el->>'id') IS NOT NULL
           AND (oi.quantity <> (el->>'quantity')::INT
                OR oi.unit_price <> (el->>'unit_price')::NUMERIC
                OR oi.product_id <> (el->>'product_id')::UUID
                OR oi.variant_id IS DISTINCT FROM NULLIF((el->>'variant_id'), '')::UUID)
    ))
  ) THEN
    IF EXISTS (SELECT 1 FROM public.consignment_orders WHERE source_order_id = p_order_id AND status IN ('active','settled')) THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        '寄賣單 ' || (SELECT code FROM public.consignment_orders WHERE source_order_id = p_order_id AND status IN ('active','settled') LIMIT 1) || ' 已出貨，請先回滾出貨後再修改訂單品項。');
    END IF;
  END IF;

  -- 3) line_type$guard$,
    's'
  );

  -- B. 同步：draft 寄賣單以訂單為準重建品項
  --    插入於最終 RETURN 之前
  v_body := regexp_replace(
    v_body,
    '  RETURN jsonb_build_object\(''ok'', true\);\s*END;',
    $sync$  -- 寄賣草稿同步：以訂單為準重建 draft 寄賣單品項
  -- consignment draft sync on order update: sync
  IF EXISTS (SELECT 1 FROM public.consignment_orders WHERE source_order_id = p_order_id AND status = 'draft') THEN
    DELETE FROM public.consignment_order_items
    WHERE consignment_order_id IN (SELECT id FROM public.consignment_orders WHERE source_order_id = p_order_id AND status = 'draft');

    INSERT INTO public.consignment_order_items (consignment_order_id, product_id, variant_id, quantity, unit_price, unit_cost, order_item_id)
    SELECT co.id, oi.product_id, oi.variant_id, (oi.quantity - oi.shipped_quantity), oi.unit_price, oi.unit_cost, oi.id
    FROM public.consignment_orders co
    JOIN public.order_items oi ON oi.order_id = p_order_id
    WHERE co.source_order_id = p_order_id
      AND co.status = 'draft'
      AND (oi.quantity - oi.shipped_quantity) > 0;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;$sync$,
    's'
  );

  EXECUTE 'CREATE OR REPLACE FUNCTION public.update_order_with_items(' ||
          'p_order_id UUID, ' ||
          'p_notes TEXT DEFAULT NULL, ' ||
          'p_items JSONB DEFAULT ''[]''::jsonb, ' ||
          'p_deleted_item_ids UUID[] DEFAULT ''{}''::uuid[]) ' ||
          'RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$' ||
          v_body || '$body$;';

  REVOKE ALL ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) FROM public, anon;
  GRANT EXECUTE ON FUNCTION public.update_order_with_items(UUID, TEXT, JSONB, UUID[]) TO authenticated;
END $$;