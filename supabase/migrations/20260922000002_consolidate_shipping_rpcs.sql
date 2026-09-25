-- ============================================================
-- 20260922000002_consolidate_shipping_rpcs.sql
-- 配送解析邏輯抽出共用 helper `_resolve_delivery`
--   * 收斂 4 支出貨 RPC 內聯重複的三塊邏輯：
--       ① 方法驗證＋快照（type/name/code/price/cost）
--       ② 類型推導 delivery_type := COALESCE(p_delivery_type, 方法type, 'delivery')
--       ③ delivery 類型未指定方法時套用「預設送貨方法」快照
--   * helper 為內部函式（SECURITY DEFINER、REVOKE public/anon/authenticated），
--     僅供 4 支 RPC 內部呼叫，不直接對外開放
--   * 行為完全等價：簽名不變、更新語意不變（包裹建置/地址/追蹤/純寄賣層轉接照舊）
--   * ship_from_pool 的多店 override 仍由呼叫端先行解析 override 類型後再傳入 helper
--     （第 3 參數 p_use_method_type_fallback=false 對齊其「不回退方法類型」的行為）
-- ⚠️ 僅 CREATE OR REPLACE（簽名與 20260922000001 相同），不新增 overload
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. 共用 helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._resolve_delivery(
  p_delivery_type text DEFAULT NULL,
  p_delivery_method_id uuid DEFAULT NULL,
  p_use_method_type_fallback boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_snap RECORD;
  v_type TEXT;
  v_method_id UUID;
  v_method_title TEXT;
  v_method_code TEXT;
  v_method_price NUMERIC;
  v_method_cost NUMERIC;
  v_default_method_id UUID;
BEGIN
  v_method_id := NULL;

  -- ① 方法驗證＋快照
  IF p_delivery_method_id IS NOT NULL THEN
    SELECT type, name, code, price, cost INTO v_snap
    FROM public.delivery_methods WHERE id = p_delivery_method_id AND is_active;
    IF v_snap.name IS NULL THEN
      RAISE EXCEPTION '配送方式不存在或已停用（id %）', p_delivery_method_id;
    END IF;
    v_method_id := p_delivery_method_id;
    v_method_title := v_snap.name;
    v_method_code := v_snap.code;
    v_method_price := v_snap.price;
    v_method_cost := v_snap.cost;
  END IF;

  -- ② 類型推導
  IF p_use_method_type_fallback THEN
    v_type := COALESCE(p_delivery_type, v_snap.type, 'delivery');
  ELSE
    v_type := COALESCE(p_delivery_type, 'delivery');
  END IF;

  -- ③ delivery：未指定方法時套用預設送貨方法快照
  IF v_type = 'delivery' AND v_method_id IS NULL THEN
    SELECT id INTO v_default_method_id FROM public.delivery_methods
    WHERE type = 'delivery' AND is_default AND is_active
    ORDER BY sort_order, created_at LIMIT 1;
    IF v_default_method_id IS NOT NULL THEN
      SELECT type, name, code, price, cost INTO v_snap
      FROM public.delivery_methods WHERE id = v_default_method_id;
      v_method_id := v_default_method_id;
      v_method_title := v_snap.name;
      v_method_code := v_snap.code;
      v_method_price := v_snap.price;
      v_method_cost := v_snap.cost;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'delivery_type', v_type,
    'method_id', v_method_id,
    'method_title', v_method_title,
    'method_code', v_method_code,
    'method_price', v_method_price,
    'method_cost', v_method_cost
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._resolve_delivery(text, uuid, boolean) FROM public;
REVOKE ALL ON FUNCTION public._resolve_delivery(text, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public._resolve_delivery(text, uuid, boolean) FROM authenticated;

COMMENT ON FUNCTION public._resolve_delivery IS '內部共用：解析配送「類型＋方法快照」；僅供出貨 RPC 呼叫，不對外開放';

-- ------------------------------------------------------------
-- 2. create_consignment_shipment_layer（14 參數，簽名不變）
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
           o.code AS order_code
    INTO v_oi
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = v_order_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_item 不存在：%', v_order_item_id;
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

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_oi.product_id, v_oi.variant_id, v_warehouse_id, -v_qty, 'consignment_out_shipment',
      v_co_id, v_coi_id, v_oi.order_code, 'store_consignment', p_created_by
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
-- 3. create_order_with_sales_note（15 參數，簽名不變）
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

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, unit_cost, selected_model_name,
      shipping_payment, shipped_quantity, status
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
      'shipped'
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
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_product_id, v_variant_id, COALESCE((v_item->>'warehouse_id')::UUID, v_default_warehouse_id), -v_quantity, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
-- 4. direct_ship_order（15 參數，簽名不變）
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
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, order_item_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_remaining_qty, 'sales_shipment', v_sales_note_id, v_item.id, v_sales_note_code, p_created_by);
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
-- 5. ship_from_pool（17 參數，簽名不變）
--    多店 override：每店先解析 override 類型再傳 helper；
--    第三參數 false＝類型不回退方法類型（對齊原 COALESCE(v_override_type, p_delivery_type)）
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
          INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, order_item_id, reference_code, created_by)
          VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_item.quantity, 'sales_shipment', v_sales_note_id, v_item.order_item_id, v_sales_note_code, p_created_by);
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
    SELECT bool_and(oi.shipped_quantity >= oi.quantity OR oi.status IN ('cancelled', 'discontinued'))
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
-- 6. 權限：4 支 RPC 維持 authenticated EXECUTE；helper 不對外
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;