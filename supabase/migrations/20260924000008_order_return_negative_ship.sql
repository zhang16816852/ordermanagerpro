-- ============================================================
-- 20260924000008_order_return_negative_ship.sql
-- 訂單層退貨（line_type='return'）列開放「轉銷售單/出貨池出貨」，
-- 以「負數量」反映在銷貨單明細、退回的量回補庫存，並自動標記 return_status='stock'。
--
-- 設計（依 2026-09-24 決策）：
--  - return 與 exchange 列都開放列出貨，但只有 return 列會真的出貨（負數量）；
--    exchange（is_repair=true）列維持僅結清標記、不進銷售單。
--  - 出貨即「退回庫存」：新增內部 helper _receive_return_to_stock 寫
--    source_type='customer_return'、inventory_owner='self' 的 +N movement
--    （trigger 自動同步 product_inventory），不上 _ship_stock_movements。
--  - 既有 process_order_return_lines（結清流程：stock/exchange/repaired）保留並存。
--  - 刪單 / 修正（Phase 1 移除）需 sign-aware 逆轉：
--      括回 shipped_quantity（-abs）、庫存逆轉（-N）、退回出貨池、return_status 還原 pending。
--
-- ⚠️ 套用順序：本檔依賴 00005/00006 已套用（含 00002 序號/批次，勿套 00003）。
--    本檔重新 emit 的函式 body 以 00005 原始版本為基底，僅做上述差異改動。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 內部 helper：退貨列出貨＝把退貨量回補自有倉庫存
--    鏡像 process_order_return_lines（簡單版）的 restock 寫法，不開批次。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._receive_return_to_stock(
  p_product_id UUID,
  p_variant_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_quantity INTEGER DEFAULT 1,
  p_sales_note_id UUID DEFAULT NULL,
  p_order_item_id UUID DEFAULT NULL,
  p_reference_code TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_wh UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN;
  END IF;

  v_wh := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));
  IF v_wh IS NULL THEN
    RAISE EXCEPTION '找不到退貨入庫倉庫（warehouses.code=''own''）';
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, variant_id, warehouse_id, quantity_change, source_type,
    sales_note_id, order_item_id, reference_code, inventory_owner, note, created_by
  )
  VALUES (
    p_product_id, p_variant_id, v_wh, p_quantity, 'customer_return',
    p_sales_note_id, p_order_item_id, p_reference_code, 'self', p_note, p_created_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public._receive_return_to_stock(UUID, UUID, UUID, INTEGER, UUID, UUID, TEXT, UUID, TEXT) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._receive_return_to_stock(UUID, UUID, UUID, INTEGER, UUID, UUID, TEXT, UUID, TEXT) TO postgres;

-- ------------------------------------------------------------
-- 1. create_order_with_sales_note：退貨列以負數量出貨＋回庫＋return_status='stock'
--    （移除原 RAISE；寄賣模式仍拒絕 return）
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
  v_line_type TEXT;
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
    v_line_type := COALESCE(NULLIF(v_item->>'line_type', ''), 'sale');

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
      v_line_type,
      NULLIF(v_item->>'line_note', ''),
      COALESCE((v_item->>'is_repair')::BOOLEAN, false)
    )
    RETURNING id INTO v_order_item_id;

    v_temp_key := v_item->>'temp_key';
    IF v_temp_key IS NOT NULL THEN
      INSERT INTO _new_item_map (temp_key, item_id) VALUES (v_temp_key, v_order_item_id);
    END IF;

    IF p_consignment_mode THEN
      IF v_line_type = 'return' THEN
        RAISE EXCEPTION '寄賣模式不支援退貨列（line_type=return）';
      END IF;
      v_consignment_items := v_consignment_items || jsonb_build_object(
        'order_item_id', v_order_item_id,
        'quantity', v_quantity
      );
      CONTINUE;
    END IF;

    IF v_line_type = 'return' THEN
      -- 退貨列出貨：銷貨單明細以負數量淨扣、退回的量回補自有倉庫存
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (v_sales_note_id, v_order_item_id, -v_quantity, COALESCE(v_item->>'inventory_source_type', 'self'));

      PERFORM public._receive_return_to_stock(
        v_product_id, v_variant_id,
        COALESCE((v_item->>'warehouse_id')::UUID, v_default_warehouse_id),
        v_quantity, v_sales_note_id, v_order_item_id, v_sales_note_code, p_created_by,
        '訂單退貨出貨'
      );

      UPDATE public.order_items
      SET return_status = 'stock',
          line_note = CASE WHEN return_status = 'pending'
                           THEN COALESCE(line_note, '') || CASE WHEN COALESCE(line_note, '') = '' THEN '' ELSE '；' END || '退貨出貨入庫'
                           ELSE line_note END
      WHERE id = v_order_item_id;
    ELSE
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
-- 2. direct_ship_order：非寄賣迴圈開放退貨列以負數量出貨＋回庫＋return_status='stock'
--    （寄賣迴圈維持排除 return）
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
           oi.unit_price, oi.selected_model_name, oi.store_id, oi.line_type, oi.return_status
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('cancelled', 'discontinued')
  LOOP
    v_remaining_qty := v_item.quantity - v_item.shipped_quantity;
    CONTINUE WHEN v_remaining_qty <= 0;

    v_item_warehouse_id := COALESCE(
      (p_warehouse_map->>v_item.id::TEXT)::UUID,
      v_default_warehouse_id
    );
    v_source := COALESCE(p_source_map->>v_item.id::TEXT, 'self');

    IF v_item.line_type = 'return' THEN
      -- 退貨列：負數量明細＋回補自有倉庫存
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (v_sales_note_id, v_item.id, -v_remaining_qty, v_source);

      IF v_source = 'self' THEN
        PERFORM public._receive_return_to_stock(
          v_item.product_id, v_item.variant_id, v_item_warehouse_id, v_remaining_qty,
          v_sales_note_id, v_item.id, v_sales_note_code, p_created_by, '訂單退貨出貨'
        );
      ELSE
        RAISE EXCEPTION '退貨列不支援透過寄賣路徑出貨';
      END IF;
    ELSE
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
    END IF;

    v_new_shipped_qty := v_item.shipped_quantity + v_remaining_qty;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped_qty,
        status = 'shipped',
        return_status = CASE WHEN v_item.line_type = 'return' AND return_status = 'pending'
                            THEN 'stock' ELSE return_status END,
        line_note = CASE WHEN v_item.line_type = 'return' AND return_status = 'pending'
                         THEN COALESCE(line_note, '') || CASE WHEN COALESCE(line_note, '') = '' THEN '' ELSE '；' END || '退貨出貨入庫'
                         ELSE line_note END,
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
-- 3. ship_from_pool：出貨池退貨列以負數量出貨＋回庫＋return_status='stock'
--    （consignment 分支排除 return；全數出貨收斂維持豁免 return）
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
             oo.consignment_mode, oi.line_type, oi.return_status
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

      -- 退貨列一律以回庫路徑出貨，不進寄賣層
      IF v_is_consignment AND v_item.line_type <> 'return' THEN
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

        IF v_item.line_type = 'return' THEN
          INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
          VALUES (v_sales_note_id, v_item.order_item_id, -v_item.quantity, v_source, v_sort_counter);

          IF v_source = 'self' THEN
            PERFORM public._receive_return_to_stock(
              v_item.product_id, v_item.variant_id, v_item_warehouse_id, v_item.quantity,
              v_sales_note_id, v_item.order_item_id, v_sales_note_code, p_created_by, '訂單退貨出貨'
            );
          ELSE
            RAISE EXCEPTION '退貨列不支援透過寄賣路徑出貨';
          END IF;
        ELSE
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
      SET shipped_quantity = v_new_shipped_qty, status = v_new_status,
          return_status = CASE WHEN v_item.line_type = 'return' AND return_status = 'pending'
                              THEN 'stock' ELSE return_status END,
          line_note = CASE WHEN v_item.line_type = 'return' AND return_status = 'pending'
                           THEN COALESCE(line_note, '') || CASE WHEN COALESCE(line_note, '') = '' THEN '' ELSE '；' END || '退貨出貨入庫'
                           ELSE line_note END,
          updated_at = NOW()
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
-- 4. correct_sales_note：Phase 1 移除外加 sign-aware 逆轉（負數量退貨列）
--    Phase 2 追加維持拒絕 return；收斂維持豁免 return
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
  v_item_abs_qty INTEGER;
  v_is_return_line BOOLEAN;
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
      v_item_abs_qty := ABS(v_sni.quantity);
      v_is_return_line := (v_oi.line_type = 'return');

      -- 批次還原資料：在 DELETE 出貨 movements 前先讀取批次+倉位分佈
      IF NOT v_is_consignment THEN
        IF v_is_return_line THEN
          -- 退貨列：庫存逆轉＝扣回 abs（customer_return 回補反向）
          PERFORM public.upsert_sales_note_deletion_movement(
            p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
            v_own_wh, -v_item_abs_qty, v_new_sni_code, p_created_by
          );
        ELSE
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

      -- 出貨 movements（sales_shipment / consignment_out_shipment / 退貨回補 customer_return）
      -- 在此才刪除，確保上方批次還原先用原批次+倉位分布讀取並寫回
      DELETE FROM public.inventory_movements
      WHERE sales_note_id = p_sales_note_id
        AND order_item_id = v_sni.order_item_id
        AND source_type IN ('sales_shipment', 'consignment_out_shipment', 'customer_return');

      v_new_shipped := GREATEST(0, v_oi.shipped_quantity - v_item_abs_qty);
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped,
          status = CASE
                     WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                     WHEN v_new_shipped < v_oi.quantity THEN 'partial'::order_item_status
                     ELSE 'shipped'::order_item_status
                   END,
          return_status = CASE WHEN v_is_return_line THEN 'pending'::text ELSE return_status END,
          line_note = CASE WHEN v_is_return_line
                           THEN regexp_replace(COALESCE(line_note, ''), '(；)?(退貨出貨入庫|出貨退回入庫)$', '')
                           ELSE line_note END,
          updated_at = NOW()
      WHERE id = v_sni.order_item_id;

      SELECT quantity INTO v_pool_quantity FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      IF FOUND THEN
        UPDATE public.shipping_pool
        SET quantity = v_pool_quantity + v_item_abs_qty
        WHERE order_item_id = v_sni.order_item_id;
      ELSE
        INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
        VALUES (v_sni.order_item_id, v_item_abs_qty, v_sn.store_id, p_created_by);
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
        RAISE EXCEPTION '新品項數量需大於 0';
      END IF;

      IF (v_elem->>'unit_price') IS NULL THEN
        RAISE EXCEPTION '新品項需提供 unit_price';
      END IF;

      v_new_order_item_id := gen_random_uuid();

      IF (v_elem->>'variant_id') IS NOT NULL THEN
        INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode, access_token, delivery_type)
        VALUES (v_sn.store_id, p_created_by, '系統自動建立（銷貨單修正）', 'admin_proxy', 'shipped', false, gen_random_uuid(), NULL)
        RETURNING id INTO v_new_order_id;

        INSERT INTO public.order_items (
          id, order_id, product_id, variant_id, store_id,
          quantity, unit_price, unit_cost, shipped_quantity, status, line_type
        )
        VALUES (
          v_new_order_item_id, v_new_order_id, (v_elem->>'product_id')::UUID, (v_elem->>'variant_id')::UUID,
          v_sn.store_id, v_item_quantity, (v_elem->>'unit_price')::NUMERIC, NULL,
          v_item_quantity, 'shipped', 'sale'
        );
      ELSE
        INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode, access_token, delivery_type)
        VALUES (v_sn.store_id, p_created_by, '系統自動建立（銷貨單修正）', 'admin_proxy', 'shipped', false, gen_random_uuid(), NULL)
        RETURNING id INTO v_new_order_id;

        INSERT INTO public.order_items (
          id, order_id, product_id, variant_id, store_id,
          quantity, unit_price, unit_cost, shipped_quantity, status, line_type
        )
        VALUES (
          v_new_order_item_id, v_new_order_id, (v_elem->>'product_id')::UUID, NULL,
          v_sn.store_id, v_item_quantity, (v_elem->>'unit_price')::NUMERIC, NULL,
          v_item_quantity, 'shipped', 'sale'
        );
      END IF;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (
        p_sales_note_id, v_new_order_item_id, v_item_quantity,
        CASE WHEN v_sni.quantity < 0 THEN 'self' ELSE 'self' END
      );

      PERFORM public._ship_stock_movements(
        (v_elem->>'product_id')::UUID, (v_elem->>'variant_id')::UUID, v_own_wh, v_item_quantity,
        'sales_shipment', p_sales_note_id, NULL, NULL, v_new_order_item_id,
        v_new_sni_code, p_created_by, 'self'
      );

      v_new_items_qty := v_new_items_qty + v_item_quantity;

      IF NOT (v_new_order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_new_order_id);
      END IF;
    END LOOP;
  END IF;

  -- Phase 4: 價格更新
  IF p_price_updates IS NOT NULL AND jsonb_typeof(p_price_updates) = 'array' AND jsonb_array_length(p_price_updates) > 0 THEN
    FOR v_pu_elem IN SELECT * FROM jsonb_array_elements(p_price_updates)
    LOOP
      v_pu_oi_id := (v_pu_elem->>'order_item_id')::UUID;
      v_pu_new_price := (v_pu_elem->>'new_unit_price')::INTEGER;

      SELECT * INTO v_pu_oi FROM public.order_items WHERE id = v_pu_oi_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '要調價的品項不存在';
      END IF;

      IF v_pu_new_price < 0 THEN
        RAISE EXCEPTION '新單價不可為負數';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.sales_note_items sni
        WHERE sni.sales_note_id = p_sales_note_id AND sni.order_item_id = v_pu_oi_id
      ) THEN
        RAISE EXCEPTION '要調價的品項不屬於此銷貨單';
      END IF;

      v_pu_old_price := v_pu_oi.unit_price;

      v_other_notes := (
        SELECT jsonb_agg(jsonb_build_object(
          'sales_note_id', sni.sales_note_id,
          'code', sn.code,
          'paid', (sn.payment_status IN ('paid', 'partial'))
        ))
        FROM public.sales_note_items sni
        JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
        WHERE sni.order_item_id = v_pu_oi_id
          AND sni.sales_note_id <> p_sales_note_id
      );

      SELECT sn.code, sn.payment_status
      INTO v_pu_order_code, v_pu_oi.consignment_mode
      FROM public.sales_notes sn
      WHERE sn.id IN (
        SELECT sni.sales_note_id
        FROM public.sales_note_items sni
        WHERE sni.order_item_id = v_pu_oi_id
          AND sni.sales_note_id <> p_sales_note_id
      )
      LIMIT 1;

      v_price_updates_result := v_price_updates_result || jsonb_build_object(
        'order_item_id', v_pu_oi_id,
        'order_code', v_pu_order_code,
        'old_unit_price', v_pu_old_price,
        'new_unit_price', v_pu_new_price,
        'other_affected_sales_notes', v_other_notes
      );

      UPDATE public.order_items
      SET unit_price = v_pu_new_price, updated_at = NOW()
      WHERE id = v_pu_oi_id;
    END LOOP;
  END IF;

  -- Phase 5: 收斂
  IF NOT EXISTS (
    SELECT 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id
  ) THEN
    UPDATE public.sales_notes SET status = 'shipped' WHERE id = p_sales_note_id;
  END IF;

  UPDATE public.sales_notes SET updated_at = NOW() WHERE id = p_sales_note_id;

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

  v_result := jsonb_build_object(
    'ok', true,
    'removed_qty', v_removed_qty,
    'added_qty', v_added_qty,
    'new_items_qty', v_new_items_qty,
    'affected_order_ids', v_affected_order_ids,
    'price_updates', v_price_updates_result
  );

  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------
-- 5. delete_sales_note：sign-aware 逆轉退貨列（負數量）
--    （基底：20260916000001_fix_sales_note_deletion_merge.sql + 20260916000005 防呆）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_sales_note(
  p_sales_note_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item RECORD;
  v_new_shipped int;
  v_total_quantity int;
  v_order_ids UUID[] := '{}';
  v_pool_quantity int;
  v_own_warehouse_id UUID;
  v_consignment_wh_id UUID;
  v_is_consignment BOOLEAN;
  v_source_type TEXT;
  v_owner TEXT;
  v_sn_status TEXT;
  v_sn_code TEXT;
  v_abs_qty INTEGER;
  v_is_return_line BOOLEAN;
BEGIN
  SELECT status, code INTO v_sn_status, v_sn_code FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;

  IF v_sn_status = 'received' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單已收貨，無法刪除', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'label', '已收貨狀態')));
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

  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';
  SELECT id INTO v_consignment_wh_id FROM public.warehouses WHERE code = 'supplier_consignment';

  FOR v_item IN
    SELECT si.order_item_id, si.quantity, si.inventory_source_type,
           oi.quantity AS total_quantity,
           oi.shipped_quantity, oi.order_id, oi.product_id, oi.variant_id, oi.line_type,
           oi.return_status
    FROM public.sales_note_items si
    JOIN public.order_items oi ON si.order_item_id = oi.id
    WHERE si.sales_note_id = p_sales_note_id
  LOOP
    IF NOT (v_item.order_id = ANY(v_order_ids)) THEN
      v_order_ids := array_append(v_order_ids, v_item.order_id);
    END IF;

    v_abs_qty := ABS(v_item.quantity);
    v_is_return_line := (v_item.line_type = 'return');

    v_new_shipped := GREATEST(0, v_item.shipped_quantity - v_abs_qty);
    v_total_quantity := v_item.total_quantity;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped,
        status = CASE
                    WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                    WHEN v_new_shipped < v_total_quantity THEN 'partial'::order_item_status
                    ELSE 'shipped'::order_item_status
                 END,
        return_status = CASE WHEN v_is_return_line THEN 'pending'::text ELSE return_status END,
        line_note = CASE WHEN v_is_return_line
                         THEN regexp_replace(COALESCE(line_note, ''), '(；)?(退貨出貨入庫|出貨退回入庫)$', '')
                         ELSE line_note END
    WHERE id = v_item.order_item_id;

    v_is_consignment := v_item.inventory_source_type IN ('supplier_consignment', 'store_consignment')
      OR EXISTS (
        SELECT 1 FROM public.consignment_sales cs
        WHERE cs.order_item_id = v_item.order_item_id
          AND cs.sales_note_id = p_sales_note_id
          AND NOT cs.reversed
      );

    IF v_is_consignment THEN
      UPDATE public.consignment_sales
      SET reversed = true
      WHERE order_item_id = v_item.order_item_id
        AND sales_note_id = p_sales_note_id
        AND NOT reversed;

      IF v_item.inventory_source_type = 'store_consignment' THEN
        v_source_type := 'consignment_shipment_reversal';
        v_owner := 'store_consignment';
      ELSE
        v_source_type := 'consignment_sale_reversal';
        v_owner := 'supplier_consignment';
      END IF;

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, consignment_order_id, consignment_order_item_id,
        inventory_owner, reference_code, created_by
      )
      SELECT
        v_item.product_id, v_item.variant_id,
        CASE WHEN v_item.inventory_source_type = 'store_consignment'
             THEN v_own_warehouse_id ELSE v_consignment_wh_id END,
        v_item.quantity, v_source_type,
        p_sales_note_id, m.consignment_order_id, m.consignment_order_item_id,
        v_owner, v_sn_code, NULL
      FROM public.inventory_movements m
      WHERE m.sales_note_id = p_sales_note_id
        AND m.consignment_order_item_id IS NOT NULL
        AND m.product_id = v_item.product_id
        AND m.variant_id IS NOT DISTINCT FROM v_item.variant_id
      LIMIT 1;

      CONTINUE;
    END IF;

    -- 庫存逆轉：一般列 +abs（出貨扣回的）、退貨列 -abs（回補扣回的）→ 直接以 signed quantity
    PERFORM public.upsert_sales_note_deletion_movement(
      p_sales_note_id, v_item.order_item_id, v_item.product_id, v_item.variant_id,
      v_own_warehouse_id, CASE WHEN v_is_return_line THEN -v_abs_qty ELSE v_abs_qty END,
      v_sn_code, NULL
    );

    SELECT quantity INTO v_pool_quantity
    FROM public.shipping_pool WHERE order_item_id = v_item.order_item_id;

    IF FOUND THEN
      UPDATE public.shipping_pool
      SET quantity = v_pool_quantity + v_abs_qty
      WHERE order_item_id = v_item.order_item_id;
    ELSE
      INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
      SELECT v_item.order_item_id, v_abs_qty, o.store_id, o.created_by
      FROM public.orders o WHERE o.id = v_item.order_id;
    END IF;
  END LOOP;

  DELETE FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id;
  DELETE FROM public.sales_notes WHERE id = p_sales_note_id;

  UPDATE public.orders o
  SET status = 'processing'
  WHERE o.id = ANY(v_order_ids)
    AND o.status = 'shipped'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_items oi2
      WHERE oi2.order_id = o.id
        AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
    );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ------------------------------------------------------------
-- 權限：重發的函式維持既有安全性（SECURITY DEFINER 對外一致）
--   CREATE OR REPLACE 保留既有權限；此處明示 REVOKE/GRANT 與全站慣例一致。
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_sales_note(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_sales_note(uuid) TO authenticated;