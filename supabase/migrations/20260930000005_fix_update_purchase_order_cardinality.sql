-- 20260930000005 修正 update_purchase_order_with_items 的 uuid[] 長度判斷
--
-- 根因：array_length(anyarray, int) 需要第二參數 dimension；原寫成單參數
--       COALESCE(array_length(p_deleted_item_ids), 0) 會在「已取消單鎖品項」
--       守門被執行時拋 42883（function array_length(uuid[]) does not exist），
--       導致所有編輯已取消採購單的請求直接失敗。
-- 修法：改用單參數的 cardinality()（回傳 NULL 給空陣列，保留 COALESCE）。
--
-- 簽名不變、權限不變；重發完整 body 避免沿用舊版。
CREATE OR REPLACE FUNCTION public.update_purchase_order_with_items(
  p_purchase_order_id uuid,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_deleted_item_ids uuid[] DEFAULT '{}',
  p_status text DEFAULT NULL,
  p_order_date date DEFAULT NULL,
  p_expected_date date DEFAULT NULL,
  p_purpose text DEFAULT NULL,
  p_supplier_order_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_po_id uuid;
  v_po_status public.purchase_order_status;
  v_line jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric;
  v_sort integer := 0;
  v_total numeric := 0;
  v_received integer;
  v_consumed integer;
  v_has_batch boolean;
  v_po_locked boolean;
  v_new_status text;
  v_any_received boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可編輯採購單');
  END IF;

  SELECT status INTO v_po_status FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  -- 已取消單鎖定品項變更
  v_po_locked := (v_po_status = 'cancelled');
  IF v_po_locked AND (
    jsonb_array_length(COALESCE(p_items, '[]')) > 0
    OR COALESCE(cardinality(p_deleted_item_ids), 0) > 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已取消的採購單不可變更品項');
  END IF;

  -- 移除品項：已收貨／已耗用／已建立序號批號者不可刪
  FOREACH v_item_id IN ARRAY COALESCE(p_deleted_item_ids, '{}')
  LOOP
    SELECT poi.received_quantity, poi.consumed_quantity,
           EXISTS (SELECT 1 FROM public.product_batches pb WHERE pb.purchase_order_item_id = poi.id)
      INTO v_received, v_consumed, v_has_batch
    FROM public.purchase_order_items poi
    WHERE poi.id = v_item_id AND poi.purchase_order_id = p_purchase_order_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', '要刪除的品項不存在於此採購單：' || v_item_id);
    END IF;
    IF v_received > 0 OR v_consumed > 0 OR v_has_batch THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        '品項已收貨／已使用，無法刪除（請改用採購退貨）', 'item_id', v_item_id);
    END IF;

    DELETE FROM public.purchase_order_items WHERE id = v_item_id;
  END LOOP;

  -- 更新既有品項／新增品項
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'))
  LOOP
    v_item_id := NULLIF(v_line->>'id', '')::uuid;
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_variant_id := NULLIF(v_line->>'variant_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::integer, 0);
    v_cost := COALESCE(NULLIF(v_line->>'unit_cost', '')::numeric, 0);
    v_sort := v_sort + 1;

    IF v_item_id IS NULL THEN
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION '新增品項缺少商品';
      END IF;
      IF v_qty <= 0 THEN
        RAISE EXCEPTION '新增品項數量必須大於 0';
      END IF;
      IF v_variant_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.product_variants pv WHERE pv.id = v_variant_id AND pv.product_id = v_product_id
      ) THEN
        RAISE EXCEPTION '新增品項的變體不屬於該商品';
      END IF;

      INSERT INTO public.purchase_order_items (
        purchase_order_id, product_id, variant_id, quantity, received_quantity, unit_cost, sort_order
      )
      VALUES (p_purchase_order_id, v_product_id, v_variant_id, v_qty, 0, v_cost, v_sort);
      CONTINUE;
    END IF;

    -- 既有品項：守門
    SELECT received_quantity INTO v_received
      FROM public.purchase_order_items
     WHERE id = v_item_id AND purchase_order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '要更新的品項不存在於此採購單：%', v_item_id;
    END IF;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION '品項缺少商品';
    END IF;
    IF v_qty < v_received THEN
      RAISE EXCEPTION '品項數量（%）不可小於已收貨數量（%）', v_qty, v_received;
    END IF;
    IF v_received > 0 AND (
      v_product_id IS DISTINCT FROM (SELECT product_id FROM public.purchase_order_items WHERE id = v_item_id)
      OR v_variant_id IS DISTINCT FROM (SELECT variant_id FROM public.purchase_order_items WHERE id = v_item_id)
    ) THEN
      RAISE EXCEPTION '品項已收貨，不可更換商品或變體';
    END IF;

    UPDATE public.purchase_order_items
       SET quantity = v_qty, unit_cost = v_cost, sort_order = v_sort
     WHERE id = v_item_id;
  END LOOP;

  -- 狀態：僅 draft/ordered/cancelled 可手動指定；partial_received/received 為收貨衍生
  v_new_status := v_po_status::text;
  IF NULLIF(p_status, '') IS NOT NULL THEN
    IF p_status NOT IN ('draft', 'ordered', 'cancelled') THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        '採購單狀態僅支援 draft/ordered/cancelled（收到 ' || p_status || '）');
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id AND received_quantity > 0
    ) INTO v_any_received;
    IF v_any_received AND p_status IS DISTINCT FROM v_po_status::text THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        '此採購單已有收貨品項，狀態由收貨結果決定，不可手動變更');
    END IF;
    v_new_status := p_status;
  END IF;

  UPDATE public.purchase_orders
     SET notes = COALESCE(p_notes, notes),
         order_date = COALESCE(p_order_date, order_date),
         expected_date = CASE WHEN p_expected_date IS NULL THEN expected_date ELSE p_expected_date END,
         purpose = COALESCE(NULLIF(p_purpose, ''), purpose),
         supplier_order_number = CASE
           WHEN p_supplier_order_number IS NULL THEN supplier_order_number
           ELSE NULLIF(btrim(p_supplier_order_number), '')
         END,
         status = v_new_status::public.purchase_order_status
   WHERE id = p_purchase_order_id;

  SELECT COALESCE(SUM(quantity * unit_cost), 0) INTO v_total
    FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id;
  UPDATE public.purchase_orders SET total_amount = v_total WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object('ok', true, 'purchase_order_id', p_purchase_order_id, 'total_amount', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.update_purchase_order_with_items(uuid, text, jsonb, uuid[], text, date, date, text, text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_order_with_items(uuid, text, jsonb, uuid[], text, date, date, text, text)
  TO authenticated;
