-- ============================================================
-- 20260924000005_order_return_line_processing.sql
-- 退貨/換貨/送修（order line 層級整合）— Phase 1 RPC 層
--
-- 疊在 20260924000004（order_items 四欄 + CHECK + drop 舊表/RPC）之上：
--
-- 1) 出貨路徑一律排除 line_type='return'：
--    - convert_order_to_consignment_draft：未出貨量與鏡像品項排除 return 列
--    - create_consignment_shipment_layer：防呆 RAISE（防護其他呼叫端誤送）
--    - create_order_with_sales_note：帶入 line 四欄，且「下單即出貨」拒絕 return 列
--    - direct_ship_order：兩個品項迴圈排除 return 列
--    - ship_from_pool：訂單收斂 shipped 的 bool_and 排除 return 列
--    - correct_sales_note：Phase 2（追加）拒絕 return 列 + 收斂 bool_and 排除
--    - reverse_consignment_shipment：來源 order_items 匹配排除 return 列
-- 2) update_order_with_items：
--    - 新品項接受 line_type/line_note/return_status/is_repair
--    - 既有品項可更新 line 四欄（未傳時保留現值，向後相容舊呼叫端）
--    - 前置校驗 line_type ↔ return_status / is_repair 組合（避免 CHECK 拋晦澀錯誤）
-- 3) 新 RPC process_order_return_lines（SECURITY DEFINER，僅 admin，單一交易）：
--    - stock    → customer_return 退庫存（+qty 自有倉）＋退款 expense 分錄扣帳戶
--                 （退額 > 0 必填退款帳戶；分類預設「客戶退貨退款」；references 子表逐單攤分）
--    - exchange → 僅標記 return_status='exchange'（不回勾庫存、不退款）
--    - repaired → 僅標記 return_status='repaired' 送修已歸還（不回勾庫存、不退款）
--    僅處理 line_type='return' 且 return_status='pending' 的列；重複/非 pending 全批次擋下。
--    純維修列（unit_price=0, is_repair=true, pending）可在未來以 stock/repaired 收尾。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. convert_order_to_consignment_draft：排除 return 列
--    （既有 body 源自 20260923000002，僅加入 line_type 過濾）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_order_to_consignment_draft(
  p_order_id UUID,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_co_id UUID;
  v_item RECORD;
  v_unshipped INTEGER;
  v_coi_id UUID;
BEGIN
  SELECT id, status, store_id, source_type, consignment_mode, delivery_type, shipping_address
  INTO v_order
  FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '訂單不存在');
  END IF;

  -- 已是寄賣鏡像單，不可再轉
  IF v_order.source_type = 'consignment' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此為寄賣鏡像訂單，請至寄賣管理處理');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅待確認（pending）訂單可轉寄賣草稿');
  END IF;

  -- 檢查是否有未出貨品項（退貨列不視為可出貨量）
  SELECT COALESCE(SUM(oi.quantity - oi.shipped_quantity), 0)::INTEGER
  INTO v_unshipped
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status NOT IN ('cancelled', 'discontinued')
    AND oi.line_type <> 'return';
  IF v_unshipped IS NULL OR v_unshipped <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此訂單沒有未出貨品項');
  END IF;

  -- 尋找既有未取消的寄賣草稿，避免重複建立
  IF v_order.consignment_mode THEN
    SELECT id INTO v_co_id
    FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND source_order_id = p_order_id
      AND status IN ('draft', 'active')
    LIMIT 1;
    IF v_co_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'consignment_order_id', v_co_id, 'order_id', p_order_id, 'reused', true);
    END IF;
  END IF;

  -- 標記寄賣模式（維持 pending，不出貨）
  IF NOT v_order.consignment_mode THEN
    UPDATE public.orders
    SET consignment_mode = true, updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  -- 建立寄賣草稿（未出貨）；配送資訊自來源訂單快照
  INSERT INTO public.consignment_orders (
    direction, store_id, status, source_order_id, created_by, note,
    delivery_type, shipping_address
  )
  SELECT 'send_to_store', v_order.store_id, 'draft', p_order_id, p_created_by,
         o.notes, o.delivery_type, o.shipping_address
  FROM public.orders o WHERE o.id = p_order_id
  RETURNING id INTO v_co_id;

  -- 逐項鏡像 order_items → consignment_order_items（不扣庫存；退貨列不鏡像）
  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.shipped_quantity,
           oi.unit_price, oi.unit_cost
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('cancelled', 'discontinued')
      AND oi.line_type <> 'return'
      AND (oi.quantity - oi.shipped_quantity) > 0
  LOOP
    -- 若已連結既有寄賣品項則沿用
    SELECT id INTO v_coi_id
    FROM public.consignment_order_items
    WHERE consignment_order_id = v_co_id
      AND order_item_id = v_item.id
    LIMIT 1;

    IF v_coi_id IS NULL THEN
      INSERT INTO public.consignment_order_items (
        consignment_order_id, order_item_id, product_id, variant_id,
        quantity, unit_price, unit_cost
      )
      VALUES (
        v_co_id, v_item.id, v_item.product_id, v_item.variant_id,
        v_item.quantity - v_item.shipped_quantity,
        v_item.unit_price, COALESCE(v_item.unit_cost, 0)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'consignment_order_id', v_co_id,
    'order_id', p_order_id,
    'reused', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_order_to_consignment_draft(UUID, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_order_to_consignment_draft(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 2. create_consignment_shipment_layer：防呆（呼叫端已過濾，這裡再擋一層）
--    （既有 body 源自 20260924000003，僅加入 line_type 讀取 + RAISE）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_consignment_shipment_layer(
  p_store_id uuid,
  p_created_by uuid,
  p_order_items jsonb,
  p_shipped_at timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_delivery_method_id uuid DEFAULT NULL,
  p_shipping_fee numeric DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL,
  p_delivery_type text DEFAULT NULL,
  p_shipping_cost numeric DEFAULT NULL,
  p_tracking_company text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_rec JSONB;
  v_order_item_id UUID;
  v_qty INTEGER;
  v_oi RECORD;
  v_co_id UUID;
  v_coi_id UUID;
  v_shipped_at TIMESTAMPTZ;
  v_warehouse_id UUID;
  v_co_count INTEGER := 0;
  v_delivery_type TEXT;
  v_delivery JSONB;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_delivery := public._resolve_delivery(p_delivery_type, p_delivery_method_id);
  v_delivery_type := v_delivery->>'delivery_type';

  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_order_items)
  LOOP
    v_order_item_id := (v_rec->>'order_item_id')::UUID;
    v_qty := (v_rec->>'quantity')::INTEGER;
    CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;

    DELETE FROM public.shipping_pool WHERE order_item_id = v_order_item_id;

    SELECT oi.product_id, oi.variant_id, oi.unit_price, oi.store_id, oi.order_id, oi.quantity,
           oi.line_type,
           o.code AS order_code
    INTO v_oi
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = v_order_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_item 不存在：%', v_order_item_id;
    END IF;

    IF v_oi.line_type = 'return' THEN
      RAISE EXCEPTION '退貨列不可寄賣出貨：%', v_order_item_id;
    END IF;

    IF v_qty > v_oi.quantity THEN
      RAISE EXCEPTION '寄賣出貨量 % 超過 order_item 宣告總量 %（order_item %）', v_qty, v_oi.quantity, v_order_item_id;
    END IF;

    SELECT id INTO v_co_id FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND store_id = v_oi.store_id
      AND source_order_id = v_oi.order_id
      AND status IN ('draft', 'active')
    LIMIT 1;

    IF v_co_id IS NULL THEN
      INSERT INTO public.consignment_orders (direction, store_id, status, created_by, source_order_id, shipped_at, delivery_type)
      VALUES ('send_to_store', v_oi.store_id, 'active', p_created_by, v_oi.order_id, v_shipped_at, v_delivery_type)
      RETURNING id INTO v_co_id;
    ELSE
      UPDATE public.consignment_orders
      SET status = 'active', shipped_at = v_shipped_at, delivery_type = v_delivery_type, updated_at = NOW()
      WHERE id = v_co_id AND status = 'draft';
    END IF;
    v_co_count := v_co_count + 1;

    SELECT id INTO v_coi_id FROM public.consignment_order_items
    WHERE consignment_order_id = v_co_id
      AND order_item_id = v_order_item_id
    LIMIT 1;

    IF v_coi_id IS NULL THEN
      INSERT INTO public.consignment_order_items (
        consignment_order_id, order_item_id, product_id, variant_id,
        quantity, unit_price, unit_cost
      )
      VALUES (
        v_co_id, v_order_item_id, v_oi.product_id, v_oi.variant_id,
        v_qty, v_oi.unit_price, 0
      )
      RETURNING id INTO v_coi_id;
    END IF;

    PERFORM public._ship_stock_movements(
      v_oi.product_id, v_oi.variant_id, v_warehouse_id, v_qty, 'consignment_out_shipment',
      NULL, v_co_id, v_coi_id, v_order_item_id, v_oi.order_code, p_created_by, 'store_consignment'
    );
  END LOOP;

  -- 配送：僅對該張寄賣單做一次；類型驅動
  IF v_co_count > 0 THEN
    IF v_delivery_type = 'logistics' AND p_delivery_method_id IS NOT NULL THEN
      PERFORM public.upsert_shipment(
        'consignment_order', v_co_id, (v_delivery->>'method_id')::uuid,
        COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric),
        COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric),
        'one_time', p_tracking_company, p_tracking_number, p_tracking_url,
        v_shipped_at, p_notes, p_created_by, NULL
      );
      UPDATE public.consignment_orders
      SET delivery_method_id = (v_delivery->>'method_id')::uuid,
          delivery_method_title = v_delivery->>'method_title',
          delivery_method_code = v_delivery->>'method_code',
          shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
          shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
          shipping_address = COALESCE(shipping_address, p_shipping_address),
          delivery_type = v_delivery_type,
          updated_at = NOW()
      WHERE id = v_co_id;
    ELSIF v_delivery_type = 'delivery' THEN
      IF (v_delivery->>'method_id') IS NOT NULL THEN
        UPDATE public.consignment_orders
        SET delivery_method_id = (v_delivery->>'method_id')::uuid,
            delivery_method_title = v_delivery->>'method_title',
            delivery_method_code = v_delivery->>'method_code',
            shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
            shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
            shipping_address = COALESCE(shipping_address, p_shipping_address),
            delivery_type = v_delivery_type,
            updated_at = NOW()
        WHERE id = v_co_id;
      ELSE
        UPDATE public.consignment_orders SET delivery_type = v_delivery_type, updated_at = NOW() WHERE id = v_co_id;
      END IF;
    ELSE
      -- pickup：不寫方法/包裹/地址，僅記類型
      UPDATE public.consignment_orders SET delivery_type = v_delivery_type, updated_at = NOW() WHERE id = v_co_id;
    END IF;
  END IF;
END;
$function$;

-- ------------------------------------------------------------
-- 3. create_order_with_sales_note：帶入 line 四欄且拒絕 return 列
--    （「下單即出貨」永遠是銷售列）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_with_sales_note(
  p_store_id uuid,
  p_created_by uuid,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_shipped_at timestamptz DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_consignment_mode boolean DEFAULT false,
  p_delivery_method_id uuid DEFAULT NULL,
  p_shipping_fee numeric DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL,
  p_delivery_type text DEFAULT NULL,
  p_shipping_cost numeric DEFAULT NULL,
  p_tracking_company text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_order_id UUID;
  v_order_code TEXT;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_item JSONB;
  v_order_item_id UUID;
  v_product_id UUID;
  v_variant_id UUID;
  v_quantity INTEGER;
  v_source TEXT;
  v_result JSONB;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_shipped_at TIMESTAMPTZ;
  v_consignment_items JSONB := '[]'::JSONB;
  v_temp_key TEXT;
  v_parent_temp TEXT;
  v_delivery_type TEXT;
  v_delivery JSONB;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_delivery := public._resolve_delivery(p_delivery_type, p_delivery_method_id);
  v_delivery_type := v_delivery->>'delivery_type';

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode, access_token, delivery_type)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped', p_consignment_mode, gen_random_uuid(), v_delivery_type)
  RETURNING id, code INTO v_order_id, v_order_code;

  IF NOT p_consignment_mode THEN
    v_access_token := gen_random_uuid();
    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id, delivery_type)
    VALUES (p_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id, v_delivery_type)
    RETURNING id, code INTO v_sales_note_id, v_sales_note_code;
  END IF;

  CREATE TEMP TABLE _new_item_map (temp_key text PRIMARY KEY, item_id uuid)
    ON COMMIT DROP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;

    -- 下單即出貨不支援退貨列（退貨列只存在於既有訂單，走結清流程）
    IF NULLIF(v_item->>'line_type', '') = 'return' THEN
      RAISE EXCEPTION '下單即出貨不支援退貨列（line_type=return）';
    END IF;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, unit_cost, selected_model_name,
      shipping_payment, shipped_quantity, status,
      line_type, line_note, is_repair
    )
    VALUES (
      v_order_id,
      v_product_id,
      v_variant_id,
      p_store_id,
      v_quantity,
      (v_item->>'unit_price')::NUMERIC,
      COALESCE(NULLIF(v_item->>'unit_cost', '')::NUMERIC, 0),
      (v_item->>'selected_model_name'),
      NULLIF(v_item->>'shipping_payment', ''),
      v_quantity,
      'shipped',
      COALESCE(NULLIF(v_item->>'line_type', ''), 'sale'),
      NULLIF(v_item->>'line_note', ''),
      COALESCE((v_item->>'is_repair')::BOOLEAN, false)
    )
    RETURNING id INTO v_order_item_id;

    v_temp_key := v_item->>'temp_key';
    IF v_temp_key IS NOT NULL THEN
      INSERT INTO _new_item_map (temp_key, item_id) VALUES (v_temp_key, v_order_item_id);
    END IF;

    IF p_consignment_mode THEN
      v_consignment_items := v_consignment_items || jsonb_build_object(
        'order_item_id', v_order_item_id,
        'quantity', v_quantity
      );
      CONTINUE;
    END IF;

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sales_note_id, v_order_item_id, v_quantity, COALESCE(v_item->>'inventory_source_type', 'self'));

    v_source := COALESCE(v_item->>'inventory_source_type', 'self');
    IF p_consignment_mode THEN v_source := 'store_consignment'; END IF;

    IF v_source = 'self' THEN
      PERFORM public._ship_stock_movements(
        v_product_id, v_variant_id,
        COALESCE((v_item->>'warehouse_id')::UUID, v_default_warehouse_id),
        v_quantity, 'sales_shipment',
        v_sales_note_id, NULL, NULL, v_order_item_id,
        v_sales_note_code, p_created_by, 'self'
      );
    ELSE
      PERFORM public.allocate_inventory(
        v_product_id, v_variant_id, v_quantity, v_source, NULL,
        v_sales_note_id, v_order_item_id, v_sales_note_code,
        (v_item->>'unit_price')::NUMERIC, p_created_by
      );
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_parent_temp := v_item->>'parent_temp_key';
    IF v_parent_temp IS NOT NULL THEN
      UPDATE public.order_items oi
      SET parent_order_item_id = m.item_id
      FROM _new_item_map m
      WHERE m.temp_key = v_parent_temp
        AND oi.id = (SELECT item_id FROM _new_item_map WHERE temp_key = v_item->>'temp_key')
        AND oi.order_id = v_order_id;
    END IF;
  END LOOP;

  DROP TABLE _new_item_map;

  IF p_consignment_mode AND jsonb_array_length(v_consignment_items) > 0 THEN
    PERFORM public.create_consignment_shipment_layer(
      p_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes,
      v_default_warehouse_id, p_delivery_method_id, p_shipping_fee, p_shipping_address,
      v_delivery_type, p_shipping_cost, p_tracking_company, p_tracking_number, p_tracking_url
    );
  ELSIF NOT p_consignment_mode THEN
    IF v_delivery_type = 'logistics' AND p_delivery_method_id IS NOT NULL THEN
      PERFORM public.upsert_shipment(
        'sales_note', v_sales_note_id, (v_delivery->>'method_id')::uuid,
        COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric),
        COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric),
        'one_time', p_tracking_company, p_tracking_number, p_tracking_url,
        v_shipped_at, p_notes, p_created_by, NULL
      );
      UPDATE public.sales_notes
      SET delivery_method_id = (v_delivery->>'method_id')::uuid,
          delivery_method_title = v_delivery->>'method_title',
          delivery_method_code = v_delivery->>'method_code',
          shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
          shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
          shipping_address = p_shipping_address,
          delivery_type = v_delivery_type,
          updated_at = NOW()
      WHERE id = v_sales_note_id;
    ELSIF v_delivery_type = 'delivery' THEN
      IF (v_delivery->>'method_id') IS NOT NULL THEN
        UPDATE public.sales_notes
        SET delivery_method_id = (v_delivery->>'method_id')::uuid,
            delivery_method_title = v_delivery->>'method_title',
            delivery_method_code = v_delivery->>'method_code',
            shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
            shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
            shipping_address = p_shipping_address,
            delivery_type = v_delivery_type,
            updated_at = NOW()
        WHERE id = v_sales_note_id;
      ELSE
        UPDATE public.sales_notes SET delivery_type = v_delivery_type, updated_at = NOW() WHERE id = v_sales_note_id;
      END IF;
    ELSE
      -- pickup
      UPDATE public.sales_notes SET delivery_type = v_delivery_type, updated_at = NOW() WHERE id = v_sales_note_id;
    END IF;
  END IF;

  -- 單一來源回寫：訂單層只存類型（方法快照一併保留供顯示）
  IF v_delivery_type IS NOT NULL OR p_delivery_method_id IS NOT NULL THEN
    UPDATE public.orders
    SET delivery_method_id = COALESCE((v_delivery->>'method_id')::uuid, delivery_method_id),
        delivery_method_title = COALESCE(v_delivery->>'method_title', delivery_method_title),
        delivery_method_code = COALESCE(v_delivery->>'method_code', delivery_method_code),
        shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, shipping_fee, 0),
        shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, shipping_cost, 0),
        shipping_address = COALESCE(p_shipping_address, shipping_address),
        delivery_type = COALESCE(v_delivery_type, delivery_type, 'delivery'),
        updated_at = NOW()
    WHERE id = v_order_id;
  END IF;

  v_result := jsonb_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'sales_note_id', v_sales_note_id,
    'sales_note_code', v_sales_note_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$function$;

-- ------------------------------------------------------------
-- 4. direct_ship_order：兩個品項迴圈排除 return 列
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.direct_ship_order(
  p_order_id uuid,
  p_created_by uuid,
  p_notes text DEFAULT NULL,
  p_shipped_at timestamptz DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_warehouse_map jsonb DEFAULT '{}'::jsonb,
  p_source_map jsonb DEFAULT '{}'::jsonb,
  p_delivery_method_id uuid DEFAULT NULL,
  p_shipping_fee numeric DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL,
  p_delivery_type text DEFAULT NULL,
  p_shipping_cost numeric DEFAULT NULL,
  p_tracking_company text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_remaining_qty INTEGER;
  v_new_shipped_qty INTEGER;
  v_sn_notes TEXT;
  v_result JSONB;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_shipped_at TIMESTAMPTZ;
  v_consignment_items JSONB := '[]'::JSONB;
  v_delivery_type TEXT;
  v_delivery JSONB;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_delivery := public._resolve_delivery(p_delivery_type, p_delivery_method_id);
  v_delivery_type := v_delivery->>'delivery_type';

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;

  IF v_order.status NOT IN ('processing', 'pending') THEN
    RAISE EXCEPTION '僅能對處理中或待確認的訂單執行轉銷貨單';
  END IF;

  IF v_order.consignment_mode THEN
    FOR v_item IN
      SELECT oi.id, oi.quantity, oi.shipped_quantity
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.status NOT IN ('cancelled', 'discontinued')
        AND oi.line_type <> 'return'
    LOOP
      v_remaining_qty := v_item.quantity - v_item.shipped_quantity;
      CONTINUE WHEN v_remaining_qty <= 0;

      v_consignment_items := v_consignment_items || jsonb_build_object(
        'order_item_id', v_item.id,
        'quantity', v_remaining_qty
      );

      UPDATE public.order_items
      SET shipped_quantity = v_item.shipped_quantity + v_remaining_qty,
          status = 'shipped',
          updated_at = NOW()
      WHERE id = v_item.id;

      DELETE FROM public.shipping_pool WHERE order_item_id = v_item.id;
    END LOOP;

    IF jsonb_array_length(v_consignment_items) > 0 THEN
      PERFORM public.create_consignment_shipment_layer(
        v_order.store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes,
        v_default_warehouse_id, p_delivery_method_id, p_shipping_fee, p_shipping_address,
        v_delivery_type, p_shipping_cost, p_tracking_company, p_tracking_number, p_tracking_url
      );
    END IF;

    UPDATE public.orders
    SET status = 'shipped',
        delivery_method_id = COALESCE((v_delivery->>'method_id')::uuid, delivery_method_id),
        delivery_method_title = COALESCE(v_delivery->>'method_title', delivery_method_title),
        delivery_method_code = COALESCE(v_delivery->>'method_code', delivery_method_code),
        shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, shipping_fee),
        shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, shipping_cost),
        shipping_address = COALESCE(p_shipping_address, shipping_address),
        delivery_type = COALESCE(v_delivery_type, delivery_type, 'delivery'),
        updated_at = NOW()
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'sales_note_id', NULL,
      'sales_note_code', NULL,
      'access_token', NULL
    );
  END IF;

  v_access_token := gen_random_uuid();

  v_sn_notes := CASE
    WHEN v_order.notes IS NOT NULL AND p_notes IS NOT NULL THEN v_order.notes || ' | ' || p_notes
    WHEN v_order.notes IS NOT NULL THEN v_order.notes
    ELSE p_notes
  END;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id, delivery_type)
  VALUES (v_order.store_id, p_created_by, 'shipped', v_shipped_at, v_sn_notes, v_access_token, v_default_warehouse_id, v_delivery_type)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.shipped_quantity,
           oi.unit_price, oi.selected_model_name, oi.store_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('cancelled', 'discontinued')
      AND oi.line_type <> 'return'
  LOOP
    v_remaining_qty := v_item.quantity - v_item.shipped_quantity;
    CONTINUE WHEN v_remaining_qty <= 0;

    v_item_warehouse_id := COALESCE(
      (p_warehouse_map->>v_item.id::TEXT)::UUID,
      v_default_warehouse_id
    );
    v_source := COALESCE(p_source_map->>v_item.id::TEXT, 'self');

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sales_note_id, v_item.id, v_remaining_qty, v_source);

    IF v_source = 'self' THEN
      PERFORM public._ship_stock_movements(
        v_item.product_id, v_item.variant_id, v_item_warehouse_id, v_remaining_qty,
        'sales_shipment', v_sales_note_id, NULL, NULL, v_item.id,
        v_sales_note_code, p_created_by, 'self'
      );
    ELSE
      PERFORM public.allocate_inventory(
        v_item.product_id, v_item.variant_id, v_remaining_qty, v_source, NULL,
        v_sales_note_id, v_item.id, v_sales_note_code, v_item.unit_price, p_created_by
      );
    END IF;

    v_new_shipped_qty := v_item.shipped_quantity + v_remaining_qty;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped_qty,
        status = 'shipped',
        updated_at = NOW()
    WHERE id = v_item.id;

    DELETE FROM public.shipping_pool WHERE order_item_id = v_item.id;
  END LOOP;

  UPDATE public.orders
  SET status = 'shipped',
      delivery_method_id = COALESCE((v_delivery->>'method_id')::uuid, delivery_method_id),
      delivery_method_title = COALESCE(v_delivery->>'method_title', delivery_method_title),
      delivery_method_code = COALESCE(v_delivery->>'method_code', delivery_method_code),
      shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, shipping_fee),
      shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, shipping_cost),
      shipping_address = COALESCE(p_shipping_address, shipping_address),
      delivery_type = COALESCE(v_delivery_type, delivery_type, 'delivery'),
      updated_at = NOW()
  WHERE id = p_order_id;

  IF v_delivery_type = 'logistics' AND p_delivery_method_id IS NOT NULL THEN
    PERFORM public.upsert_shipment(
      'sales_note', v_sales_note_id, (v_delivery->>'method_id')::uuid,
      COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric),
      COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric),
      'one_time', p_tracking_company, p_tracking_number, p_tracking_url,
      v_shipped_at, p_notes, p_created_by, NULL
    );
    UPDATE public.sales_notes
    SET delivery_method_id = (v_delivery->>'method_id')::uuid,
        delivery_method_title = v_delivery->>'method_title',
        delivery_method_code = v_delivery->>'method_code',
        shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
        shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
        shipping_address = COALESCE(shipping_address, p_shipping_address),
        delivery_type = v_delivery_type,
        updated_at = NOW()
    WHERE id = v_sales_note_id;
  ELSIF NOT v_order.consignment_mode AND v_delivery_type = 'delivery' THEN
    IF (v_delivery->>'method_id') IS NOT NULL THEN
      UPDATE public.sales_notes
      SET delivery_method_id = (v_delivery->>'method_id')::uuid,
          delivery_method_title = v_delivery->>'method_title',
          delivery_method_code = v_delivery->>'method_code',
          shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
          shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
          shipping_address = COALESCE(shipping_address, p_shipping_address),
          delivery_type = v_delivery_type,
          updated_at = NOW()
      WHERE id = v_sales_note_id;
    ELSE
      UPDATE public.sales_notes SET delivery_type = v_delivery_type, updated_at = NOW() WHERE id = v_sales_note_id;
    END IF;
  ELSIF v_delivery_type = 'pickup' THEN
    UPDATE public.sales_notes SET delivery_type = v_delivery_type, updated_at = NOW() WHERE id = v_sales_note_id;
  END IF;

  v_result := jsonb_build_object(
    'sales_note_id', v_sales_note_id,
    'sales_note_code', v_sales_note_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$function$;

-- ------------------------------------------------------------
-- 5. ship_from_pool：訂單「全數出貨」收斂排除 return 列
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids uuid[],
  p_created_by uuid,
  p_notes text DEFAULT NULL,
  p_shipped_at timestamptz DEFAULT NULL,
  p_warehouse_id uuid DEFAULT NULL,
  p_warehouse_map jsonb DEFAULT '{}'::jsonb,
  p_source_map jsonb DEFAULT '{}'::jsonb,
  p_consignment_override_map jsonb DEFAULT '{}'::jsonb,
  p_delivery_method_id uuid DEFAULT NULL,
  p_shipping_fee numeric DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL,
  p_delivery_overrides jsonb DEFAULT NULL,
  p_delivery_type text DEFAULT NULL,
  p_shipping_cost numeric DEFAULT NULL,
  p_tracking_company text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_store_id UUID;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_item RECORD;
  v_new_shipped_qty INTEGER;
  v_new_status public.order_item_status;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_result JSONB;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_is_consignment BOOLEAN;
  v_shipped_at TIMESTAMPTZ;
  v_consignment_items JSONB := '[]'::JSONB;
  v_sort_counter INTEGER;
  v_override JSONB;
  v_override_addr JSONB;
  v_override_parcels JSONB := '[]'::JSONB;
  v_parcel JSONB;
  v_o_dm_id UUID;
  v_o_fee NUMERIC;
  v_o_cost NUMERIC;
  v_o_tracking_co TEXT;
  v_o_tracking_no TEXT;
  v_o_tracking_url TEXT;
  v_o_note TEXT;
  v_delivery_type TEXT;
  v_override_type TEXT;
  v_delivery JSONB;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  -- 全局方法仍先驗證（即使被 override 覆蓋也維持既有 RAISE 語意）
  IF p_delivery_method_id IS NOT NULL THEN
    PERFORM public._resolve_delivery(p_delivery_type, p_delivery_method_id, false);
  END IF;

  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_sales_note_id := NULL;
    v_sales_note_code := NULL;
    v_access_token := NULL;
    v_consignment_items := '[]'::JSONB;
    v_sort_counter := 0;
    v_override := NULL;
    v_override_parcels := '[]'::JSONB;
    v_override_addr := NULL;

    IF p_delivery_overrides IS NOT NULL AND jsonb_typeof(p_delivery_overrides) = 'object' THEN
      v_override := p_delivery_overrides -> v_store_id::text;
      IF jsonb_typeof(v_override) <> 'object' THEN
        v_override := NULL;
      ELSE
        v_override_addr := v_override -> 'address';
        v_override_parcels := v_override -> 'parcels';
        IF jsonb_typeof(v_override_parcels) <> 'array' OR jsonb_array_length(v_override_parcels) = 0 THEN
          v_override_parcels := '[]'::JSONB;
        END IF;
        v_override_type := NULLIF(v_override->>'delivery_type', '');
        IF v_override_type IS NULL THEN
          -- 有 parcels 的方法類型優先，否則回退全局
          IF jsonb_array_length(v_override_parcels) > 0 THEN
            SELECT type INTO v_override_type FROM public.delivery_methods
            WHERE id = NULLIF(v_override_parcels->0->>'delivery_method_id', '')::UUID;
          END IF;
        END IF;
      END IF;
    END IF;
    v_delivery := public._resolve_delivery(COALESCE(v_override_type, p_delivery_type), p_delivery_method_id, false);
    v_delivery_type := v_delivery->>'delivery_type';

    FOR v_item IN
      SELECT sp.id AS pool_id, sp.order_item_id, sp.quantity, sp.store_id,
             sp.warehouse_id AS pool_warehouse_id, sp.sort_order AS pool_sort_order,
             oi.quantity AS total_qty, oi.shipped_quantity AS current_shipped,
             oi.order_id, oi.product_id, oi.variant_id, oi.unit_price,
             oo.consignment_mode
      FROM public.shipping_pool sp
      JOIN public.order_items oi ON oi.id = sp.order_item_id
      JOIN public.orders oo ON oo.id = oi.order_id
      WHERE sp.store_id = v_store_id
      ORDER BY sp.sort_order, sp.created_at
    LOOP
      v_item_warehouse_id := COALESCE(
        v_item.pool_warehouse_id,
        (p_warehouse_map->>v_item.order_item_id::TEXT)::UUID,
        v_default_warehouse_id
      );
      v_source := COALESCE(p_source_map->>v_item.order_item_id::TEXT, 'self');

      v_is_consignment := CASE
        WHEN p_consignment_override_map ? v_item.order_item_id::TEXT
          THEN COALESCE((p_consignment_override_map->>v_item.order_item_id::TEXT)::BOOLEAN, v_item.consignment_mode)
        ELSE v_item.consignment_mode
      END;

      IF v_item.quantity > v_item.total_qty - v_item.current_shipped THEN
        RAISE EXCEPTION '出貨池品項 % 欲出貨 % 件，但訂單尚未出貨僅剩 % 件（shipped_quantity 已 %/%）',
          v_item.order_item_id, v_item.quantity, v_item.total_qty - v_item.current_shipped,
          v_item.current_shipped, v_item.total_qty;
      END IF;

      IF v_is_consignment THEN
        v_consignment_items := v_consignment_items || jsonb_build_object(
          'order_item_id', v_item.order_item_id,
          'quantity', v_item.quantity
        );
      ELSE
        IF v_sales_note_id IS NULL THEN
          v_access_token := gen_random_uuid();

          INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id, delivery_type)
          VALUES (v_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id, v_delivery_type)
          RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

          -- 配送：類型驅動。override 有包裹＝逐包（物流）；否則視類型
          IF jsonb_array_length(v_override_parcels) > 0 THEN
            FOR v_parcel IN SELECT * FROM jsonb_array_elements(v_override_parcels) LOOP
              v_o_dm_id := NULLIF(v_parcel->>'delivery_method_id', '')::UUID;
              IF v_o_dm_id IS NULL THEN
                CONTINUE;
              END IF;
              v_o_fee := NULLIF(v_parcel->>'fee', '')::NUMERIC;
              v_o_cost := NULLIF(v_parcel->>'cost', '')::NUMERIC;
              v_o_tracking_co := NULLIF(v_parcel->>'tracking_company', '');
              v_o_tracking_no := NULLIF(v_parcel->>'tracking_number', '');
              v_o_tracking_url := NULLIF(v_parcel->>'tracking_url', '');
              v_o_note := NULLIF(v_parcel->>'note', '');
              PERFORM public.upsert_shipment(
                'sales_note', v_sales_note_id, v_o_dm_id, v_o_fee, v_o_cost,
                'one_time', v_o_tracking_co, v_o_tracking_no, v_o_tracking_url,
                v_shipped_at, COALESCE(v_o_note, p_notes), p_created_by, NULL
              );
            END LOOP;
            IF jsonb_typeof(v_override_addr) = 'object' AND (v_override_addr->>'city') IS NOT NULL THEN
              UPDATE public.sales_notes
              SET shipping_address = v_override_addr, updated_at = NOW()
              WHERE id = v_sales_note_id;
            END IF;
          ELSIF v_delivery_type = 'logistics' AND p_delivery_method_id IS NOT NULL THEN
            PERFORM public.upsert_shipment(
              'sales_note', v_sales_note_id, (v_delivery->>'method_id')::uuid,
              COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric),
              COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric),
              'one_time', p_tracking_company, p_tracking_number, p_tracking_url,
              v_shipped_at, p_notes, p_created_by, NULL
            );
            UPDATE public.sales_notes
            SET delivery_method_id = (v_delivery->>'method_id')::uuid,
                delivery_method_title = v_delivery->>'method_title',
                delivery_method_code = v_delivery->>'method_code',
                shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
                shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
                shipping_address = COALESCE(shipping_address, v_override_addr, p_shipping_address),
                updated_at = NOW()
            WHERE id = v_sales_note_id;
          ELSIF v_delivery_type = 'delivery' THEN
            IF (v_delivery->>'method_id') IS NOT NULL THEN
              UPDATE public.sales_notes
              SET delivery_method_id = (v_delivery->>'method_id')::uuid,
                  delivery_method_title = v_delivery->>'method_title',
                  delivery_method_code = v_delivery->>'method_code',
                  shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::numeric, 0),
                  shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::numeric, 0),
                  shipping_address = COALESCE(shipping_address, v_override_addr, p_shipping_address),
                  updated_at = NOW()
              WHERE id = v_sales_note_id;
            END IF;
          END IF;
        END IF;

        v_sort_counter := v_sort_counter + 1;

        INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
        VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity, v_source, v_sort_counter);

        IF v_source = 'self' THEN
          PERFORM public._ship_stock_movements(
            v_item.product_id, v_item.variant_id, v_item_warehouse_id, v_item.quantity,
            'sales_shipment', v_sales_note_id, NULL, NULL, v_item.order_item_id,
            v_sales_note_code, p_created_by, 'self'
          );
        ELSE
          PERFORM public.allocate_inventory(
            v_item.product_id, v_item.variant_id, v_item.quantity, v_source, NULL,
            v_sales_note_id, v_item.order_item_id, v_sales_note_code, v_item.unit_price, p_created_by
          );
        END IF;
      END IF;

      v_new_shipped_qty := v_item.current_shipped + v_item.quantity;
      IF v_new_shipped_qty >= v_item.total_qty THEN
        v_new_status := 'shipped';
      ELSIF v_new_shipped_qty > 0 THEN
        v_new_status := 'partial';
      ELSE
        v_new_status := 'waiting';
      END IF;

      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped_qty, status = v_new_status, updated_at = NOW()
      WHERE id = v_item.order_item_id;

      IF NOT (v_item.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_item.order_id);
      END IF;

      INSERT INTO public.audit_logs (entity_type, entity_id, action, performed_by, store_id, old_value, new_value)
      VALUES ('order_item', v_item.order_item_id, 'shipped_quantity_updated', p_created_by, v_store_id,
        jsonb_build_object('shipped_quantity', v_item.current_shipped),
        jsonb_build_object('shipped_quantity', v_new_shipped_qty, 'status', v_new_status::text));
    END LOOP;

    DELETE FROM public.shipping_pool WHERE store_id = v_store_id;

    IF jsonb_array_length(v_consignment_items) > 0 THEN
      -- 純寄賣店家：override 存在時取首包方式/fee/cost/追蹤＋類型帶入 layer
      IF jsonb_array_length(v_override_parcels) > 0 THEN
        v_o_dm_id := NULLIF(v_override_parcels->0->>'delivery_method_id', '')::UUID;
        v_o_fee := NULLIF(v_override_parcels->0->>'fee', '')::NUMERIC;
        v_o_cost := NULLIF(v_override_parcels->0->>'cost', '')::NUMERIC;
        v_o_tracking_co := NULLIF(v_override_parcels->0->>'tracking_company', '');
        v_o_tracking_no := NULLIF(v_override_parcels->0->>'tracking_number', '');
        v_o_tracking_url := NULLIF(v_override_parcels->0->>'tracking_url', '');
        PERFORM public.create_consignment_shipment_layer(
          v_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes,
          v_default_warehouse_id, v_o_dm_id, v_o_fee, v_override_addr,
          v_delivery_type, v_o_cost, v_o_tracking_co, v_o_tracking_no, v_o_tracking_url
        );
      ELSE
        PERFORM public.create_consignment_shipment_layer(
          v_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes,
          v_default_warehouse_id, p_delivery_method_id, p_shipping_fee, p_shipping_address,
          v_delivery_type, p_shipping_cost, p_tracking_company, p_tracking_number, p_tracking_url
        );
      END IF;
    END IF;

    v_result := v_result || jsonb_build_object(
      'store_id', v_store_id,
      'sales_note_id', v_sales_note_id,
      'sales_note_code', v_sales_note_code,
      'access_token', v_access_token
    );
  END LOOP;

  FOREACH v_order_id IN ARRAY v_affected_order_ids LOOP
    SELECT bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN ('cancelled', 'discontinued')
                    OR oi.line_type = 'return')
    INTO v_all_shipped
    FROM public.order_items oi
    WHERE oi.order_id = v_order_id;

    IF v_all_shipped THEN
      UPDATE public.orders SET status = 'shipped' WHERE id = v_order_id;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;

-- ------------------------------------------------------------
-- 6. correct_sales_note：Phase 2 拒絕追加 return 列；收斂排除 return 列
--    （既有 body 源自 20260924000003，僅加入兩處 line_type 判斷）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_sales_note(
  p_sales_note_id UUID,
  p_items_to_remove UUID[] DEFAULT '{}',
  p_items_to_add JSONB DEFAULT '[]',
  p_new_items JSONB DEFAULT '[]',
  p_created_by UUID DEFAULT NULL,
  p_price_updates JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_sn RECORD;
  v_own_wh UUID;
  v_consignment_wh UUID;
  v_item_order_item_id UUID;
  v_item_quantity INTEGER;
  v_elem JSONB;
  v_oi RECORD;
  v_sni RECORD;
  v_new_shipped INTEGER;
  v_pool_quantity INTEGER;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_is_consignment BOOLEAN;
  v_source_type TEXT;
  v_owner TEXT;
  v_ship_wh UUID;
  v_remaining INTEGER;
  v_new_order_id UUID;
  v_new_order_item_id UUID;
  v_new_sni_code TEXT;
  v_removed_qty INTEGER := 0;
  v_added_qty INTEGER := 0;
  v_new_items_qty INTEGER := 0;
  v_result JSONB;
  v_pu_elem JSONB;
  v_pu_oi_id UUID;
  v_pu_new_price INTEGER;
  v_pu_old_price NUMERIC;
  v_pu_oi RECORD;
  v_pu_order_code TEXT;
  v_pu_other_sni RECORD;
  v_price_updates_result JSONB := '[]'::JSONB;
  v_other_notes JSONB;
  v_rest RECORD;
  v_plain_qty INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可修正銷貨單');
  END IF;

  SELECT * INTO v_sn FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;
  v_new_sni_code := v_sn.code;

  IF v_sn.status = 'received' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單已收貨，無法修正', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'label', '已收貨狀態')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_entries ae
    WHERE ae.reference_type = 'sales_note' AND ae.reference_id = p_sales_note_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer
    WHERE aer.reference_type = 'sales_note' AND aer.reference_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已有會計分錄（如收款），請先至會計模組回退/刪除分錄', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'accounting', 'label', '會計分錄（收款）')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rep_commission_payouts rcp WHERE rcp.sales_note_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已完成業務佣金發放（或已登記），請先撤銷發放', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'rep_payout', 'label', '業務佣金發放')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_sales cs WHERE cs.sales_note_id = p_sales_note_id AND NOT cs.reversed
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單為寄賣確認銷售產生的收款單，請由寄賣流程反向處理', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'consignment_sale', 'label', '寄賣確認銷售')));
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  SELECT id INTO v_consignment_wh FROM public.warehouses WHERE code = 'supplier_consignment';

  -- Phase 1: 移除
  IF p_items_to_remove IS NOT NULL AND array_length(p_items_to_remove, 1) > 0 THEN
    FOREACH v_item_order_item_id IN ARRAY p_items_to_remove LOOP
      SELECT * INTO v_sni FROM public.sales_note_items WHERE id = v_item_order_item_id AND sales_note_id = p_sales_note_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '要移除的品項不存在於此銷貨單';
      END IF;

      SELECT * INTO v_oi FROM public.order_items WHERE id = v_sni.order_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '品項對應的訂單項目不存在（資料異常）';
      END IF;

      v_is_consignment := v_sni.inventory_source_type IN ('supplier_consignment', 'store_consignment');

      -- 批次還原資料：在 DELETE 出貨 movements 前先讀取批次+倉位分佈
      IF NOT v_is_consignment THEN
        v_plain_qty := v_sni.quantity;
        FOR v_rest IN
          SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
          FROM public.inventory_movements m
          WHERE m.sales_note_id = p_sales_note_id
            AND m.order_item_id = v_sni.order_item_id
            AND m.source_type = 'sales_shipment'
            AND m.batch_id IS NOT NULL
          GROUP BY m.batch_id, m.warehouse_id
        LOOP
          PERFORM public.upsert_sales_note_deletion_movement(
            p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
            v_rest.warehouse_id, v_rest.qty, v_new_sni_code, p_created_by, v_rest.batch_id
          );
          v_plain_qty := v_plain_qty - v_rest.qty;
        END LOOP;
        IF v_plain_qty > 0 THEN
          PERFORM public.upsert_sales_note_deletion_movement(
            p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
            v_own_wh, v_plain_qty, v_new_sni_code, p_created_by
          );
        END IF;
      END IF;

      IF v_is_consignment THEN
        IF v_sni.inventory_source_type = 'store_consignment' THEN
          v_source_type := 'consignment_shipment_reversal';
          v_owner := 'store_consignment';
          v_ship_wh := v_own_wh;
        ELSE
          v_source_type := 'consignment_sale_reversal';
          v_owner := 'supplier_consignment';
          v_ship_wh := v_consignment_wh;
        END IF;

        IF v_sni.inventory_source_type = 'store_consignment' THEN
          -- 寄賣已出貨（store_consignment）：逐批還原
          v_plain_qty := v_sni.quantity;
          FOR v_rest IN
            SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
            FROM public.inventory_movements m
            WHERE m.sales_note_id = p_sales_note_id
              AND m.order_item_id = v_sni.order_item_id
              AND m.source_type = 'consignment_out_shipment'
              AND m.batch_id IS NOT NULL
            GROUP BY m.batch_id, m.warehouse_id
          LOOP
            INSERT INTO public.inventory_movements (
              product_id, variant_id, warehouse_id, quantity_change, source_type,
              sales_note_id, order_item_id, inventory_owner, reference_code, created_by, batch_id
            )
            VALUES (
              v_oi.product_id, v_oi.variant_id, v_rest.warehouse_id, v_rest.qty, v_source_type,
              p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by, v_rest.batch_id
            );
            v_plain_qty := v_plain_qty - v_rest.qty;
          END LOOP;
          IF v_plain_qty > 0 THEN
            INSERT INTO public.inventory_movements (
              product_id, variant_id, warehouse_id, quantity_change, source_type,
              sales_note_id, order_item_id, inventory_owner, reference_code, created_by
            )
            VALUES (
              v_oi.product_id, v_oi.variant_id, v_ship_wh, v_plain_qty, v_source_type,
              p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by
            );
          END IF;
        ELSE
          INSERT INTO public.inventory_movements (
            product_id, variant_id, warehouse_id, quantity_change, source_type,
            sales_note_id, order_item_id, inventory_owner, reference_code, created_by
          )
          VALUES (
            v_oi.product_id, v_oi.variant_id, v_ship_wh, v_sni.quantity, v_source_type,
            p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by
          );
        END IF;
      END IF;

      -- 出貨 movements（sales_shipment / consignment_out_shipment）在此才刪除，
      -- 確保上方批次還原先用原批次+倉位分布讀取並寫回
      DELETE FROM public.inventory_movements
      WHERE sales_note_id = p_sales_note_id
        AND order_item_id = v_sni.order_item_id
        AND source_type IN ('sales_shipment', 'consignment_out_shipment');

      v_new_shipped := GREATEST(0, v_oi.shipped_quantity - v_sni.quantity);
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped,
          status = CASE
                     WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                     WHEN v_new_shipped < v_oi.quantity THEN 'partial'::order_item_status
                     ELSE 'shipped'::order_item_status
                   END,
          updated_at = NOW()
      WHERE id = v_sni.order_item_id;

      SELECT quantity INTO v_pool_quantity FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      IF FOUND THEN
        UPDATE public.shipping_pool
        SET quantity = v_pool_quantity + v_sni.quantity
        WHERE order_item_id = v_sni.order_item_id;
      ELSE
        INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
        VALUES (v_sni.order_item_id, v_sni.quantity, v_sn.store_id, p_created_by);
      END IF;

      -- 上限防呆：回補後不得超過訂單剩餘未出貨量；剩餘量 <= 0 時（殘留整列）直接刪除
      IF v_oi.quantity - v_new_shipped <= 0 THEN
        DELETE FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      ELSE
        UPDATE public.shipping_pool
        SET quantity = v_oi.quantity - v_new_shipped
        WHERE order_item_id = v_sni.order_item_id
          AND quantity > v_oi.quantity - v_new_shipped;
      END IF;

      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      DELETE FROM public.sales_note_items WHERE id = v_sni.id;
      v_removed_qty := v_removed_qty + v_sni.quantity;
    END LOOP;
  END IF;

  -- Phase 2: 追加已有品項
  IF p_items_to_add IS NOT NULL AND jsonb_typeof(p_items_to_add) = 'array' AND jsonb_array_length(p_items_to_add) > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items_to_add)
    LOOP
      v_item_order_item_id := (v_elem->>'order_item_id')::UUID;
      v_item_quantity := (v_elem->>'quantity')::INTEGER;

      SELECT * INTO v_oi
      FROM public.order_items oi
      JOIN public.orders oo ON oo.id = oi.order_id
      WHERE oi.id = v_item_order_item_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION '要追加的品項不存在';
      END IF;

      IF v_oi.line_type = 'return' THEN
        RAISE EXCEPTION '退貨列不可追加至銷貨單';
      END IF;

      IF v_oi.store_id <> v_sn.store_id THEN
        RAISE EXCEPTION '不可跨店家追加品項';
      END IF;

      v_remaining := v_oi.quantity - v_oi.shipped_quantity;
      IF v_item_quantity > v_remaining THEN
        RAISE EXCEPTION '品項未出貨量不足，剩餘 % 件', v_remaining;
      END IF;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
      VALUES (
        p_sales_note_id, v_item_order_item_id, v_item_quantity,
        CASE WHEN v_oi.consignment_mode THEN 'store_consignment' ELSE 'self' END,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id)
      );

      IF v_oi.consignment_mode THEN
        PERFORM public.allocate_inventory(
          v_oi.product_id, v_oi.variant_id, v_item_quantity, 'store_consignment', NULL,
          p_sales_note_id, v_item_order_item_id, v_new_sni_code, v_oi.unit_price, p_created_by
        );
      ELSE
        PERFORM public._ship_stock_movements(
          v_oi.product_id, v_oi.variant_id, v_own_wh, v_item_quantity, 'sales_shipment',
          p_sales_note_id, NULL, NULL, v_item_order_item_id, v_new_sni_code, p_created_by, 'self'
        );
      END IF;

      v_new_shipped := v_oi.shipped_quantity + v_item_quantity;
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped,
          status = CASE
                     WHEN v_new_shipped >= v_oi.quantity THEN 'shipped'::order_item_status
                     WHEN v_new_shipped > 0 THEN 'partial'::order_item_status
                     ELSE 'waiting'::order_item_status
                   END,
          updated_at = NOW()
      WHERE id = v_item_order_item_id;

      DELETE FROM public.shipping_pool
      WHERE order_item_id = v_item_order_item_id AND store_id = v_sn.store_id;

      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      v_added_qty := v_added_qty + v_item_quantity;
    END LOOP;
  END IF;

  -- Phase 3: 追加完全新品（自動建單）
  IF p_new_items IS NOT NULL AND jsonb_typeof(p_new_items) = 'array' AND jsonb_array_length(p_new_items) > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_new_items)
    LOOP
      IF (v_elem->>'product_id') IS NULL THEN
        RAISE EXCEPTION '新品項缺少 product_id';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = (v_elem->>'product_id')::UUID) THEN
        RAISE EXCEPTION '新品項對應產品不存在';
      END IF;

      v_item_quantity := COALESCE((v_elem->>'quantity')::INTEGER, 1);
      IF v_item_quantity < 1 THEN
        RAISE EXCEPTION '新品項數量必須大於 0';
      END IF;

      INSERT INTO public.orders (store_id, created_by, status, source_type, access_token, notes)
      VALUES (v_sn.store_id, p_created_by, 'shipped', 'admin_proxy', gen_random_uuid(),
              '銷貨單修正自動建立（' || v_new_sni_code || '）')
      RETURNING id INTO v_new_order_id;

      INSERT INTO public.order_items (
        order_id, product_id, variant_id, store_id,
        quantity, unit_price, shipped_quantity, status,
        unit_cost, sort_order
      )
      VALUES (
        v_new_order_id,
        (v_elem->>'product_id')::UUID,
        NULLIF(v_elem->>'variant_id', '')::UUID,
        v_sn.store_id,
        v_item_quantity,
        COALESCE((v_elem->>'unit_price')::INTEGER,
          (SELECT COALESCE(p.unified_wholesale_price, p.unified_retail_price) FROM public.products p WHERE p.id = (v_elem->>'product_id')::UUID)),
        v_item_quantity,
        'shipped'::order_item_status,
        COALESCE(NULLIF(v_elem->>'unit_cost', '')::INTEGER, 0),
        1
      )
      RETURNING id INTO v_new_order_item_id;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
      VALUES (
        p_sales_note_id, v_new_order_item_id, v_item_quantity, 'self',
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id)
      );

      PERFORM public._ship_stock_movements(
        (v_elem->>'product_id')::UUID,
        NULLIF(v_elem->>'variant_id', '')::UUID,
        v_own_wh, v_item_quantity, 'sales_shipment',
        p_sales_note_id, NULL, NULL, v_new_order_item_id, v_new_sni_code, p_created_by, 'self'
      );

      IF NOT (v_new_order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_new_order_id);
      END IF;

      v_new_items_qty := v_new_items_qty + v_item_quantity;
    END LOOP;
  END IF;

  -- Phase 4: 價格更新（直接改 order_items.unit_price，單一資料源）
  IF p_price_updates IS NOT NULL AND jsonb_typeof(p_price_updates) = 'array' AND jsonb_array_length(p_price_updates) > 0 THEN
    FOR v_pu_elem IN SELECT * FROM jsonb_array_elements(p_price_updates)
    LOOP
      v_pu_oi_id := (v_pu_elem->>'order_item_id')::UUID;
      v_pu_new_price := (v_pu_elem->>'new_unit_price')::INTEGER;

      IF v_pu_new_price < 0 THEN
        RAISE EXCEPTION '價格不可為負數';
      END IF;

      SELECT oi.*, o.code AS order_code INTO v_pu_oi
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = v_pu_oi_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION '要修改價格的品項不存在';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.sales_note_items sni
        WHERE sni.sales_note_id = p_sales_note_id AND sni.order_item_id = v_pu_oi_id
      ) THEN
        RAISE EXCEPTION '品項不屬於此銷貨單';
      END IF;

      v_pu_old_price := v_pu_oi.unit_price;

      SELECT sni.id, sn.code INTO v_pu_other_sni
      FROM public.sales_note_items sni
      JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
      WHERE sni.order_item_id = v_pu_oi_id
        AND sn.id != p_sales_note_id
        AND sn.payment_status = 'paid'
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION '品項 "%" 已被銷貨單 %（已收款）引用，無法修改價格', v_pu_oi.product_id, v_pu_other_sni.code;
      END IF;

      v_other_notes := (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('code', sn.code, 'payment_status', sn.payment_status)), '[]'::jsonb)
        FROM public.sales_note_items sni
        JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
        WHERE sni.order_item_id = v_pu_oi_id
          AND sn.id != p_sales_note_id
      );

      UPDATE public.order_items
      SET unit_price = v_pu_new_price, updated_at = NOW()
      WHERE id = v_pu_oi_id;

      v_price_updates_result := v_price_updates_result || jsonb_build_object(
        'order_item_id', v_pu_oi_id,
        'product_id', v_pu_oi.product_id,
        'variant_id', v_pu_oi.variant_id,
        'old_unit_price', v_pu_old_price,
        'new_unit_price', v_pu_new_price,
        'order_code', v_pu_oi.order_code,
        'other_affected_sales_notes', v_other_notes
      );

      IF NOT (v_pu_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_pu_oi.order_id);
      END IF;
    END LOOP;
  END IF;

  -- Phase 5: 收尾
  UPDATE public.sales_notes SET updated_at = NOW() WHERE id = p_sales_note_id;

  FOREACH v_order_id IN ARRAY v_affected_order_ids LOOP
    SELECT COALESCE(bool_and(o2.shipped_quantity >= o2.quantity OR o2.status IN ('cancelled', 'discontinued')
                       OR o2.line_type = 'return'), false)
    INTO v_all_shipped
    FROM public.order_items o2
    WHERE o2.order_id = v_order_id;

    IF v_all_shipped THEN
      UPDATE public.orders SET status = 'shipped', updated_at = NOW()
      WHERE id = v_order_id AND status = 'processing';
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'sales_note_id', p_sales_note_id,
    'removed_quantity', v_removed_qty,
    'added_quantity', v_added_qty,
    'new_items_quantity', v_new_items_qty,
    'affected_orders', to_jsonb(v_affected_order_ids),
    'price_updates', v_price_updates_result,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', si.id,
        'order_item_id', si.order_item_id,
        'quantity', si.quantity,
        'inventory_source_type', si.inventory_source_type,
        'sort_order', si.sort_order
      ) ORDER BY si.sort_order)
      FROM public.sales_note_items si
      WHERE si.sales_note_id = p_sales_note_id
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 7. reverse_consignment_shipment：來源 order_items 匹配排除 return 列
--    （既有 body 源自 20260924000003，僅加入 line_type 條件）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_rest RECORD;
  v_own_wh UUID;
  v_reverse_qty INTEGER;
  v_plain_qty INTEGER;
  v_oi_id UUID;
  v_oi_shipped INTEGER;
  v_oi_qty INTEGER;
  v_new_shipped INTEGER;
  v_pool_quantity INTEGER;
  v_reversed_items INTEGER := 0;
  v_reversed_quantity INTEGER := 0;
  v_result JSONB;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '僅店家方向寄賣單可回滾出貨';
  END IF;
  IF v_order.status <> 'active' THEN
    RAISE EXCEPTION '僅進行中的寄賣單可回滾出貨';
  END IF;
  IF v_order.received_at IS NOT NULL THEN
    RAISE EXCEPTION '店家已確認收貨，請改用「退回」流程';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_sales
    WHERE consignment_order_id = p_consignment_order_id AND NOT reversed
  ) THEN
    RAISE EXCEPTION '已有已售出紀錄，無法回滾出貨';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_sales_reports
    WHERE consignment_order_id = p_consignment_order_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION '尚有待審核的銷售回報，無法回滾出貨';
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  FOR v_item IN
    SELECT s.consignment_order_item_id AS coi_id,
           s.shipped_quantity,
           coi.order_item_id,
           coi.product_id,
           coi.variant_id
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
      AND s.shipped_quantity > 0
  LOOP
    v_reverse_qty := v_item.shipped_quantity;

    -- 1) 回補自有倉庫（consignment_shipment_reversal，+qty）——依出貨批次逐批還原
    v_plain_qty := v_reverse_qty;
    FOR v_rest IN
      SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
      FROM public.inventory_movements m
      WHERE m.consignment_order_item_id = v_item.coi_id
        AND m.source_type = 'consignment_out_shipment'
        AND m.batch_id IS NOT NULL
      GROUP BY m.batch_id, m.warehouse_id
    LOOP
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        consignment_order_id, consignment_order_item_id,
        reference_code, inventory_owner, created_by, batch_id
      )
      VALUES (
        v_item.product_id, v_item.variant_id, v_rest.warehouse_id, v_rest.qty,
        'consignment_shipment_reversal',
        p_consignment_order_id, v_item.coi_id,
        v_order.code, 'store_consignment', p_created_by, v_rest.batch_id
      );
      v_plain_qty := v_plain_qty - v_rest.qty;
    END LOOP;

    IF v_plain_qty > 0 THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        consignment_order_id, consignment_order_item_id,
        reference_code, inventory_owner, created_by
      )
      VALUES (
        v_item.product_id, v_item.variant_id, v_own_wh, v_plain_qty,
        'consignment_shipment_reversal',
        p_consignment_order_id, v_item.coi_id,
        v_order.code, 'store_consignment', p_created_by
      );
    END IF;

    -- 2) 來源 order_items：先由 consignment_order_items.order_item_id 直接對應，
    --    若無再依 source_order_id + product/variant 精確匹配（避免 A+B 訂單時誤匹配）
    v_oi_id := v_item.order_item_id;
    IF v_oi_id IS NULL AND v_order.source_order_id IS NOT NULL THEN
      SELECT oi.id INTO v_oi_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order.source_order_id
        AND oi.line_type <> 'return'
        AND oi.product_id = v_item.product_id
        AND oi.variant_id IS NOT DISTINCT FROM v_item.variant_id
      LIMIT 1;
    END IF;

    IF v_oi_id IS NOT NULL THEN
      SELECT quantity, shipped_quantity INTO v_oi_qty, v_oi_shipped
      FROM public.order_items WHERE id = v_oi_id;
      IF FOUND THEN
        v_new_shipped := GREATEST(0, v_oi_shipped - v_reverse_qty);
        UPDATE public.order_items
        SET shipped_quantity = v_new_shipped,
            status = CASE
                       WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                       WHEN v_new_shipped < v_oi_qty THEN 'partial'::order_item_status
                       ELSE 'shipped'::order_item_status
                     END,
            updated_at = NOW()
        WHERE id = v_oi_id;

        -- 3) 放回出貨池（有列累加、無列新增）
        SELECT quantity INTO v_pool_quantity
        FROM public.shipping_pool WHERE order_item_id = v_oi_id;
        IF FOUND THEN
          UPDATE public.shipping_pool
          SET quantity = v_pool_quantity + v_reverse_qty
          WHERE order_item_id = v_oi_id;
        ELSE
          INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
          SELECT v_oi_id, v_reverse_qty, o.store_id, o.created_by
          FROM public.orders o WHERE o.id = v_order.source_order_id;
        END IF;
      END IF;
    END IF;

    v_reversed_items := v_reversed_items + 1;
    v_reversed_quantity := v_reversed_quantity + v_reverse_qty;
  END LOOP;

  IF v_reversed_items = 0 THEN
    RAISE EXCEPTION '此寄賣單沒有可回滾的出貨紀錄';
  END IF;

  -- 4) 寄賣單回草稿；來源訂單全數回滾時降 processing
  UPDATE public.consignment_orders
  SET status = 'draft', updated_at = NOW()
  WHERE id = p_consignment_order_id;

  IF v_order.source_order_id IS NOT NULL THEN
    UPDATE public.orders
    SET status = 'processing', updated_at = NOW()
    WHERE id = v_order.source_order_id
      AND status = 'shipped'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi2
        WHERE oi2.order_id = v_order.source_order_id
          AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
      );
  END IF;

  v_result := jsonb_build_object(
    'consignment_order_id', p_consignment_order_id,
    'source_order_id', v_order.source_order_id,
    'reversed_items', v_reversed_items,
    'reversed_quantity', v_reversed_quantity
  );

  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------
-- 8. update_order_with_items：支援 line 四欄
--    （既有 body 源自 20260916000004 + paid/quantity 守門；僅加 line 欄位處理）
-- ------------------------------------------------------------
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
  v_shipped_deletion BOOLEAN;
  v_low_quantity BOOLEAN;
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

  -- 數量守門（不依賴收款狀態，處理「已出貨但未收款」或寄賣已出貨的品項）：
  -- 1) 刪除既有品項：已出貨（shipped_quantity > 0）不可直接刪除
  --    （sales_note_items.order_item_id 為 FK，且刪除已出貨品項會弄垮銷售/寄賣紀錄）
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

  -- 2) 既有品項新數量不可低於已出貨數量（防止負剩餘）
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

  -- 3) line_type ↔ return_status / is_repair 組合校驗（避免 CHECK 拋晦澀錯誤）
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    -- 退貨列必須有有效的 return_status
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
    -- 非退貨列不得設定 return_status / is_repair
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      LEFT JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND (el->>'id') IS NOT NULL
      WHERE COALESCE(NULLIF(el->>'line_type', ''), oi.line_type, 'sale') <> 'return'
        AND (NULLIF(el->>'return_status', '') IS NOT NULL
             OR COALESCE((el->>'is_repair')::boolean, false))
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '僅退貨列可設定 return_status / is_repair');
    END IF;
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

  -- 3. 更新既有品項（id IS NOT NULL；line 欄位未傳時保留現值）
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

-- ------------------------------------------------------------
-- 9. process_order_return_lines：結清退貨列（admin、單一交易）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_order_return_lines(
  p_line_ids UUID[],
  p_action TEXT DEFAULT 'stock',
  p_warehouse_id UUID DEFAULT NULL,
  p_refund_account_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID;
  v_line RECORD;
  v_own_wh UUID;
  v_total_refund NUMERIC := 0;
  v_entry_id UUID;
  v_amount NUMERIC;
  v_store_name TEXT;
  v_desc TEXT;
  v_order_ids UUID[] := '{}';
  v_refund_by_order JSONB := '{}'::jsonb;
  v_order_code TEXT;
  v_order_id UUID;
  v_processed INTEGER := 0;
  v_label TEXT;
  v_result JSONB;
BEGIN
  v_uid := COALESCE(p_created_by, auth.uid());

  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可處理退貨列');
  END IF;

  IF p_line_ids IS NULL OR array_length(p_line_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '未指定退貨列');
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('stock', 'exchange', 'repaired') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '處理動作必須為 stock / exchange / repaired');
  END IF;

  -- 前置校驗（全部在寫入前完成，避免部分寫入後才 RETURN 造成已提交不一致）
  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    LEFT JOIN public.order_items oi ON oi.id = lid
    WHERE oi.id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '退貨列不存在');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    WHERE oi.line_type <> 'return'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '選取範圍包含非退貨列的品項');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    WHERE oi.return_status <> 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '含已處理的退貨列（僅能處理 pending 狀態）');
  END IF;

  v_own_wh := COALESCE(p_warehouse_id, (
    SELECT id FROM public.warehouses
    WHERE code = 'own' OR type = '自有倉'
    ORDER BY (code = 'own') DESC, is_active DESC
    LIMIT 1
  ));
  IF v_own_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到退貨入庫倉庫');
  END IF;

  -- 累計退款並收集訂單（stock 動作）
  FOR v_line IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           o.store_id, o.code AS order_code
    FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    JOIN public.orders o ON o.id = oi.order_id
  LOOP
    IF NOT (v_line.order_id = ANY(v_order_ids)) THEN
      v_order_ids := array_append(v_order_ids, v_line.order_id);
      v_refund_by_order := jsonb_set(v_refund_by_order, ARRAY[v_line.order_id::text], to_jsonb(0));
    END IF;
    IF p_action = 'stock' THEN
      v_total_refund := v_total_refund + COALESCE(v_line.unit_price, 0) * v_line.quantity;
      v_refund_by_order := jsonb_set(
        v_refund_by_order,
        ARRAY[v_line.order_id::text],
        to_jsonb(
          COALESCE((v_refund_by_order->>v_line.order_id::text)::numeric, 0)
          + COALESCE(v_line.unit_price, 0) * v_line.quantity
        )
      );
    END IF;
  END LOOP;

  -- stock 且退額 > 0：退款帳戶 / 分類預先驗證
  IF p_action = 'stock' AND v_total_refund > 0 THEN
    IF p_refund_account_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', '退貨金額大於 0 但未指定退款帳戶');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_refund_account_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '退款帳戶不存在');
    END IF;
    IF p_category_id IS NOT NULL AND
       NOT EXISTS (SELECT 1 FROM public.accounting_categories WHERE id = p_category_id AND is_active) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '指定的會計分類不存在或已停用');
    END IF;
    IF p_category_id IS NULL THEN
      SELECT id INTO p_category_id FROM public.accounting_categories
      WHERE name = '客戶退貨退款' AND type = 'expense' AND is_active
      LIMIT 1;
      IF p_category_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', '找不到「客戶退貨退款」會計分類（請先於會計分類建立）');
      END IF;
    END IF;
  END IF;

  v_label := CASE p_action
    WHEN 'stock' THEN '退庫存'
    WHEN 'exchange' THEN '換貨'
    ELSE '送修歸還'
  END;

  -- 主處理迴圈
  FOR v_line IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           o.store_id, o.code AS order_code
    FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    JOIN public.orders o ON o.id = oi.order_id
    ORDER BY lid
  LOOP
    IF p_action = 'stock' THEN
      -- 退庫存：customer_return（+qty 自有倉；BEFORE INSERT 自動同步 product_inventory）
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, order_item_id, inventory_owner, reference_code, note, created_by
      ) VALUES (
        v_line.product_id, v_line.variant_id, v_own_wh, v_line.quantity, 0,
        'customer_return', v_line.id, 'self', v_line.order_code,
        '客戶退貨' || COALESCE(NULLIF(p_description, ''), ''), v_uid
      );
    END IF;

    -- 標記結清
    UPDATE public.order_items
    SET return_status = p_action::text,
        line_note = CASE
          WHEN line_note IS NULL OR line_note = '' THEN '已' || v_label
          ELSE line_note || '｜已' || v_label
        END,
        updated_at = NOW()
    WHERE id = v_line.id;

    v_processed := v_processed + 1;
  END LOOP;

  -- 退款 expense 分錄（僅 stock）；references 子表逐單攤分
  IF p_action = 'stock' AND v_total_refund > 0 THEN
    SELECT st.name INTO v_store_name
    FROM public.stores st
    WHERE st.id = (SELECT store_id FROM public.orders WHERE id = v_order_ids[1]);

    v_desc := COALESCE(NULLIF(p_description, ''), '客戶退貨退款');

    INSERT INTO public.accounting_entries (
      type, account_id, category_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, counterparty_name, transaction_date, created_by
    ) VALUES (
      'expense', p_refund_account_id, p_category_id, v_total_refund, v_total_refund, 'paid',
      v_desc, 'order', v_order_ids[1], v_store_name, CURRENT_DATE, v_uid
    ) RETURNING id INTO v_entry_id;

    FOREACH v_order_id IN ARRAY v_order_ids LOOP
      v_amount := COALESCE((v_refund_by_order->>v_order_id::text)::numeric, 0);
      CONTINUE WHEN v_amount <= 0;
      SELECT code INTO v_order_code FROM public.orders WHERE id = v_order_id;
      INSERT INTO public.accounting_entry_references (
        entry_id, reference_type, reference_id, item_name, amount_applied
      ) VALUES (
        v_entry_id, 'order', v_order_id,
        '退貨退款（' || COALESCE(v_order_code, '') || '）', v_amount
      );
    END LOOP;

    UPDATE public.accounts
    SET balance = balance - v_total_refund, updated_at = NOW()
    WHERE id = p_refund_account_id;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'action', p_action,
    'total_refund', v_total_refund,
    'entry_id', v_entry_id,
    'order_ids', to_jsonb(v_order_ids)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.process_order_return_lines(uuid[], text, uuid, uuid, uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_order_return_lines(uuid[], text, uuid, uuid, uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;