-- 修復：create_consignment_shipment_layer 的配送/包裹資訊只落到最後一筆寄賣單
-- 根因：v_co_id 在迴圈中被覆寫，配送 UPDATE 僅作用於最後一個 v_co_id
-- 修法：收集所有 v_co_id，迴圈結束後逐一套用配送/包裹資訊

CREATE OR REPLACE FUNCTION public.create_consignment_shipment_layer(
  p_store_id uuid,
  p_created_by uuid,
  p_order_items jsonb,
  p_shipped_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_notes text DEFAULT NULL::text,
  p_warehouse_id uuid DEFAULT NULL::uuid,
  p_delivery_method_id uuid DEFAULT NULL::uuid,
  p_shipping_fee numeric DEFAULT NULL::numeric,
  p_shipping_address jsonb DEFAULT NULL::jsonb,
  p_delivery_type text DEFAULT NULL::text,
  p_shipping_cost numeric DEFAULT NULL::numeric,
  p_tracking_company text DEFAULT NULL::text,
  p_tracking_number text DEFAULT NULL::text,
  p_tracking_url text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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
  v_co_ids UUID[] := '{}';
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

    -- repair-skip guard
    PERFORM 1 FROM public.order_items oi WHERE oi.id = v_order_item_id AND oi.line_type = 'exchange' AND oi.is_repair;
    IF FOUND THEN
      RAISE EXCEPTION '送修列不支援寄賣路徑：%', v_order_item_id;
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

    -- 收集所有 v_co_id（去重）
    IF NOT (v_co_id = ANY(v_co_ids)) THEN
      v_co_ids := v_co_ids || v_co_id;
    END IF;

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

  -- 套用配送/包裹資訊到所有建立/啟用的寄賣單
  IF v_co_count > 0 THEN
    IF v_delivery_type = 'logistics' AND p_delivery_method_id IS NOT NULL THEN
      FOR v_co_id IN SELECT unnest(v_co_ids) LOOP
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
      END LOOP;
    ELSIF v_delivery_type = 'delivery' THEN
      FOR v_co_id IN SELECT unnest(v_co_ids) LOOP
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
      END LOOP;
    ELSIF v_delivery_type = 'pickup' THEN
      FOR v_co_id IN SELECT unnest(v_co_ids) LOOP
        UPDATE public.consignment_orders SET delivery_type = v_delivery_type, updated_at = NOW() WHERE id = v_co_id;
      END LOOP;
    END IF;
  END IF;
END;
$function$;

-- 權限設定
REVOKE ALL ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;