-- ============================================================
-- 店家寄賣模型修正 v1.3：
--   「出貨不開銷貨單、確認賣掉才開銷貨單」
-- 1. 店家寄賣出貨（獨立單 / 訂單轉寄賣）不再建立 sales_note：
--    - create_consignment_shipment：只建來源 order + movements，不開銷貨單，
--      回填 source_order_id、寄賣單轉 active
--    - create_consignment_shipment_layer：改收 p_order_items JSONB，
--      不再依賴 sales_note_items；修「出貨後仍顯示草稿」bug（出貨即 active）
--    - ship_from_pool / direct_ship_order / create_order_with_sales_note：
--      寄賣品項不進 sales_note，改呼叫新 layer
-- 2. 統一性：所有 send_to_store 寄賣單都須有 source_order_id
--    （A/B 路徑＝原訂單；C 路徑＝出貨時補 order）
-- 3. 店家確認收貨：consignment_orders 加 received_at/received_by +
--    confirm_consignment_receipt；report_consignment_sale 需先收貨
-- 4. 確認賣掉才開銷貨單：confirm_consignment_sales 審核通過後，
--    依店家批次自動開立收款銷貨單（status='received'）
-- 5. 新增 report_consignment_sale_by_product（全品項檢視，跨單 FIFO）
-- 6. Backfill：既有「已出貨但顯示草稿」與「缺 source_order_id」的寄賣單
-- ============================================================

-- ============================================================
-- 1. consignment_orders 加收貨欄位
-- ============================================================
ALTER TABLE public.consignment_orders
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE public.consignment_orders
  ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES auth.users(id);

-- ============================================================
-- 2. 重寫 create_consignment_shipment（獨立寄賣單出貨）
--    建來源 order + order_items + movements；不開銷貨單；回填 source_order_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_order_id UUID;
  v_order_code TEXT;
  v_item RECORD;
  v_ship_qty INTEGER;
  v_oi_id UUID;
  v_own_wh UUID;
  v_result JSONB;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '此寄賣單非店家方向，無法出貨';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '寄賣單狀態不允許出貨';
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  -- 補 order：獨立寄賣單出貨時建立來源訂單（統一 source_order_id）
  IF v_order.source_order_id IS NULL THEN
    INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
    VALUES (v_order.store_id, p_created_by, COALESCE(p_notes, v_order.note), 'consignment', 'shipped', true)
    RETURNING id, code INTO v_order_id, v_order_code;

    UPDATE public.consignment_orders
    SET source_order_id = v_order_id, updated_at = NOW()
    WHERE id = p_consignment_order_id;
  ELSE
    SELECT id, code INTO v_order_id, v_order_code
    FROM public.orders WHERE id = v_order.source_order_id;
  END IF;

  FOR v_item IN
    SELECT s.consignment_order_item_id, s.unit_price,
           s.order_quantity - s.shipped_quantity AS remaining,
           coi.product_id, coi.variant_id
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
  LOOP
    v_ship_qty := v_item.remaining;
    CONTINUE WHEN v_ship_qty <= 0;

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, shipped_quantity, status
    )
    VALUES (
      v_order_id, v_item.product_id, v_item.variant_id, v_order.store_id,
      v_ship_qty, v_item.unit_price, v_ship_qty, 'shipped'
    )
    RETURNING id INTO v_oi_id;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_item.product_id, v_item.variant_id, v_own_wh, -v_ship_qty, 'consignment_out_shipment',
      p_consignment_order_id, v_item.consignment_order_item_id,
      v_order_code, 'store_consignment', p_created_by
    );
  END LOOP;

  UPDATE public.consignment_orders
  SET status = 'active', updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';

  v_result := jsonb_build_object(
    'consignment_order_id', p_consignment_order_id,
    'order_id', v_order_id,
    'order_code', v_order_code
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 3. 重寫 create_consignment_shipment_layer
--    簽名：create_consignment_shipment_layer(p_order_items JSONB, p_warehouse_id, p_created_by)
--    p_order_items = [{"order_item_id", "quantity"}]
--    出貨即建寄賣單並轉 active（修草稿 bug）
-- ============================================================
DROP FUNCTION IF EXISTS public.create_consignment_shipment_layer(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.create_consignment_shipment_layer(
  p_order_items JSONB,
  p_warehouse_id UUID,
  p_created_by UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_rec JSONB;
  v_order_item_id UUID;
  v_qty INTEGER;
  v_oi RECORD;
  v_co_id UUID;
  v_coi_id UUID;
BEGIN
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_order_items)
  LOOP
    v_order_item_id := (v_rec->>'order_item_id')::UUID;
    v_qty := (v_rec->>'quantity')::INTEGER;
    CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;

    SELECT oi.product_id, oi.variant_id, oi.unit_price, oi.store_id, oi.order_id,
           o.code AS order_code
    INTO v_oi
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = v_order_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_item 不存在：%', v_order_item_id;
    END IF;

    SELECT id INTO v_co_id FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND store_id = v_oi.store_id
      AND source_order_id = v_oi.order_id
      AND status IN ('draft', 'active')
    LIMIT 1;

    IF v_co_id IS NULL THEN
      INSERT INTO public.consignment_orders (direction, store_id, status, created_by, source_order_id)
      VALUES ('send_to_store', v_oi.store_id, 'active', p_created_by, v_oi.order_id)
      RETURNING id INTO v_co_id;
    ELSE
      UPDATE public.consignment_orders
      SET status = 'active', updated_at = NOW()
      WHERE id = v_co_id AND status = 'draft';
    END IF;

    INSERT INTO public.consignment_order_items (
      consignment_order_id, product_id, variant_id, quantity, unit_price, unit_cost
    )
    VALUES (v_co_id, v_oi.product_id, v_oi.variant_id, v_qty, v_oi.unit_price, 0)
    RETURNING id INTO v_coi_id;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_oi.product_id, v_oi.variant_id, p_warehouse_id, -v_qty, 'consignment_out_shipment',
      v_co_id, v_coi_id, v_oi.order_code, 'store_consignment', p_created_by
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 4. ship_from_pool：寄賣品項不進 sales_note，改收集後呼叫新 layer
--    sales_note 懶建立（有一般品項才建）
-- ============================================================
CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids UUID[],
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_warehouse_map JSONB DEFAULT '{}',
  p_source_map JSONB DEFAULT '{}',
  p_consignment_override_map JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
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
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_sales_note_id := NULL;
    v_sales_note_code := NULL;
    v_access_token := NULL;
    v_consignment_items := '[]'::JSONB;

    FOR v_item IN
      SELECT sp.id AS pool_id, sp.order_item_id, sp.quantity, sp.store_id,
             sp.warehouse_id AS pool_warehouse_id,
             oi.quantity AS total_qty, oi.shipped_quantity AS current_shipped,
             oi.order_id, oi.product_id, oi.variant_id, oi.unit_price,
             oo.consignment_mode
      FROM public.shipping_pool sp
      JOIN public.order_items oi ON oi.id = sp.order_item_id
      JOIN public.orders oo ON oo.id = oi.order_id
      WHERE sp.store_id = v_store_id
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

      IF v_is_consignment THEN
        v_consignment_items := v_consignment_items || jsonb_build_object(
          'order_item_id', v_item.order_item_id,
          'quantity', v_item.quantity
        );
      ELSE
        IF v_sales_note_id IS NULL THEN
          v_access_token := gen_random_uuid();
          INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
          VALUES (v_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
          RETURNING id, code INTO v_sales_note_id, v_sales_note_code;
        END IF;

        INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
        VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity, v_source);

        IF v_source = 'self' THEN
          INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
          VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_item.quantity, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
      PERFORM public.create_consignment_shipment_layer(v_consignment_items, v_default_warehouse_id, p_created_by);
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
$$;

-- ============================================================
-- 5. direct_ship_order：寄賣模式不開銷貨單，走新 layer
--    移除全部舊 overloads，重建單一 canonical 簽名（含逐項倉庫/庫存來源）
-- ============================================================
DROP FUNCTION IF EXISTS public.direct_ship_order(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.direct_ship_order(uuid, uuid, text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.direct_ship_order(uuid, uuid, text, timestamp with time zone, uuid);
DROP FUNCTION IF EXISTS public.direct_ship_order(uuid, uuid, text, timestamp with time zone, uuid, jsonb);
DROP FUNCTION IF EXISTS public.direct_ship_order(uuid, uuid, text, timestamp with time zone, uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.direct_ship_order(
  p_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_warehouse_map JSONB DEFAULT '{}',
  p_source_map JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;

  IF v_order.status NOT IN ('processing', 'pending') THEN
    RAISE EXCEPTION '僅能對處理中或待確認的訂單執行轉銷貨單';
  END IF;

  -- 寄賣模式：不開銷貨單，逐項標 shipped + 建立寄賣層
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
    END LOOP;

    IF jsonb_array_length(v_consignment_items) > 0 THEN
      PERFORM public.create_consignment_shipment_layer(v_consignment_items, v_default_warehouse_id, p_created_by);
    END IF;

    UPDATE public.orders
    SET status = 'shipped', updated_at = NOW()
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

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (v_order.store_id, p_created_by, 'shipped', v_shipped_at, v_sn_notes, v_access_token, v_default_warehouse_id)
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
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_remaining_qty, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
  END LOOP;

  UPDATE public.orders
  SET status = 'shipped', updated_at = NOW()
  WHERE id = p_order_id;

  v_result := jsonb_build_object(
    'sales_note_id', v_sales_note_id,
    'sales_note_code', v_sales_note_code,
    'access_token', v_access_token
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 6. create_order_with_sales_note：寄賣模式不開銷貨單，走新 layer
--    移除全部舊 overloads，重建單一 canonical 簽名（含 p_consignment_mode）
-- ============================================================
DROP FUNCTION IF EXISTS public.create_order_with_sales_note(uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamp with time zone);
DROP FUNCTION IF EXISTS public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamp with time zone, uuid);
DROP FUNCTION IF EXISTS public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamp with time zone, uuid, boolean);

CREATE OR REPLACE FUNCTION public.create_order_with_sales_note(
  p_store_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_consignment_mode BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
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
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped', p_consignment_mode)
  RETURNING id, code INTO v_order_id, v_order_code;

  IF NOT p_consignment_mode THEN
    v_access_token := gen_random_uuid();
    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
    VALUES (p_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
    RETURNING id, code INTO v_sales_note_id, v_sales_note_code;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    v_source := COALESCE(v_item->>'inventory_source_type', 'self');
    IF p_consignment_mode THEN
      v_source := 'store_consignment';
    END IF;
    v_item_warehouse_id := COALESCE(
      (v_item->>'warehouse_id')::UUID,
      v_default_warehouse_id
    );

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, store_id,
      quantity, unit_price, selected_model_name,
      shipped_quantity, status
    )
    VALUES (
      v_order_id,
      v_product_id,
      v_variant_id,
      p_store_id,
      v_quantity,
      (v_item->>'unit_price')::NUMERIC,
      (v_item->>'selected_model_name'),
      v_quantity,
      'shipped'
    )
    RETURNING id INTO v_order_item_id;

    IF p_consignment_mode THEN
      v_consignment_items := v_consignment_items || jsonb_build_object(
        'order_item_id', v_order_item_id,
        'quantity', v_quantity
      );
      CONTINUE;
    END IF;

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sales_note_id, v_order_item_id, v_quantity, v_source);

    IF v_source = 'self' THEN
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_product_id, v_variant_id, v_item_warehouse_id, -v_quantity, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
    ELSE
      PERFORM public.allocate_inventory(
        v_product_id, v_variant_id, v_quantity, v_source, NULL,
        v_sales_note_id, v_order_item_id, v_sales_note_code,
        (v_item->>'unit_price')::NUMERIC, p_created_by
      );
    END IF;
  END LOOP;

  IF p_consignment_mode AND jsonb_array_length(v_consignment_items) > 0 THEN
    PERFORM public.create_consignment_shipment_layer(v_consignment_items, v_default_warehouse_id, p_created_by);
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
$$;

-- ============================================================
-- 7. confirm_consignment_sales：審核確認後，依店家開立收款銷貨單
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_consignment_sales(
  p_report_ids UUID[],
  p_confirmed_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_report_id UUID;
  v_report RECORD;
  v_available INTEGER;
  v_count INTEGER := 0;
  v_store_loop RECORD;
  v_sale RECORD;
  v_order_id UUID;
  v_order_code TEXT;
  v_sn_id UUID;
  v_sn_code TEXT;
  v_oi_id UUID;
  v_own_wh UUID;
BEGIN
  FOREACH v_report_id IN ARRAY p_report_ids LOOP
    SELECT r.*, co.direction, coi.unit_price AS default_price, coi.unit_cost
    INTO v_report
    FROM public.consignment_sales_reports r
    JOIN public.consignment_orders co ON co.id = r.consignment_order_id
    JOIN public.consignment_order_items coi ON coi.id = r.consignment_order_item_id
    WHERE r.id = v_report_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '回報單不存在：%', v_report_id;
    END IF;
    IF v_report.status <> 'pending' THEN
      RAISE EXCEPTION '回報單已處理：%', v_report_id;
    END IF;
    IF v_report.direction <> 'send_to_store' THEN
      RAISE EXCEPTION '僅店家方向回報需要審核';
    END IF;

    SELECT
      s.shipped_quantity - s.sold_quantity - s.returned_from_store
      - COALESCE((
          SELECT SUM(pr.quantity) FROM public.consignment_sales_reports pr
          WHERE pr.consignment_order_item_id = v_report.consignment_order_item_id
            AND pr.status = 'pending' AND pr.id <> v_report.id
        ), 0)
    INTO v_available
    FROM public.consignment_order_item_summary s
    WHERE s.consignment_order_item_id = v_report.consignment_order_item_id;

    IF v_report.quantity > v_available THEN
      RAISE EXCEPTION '可確認數量不足（可確認 %，回報 %）', v_available, v_report.quantity;
    END IF;

    INSERT INTO public.consignment_sales (
      consignment_order_id, consignment_order_item_id, direction, source_type,
      report_id, quantity, unit_price, unit_cost, created_by
    )
    VALUES (
      v_report.consignment_order_id, v_report.consignment_order_item_id,
      'send_to_store', 'store_report', v_report.id,
      v_report.quantity, COALESCE(v_report.sale_price, v_report.default_price),
      v_report.unit_cost, p_confirmed_by
    );

    UPDATE public.consignment_sales_reports
    SET status = 'confirmed', confirmed_by = p_confirmed_by, confirmed_at = NOW()
    WHERE id = v_report_id;

    v_count := v_count + 1;
  END LOOP;

  -- 依店家開立收款銷貨單（確認賣掉的部分）
  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';

  FOR v_store_loop IN
    SELECT r.store_id,
           COALESCE(string_agg(DISTINCT co.code, '、'), '') AS order_codes
    FROM public.consignment_sales_reports r
    JOIN public.consignment_orders co ON co.id = r.consignment_order_id
    WHERE r.id = ANY(p_report_ids) AND r.status = 'confirmed'
    GROUP BY r.store_id
  LOOP
    INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
    VALUES (
      v_store_loop.store_id, p_confirmed_by,
      CASE WHEN v_store_loop.order_codes <> '' THEN '寄賣售出：' || v_store_loop.order_codes ELSE NULL END,
      'consignment', 'shipped', false
    )
    RETURNING id, code INTO v_order_id, v_order_code;

    INSERT INTO public.sales_notes (
      store_id, created_by, status, shipped_at, received_at, received_by, notes, access_token, warehouse_id
    )
    VALUES (
      v_store_loop.store_id, p_confirmed_by, 'received', NOW(), NOW(), p_confirmed_by,
      '寄賣售出確認收款單：' || v_order_code, gen_random_uuid(), v_own_wh
    )
    RETURNING id, code INTO v_sn_id, v_sn_code;

    FOR v_sale IN
      SELECT r.id AS report_id, r.consignment_order_item_id, r.quantity,
             COALESCE(r.sale_price, coi.unit_price) AS unit_price
      FROM public.consignment_sales_reports r
      JOIN public.consignment_order_items coi ON coi.id = r.consignment_order_item_id
      WHERE r.id = ANY(p_report_ids)
        AND r.status = 'confirmed'
        AND r.store_id = v_store_loop.store_id
    LOOP
      INSERT INTO public.order_items (
        order_id, product_id, variant_id, store_id, quantity, unit_price, shipped_quantity, status
      )
      SELECT v_order_id, coi.product_id, coi.variant_id, v_store_loop.store_id,
             v_sale.quantity, v_sale.unit_price, v_sale.quantity, 'shipped'
      FROM public.consignment_order_items coi
      WHERE coi.id = v_sale.consignment_order_item_id
      RETURNING id INTO v_oi_id;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (v_sn_id, v_oi_id, v_sale.quantity, 'store_consignment');

      UPDATE public.consignment_sales
      SET sales_note_id = v_sn_id, order_item_id = v_oi_id
      WHERE report_id = v_sale.report_id AND sales_note_id IS NULL;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================
-- 8. confirm_consignment_receipt：店家確認收貨
-- ============================================================
CREATE OR REPLACE FUNCTION public.confirm_consignment_receipt(
  p_consignment_order_id UUID,
  p_received_by UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '僅店家方向寄賣單可確認收貨';
  END IF;
  IF v_order.received_at IS NOT NULL THEN
    RAISE EXCEPTION '此寄賣單已確認收貨';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.consignment_order_id = p_consignment_order_id
      AND m.source_type = 'consignment_out_shipment'
  ) THEN
    RAISE EXCEPTION '此寄賣單尚未出貨，無法確認收貨';
  END IF;

  UPDATE public.consignment_orders
  SET received_at = NOW(), received_by = p_received_by, updated_at = NOW()
  WHERE id = p_consignment_order_id;
END;
$$;

-- ============================================================
-- 9. report_consignment_sale：send_to_store 需先確認收貨
-- ============================================================
CREATE OR REPLACE FUNCTION public.report_consignment_sale(
  p_consignment_order_item_id UUID,
  p_quantity INTEGER,
  p_sale_price NUMERIC DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_available INTEGER;
  v_report_id UUID;
BEGIN
  SELECT co.id AS order_id, co.direction, co.status, co.store_id, co.received_at
  INTO v_order
  FROM public.consignment_order_items coi
  JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
  WHERE coi.id = p_consignment_order_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣商品不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '此寄賣單非店家方向，無法回報銷售';
  END IF;
  IF v_order.status NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION '寄賣單狀態不允許回報';
  END IF;
  IF v_order.received_at IS NULL THEN
    RAISE EXCEPTION '尚未確認收貨，無法回報銷售';
  END IF;
  IF p_created_by IS NOT NULL AND NOT public.is_store_member(p_created_by, v_order.store_id) THEN
    RAISE EXCEPTION '非門市成員，無法回報銷售';
  END IF;

  SELECT
    s.shipped_quantity - s.sold_quantity - s.returned_from_store
    - COALESCE((
        SELECT SUM(pr.quantity) FROM public.consignment_sales_reports pr
        WHERE pr.consignment_order_item_id = p_consignment_order_item_id AND pr.status = 'pending'
      ), 0)
  INTO v_available
  FROM public.consignment_order_item_summary s
  WHERE s.consignment_order_item_id = p_consignment_order_item_id;

  IF p_quantity > v_available THEN
    RAISE EXCEPTION '可回報數量不足（可回報 %，回報 %）', v_available, p_quantity;
  END IF;

  INSERT INTO public.consignment_sales_reports (
    consignment_order_id, consignment_order_item_id, store_id,
    quantity, sale_price, note, created_by
  )
  VALUES (
    v_order.order_id, p_consignment_order_item_id, v_order.store_id,
    p_quantity, p_sale_price, p_note, p_created_by
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- ============================================================
-- 10. report_consignment_sale_by_product：全品項檢視，跨寄賣單 FIFO
-- ============================================================
CREATE OR REPLACE FUNCTION public.report_consignment_sale_by_product(
  p_store_id UUID,
  p_product_id UUID,
  p_quantity INTEGER,
  p_variant_id UUID DEFAULT NULL,
  p_sale_price NUMERIC DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_remaining INTEGER;
  v_item RECORD;
  v_take INTEGER;
  v_total INTEGER := 0;
  v_report_id UUID;
BEGIN
  IF p_created_by IS NOT NULL AND NOT public.is_store_member(p_created_by, p_store_id) THEN
    RAISE EXCEPTION '非門市成員，無法回報銷售';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION '回報數量需大於 0';
  END IF;

  v_remaining := p_quantity;

  FOR v_item IN
    SELECT coi.id AS item_id, coi.consignment_order_id, co.id AS order_id,
           s.shipped_quantity - s.sold_quantity - s.returned_from_store
             - COALESCE((
                 SELECT SUM(pr.quantity) FROM public.consignment_sales_reports pr
                 WHERE pr.consignment_order_item_id = coi.id AND pr.status = 'pending'
               ), 0) AS available
    FROM public.consignment_order_items coi
    JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
    JOIN public.consignment_order_item_summary s ON s.consignment_order_item_id = coi.id
    WHERE co.direction = 'send_to_store'
      AND co.store_id = p_store_id
      AND co.status IN ('active', 'settled')
      AND co.received_at IS NOT NULL
      AND coi.product_id = p_product_id
      AND coi.variant_id IS NOT DISTINCT FROM p_variant_id
    ORDER BY coi.created_at ASC, coi.id ASC
  LOOP
    CONTINUE WHEN v_remaining <= 0;
    CONTINUE WHEN v_item.available <= 0;

    v_take := LEAST(v_remaining, v_item.available);

    INSERT INTO public.consignment_sales_reports (
      consignment_order_id, consignment_order_item_id, store_id,
      quantity, sale_price, note, created_by
    )
    VALUES (
      v_item.order_id, v_item.item_id, p_store_id,
      v_take, p_sale_price, p_note, p_created_by
    )
    RETURNING id INTO v_report_id;

    v_remaining := v_remaining - v_take;
    v_total := v_total + v_take;
  END LOOP;

  IF v_total = 0 THEN
    RAISE EXCEPTION '此商品可回報數量不足';
  END IF;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION '可回報數量不足（缺 % 件）', v_remaining;
  END IF;

  RETURN v_total;
END;
$$;

-- ============================================================
-- 11. Backfill：統一 source_order_id + 修「出貨後仍顯示草稿」
-- ============================================================
DO $$
DECLARE
  v_rec RECORD;
  v_item RECORD;
  v_order_id UUID;
  v_fallback_user UUID;
BEGIN
  SELECT id INTO v_fallback_user FROM auth.users ORDER BY created_at ASC LIMIT 1;
  IF v_fallback_user IS NULL THEN
    RAISE EXCEPTION '找不到可用使用者（auth.users 為空）';
  END IF;

  -- 所有 active/settled 但缺 source_order_id 的 send_to_store 寄賣單 → 補來源訂單
  -- （含尚未出貨的：建立來源訂單但無 order_items；已出貨的：依出貨量補 order_items）
  FOR v_rec IN
    SELECT co.id, co.store_id, co.note, COALESCE(co.created_by, v_fallback_user) AS created_by
    FROM public.consignment_orders co
    WHERE co.direction = 'send_to_store'
      AND co.source_order_id IS NULL
      AND co.status IN ('active', 'settled')
  LOOP
    INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
    VALUES (v_rec.store_id, v_rec.created_by, v_rec.notes, 'consignment', 'shipped', true)
    RETURNING id INTO v_order_id;

    FOR v_item IN
      SELECT coi.product_id, coi.variant_id, coi.unit_price,
             COALESCE(s.shipped_quantity, 0) AS shipped_qty
      FROM public.consignment_order_items coi
      LEFT JOIN public.consignment_order_item_summary s ON s.consignment_order_item_id = coi.id
      WHERE coi.consignment_order_id = v_rec.id
    LOOP
      CONTINUE WHEN v_item.shipped_qty <= 0;
      INSERT INTO public.order_items (
        order_id, product_id, variant_id, store_id, quantity, unit_price, shipped_quantity, status
      )
      VALUES (
        v_order_id, v_item.product_id, v_item.variant_id, v_rec.store_id,
        v_item.shipped_qty, v_item.unit_price, v_item.shipped_qty, 'shipped'
      );
    END LOOP;

    UPDATE public.consignment_orders
    SET source_order_id = v_order_id, updated_at = NOW()
    WHERE id = v_rec.id;
  END LOOP;

  -- 已出貨但顯示草稿 → active
  UPDATE public.consignment_orders co
  SET status = 'active', updated_at = NOW()
  WHERE co.direction = 'send_to_store'
    AND co.status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.inventory_movements m
      WHERE m.consignment_order_id = co.id
        AND m.source_type = 'consignment_out_shipment'
    );
END $$;

-- ============================================================
-- 12. 完整性守門員：非草稿/取消的 send_to_store 寄賣單須有 source_order_id
-- ============================================================
ALTER TABLE public.consignment_orders
  DROP CONSTRAINT IF EXISTS chk_consignment_send_to_store_source_order;

ALTER TABLE public.consignment_orders
  ADD CONSTRAINT chk_consignment_send_to_store_source_order
  CHECK (
    direction <> 'send_to_store'
    OR status IN ('draft', 'cancelled')
    OR source_order_id IS NOT NULL
  );
