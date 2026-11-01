-- 20261102000001 修復 source_order_ids 被誤寫為採購單自身 id 的資料與流程
--
-- 背景：2026/10/28–10/31 有 64 筆 purchase_order_items 的 source_order_ids 被寫成
--       [purchase_order_id]（採購單自己的 id），而非銷售訂單 id，導致前台顯示
--       UUID 前綴、訂單端反查永遠查不到（顯示「未採購」）。
--
-- 本 migration：
--   1. 清空受影響品項的錯誤綁定（source_order_ids / source_quantities = NULL）。
--   2. 在 _po_create_with_items / update_purchase_order_with_items 解析
--      source_order_ids 時，過濾掉不存在於 orders 表的 id（DB 層防呆）。
--   3. source_quantities 的 key 若對應的 order id 不存在，整體清空（避免孤兒 key）。

-- ============================================================================
-- 1. 資料修復
-- ============================================================================
UPDATE public.purchase_order_items
SET source_order_ids = NULL, source_quantities = NULL
WHERE source_order_ids IS NOT NULL
  AND source_order_ids = ARRAY[purchase_order_id];

-- ============================================================================
-- 2. _po_create_with_items：解析 source_order_ids 時過濾無效 order id
-- ============================================================================
CREATE OR REPLACE FUNCTION public._po_create_with_items(
  p_supplier_id uuid,
  p_order_date date,
  p_status text,
  p_purpose text,
  p_expected_date date,
  p_supplier_order_number text,
  p_notes text,
  p_items jsonb,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_po_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_idx integer := 0;
  v_total numeric := 0;
  v_created jsonb := '[]';
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric;
  v_source_ids uuid[];
  v_source_qty jsonb;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '沒有品項';
  END IF;

  INSERT INTO public.purchase_orders (
    supplier_id, status, purpose, order_date, expected_date,
    supplier_order_number, total_amount, notes, created_by
  )
  VALUES (
    p_supplier_id,
    COALESCE(NULLIF(p_status, ''), 'draft')::public.purchase_order_status,
    COALESCE(NULLIF(p_purpose, ''), 'general'),
    COALESCE(p_order_date, CURRENT_DATE),
    p_expected_date,
    NULLIF(btrim(COALESCE(p_supplier_order_number, '')), ''),
    0,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    COALESCE(p_created_by, auth.uid())
  )
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_variant_id := NULLIF(v_line->>'variant_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::integer, 0);
    v_cost := COALESCE(NULLIF(v_line->>'unit_cost', '')::numeric, 0);

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION '第 % 個品項缺少商品', v_idx;
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION '第 % 個品項數量必須大於 0', v_idx;
    END IF;
    IF v_cost < 0 THEN
      RAISE EXCEPTION '第 % 個品項單價不可為負', v_idx;
    END IF;
    IF v_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants pv WHERE pv.id = v_variant_id AND pv.product_id = v_product_id
    ) THEN
      RAISE EXCEPTION '第 % 個品項的變體不屬於該商品', v_idx;
    END IF;

    -- 來源訂單 ids：key 缺席 → NULL；JSON null → NULL；array → 正規化並過濾無效 order id；其餘 → RAISE
    IF v_line ? 'source_order_ids' THEN
      IF v_line->'source_order_ids' = 'null'::jsonb THEN
        v_source_ids := NULL;
      ELSIF jsonb_typeof(v_line->'source_order_ids') = 'array' THEN
        SELECT COALESCE(array_agg(t.val::uuid), '{}') INTO v_source_ids
          FROM jsonb_array_elements_text(v_line->'source_order_ids') AS t(val)
         WHERE t.val::uuid IN (SELECT id FROM public.orders);
        -- 過濾後為空 → NULL（避免寫入空陣列）
        IF v_source_ids = '{}'::uuid[] THEN v_source_ids := NULL; END IF;
      ELSE
        RAISE EXCEPTION '第 % 個品項的來源訂單格式錯誤', v_idx;
      END IF;
    ELSE
      v_source_ids := NULL;
    END IF;

    -- 來源數量：key 缺席 → NULL；JSON null → NULL；object → 正規化；其餘 → RAISE
    -- 若 source_order_ids 被過濾為 NULL，source_quantities 也清空（避免孤兒 key）
    IF v_line ? 'source_quantities' THEN
      IF v_line->'source_quantities' = 'null'::jsonb THEN
        v_source_qty := NULL;
      ELSIF jsonb_typeof(v_line->'source_quantities') = 'object' THEN
        IF v_source_ids IS NULL THEN
          v_source_qty := NULL;
        ELSE
          v_source_qty := NULLIF(v_line->'source_quantities', '{}'::jsonb);
        END IF;
      ELSE
        RAISE EXCEPTION '第 % 個品項的來源數量格式錯誤', v_idx;
      END IF;
    ELSE
      v_source_qty := NULL;
    END IF;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, variant_id, quantity, received_quantity, unit_cost, sort_order,
      source_order_ids, source_quantities
    )
    VALUES (v_po_id, v_product_id, v_variant_id, v_qty, 0, v_cost, v_idx, v_source_ids, v_source_qty)
    RETURNING id INTO v_item_id;

    v_total := v_total + (v_qty * v_cost);
    v_created := v_created || jsonb_build_object(
      'id', v_item_id,
      'product_id', v_product_id,
      'variant_id', v_variant_id,
      'quantity', v_qty
    );
  END LOOP;

  UPDATE public.purchase_orders SET total_amount = v_total WHERE id = v_po_id;

  RETURN jsonb_build_object('ok', true, 'purchase_order_id', v_po_id, 'items', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public._po_create_with_items(uuid, date, text, text, date, text, text, jsonb, uuid)
  FROM public, anon, authenticated;
-- 內部 helper：僅 owner / SECURITY DEFINER 呼叫端使用
REVOKE ALL ON FUNCTION public._po_create_with_items(uuid, date, text, text, date, text, text, jsonb, uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public._po_create_with_items(uuid, date, text, text, date, text, text, jsonb, uuid)
  TO service_role;

-- ============================================================================
-- 3. update_purchase_order_with_items：解析 source_order_ids 時過濾無效 order id
-- ============================================================================
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
  v_source_ids uuid[];
  v_source_qty jsonb;
  v_has_src_ids boolean;
  v_has_src_qty boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可編輯採購單');
  END IF;

  SELECT status INTO v_po_status FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  v_po_locked := (v_po_status = 'cancelled');
  IF v_po_locked AND (
    jsonb_array_length(COALESCE(p_items, '[]')) > 0
    OR COALESCE(cardinality(p_deleted_item_ids), 0) > 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已取消的採購單不可變更品項');
  END IF;

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

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'))
  LOOP
    v_item_id := NULLIF(v_line->>'id', '')::uuid;
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_variant_id := NULLIF(v_line->>'variant_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::integer, 0);
    v_cost := COALESCE(NULLIF(v_line->>'unit_cost', '')::numeric, 0);
    v_sort := v_sort + 1;

    -- 來源訂單 ids（key 缺席 → 不覆寫；JSON null → 清除；array → 正規化並過濾無效 order id；其餘 → RAISE）
    v_has_src_ids := v_line ? 'source_order_ids';
    IF v_has_src_ids THEN
      IF v_line->'source_order_ids' = 'null'::jsonb THEN
        v_source_ids := NULL;
      ELSIF jsonb_typeof(v_line->'source_order_ids') = 'array' THEN
        SELECT COALESCE(array_agg(t.val::uuid), '{}') INTO v_source_ids
          FROM jsonb_array_elements_text(v_line->'source_order_ids') AS t(val)
         WHERE t.val::uuid IN (SELECT id FROM public.orders);
        IF v_source_ids = '{}'::uuid[] THEN v_source_ids := NULL; END IF;
      ELSE
        RAISE EXCEPTION '品項的來源訂單格式錯誤';
      END IF;
    END IF;

    -- 來源數量（key 缺席 → 不覆寫；JSON null → 清除；object → 正規化；其餘 → RAISE）
    -- 若 source_order_ids 被過濾為 NULL，source_quantities 也清空
    v_has_src_qty := v_line ? 'source_quantities';
    IF v_has_src_qty THEN
      IF v_line->'source_quantities' = 'null'::jsonb THEN
        v_source_qty := NULL;
      ELSIF jsonb_typeof(v_line->'source_quantities') = 'object' THEN
        IF v_source_ids IS NULL AND v_has_src_ids THEN
          v_source_qty := NULL;
        ELSE
          v_source_qty := NULLIF(v_line->'source_quantities', '{}'::jsonb);
        END IF;
      ELSE
        RAISE EXCEPTION '品項的來源數量格式錯誤';
      END IF;
    END IF;

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
        purchase_order_id, product_id, variant_id, quantity, received_quantity, unit_cost, sort_order,
        source_order_ids, source_quantities
      )
      VALUES (p_purchase_order_id, v_product_id, v_variant_id, v_qty, 0, v_cost, v_sort,
              v_source_ids, v_source_qty);
      CONTINUE;
    END IF;

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
       SET quantity = v_qty, unit_cost = v_cost, sort_order = v_sort,
           source_order_ids = CASE WHEN v_has_src_ids THEN v_source_ids ELSE source_order_ids END,
           source_quantities = CASE WHEN v_has_src_qty THEN v_source_qty ELSE source_quantities END
     WHERE id = v_item_id;
  END LOOP;

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