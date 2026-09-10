-- 修正銷貨單品項排序：ship_from_pool 出貨時寫入 sni.sort_order，查詢改用 sni.sort_order

-- 1. get_shared_sales_note_details：ORDER BY 改用 sni.sort_order（出貨順序）為主
CREATE OR REPLACE FUNCTION public.get_shared_sales_note_details(
  p_identifier TEXT,
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid_id UUID;
  v_result JSONB;
BEGIN
  BEGIN
    v_uuid_id := p_identifier::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uuid_id := NULL;
  END;

  SELECT jsonb_build_object(
    'sales_note', (
      SELECT jsonb_build_object(
        'id', sn.id,
        'code', sn.code,
        'created_at', sn.created_at,
        'shipped_at', sn.shipped_at,
        'status', sn.status,
        'notes', sn.notes,
        'store_name', s.name,
        'access_token', sn.access_token
      )
      FROM public.sales_notes sn
      JOIN public.stores s ON s.id = sn.store_id
      WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
      AND sn.access_token = p_token::UUID
    ),
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_name', p.name,
          'variant_name', pv.name,
          'quantity', sni.quantity,
          'unit_price', oi.unit_price,
          'sort_order', COALESCE(sni.sort_order, 0),
          'item_type', p.item_type,
          'parent_order_item_id', oi.parent_order_item_id,
          'shipping_payment', oi.shipping_payment
        )
        ORDER BY COALESCE(sni.sort_order, 0), oi.sort_order, oi.created_at
      )
      FROM public.sales_note_items sni
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
      WHERE sni.sales_note_id IN (
        SELECT sn.id FROM public.sales_notes sn
        WHERE (sn.id = v_uuid_id OR sn.code = p_identifier)
        AND sn.access_token = p_token::UUID
      )
    )
  ) INTO v_result;

  IF (v_result->'sales_note') IS NULL OR (v_result->'sales_note') = 'null'::jsonb THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_shared_sales_note_details(TEXT, TEXT) TO authenticated;

-- 2. ship_from_pool：pool items 加 ORDER BY + 寫入 sni.sort_order
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
  v_sort_counter INTEGER;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  v_result := '[]'::JSONB;

  FOR v_store_id IN SELECT unnest(p_store_ids) LOOP
    v_sales_note_id := NULL;
    v_sales_note_code := NULL;
    v_access_token := NULL;
    v_consignment_items := '[]'::JSONB;
    v_sort_counter := 0;

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
      SET shipped_quantity = v_new_shipped_qty, status = v_new_status
      WHERE id = v_item.order_item_id;

      IF NOT (v_affected_order_ids @> ARRAY[v_item.order_id]) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_item.order_id);
      END IF;
    END LOOP;

    -- 處理寄賣品項
    IF jsonb_array_length(v_consignment_items) > 0 THEN
      PERFORM public.create_consignment_shipment_layer(
        v_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes
      );
    END IF;

    -- 收斂訂單狀態
    IF v_sales_note_id IS NOT NULL THEN
      FOR v_order_id IN SELECT unnest(v_affected_order_ids) LOOP
        SELECT bool_and(oi.shipped_quantity >= oi.quantity)
        INTO v_all_shipped
        FROM public.order_items oi
        WHERE oi.order_id = v_order_id;

        UPDATE public.orders
        SET status = CASE WHEN v_all_shipped THEN 'shipped'::public.order_status ELSE 'processing'::public.order_status END
        WHERE id = v_order_id;
      END LOOP;

      v_result := v_result || jsonb_build_object(
        'sales_note_id', v_sales_note_id,
        'sales_note_code', v_sales_note_code,
        'store_id', v_store_id,
        'access_token', v_access_token
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.ship_from_pool(UUID[], UUID, TEXT, TIMESTAMPTZ, UUID, JSONB, JSONB, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.ship_from_pool(UUID[], UUID, TEXT, TIMESTAMPTZ, UUID, JSONB, JSONB, JSONB) TO authenticated;
