-- ============================================================
-- 出貨池逐項寄賣 override + 寄賣層判據統一
-- 1. ship_from_pool 新增 p_consignment_override_map（order_item_id → boolean）
--    讓一般訂單可在出貨池「逐項」轉寄賣出貨（不必改整單 consignment_mode）
-- 2. 移除 ship_from_pool 全部舊 overloads，重建單一 canonical 簽名
--    （避免 overload 併存造成 named-notation 42725 歧義）
-- 3. create_consignment_shipment_layer 改依 sales_note_items.inventory_source_type
--    判斷是否建寄賣層（原依 orders.consignment_mode，逐項 override 時會漏建）
-- ============================================================

-- ============================================================
-- 1. 移除 ship_from_pool 舊 overloads
-- ============================================================
DROP FUNCTION IF EXISTS public.ship_from_pool(uuid[], uuid, text);
DROP FUNCTION IF EXISTS public.ship_from_pool(uuid[], uuid, text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.ship_from_pool(uuid[], uuid, text, timestamp with time zone, uuid);
DROP FUNCTION IF EXISTS public.ship_from_pool(uuid[], uuid, text, timestamp with time zone, uuid, jsonb);
DROP FUNCTION IF EXISTS public.ship_from_pool(uuid[], uuid, text, timestamp with time zone, uuid, jsonb, jsonb);

-- ============================================================
-- 2. ship_from_pool：單一 canonical 簽名（含逐項寄賣 override）
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
  v_is_consignment BOOLEAN;
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

      -- 逐項寄賣 override：map 有該 order_item_id 時以 override 為準，否則回歸訂單模式
      v_is_consignment := CASE
        WHEN p_consignment_override_map ? v_item.order_item_id::TEXT
          THEN COALESCE((p_consignment_override_map->>v_item.order_item_id::TEXT)::BOOLEAN, v_item.consignment_mode)
        ELSE v_item.consignment_mode
      END;

      IF v_is_consignment THEN
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
-- 3. create_consignment_shipment_layer：改依 inventory_source_type 判斷
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
    SELECT sni.order_item_id, sni.quantity, sni.inventory_source_type,
           oi.product_id, oi.variant_id, oi.unit_price, oi.store_id, oi.order_id
    FROM public.sales_note_items sni
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    WHERE sni.sales_note_id = p_sales_note_id
  LOOP
    CONTINUE WHEN NOT (v_rec.inventory_source_type = 'store_consignment');

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
