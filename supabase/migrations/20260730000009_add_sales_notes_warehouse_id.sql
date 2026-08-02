-- ============================================================
-- Add warehouse_id to sales_notes so delete_sales_note can
-- restore inventory back to the original warehouse.
-- Update 3 shipping RPCs to save the warehouse on creation.
-- ============================================================

-- ============================================================
-- 1. Add column to sales_notes
-- ============================================================

ALTER TABLE public.sales_notes
ADD COLUMN warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

-- ============================================================
-- 2. ship_from_pool — save warehouse_id on sales_note
-- ============================================================

CREATE OR REPLACE FUNCTION public.ship_from_pool(
  p_store_ids UUID[],
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL
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
  v_warehouse_id UUID;
  v_shipped_at TIMESTAMPTZ;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_access_token := gen_random_uuid();

    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
    VALUES (v_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_warehouse_id)
    RETURNING id, code INTO v_sales_note_id, v_sn_code;

    FOR v_item IN
      SELECT sp.id AS pool_id, sp.order_item_id, sp.quantity, sp.store_id,
             oi.quantity AS total_qty, oi.shipped_quantity AS current_shipped,
             oi.order_id, oi.product_id, oi.variant_id
      FROM public.shipping_pool sp
      JOIN public.order_items oi ON oi.id = sp.order_item_id
      WHERE sp.store_id = v_store_id
    LOOP
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
      VALUES (v_sales_note_id, v_item.order_item_id, v_item.quantity);

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

      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, v_warehouse_id, -v_item.quantity, 'sales_shipment', v_sales_note_id, v_sn_code, p_created_by);

      IF NOT (v_item.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_item.order_id);
      END IF;

      INSERT INTO public.audit_logs (entity_type, entity_id, action, performed_by, store_id, old_value, new_value)
      VALUES ('order_item', v_item.order_item_id, 'shipped_quantity_updated', p_created_by, v_store_id,
        jsonb_build_object('shipped_quantity', v_item.current_shipped),
        jsonb_build_object('shipped_quantity', v_new_shipped_qty, 'status', v_new_status::text));
    END LOOP;

    DELETE FROM public.shipping_pool WHERE store_id = v_store_id;

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
-- 3. direct_ship_order — save warehouse_id on sales_note
-- ============================================================

CREATE OR REPLACE FUNCTION public.direct_ship_order(
  p_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL
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
  v_warehouse_id UUID;
  v_shipped_at TIMESTAMPTZ;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

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
  VALUES (v_order.store_id, p_created_by, 'shipped', v_shipped_at, v_sn_notes, v_access_token, v_warehouse_id)
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

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
    VALUES (v_sales_note_id, v_item.id, v_remaining_qty);

    v_new_shipped_qty := v_item.shipped_quantity + v_remaining_qty;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped_qty,
        status = 'shipped',
        updated_at = NOW()
    WHERE id = v_item.id;

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
    VALUES (v_item.product_id, v_item.variant_id, v_warehouse_id, -v_remaining_qty, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
-- 4. create_order_with_sales_note — save warehouse_id on sales_note
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_order_with_sales_note(
  p_store_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  v_result JSONB;
  v_warehouse_id UUID;
  v_shipped_at TIMESTAMPTZ;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_access_token := gen_random_uuid();

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped')
  RETURNING id, code INTO v_order_id, v_order_code;

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (p_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_warehouse_id)
  RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;

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

    INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity)
    VALUES (v_sales_note_id, v_order_item_id, v_quantity);

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
    VALUES (v_product_id, v_variant_id, v_warehouse_id, -v_quantity, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
  END LOOP;

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
-- 5. delete_sales_note — prefer sales_notes.warehouse_id
--    Priority: p_warehouse_id > sales_note's saved warehouse > own
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_sales_note(
  p_sales_note_id UUID,
  p_warehouse_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item RECORD;
  v_new_shipped int;
  v_total_quantity int;
  v_order_ids UUID[] := '{}';
  v_pool_quantity int;
  v_warehouse_id UUID;
BEGIN
  v_warehouse_id := COALESCE(
    p_warehouse_id,
    (SELECT sn.warehouse_id FROM public.sales_notes sn WHERE sn.id = p_sales_note_id),
    (SELECT id FROM public.warehouses WHERE code = 'own')
  );

  IF EXISTS (SELECT 1 FROM public.sales_notes WHERE id = p_sales_note_id AND status = 'received') THEN
    RAISE EXCEPTION '無法刪除已收貨的銷貨單';
  END IF;

  FOR v_item IN
    SELECT si.order_item_id, si.quantity, oi.quantity AS total_quantity,
           oi.shipped_quantity, oi.order_id, oi.product_id, oi.variant_id
    FROM public.sales_note_items si
    JOIN public.order_items oi ON si.order_item_id = oi.id
    WHERE si.sales_note_id = p_sales_note_id
  LOOP
    IF NOT (v_item.order_id = ANY(v_order_ids)) THEN
      v_order_ids := array_append(v_order_ids, v_item.order_id);
    END IF;

    v_new_shipped := GREATEST(0, v_item.shipped_quantity - v_item.quantity);
    v_total_quantity := v_item.total_quantity;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped,
        status = CASE
                    WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                    WHEN v_new_shipped < v_total_quantity THEN 'partial'::order_item_status
                    ELSE 'shipped'::order_item_status
                 END
    WHERE id = v_item.order_item_id;

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, created_by)
    VALUES (v_item.product_id, v_item.variant_id, v_warehouse_id, v_item.quantity, 'sales_note_deletion', p_sales_note_id, NULL);

    SELECT quantity INTO v_pool_quantity
    FROM public.shipping_pool WHERE order_item_id = v_item.order_item_id;

    IF FOUND THEN
      UPDATE public.shipping_pool
      SET quantity = v_pool_quantity + v_item.quantity
      WHERE order_item_id = v_item.order_item_id;
    ELSE
      INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
      SELECT v_item.order_item_id, v_item.quantity, o.store_id, o.created_by
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
END;
$$;
