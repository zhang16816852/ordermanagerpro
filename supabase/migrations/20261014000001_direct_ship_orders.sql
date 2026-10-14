-- 批次直接轉銷貨單：將「同一店家的多張訂單」合併為「一張銷貨單」
-- 需求：在訂單列表勾選多張同店家訂單執行「轉銷貨單」時，應只產生單一銷貨單，
--       而非每張訂單各一張。沿用 direct_ship_order 的單筆邏輯，改以店家分組。
-- 行為：一般訂單 → 每店家一張 sales_notes（品項跨訂單合併）；
--       寄賣訂單 → 每店家一次 create_consignment_shipment_layer 呼叫（layer 內部仍逐來源訂單建立寄賣單）。
-- 零前端破壞：direct_ship_order 維持不動；新增 direct_ship_orders 供列表批次使用。

CREATE OR REPLACE FUNCTION public.direct_ship_orders(
  p_order_ids uuid[],
  p_created_by uuid,
  p_notes text DEFAULT NULL::text,
  p_shipped_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_warehouse_id uuid DEFAULT NULL::uuid,
  p_warehouse_map jsonb DEFAULT '{}'::jsonb,
  p_source_map jsonb DEFAULT '{}'::jsonb,
  p_delivery_method_id uuid DEFAULT NULL::uuid,
  p_shipping_fee numeric DEFAULT NULL::numeric,
  p_shipping_address jsonb DEFAULT NULL::jsonb,
  p_delivery_type text DEFAULT NULL::text,
  p_shipping_cost numeric DEFAULT NULL::numeric,
  p_tracking_company text DEFAULT NULL::text,
  p_tracking_number text DEFAULT NULL::text,
  p_tracking_url text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order_ids uuid[];
  v_order_id uuid;
  v_store RECORD;
  v_order RECORD;
  v_item RECORD;
  v_sales_note_id UUID;
  v_sales_note_code TEXT;
  v_access_token UUID;
  v_remaining_qty INTEGER;
  v_new_shipped_qty INTEGER;
  v_sn_notes TEXT;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_shipped_at TIMESTAMPTZ;
  v_consignment_items JSONB;
  v_delivery_type TEXT;
  v_delivery JSONB;
  v_sales_notes JSONB := '[]'::JSONB;
  v_has_sales_note BOOLEAN;
BEGIN
  IF p_order_ids IS NULL OR array_length(p_order_ids, 1) IS NULL THEN
    RAISE EXCEPTION '未選擇訂單';
  END IF;

  -- 去重（保留首次出現順序）
  v_order_ids := (
    SELECT array_agg(x ORDER BY ord)
    FROM (
      SELECT DISTINCT ON (x) x, ord
      FROM unnest(p_order_ids) WITH ORDINALITY AS t(x, ord)
      ORDER BY x, ord
    ) s
  );

  -- 驗證每張訂單存在且狀態可出貨
  FOREACH v_order_id IN ARRAY v_order_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_order_id) THEN
      RAISE EXCEPTION '訂單不存在: %', v_order_id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = ANY(v_order_ids) AND status NOT IN ('processing', 'pending')
  ) THEN
    RAISE EXCEPTION '僅能對處理中或待確認的訂單執行轉銷貨單';
  END IF;

  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));
  v_delivery := public._resolve_delivery(p_delivery_type, p_delivery_method_id);
  v_delivery_type := v_delivery->>'delivery_type';

  -- 依店家分組處理
  FOR v_store IN
    SELECT DISTINCT o.store_id FROM public.orders o WHERE o.id = ANY(v_order_ids) ORDER BY o.store_id
  LOOP
    -- ===== 寄賣訂單：整併為單一次 layer 呼叫 =====
    v_consignment_items := '[]'::JSONB;
    FOR v_order IN
      SELECT * FROM public.orders o
      WHERE o.id = ANY(v_order_ids) AND o.store_id = v_store.store_id AND o.consignment_mode
    LOOP
      FOR v_item IN
        SELECT oi.id, oi.quantity, oi.shipped_quantity
        FROM public.order_items oi
        WHERE oi.order_id = v_order.id
          AND oi.status NOT IN ('cancelled', 'discontinued')
          AND oi.line_type <> 'return'
        ORDER BY oi.sort_order, oi.created_at
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
    END LOOP;

    IF jsonb_array_length(v_consignment_items) > 0 THEN
      PERFORM public.create_consignment_shipment_layer(
        v_store.store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes,
        v_default_warehouse_id, p_delivery_method_id, p_shipping_fee, p_shipping_address,
        v_delivery_type, p_shipping_cost, p_tracking_company, p_tracking_number, p_tracking_url
      );
    END IF;

    -- ===== 一般訂單：合併為單一張銷貨單 =====
    v_has_sales_note := EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = ANY(v_order_ids) AND o.store_id = v_store.store_id
        AND COALESCE(o.consignment_mode, false) = false
    );

    IF v_has_sales_note THEN
      v_access_token := gen_random_uuid();

      v_sn_notes := (
        SELECT string_agg(DISTINCT o.notes, ' | ')
        FROM public.orders o
        WHERE o.id = ANY(v_order_ids) AND o.store_id = v_store.store_id
          AND COALESCE(o.consignment_mode, false) = false
          AND o.notes IS NOT NULL AND o.notes <> ''
      );
      IF p_notes IS NOT NULL AND p_notes <> '' THEN
        v_sn_notes := CASE WHEN v_sn_notes IS NOT NULL THEN v_sn_notes || ' | ' || p_notes ELSE p_notes END;
      END IF;

      INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id, delivery_type)
      VALUES (v_store.store_id, p_created_by, 'shipped', v_shipped_at, v_sn_notes, v_access_token, v_default_warehouse_id, v_delivery_type)
      RETURNING id, code INTO v_sales_note_id, v_sales_note_code;

      FOR v_item IN
        SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.shipped_quantity,
               oi.unit_price, oi.selected_model_name, oi.store_id, oi.line_type, oi.return_status
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE oi.order_id = ANY(v_order_ids) AND o.store_id = v_store.store_id
          AND COALESCE(o.consignment_mode, false) = false
          AND oi.status NOT IN ('cancelled', 'discontinued')
        ORDER BY oi.order_id, oi.sort_order, oi.created_at
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

      -- 銷貨單配送快照
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
      ELSIF v_delivery_type = 'delivery' THEN
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

      v_sales_notes := v_sales_notes || jsonb_build_object(
        'sales_note_id', v_sales_note_id,
        'sales_note_code', v_sales_note_code,
        'store_id', v_store.store_id,
        'access_token', v_access_token
      );
    END IF;

    -- ===== 訂單層配送快照（含寄賣訂單，逐店整批） =====
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
    WHERE id = ANY(v_order_ids) AND store_id = v_store.store_id;
  END LOOP;

  RETURN jsonb_build_object(
    'order_ids', to_jsonb(v_order_ids),
    'sales_notes', v_sales_notes
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.direct_ship_orders(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.direct_ship_orders(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;
