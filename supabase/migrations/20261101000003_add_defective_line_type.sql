-- ============================================================
-- 20261101000003_add_defective_line_type.sql
-- 新增 'defective'（瑕疵）line_type，合併至 direct ship 流程
--
-- 變更：
-- 1) order_items.line_type CHECK 約束加 'defective'
-- 2) direct_ship_order：瑕疵列 → defective warehouse + return_status='exchange'
-- 3) process_order_return_lines：接受 'defective'（fallback，瑕疵走 stock 動作路由到 defective 倉）
-- ============================================================

-- ------------------------------------------------------------
-- 1. CHECK 約束：加 'defective'
-- ------------------------------------------------------------
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS chk_order_item_line_type;

ALTER TABLE public.order_items
  ADD CONSTRAINT chk_order_item_line_type
    CHECK (line_type IN ('sale', 'exchange', 'return', 'defective'));

-- ------------------------------------------------------------
-- 2. direct_ship_order：瑕疵列走退貨迴圈（defective warehouse）
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
  v_return_wh UUID;
  v_is_defective BOOLEAN;
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
        AND oi.line_type NOT IN ('return', 'defective')
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

    v_is_defective := (v_item.line_type = 'defective');

    IF v_item.line_type IN ('return', 'defective') THEN
      -- 退貨/瑕疵列：負數量明細＋回補倉庫存
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type)
      VALUES (v_sales_note_id, v_item.id, -v_remaining_qty, v_source);

      IF v_source = 'self' THEN
        -- 瑕疵品 → defective warehouse；退貨 → own warehouse
        v_return_wh := CASE WHEN v_is_defective
                            THEN (SELECT id FROM public.warehouses WHERE code = 'defective')
                            ELSE v_item_warehouse_id END;
        PERFORM public._receive_return_to_stock(
          v_item.product_id, v_item.variant_id, v_return_wh, v_remaining_qty,
          v_sales_note_id, v_item.id, v_sales_note_code, p_created_by,
          CASE WHEN v_is_defective THEN '訂單瑕疵出貨' ELSE '訂單退貨出貨' END
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
        return_status = CASE
          WHEN v_item.line_type = 'return' AND return_status = 'pending' THEN 'stock'
          WHEN v_item.line_type = 'defective' AND return_status = 'pending' THEN 'exchange'
          ELSE return_status
        END,
        line_note = CASE
          WHEN v_item.line_type = 'return' AND return_status = 'pending'
            THEN COALESCE(line_note, '') || CASE WHEN COALESCE(line_note, '') = '' THEN '' ELSE '；' END || '退貨出貨入庫'
          WHEN v_item.line_type = 'defective' AND return_status = 'pending'
            THEN COALESCE(line_note, '') || CASE WHEN COALESCE(line_note, '') = '' THEN '' ELSE '；' END || '瑕疵出貨入庫'
          ELSE line_note
        END,
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
-- 3. process_order_return_lines：接受 'defective' line type
--    瑕疵品走 stock 動作時路由到 defective 倉 + 退款
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_order_return_lines(
  p_line_ids UUID[],
  p_action TEXT DEFAULT 'stock',
  p_warehouse_id UUID DEFAULT NULL,
  p_refund_account_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_uid UUID := COALESCE(p_created_by, auth.uid());
  v_line RECORD;
  v_order_ids UUID[];
  v_processed INT := 0;
  v_total_refund NUMERIC := 0;
  v_refund_by_order JSONB := '{}';
  v_own_wh UUID;
  v_defective_wh UUID;
  v_repair_wh UUID;
  v_label TEXT;
  v_entry_id UUID;
  v_store_name TEXT;
  v_desc TEXT;
  v_order_id UUID;
  v_order_code TEXT;
  v_amount NUMERIC;
  v_is_defective BOOLEAN;
  v_target_wh UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '未登入');
  END IF;

  IF NOT has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可處理退貨');
  END IF;

  IF p_line_ids IS NULL OR array_length(p_line_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '未指定退貨品項');
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('stock', 'exchange', 'repaired') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '處理動作必須為 stock / exchange / repaired');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    WHERE oi.line_type NOT IN ('return', 'defective')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '選取範圍包含非退貨列的品項');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    WHERE oi.return_status <> 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '選取範圍包含已處理的退貨品項');
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own' AND is_active LIMIT 1;
  SELECT id INTO v_defective_wh FROM public.warehouses WHERE code = 'defective' AND is_active LIMIT 1;
  SELECT id INTO v_repair_wh FROM public.warehouses WHERE code = 'repair' AND is_active LIMIT 1;

  IF v_own_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到自有倉');
  END IF;

  IF p_action = 'exchange' AND v_defective_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到瑕疵倉');
  END IF;

  IF p_action = 'repaired' AND v_repair_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到送修倉');
  END IF;

  IF p_action = 'stock' AND p_warehouse_id IS NULL THEN
    p_warehouse_id := v_own_wh;
  END IF;

  IF p_action = 'stock' AND NOT EXISTS (
    SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id AND is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '指定的倉庫不存在或已停用');
  END IF;

  IF p_refund_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_refund_account_id AND is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '指定的退款帳戶不存在或已停用');
  END IF;

  IF p_category_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.accounting_categories WHERE id = p_category_id AND is_active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '指定的會計分類不存在或已停用');
  END IF;

  IF p_category_id IS NULL AND p_action IN ('stock', 'exchange') AND v_total_refund > 0 THEN
    SELECT id INTO p_category_id FROM public.accounting_categories
    WHERE name = '客戶退貨退款' AND type = 'expense' AND is_active
    LIMIT 1;
    IF p_category_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', '找不到「客戶退貨退款」會計分類（請先於會計分類建立）');
    END IF;
  END IF;

  v_label := CASE p_action
    WHEN 'stock' THEN '退庫存'
    WHEN 'exchange' THEN '換貨'
    ELSE '送修歸還'
  END;

  FOR v_line IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           oi.line_type, o.store_id, o.code AS order_code
    FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    JOIN public.orders o ON o.id = oi.order_id
    ORDER BY lid
  LOOP
    v_is_defective := (v_line.line_type = 'defective');

    IF p_action = 'stock' THEN
      -- 瑕疵品路由到 defective warehouse；退貨路由到指定/own warehouse
      v_target_wh := CASE WHEN v_is_defective THEN v_defective_wh ELSE COALESCE(p_warehouse_id, v_own_wh) END;
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, order_item_id, inventory_owner, reference_code, note, created_by
      ) VALUES (
        v_line.product_id, v_line.variant_id, v_target_wh, v_line.quantity, 0,
        'customer_return', v_line.id, 'self', v_line.order_code,
        CASE WHEN v_is_defective THEN '瑕疵品退回' ELSE '客戶退貨' END || COALESCE(NULLIF(p_description, ''), ''),
        v_uid
      );
    ELSIF p_action = 'exchange' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, order_item_id, inventory_owner, reference_code, note, created_by
      ) VALUES (
        v_line.product_id, v_line.variant_id, v_defective_wh, v_line.quantity, 0,
        'customer_return', v_line.id, 'self', v_line.order_code,
        '換貨退回瑕疵品' || COALESCE(NULLIF(p_description, ''), ''), v_uid
      );
    ELSIF p_action = 'repaired' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, order_item_id, inventory_owner, reference_code, note, created_by
      ) VALUES (
        v_line.product_id, v_line.variant_id, v_repair_wh, v_line.quantity, 0,
        'customer_return', v_line.id, 'self', v_line.order_code,
        '送修退回' || COALESCE(NULLIF(p_description, ''), ''), v_uid
      );
    END IF;

    -- 退款：stock 動作一律退款；exchange 動作僅瑕疵品退款
    IF p_action = 'stock' OR (p_action = 'exchange' AND v_is_defective) THEN
      v_total_refund := v_total_refund + COALESCE(v_line.unit_price, 0) * v_line.quantity;
      v_refund_by_order := jsonb_set(
        v_refund_by_order,
        ARRAY[v_line.order_id::text],
        to_jsonb(
          COALESCE((v_refund_by_order->>v_line.order_id::text)::numeric, 0)
          + COALESCE(v_line.unit_price, 0) * v_line.quantity
        )
      );
    END IF;

    UPDATE public.order_items
    SET return_status = p_action::text,
        line_note = CASE
          WHEN line_note IS NULL OR line_note = '' THEN '已' || v_label
          ELSE line_note || '｜已' || v_label
        END,
        updated_at = NOW()
    WHERE id = v_line.id;

    v_processed := v_processed + 1;
  END LOOP;

  -- 退款分錄：stock 動作 或 exchange+瑕疵品
  IF v_total_refund > 0 AND p_refund_account_id IS NOT NULL THEN
    SELECT st.name INTO v_store_name
    FROM public.stores st
    WHERE st.id = (SELECT store_id FROM public.orders WHERE id = (SELECT order_id FROM public.order_items WHERE id = p_line_ids[1]));

    v_desc := COALESCE(NULLIF(p_description, ''), 
      CASE WHEN p_action = 'exchange' THEN '客戶瑕疵品退款' ELSE '客戶退貨退款' END);

    INSERT INTO public.accounting_entries (
      type, account_id, category_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, counterparty_name, transaction_date, created_by
    ) VALUES (
      'expense', p_refund_account_id, p_category_id, v_total_refund, v_total_refund, 'paid',
      v_desc, 'order', (SELECT order_id FROM public.order_items WHERE id = p_line_ids[1]),
      v_store_name, CURRENT_DATE, v_uid
    ) RETURNING id INTO v_entry_id;

    FOREACH v_order_id IN ARRAY (SELECT ARRAY_AGG(DISTINCT order_id) FROM public.order_items WHERE id = ANY(p_line_ids)) LOOP
      v_amount := COALESCE((v_refund_by_order->>v_order_id::text)::numeric, 0);
      CONTINUE WHEN v_amount <= 0;
      SELECT code INTO v_order_code FROM public.orders WHERE id = v_order_id;
      INSERT INTO public.accounting_entry_references (
        entry_id, reference_type, reference_id, item_name, amount_applied
      ) VALUES (
        v_entry_id, 'order', v_order_id,
        CASE WHEN p_action = 'exchange' THEN '瑕疵品退款' ELSE '退貨退款' END || '（' || COALESCE(v_order_code, '') || '）',
        v_amount
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'action', p_action,
    'total_refund', v_total_refund
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.process_order_return_lines(UUID[], TEXT, UUID, UUID, UUID, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_order_return_lines(UUID[], TEXT, UUID, UUID, UUID, TEXT, UUID) TO authenticated;