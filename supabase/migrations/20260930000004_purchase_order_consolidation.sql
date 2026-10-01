-- 20260930000004 採購單整併：建立／更新交易 RPC、品項安全刪除、批次匯入（含序號批號收貨）
--
-- 目標：
--   1. 採購單建立／編輯收斂到 AdminOrderForm，PO 頭與品項在同一交易內寫入，sort_order 可靠落地。
--   2. 已收貨品項不可刪除／不可降數／不可換商品，補上裸 DELETE 缺口。
--   3. 批次匯入：每張採購單一個子交易，序號／批號收貨失敗時 PO、品項、product_batches、
--      inventory_movements 與 trigger 同步的庫存全部回退，其他張照常提交。
--   4. 逐品項判重 (supplier_id, supplier_order_number, product_id, variant_id)：
--      已存在者跳過，剩餘新品項另建一張沿用同單號的採購單（同一供應商單號合法存在於多張 PO）。

-- ============================================================================
-- 1. 商品解析：供應商 mapping → 內部 SKU → 品名
-- ============================================================================
CREATE OR REPLACE FUNCTION public._po_resolve_item(
  p_supplier_id uuid DEFAULT NULL,
  p_sku text DEFAULT NULL,
  p_item_name text DEFAULT NULL,
  p_vendor_product_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_vendor_id text := NULLIF(btrim(COALESCE(p_vendor_product_id, '')), '');
  v_product_id uuid;
  v_variant_id uuid;
  v_cost numeric;
  v_label text;
  v_res jsonb;
BEGIN
  -- (1) 供應商商品 mapping（廠商料號 → 內部商品／變體 + 廠商單價）
  IF v_vendor_id IS NOT NULL AND p_supplier_id IS NOT NULL THEN
    SELECT m.internal_product_id, m.internal_variant_id, m.vendor_unit_cost
      INTO v_product_id, v_variant_id, v_cost
      FROM public.supplier_product_mappings m
     WHERE m.supplier_id = p_supplier_id
       AND m.vendor_product_id = v_vendor_id
     LIMIT 1;
    IF FOUND THEN
      SELECT COALESCE(pv.name, p.name)
        INTO v_label
        FROM public.products p
        LEFT JOIN public.product_variants pv ON pv.id = v_variant_id
       WHERE p.id = v_product_id;
      RETURN jsonb_build_object(
        'product_id', v_product_id,
        'variant_id', v_variant_id,
        'name', COALESCE(v_label, v_vendor_id),
        'unit_cost', v_cost,
        'source', 'mapping'
      );
    END IF;
  END IF;

  -- (2)(3) 內部 SKU → 品名（沿用既有 import_resolve_item 行為）
  v_res := public.import_resolve_item(p_sku, p_item_name);
  IF v_res IS NOT NULL THEN
    RETURN (v_res - 'fallback_price')
      || jsonb_build_object('unit_cost', v_res->'fallback_price', 'source', 'sku');
  END IF;

  RETURN NULL;
END;
$$;

-- 內部 helper：不對外開放（僅由 SECURITY DEFINER 呼叫端以 owner 身分使用）
REVOKE ALL ON FUNCTION public._po_resolve_item(uuid, text, text, text) FROM public, anon, authenticated;

-- ============================================================================
-- 2. 內部建立 helper：品項已解析完成才呼叫（先解析、後寫入）
--    回傳建立後的品項（含 id）供收貨時組 p_lots
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
    -- 變體必須真的屬於該商品（避免錯配造成庫存與明細分離）
    IF v_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants pv WHERE pv.id = v_variant_id AND pv.product_id = v_product_id
    ) THEN
      RAISE EXCEPTION '第 % 個品項的變體不屬於該商品', v_idx;
    END IF;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, variant_id, quantity, received_quantity, unit_cost, sort_order
    )
    VALUES (v_po_id, v_product_id, v_variant_id, v_qty, 0, v_cost, v_idx)
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

-- 內部 helper：不對外開放（僅由 SECURITY DEFINER 呼叫端以 owner 身分使用）
REVOKE ALL ON FUNCTION public._po_create_with_items(uuid, date, text, text, date, text, text, jsonb, uuid)
  FROM public, anon, authenticated;

-- ============================================================================
-- 3. 對外：建立採購單（含品項）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_purchase_order_with_items(
  p_supplier_id uuid,
  p_order_date date DEFAULT NULL,
  p_items jsonb DEFAULT '[]',
  p_status text DEFAULT 'draft',
  p_purpose text DEFAULT 'general',
  p_expected_date date DEFAULT NULL,
  p_supplier_order_number text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_status text := COALESCE(NULLIF(p_status, ''), 'draft');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可建立採購單');
  END IF;
  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '請選擇供應商');
  END IF;
  -- partial_received / received 為收貨衍生狀態，不可手動指定
  IF v_status NOT IN ('draft', 'ordered', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      '採購單狀態僅支援 draft/ordered/cancelled（收到 ' || v_status || '）');
  END IF;

  RETURN public._po_create_with_items(
    p_supplier_id, p_order_date, v_status, p_purpose, p_expected_date,
    p_supplier_order_number, p_notes, p_items, COALESCE(p_created_by, auth.uid())
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_purchase_order_with_items(uuid, date, jsonb, text, text, date, text, text, uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order_with_items(uuid, date, jsonb, text, text, date, text, text, uuid)
  TO authenticated;

-- ============================================================================
-- 4. 對外：更新採購單（含品項，軟刪除 p_deleted_item_ids）
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

-- ============================================================================
-- 5. 對外：刪除單一採購品項（取代前端裸 DELETE）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_purchase_order_item_if_safe(
  p_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_po_id uuid;
  v_received integer;
  v_consumed integer;
  v_returned integer;
  v_has_batch boolean;
  v_total numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除採購品項');
  END IF;

  SELECT poi.purchase_order_id, poi.received_quantity, poi.consumed_quantity, poi.returned_quantity,
         EXISTS (SELECT 1 FROM public.product_batches pb WHERE pb.purchase_order_item_id = poi.id)
    INTO v_po_id, v_received, v_consumed, v_returned, v_has_batch
  FROM public.purchase_order_items poi
  WHERE poi.id = p_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '品項不存在');
  END IF;
  IF v_received > 0 OR v_consumed > 0 OR v_returned > 0 OR v_has_batch THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      '品項已收貨／已使用／已產生序號批號，無法刪除（請改用採購退貨）');
  END IF;

  DELETE FROM public.purchase_order_items WHERE id = p_item_id;

  SELECT COALESCE(SUM(quantity * unit_cost), 0) INTO v_total
    FROM public.purchase_order_items WHERE purchase_order_id = v_po_id;
  UPDATE public.purchase_orders
     SET total_amount = v_total, updated_at = NOW()
   WHERE id = v_po_id;

  RETURN jsonb_build_object('ok', true, 'purchase_order_id', v_po_id, 'total_amount', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_purchase_order_item_if_safe(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_purchase_order_item_if_safe(uuid) TO authenticated;

-- ============================================================================
-- 6. 對外：採購單批次匯入
--    每張採購單一個子交易（BEGIN … EXCEPTION），序號／批號收貨失敗時整張回退。
--    逐品項判重：(supplier_id, supplier_order_number, product_id, variant_id)
--      已存在者跳過；剩餘新品項另建一張沿用同單號的採購單。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.import_purchase_orders_batch(
  p_supplier_id uuid,
  p_groups jsonb,
  p_warehouse_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_creator uuid := COALESCE(p_created_by, auth.uid());
  v_groups jsonb;
  v_group jsonb;
  v_line jsonb;
  v_res jsonb;
  v_idx integer := -1;
  v_line_idx integer := 0;
  v_total integer;
  v_success integer := 0;
  v_results jsonb := '[]';
  v_errors jsonb := '[]';
  v_po_number text;
  v_status text;
  v_purpose text;
  v_order_date date;
  v_expected_date date;
  v_notes text;
  v_receive boolean;
  v_warehouse uuid := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));
  v_resolved jsonb := '[]';
  v_new_items jsonb := '[]';
  v_skipped jsonb := '[]';
  v_resolve jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric;
  v_label text;
  v_duplicate boolean;
  v_created jsonb;
  v_po_id uuid;
  v_created_items jsonb;
  v_rpc_items jsonb := '[]';
  v_rpc_lots jsonb := '[]';
  v_new_item jsonb;
  v_link record;
  v_serials jsonb;
  v_batch_number text;
  v_batch_cost numeric;
  v_mode text;
  v_err text;
  v_skipped_names jsonb := '[]';
  v_created_names jsonb := '[]';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION '僅管理員可匯入採購單';
  END IF;
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION '請選擇供應商';
  END IF;
  IF jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'p_groups 必須為 JSON 陣列';
  END IF;

  v_groups := p_groups;
  v_total := jsonb_array_length(v_groups);

  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    v_idx := v_idx + 1;
    v_err := NULL;
    v_resolved := '[]';
    v_new_items := '[]';
    v_skipped := '[]';
    v_skipped_names := '[]';
    v_created_names := '[]';

    BEGIN
      v_po_number := NULLIF(btrim(COALESCE(v_group->>'supplier_order_number', '')), '');
      v_status := COALESCE(NULLIF(v_group->>'status', ''), 'draft');
      IF v_status NOT IN ('draft', 'ordered', 'cancelled') THEN
        RAISE EXCEPTION '採購單狀態僅支援 draft/ordered/cancelled（收到 %）', v_status;
      END IF;
      v_purpose := COALESCE(NULLIF(v_group->>'purpose', ''), 'general');
      v_order_date := COALESCE(NULLIF(v_group->>'order_date', '')::date, CURRENT_DATE);
      v_expected_date := NULLIF(v_group->>'expected_date', '')::date;
      v_notes := NULLIF(btrim(COALESCE(v_group->>'notes', '')), '');
      v_receive := COALESCE((v_group->>'receive')::boolean, false);

      IF jsonb_typeof(v_group->'items') <> 'array' OR jsonb_array_length(v_group->'items') = 0 THEN
        RAISE EXCEPTION '沒有品項';
      END IF;

      -- 同一 (供應商, 廠商單號) 併行匯入序列化（空單號不鎖、不判重）
      IF v_po_number IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(p_supplier_id::text || ':' || v_po_number));
      END IF;

      -- Phase 1：先完整解析所有品項（尚未寫入任何資料）→ 任一失敗整張中止
      v_line_idx := 0;
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_group->'items')
      LOOP
        v_line_idx := v_line_idx + 1;
        v_res := public._po_resolve_item(
          p_supplier_id,
          v_line->>'sku',
          v_line->>'name',
          v_line->>'vendor_product_id'
        );
        IF v_res IS NULL THEN
          RAISE EXCEPTION '第 % 個品項找不到對應商品（料號：%／品名：%／廠商料號：%）',
            v_line_idx,
            COALESCE(NULLIF(v_line->>'sku', ''), '(未填)'),
            COALESCE(NULLIF(v_line->>'name', ''), '(未填)'),
            COALESCE(NULLIF(v_line->>'vendor_product_id', ''), '(未填)');
        END IF;

        v_product_id := (v_res->>'product_id')::uuid;
        v_variant_id := NULLIF(v_res->>'variant_id', '')::uuid;
        v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::integer, 0);
        v_cost := COALESCE(
          NULLIF(v_line->>'unit_cost', '')::numeric,
          NULLIF(v_res->>'unit_cost', '')::numeric,
          0
        );
        v_label := COALESCE(v_res->>'name', v_line->>'name', v_line->>'sku', '(未命名)');

        IF v_qty <= 0 THEN
          RAISE EXCEPTION '第 % 個品項（%）數量必須大於 0', v_line_idx, v_label;
        END IF;

        v_resolved := v_resolved || jsonb_build_object(
          'product_id', v_product_id,
          'variant_id', v_variant_id,
          'quantity', v_qty,
          'unit_cost', v_cost,
          'name', v_label,
          'serials', COALESCE(v_line->'serials', '[]'::jsonb),
          'batch_number', v_line->>'batch_number',
          'batch_unit_cost', v_line->>'batch_unit_cost'
        );
      END LOOP;

      -- Phase 2：逐品項判重（僅非空單號、且既有 PO 非 cancelled）
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_resolved)
      LOOP
        v_duplicate := false;
        IF v_po_number IS NOT NULL THEN
          SELECT EXISTS (
            SELECT 1
              FROM public.purchase_order_items poi
              JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
             WHERE po.supplier_id = p_supplier_id
               AND po.supplier_order_number = v_po_number
               AND po.status <> 'cancelled'
               AND poi.product_id = (v_line->>'product_id')::uuid
               AND poi.variant_id IS NOT DISTINCT FROM NULLIF(v_line->>'variant_id', '')::uuid
          ) INTO v_duplicate;
        END IF;

        IF v_duplicate THEN
          v_skipped := v_skipped || v_line;
          v_skipped_names := v_skipped_names || jsonb_build_object('name', v_line->>'name', 'quantity', v_line->>'quantity');
        ELSE
          v_new_items := v_new_items || v_line;
          v_created_names := v_created_names || jsonb_build_object('name', v_line->>'name', 'quantity', v_line->>'quantity');
        END IF;
      END LOOP;

      -- 全部品項已存在 → 整組跳過（非錯誤）
      IF jsonb_array_length(v_new_items) = 0 THEN
        v_results := v_results || jsonb_build_object(
          'index', v_idx,
          'status', 'skipped',
          'supplier_order_number', v_po_number,
          'reason', '所有品項已存在於同供應商同單號的採購單',
          'skipped_items', v_skipped_names
        );
        CONTINUE;
      END IF;

      -- Phase 3：建立採購單 + 品項
      v_created := public._po_create_with_items(
        p_supplier_id, v_order_date, v_status, v_purpose, v_expected_date,
        v_po_number, v_notes,
        (SELECT jsonb_agg(jsonb_build_object(
           'product_id', e->>'product_id',
           'variant_id', e->>'variant_id',
           'quantity', e->>'quantity',
           'unit_cost', e->>'unit_cost'
         )) FROM jsonb_array_elements(v_new_items) e),
        v_creator
      );
      IF NOT (v_created->>'ok')::boolean THEN
        RAISE EXCEPTION '建立採購單失敗：%', v_created->>'reason';
      END IF;
      v_po_id := (v_created->>'purchase_order_id')::uuid;
      v_created_items := v_created->'items';

      -- Phase 4：立即收貨（序號／批號錯誤 → 上方 EXCEPTION 讓整張回退）
      v_rpc_items := '[]';
      v_rpc_lots := '[]';
      IF v_receive AND v_status NOT IN ('draft', 'cancelled') THEN
        FOR v_new_item IN SELECT * FROM jsonb_array_elements(v_created_items)
        LOOP
          v_rpc_items := v_rpc_items || jsonb_build_object(
            'id', v_new_item->>'id',
            'product_id', v_new_item->>'product_id',
            'variant_id', v_new_item->>'variant_id',
            'received_quantity', v_new_item->>'quantity',
            'purchase_order_id', v_po_id,
            'purchase_order_code', COALESCE(v_po_number, v_po_id::text),
            'warehouse_id', v_warehouse
          );
        END LOOP;

        -- 依「同品項」對回原始檔案的 serials / batch_number
        FOR v_link IN
          SELECT c.value AS created,
                 n.value AS src
            FROM jsonb_array_elements(v_created_items) WITH ORDINALITY AS c(value, ord)
            JOIN jsonb_array_elements(v_new_items) WITH ORDINALITY AS n(value, ord)
              ON n.ord = c.ord
        LOOP
          v_mode := NULL;
          IF NULLIF(v_link.created->>'variant_id', '') IS NOT NULL THEN
            SELECT pv.tracking_mode INTO v_mode
              FROM public.product_variants pv WHERE pv.id = (v_link.created->>'variant_id')::uuid;
          END IF;

          IF v_mode = 'serial' OR v_mode = 'batch' THEN
            v_batch_number := NULLIF(btrim(COALESCE(v_link.src->>'batch_number', '')), '');
            v_batch_cost := NULLIF(v_link.src->>'batch_unit_cost', '')::numeric;
            v_serials := COALESCE(v_link.src->'serials', '[]'::jsonb);

            IF v_mode = 'serial' THEN
              IF jsonb_typeof(v_serials) <> 'array' OR jsonb_array_length(v_serials) = 0 THEN
                RAISE EXCEPTION '「%」為序號商品，必須提供序號清單（% 支）',
                  v_link.src->>'name', v_link.created->>'quantity';
              END IF;
              IF jsonb_array_length(v_serials) <> (v_link.created->>'quantity')::integer THEN
                RAISE EXCEPTION '「%」序號數量（% 個）與收貨數量（% 件）不符',
                  v_link.src->>'name',
                  jsonb_array_length(v_serials),
                  v_link.created->>'quantity';
              END IF;
            ELSE
              IF v_batch_number IS NULL THEN
                RAISE EXCEPTION '「%」為批號商品，必須提供批號', v_link.src->>'name';
              END IF;
            END IF;

            v_rpc_lots := v_rpc_lots || jsonb_build_object(
              'purchase_order_item_id', v_link.created->>'id',
              'mode', v_mode,
              'serials', v_serials,
              'batch_number', v_batch_number,
              'unit_cost', v_batch_cost
            );
          END IF;
        END LOOP;

        -- receive_purchase_items 為 RETURNS void 且內部無 exception handler，
        -- 錯誤以 RAISE 傳播 → 由本子交易 EXCEPTION 完整回退 PO/品項/批次/庫存
        PERFORM public.receive_purchase_items(
          v_rpc_items,
          v_warehouse,
          CASE WHEN jsonb_array_length(v_rpc_lots) > 0 THEN v_rpc_lots ELSE NULL END
        );
      END IF;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'index', v_idx,
        'status', 'created',
        'purchase_order_id', v_po_id,
        'supplier_order_number', v_po_number,
        'received', (v_receive AND v_status NOT IN ('draft', 'cancelled')),
        'created_items', v_created_names,
        'skipped_items', v_skipped_names
      );
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_errors := v_errors || jsonb_build_object(
        'index', v_idx,
        'supplier_order_number', v_po_number,
        'reason', v_err
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'success', v_success,
    'results', v_results,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_purchase_orders_batch(uuid, jsonb, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_purchase_orders_batch(uuid, jsonb, uuid, uuid) TO authenticated;

-- ============================================================================
-- 7. 資料修復（冪等）
-- ============================================================================

-- 7a. 空殼採購單：f288964c 的庫存異動改掛到同廠商單號的正確採購單，再刪除空殼。
--     FK 為 NO ACTION，故先改指向再刪，庫存數量完全不動。
DO $$
DECLARE
  v_orphan uuid := 'f288964c-1ff7-475b-834f-79177f3985c4';
  v_target uuid := '77347912-c470-4a52-b28c-8c0ed0d738cf';
  v_movement uuid := 'ac88bf2d-781a-4132-aa64-be304acc31cf';
  v_items integer;
  v_target_exists boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.purchase_orders WHERE id = v_orphan) THEN
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.purchase_orders WHERE id = v_target) INTO v_target_exists;
  IF NOT v_target_exists THEN
    RAISE EXCEPTION '修復中止：目標採購單 % 不存在', v_target;
  END IF;

  SELECT count(*) INTO v_items FROM public.purchase_order_items WHERE purchase_order_id = v_orphan;
  IF v_items > 0 THEN
    RAISE EXCEPTION '修復中止：採購單 % 已有 % 個品項，非空殼', v_orphan, v_items;
  END IF;

  UPDATE public.inventory_movements
     SET purchase_order_id = v_target,
         reference_code = COALESCE(
           (SELECT NULLIF(supplier_order_number, '') FROM public.purchase_orders WHERE id = v_target),
           v_target::text
         )
   WHERE id = v_movement AND purchase_order_id = v_orphan;

  DELETE FROM public.purchase_orders WHERE id = v_orphan;
  RAISE NOTICE '已修復：空殼採購單 % 已刪除，movement % 改掛 %', v_orphan, v_movement, v_target;
END;
$$;

-- 7b. sort_order 回填：所有品項仍為預設 0 的採購單，依建立時間重排（冪等）
DO $$
DECLARE
  v_po record;
  v_ord integer := 0;
  v_item record;
BEGIN
  FOR v_po IN
    SELECT po.id
      FROM public.purchase_orders po
      JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
     WHERE poi.sort_order = 0
     GROUP BY po.id
  LOOP
    v_ord := 0;
    FOR v_item IN
      SELECT id FROM public.purchase_order_items
       WHERE purchase_order_id = v_po.id
       ORDER BY created_at, id
    LOOP
      v_ord := v_ord + 1;
      UPDATE public.purchase_order_items SET sort_order = v_ord WHERE id = v_item.id;
    END LOOP;
  END LOOP;
END;
$$;
