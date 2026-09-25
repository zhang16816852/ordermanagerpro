-- 20260924000009：修正 create_order_with_sales_note 建立退貨列時未寫 return_status，
-- 導致 INSERT order_items 違反 chk_order_item_return_status_scope（退貨列 return_status 不得為 NULL）。
-- 於 INSERT 補上 return_status：退貨列用 payload 提供的值（缺省 'pending'），非退貨列維持 NULL。
-- 20260924000008 已套用遠端；本檔僅重發該函式（CREATE OR REPLACE，簽名不變，前端零改動）。

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
      line_type, line_note, return_status, is_repair
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
      CASE WHEN v_line_type = 'return'
           THEN COALESCE(NULLIF(v_item->>'return_status', ''), 'pending')
           ELSE NULL END,
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

REVOKE ALL ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;