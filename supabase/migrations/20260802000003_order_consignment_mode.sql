-- ============================================================
-- 訂單 → 出貨池 → 銷售 / 寄賣（整單單一模式）
-- 1. orders 加 consignment_mode（true = 整單以寄賣方式出貨）
-- 2. consignment_orders 加 source_order_id（連結來源訂單，供 find-or-create）
-- 3. 新增 helper：create_consignment_shipment_layer
--    —— 針對一張 sales_note 中屬於 consignment_mode 訂單的品項，
--       同步建立寄賣中間層（consignment_order + consignment_order_items +
--       consignment_out_shipment movement，owner=store_consignment）
-- 4. 改寫 ship_from_pool / direct_ship_order / create_order_with_sales_note
--    —— consignment 品項改寫 store_consignment 來源，不出扣自有庫存、
--       改由 helper 建立寄賣異動；後續回報/審核/結算/退回沿用既有機制
-- ============================================================

-- ============================================================
-- 1. orders.consignment_mode
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS consignment_mode BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 2. consignment_orders.source_order_id
-- ============================================================
ALTER TABLE public.consignment_orders
  ADD COLUMN IF NOT EXISTS source_order_id UUID REFERENCES public.orders(id);

CREATE INDEX IF NOT EXISTS idx_consignment_orders_source_order
  ON public.consignment_orders(source_order_id);

-- ============================================================
-- 3. helper：create_consignment_shipment_layer
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_consignment_shipment_layer(
  p_sales_note_id UUID,
  p_warehouse_id UUID,
  p_created_by UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_rec RECORD;
  v_co_id UUID;
  v_coi_id UUID;
  v_sn_code TEXT;
BEGIN
  SELECT code INTO v_sn_code FROM public.sales_notes WHERE id = p_sales_note_id;

  FOR v_rec IN
    SELECT sni.order_item_id, sni.quantity,
           oi.product_id, oi.variant_id, oi.unit_price, oi.store_id, oi.order_id,
           oo.consignment_mode
    FROM public.sales_note_items sni
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    JOIN public.orders oo ON oo.id = oi.order_id
    WHERE sni.sales_note_id = p_sales_note_id
  LOOP
    CONTINUE WHEN NOT v_rec.consignment_mode;

    SELECT id INTO v_co_id FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND store_id = v_rec.store_id
      AND source_order_id = v_rec.order_id
      AND status IN ('draft', 'active')
    LIMIT 1;

    IF v_co_id IS NULL THEN
      INSERT INTO public.consignment_orders (direction, store_id, status, created_by, source_order_id)
      VALUES ('send_to_store', v_rec.store_id, 'draft', p_created_by, v_rec.order_id)
      RETURNING id INTO v_co_id;
    END IF;

    INSERT INTO public.consignment_order_items (
      consignment_order_id, product_id, variant_id, quantity, unit_price, unit_cost
    )
    VALUES (v_co_id, v_rec.product_id, v_rec.variant_id, v_rec.quantity, v_rec.unit_price, 0)
    RETURNING id INTO v_coi_id;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      sales_note_id, consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_rec.product_id, v_rec.variant_id, p_warehouse_id, -v_rec.quantity, 'consignment_out_shipment',
      p_sales_note_id, v_co_id, v_coi_id, v_sn_code, 'store_consignment', p_created_by
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 4a. ship_from_pool：逐項依所屬訂單 consignment_mode 分流
-- ============================================================
CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids UUID[],
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_warehouse_map JSONB DEFAULT '{}',
  p_source_map JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_store_id UUID;
  v_sales_note_id UUID;
  v_access_token UUID;
  v_item RECORD;
  v_new_shipped_qty INTEGER;
  v_new_status public.order_item_status;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_result JSONB;
  v_sn_code TEXT;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_shipped_at TIMESTAMPTZ;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_access_token := gen_random_uuid();

    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
    VALUES (v_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
    RETURNING id, code INTO v_sales_note_id, v_sn_code;

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

      IF v_item.consignment_mode THEN
        INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
        VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity, 'store_consignment');
      ELSE
        INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
        VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity, v_source);

        IF v_source = 'self' THEN
          INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
          VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_item.quantity, 'sales_shipment', v_sales_note_id, v_sn_code, p_created_by);
        ELSE
          PERFORM public.allocate_inventory(
            v_item.product_id, v_item.variant_id, v_item.quantity, v_source, NULL,
            v_sales_note_id, v_item.order_item_id, v_sn_code, v_item.unit_price, p_created_by
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

    PERFORM public.create_consignment_shipment_layer(v_sales_note_id, v_default_warehouse_id, p_created_by);

    v_result := v_result || jsonb_build_object(
      'store_id', v_store_id,
      'sales_note_id', v_sales_note_id,
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
-- 4b. direct_ship_order：整單依 consignment_mode 分流
-- ============================================================
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

    IF v_order.consignment_mode THEN
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (v_sales_note_id, v_item.id, v_remaining_qty, 'store_consignment');
    ELSE
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
    END IF;

    v_new_shipped_qty := v_item.shipped_quantity + v_remaining_qty;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped_qty,
        status = 'shipped',
        updated_at = NOW()
    WHERE id = v_item.id;
  END LOOP;

  IF v_order.consignment_mode THEN
    PERFORM public.create_consignment_shipment_layer(v_sales_note_id, v_default_warehouse_id, p_created_by);
  END IF;

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
-- 4c. create_order_with_sales_note：新增 p_consignment_mode
-- ============================================================
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
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_access_token := gen_random_uuid();

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped', p_consignment_mode)
  RETURNING id, code INTO v_order_id, v_order_code;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (p_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

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

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
    VALUES (v_sales_note_id, v_order_item_id, v_quantity, v_source);

    IF p_consignment_mode THEN
      CONTINUE;
    END IF;

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

  IF p_consignment_mode THEN
    PERFORM public.create_consignment_shipment_layer(v_sales_note_id, v_default_warehouse_id, p_created_by);
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
