-- 20261101000002  手動建立採購退貨單 RPC
--
-- 目標：讓 AdminOrderForm 能直接建立採購退貨單（purpose='purchase_return'），
--       不再只能透過 Excel 匯入。邏輯與 import_purchase_returns_batch 一致：
--       跨 PO 分配 returned_quantity、FIFO 耗用守門、庫存回沖、成本鎖定。
--
-- 參數：
--   p_supplier_id  供應商
--   p_items        jsonb [{product_id, variant_id?, quantity(正數), unit_cost?}]
--   p_order_date   退貨日期（預設今天）
--   p_notes        備註
--   p_created_by   建立者
--
-- 行為：
--   * 建立 purchase_orders (purpose='purchase_return', status='received', total<0)
--   * 建立 purchase_order_items (quantity 轉負, received_quantity 轉負)
--   * 跨 PO 分配 returned_quantity（FOR UPDATE + LEAST）
--   * 守門：可退數量 = received - returned - consumed（FIFO 耗用扣減）
--   * 成本鎖定：優先用分配到的 PO item 的 unit_cost
--   * 回沖庫存：purchase_return movement（自有倉）
--   * 無 accounting（前端選擇不建立）
--   * source_purchase_order_id = 主要分配來源 PO（追蹤用，可為 null）

CREATE OR REPLACE FUNCTION public.create_purchase_return_with_items(
  p_supplier_id uuid,
  p_items jsonb,
  p_order_date date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_uid uuid := COALESCE(p_created_by, auth.uid());
  v_order_date date := COALESCE(p_order_date, CURRENT_DATE);
  v_own_warehouse uuid;
  v_po_id uuid;
  v_ref text;
  v_sum numeric := 0;
  v_item record;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric;
  v_label text;
  v_line_idx integer := 0;
  v_item_names jsonb := '[]'::jsonb;
  v_demand jsonb := '{}'::jsonb;
  v_dkey text;
  v_dentry jsonb;
  v_src_item_id uuid;
  v_take integer;
  v_remaining integer;
  v_primary_source_po uuid := NULL;
  v_first_source_set boolean := false;
  v_available integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可建立採購退貨');
  END IF;
  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '請選擇供應商');
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '請至少新增一項品項');
  END IF;

  SELECT id INTO v_own_warehouse FROM public.warehouses WHERE code = 'own';
  IF v_own_warehouse IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  -- Phase 1：解析所有品項（尚未寫入）→ 任一失敗整張中止
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line_idx := v_line_idx + 1;
    v_product_id := (v_item.value->>'product_id')::uuid;
    v_variant_id := NULLIF(v_item.value->>'variant_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item.value->>'quantity', '')::integer, 0);
    v_cost := NULLIF(v_item.value->>'unit_cost', '')::numeric;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION '第 % 個品項缺少 product_id', v_line_idx;
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION '第 % 個品項退貨數量必須大於 0', v_line_idx;
    END IF;
    IF v_cost IS NULL OR v_cost = 0 THEN
      -- 成本 fallback：供應商對照成本 → 0（無 source PO 單價回退，因為不綁單）
      SELECT spm.vendor_unit_cost INTO v_cost
        FROM public.supplier_product_mappings spm
       WHERE spm.supplier_id = p_supplier_id
         AND spm.internal_product_id = v_product_id
         AND spm.internal_variant_id IS NOT DISTINCT FROM v_variant_id
       ORDER BY spm.is_primary DESC, spm.updated_at DESC NULLS LAST
       LIMIT 1;
      v_cost := COALESCE(v_cost, 0);
    END IF;
    IF v_cost < 0 THEN
      RAISE EXCEPTION '第 % 個品項單價不可為負', v_line_idx;
    END IF;

    -- 可退量守門（聚合該廠商所有 received PO）
    -- available = received - returned - consumed
    SELECT COALESCE(SUM(poi.received_quantity - poi.returned_quantity - poi.consumed_quantity), 0)
      INTO v_available
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
     WHERE po.supplier_id = p_supplier_id
       AND po.purpose IN ('general', 'repair_parts')
       AND po.status IN ('received', 'partial_received')
       AND poi.product_id = v_product_id
       AND poi.variant_id IS NOT DISTINCT FROM v_variant_id;
    IF v_available < v_qty THEN
      RAISE EXCEPTION '品項（%）退貨數量超過可退數量（可退 % 件）',
        COALESCE((SELECT name FROM products WHERE id = v_product_id), v_product_id::text),
        v_available;
    END IF;

    v_label := COALESCE(
      (SELECT pv.name FROM public.product_variants pv WHERE pv.id = v_variant_id),
      (SELECT p.name FROM public.products p WHERE p.id = v_product_id),
      '(未命名)'
    );

    -- 累計同商品需求
    v_dkey := v_product_id::text || '|' || COALESCE(v_variant_id::text, '');
    v_demand := jsonb_set(
      v_demand,
      ARRAY[v_dkey],
      jsonb_build_object(
        'product_id', v_product_id,
        'variant_id', v_variant_id,
        'name', v_label,
        'qty', COALESCE((v_demand->v_dkey->>'qty')::integer, 0) + v_qty
      )
    );

    v_sum := v_sum + (v_qty * v_cost);
    v_item_names := v_item_names || jsonb_build_object(
      'product_id', v_product_id,
      'variant_id', v_variant_id,
      'name', v_label,
      'quantity', v_qty,
      'unit_cost', v_cost
    );
  END LOOP;

  -- Phase 2：建立負數採購單
  -- 退貨單號由 trigger 產號，這裡用 NULL 讓 trigger 處理
  INSERT INTO public.purchase_orders (
    supplier_id, status, purpose, order_date, received_date,
    expected_date, supplier_order_number, total_amount, notes, created_by,
    source_purchase_order_id
  )
  VALUES (
    p_supplier_id,
    'received'::public.purchase_order_status,
    'purchase_return',
    v_order_date,
    v_order_date,
    NULL,
    NULL,
    -v_sum,
    p_notes,
    v_uid,
    NULL
  )
  RETURNING id INTO v_po_id;

  -- Phase 3：建立負數品項 + 跨 PO 分配 returned_quantity
  v_line_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_item_names)
  LOOP
    v_line_idx := v_line_idx + 1;
    v_product_id := (v_item.value->>'product_id')::uuid;
    v_variant_id := NULLIF(v_item.value->>'variant_id', '')::uuid;
    v_qty := (v_item.value->>'quantity')::integer;
    v_cost := (v_item.value->>'unit_cost')::numeric;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, variant_id,
      quantity, received_quantity, unit_cost, sort_order
    )
    VALUES (
      v_po_id,
      v_product_id,
      v_variant_id,
      -v_qty,
      -v_qty,
      v_cost,
      v_line_idx
    );

    -- 跨 PO 分配：更新來源 PO 品項的 returned_quantity
    -- ⚠️ 併行安全：FOR UPDATE 鎖定
    v_remaining := v_qty;
    WHILE v_remaining > 0 LOOP
      SELECT poi.id INTO v_src_item_id
        FROM public.purchase_order_items poi
        JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
       WHERE po.supplier_id = p_supplier_id
         AND po.purpose IN ('general', 'repair_parts')
         AND po.status IN ('received', 'partial_received')
         AND poi.product_id = v_product_id
         AND poi.variant_id IS NOT DISTINCT FROM v_variant_id
         AND (poi.received_quantity - poi.returned_quantity - poi.consumed_quantity) > 0
       ORDER BY (poi.received_quantity - poi.returned_quantity - poi.consumed_quantity) DESC,
                COALESCE(po.received_date, po.order_date, po.created_at::DATE) ASC,
                poi.sort_order, poi.id
       LIMIT 1
         FOR UPDATE;
      EXIT WHEN NOT FOUND;

      SELECT LEAST(poi.received_quantity - poi.returned_quantity - poi.consumed_quantity, v_remaining)
        INTO v_take
        FROM public.purchase_order_items poi
       WHERE poi.id = v_src_item_id;

      UPDATE public.purchase_order_items
         SET returned_quantity = returned_quantity + v_take
       WHERE id = v_src_item_id;

      -- 記錄主要來源 PO（第一個分配到的）
      IF NOT v_first_source_set THEN
        SELECT poi.purchase_order_id INTO v_primary_source_po
          FROM public.purchase_order_items poi WHERE poi.id = v_src_item_id;
        v_first_source_set := true;
      END IF;

      -- Cost 鎖定：如果 form 傳入的 cost 為 0，用分配到的 PO item 的 cost
      IF v_cost = 0 THEN
        SELECT poi.unit_cost INTO v_cost
          FROM public.purchase_order_items poi WHERE poi.id = v_src_item_id;
        v_cost := COALESCE(v_cost, 0);
        -- 更新已插入的品項成本
        UPDATE public.purchase_order_items
           SET unit_cost = v_cost
         WHERE purchase_order_id = v_po_id
           AND product_id = v_product_id
           AND variant_id IS NOT DISTINCT FROM v_variant_id
           AND sort_order = v_line_idx;
      END IF;

      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION '品項（%）退貨數量超過可退數量（剩 % 件未分配）',
        v_item.value->>'name', v_remaining;
    END IF;
  END LOOP;

  -- 更新 source_purchase_order_id 為主要來源 PO（追蹤用）
  IF v_primary_source_po IS NOT NULL THEN
    UPDATE public.purchase_orders
       SET source_purchase_order_id = v_primary_source_po
     WHERE id = v_po_id;
  END IF;

  -- Phase 4：庫存回補
  v_line_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_item_names)
  LOOP
    v_line_idx := v_line_idx + 1;
    v_product_id := (v_item.value->>'product_id')::uuid;
    v_variant_id := NULLIF(v_item.value->>'variant_id', '')::uuid;
    v_qty := (v_item.value->>'quantity')::integer;
    v_cost := (v_item.value->>'unit_cost')::numeric;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change,
      source_type, purchase_order_id, reference_code, note, created_by
    )
    VALUES (
      v_product_id,
      v_variant_id,
      v_own_warehouse,
      -v_qty,
      'purchase_return',
      v_po_id,
      v_po_id::text,
      '退回供應商',
      v_uid
    );
  END LOOP;

  -- 重新計算 total_amount（cost 可能因 fallback 而變）
  SELECT COALESCE(SUM(quantity * unit_cost), 0) * -1 INTO v_sum
    FROM public.purchase_order_items
   WHERE purchase_order_id = v_po_id;
  UPDATE public.purchase_orders SET total_amount = -ABS(v_sum) WHERE id = v_po_id;

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_order_id', v_po_id,
    'total_amount', (SELECT total_amount FROM public.purchase_orders WHERE id = v_po_id),
    'created_items', v_item_names
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_purchase_return_with_items(uuid, jsonb, date, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_return_with_items(uuid, jsonb, date, text, uuid) TO authenticated;