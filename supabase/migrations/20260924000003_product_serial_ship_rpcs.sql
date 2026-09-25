-- ============================================================
-- 20260924000003_product_serial_ship_rpcs.sql
-- 產品「批號追蹤」第二階段：把批次/序號接進庫存流。
--
--   * receive_purchase_items：尾端加 p_lots（jsonb，DEFAULT NULL）——
--     tracking_mode='serial' 的變體收貨時必須帶每個序號（一機一號）；
--     tracking_mode='batch' 可帶批次（batch_number + quantity）。
--     序號/批次逐一建立 product_batches 並以「逐批 movement +1」入庫
--     （batch_id 寫進 inventory_movements），由 trigger 同時更新
--     product_inventory 與 product_batch_inventory。
--   * 4 支出貨 RPC：self 來源的 movement INSERT 一律改呼叫共用
--     `_ship_stock_movements`（FIFO 拆批；不足時以一般 movement 補足）。
--   * 還原路徑（delete_sales_note / correct_sales_note /
--     reverse_consignment_shipment）：還原 movement 依原出貨批次
--     （batch_id＋倉位）逐一寫回，product_batch_inventory 由 trigger/helper 同步。
--
-- ⚠️ 簽名慣例：直接「DROP 舊簽名」再 CREATE（receive_purchase_items 加參數），
--    其餘函式僅 CREATE OR REPLACE（簽名不變，使用 had 內僅改 body）。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. receive_purchase_items（p_lots jsonb DEFAULT NULL）
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_purchase_items(jsonb, uuid);

CREATE OR REPLACE FUNCTION public.receive_purchase_items(
  p_items JSONB,
  p_warehouse_id UUID DEFAULT NULL,
  p_lots JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_received_qty INTEGER;
  v_po_id UUID;
  v_po_code TEXT;
  v_item_warehouse_id UUID;
  v_default_warehouse_id UUID;
  v_po_ids UUID[];
  v_all_received BOOLEAN;
  v_any_received BOOLEAN;
  v_mode TEXT;
  v_lot JSONB;
  v_has_lot BOOLEAN;
  v_po_item_cost NUMERIC := 0;
  v_serial_list JSONB;
  v_serial_elem TEXT;
  v_batch_number TEXT;
  v_batch_unit_cost NUMERIC := 0;
  v_batch_id UUID;
  v_created_by UUID;
BEGIN
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));
  v_po_ids := '{}';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_received_qty := (v_item->>'received_quantity')::INTEGER;
    v_po_id := (v_item->>'purchase_order_id')::UUID;
    v_po_code := v_item->>'purchase_order_code';
    v_item_warehouse_id := COALESCE(
      (v_item->>'warehouse_id')::UUID,
      v_default_warehouse_id
    );
    v_created_by := NULLIF(v_item->>'created_by', '')::UUID;
    v_has_lot := false;
    v_lot := NULL;

    IF p_lots IS NOT NULL AND jsonb_typeof(p_lots) = 'array' THEN
      SELECT e INTO v_lot
      FROM jsonb_array_elements(p_lots) e
      WHERE (e->>'purchase_order_item_id')::UUID = (v_item->>'id')::UUID
      LIMIT 1;
      v_has_lot := v_lot IS NOT NULL;
    END IF;

    -- 變體追蹤模式（無變體＝不追蹤）
    v_mode := NULL;
    IF v_variant_id IS NOT NULL THEN
      SELECT tracking_mode INTO v_mode FROM public.product_variants WHERE id = v_variant_id;
    END IF;

    UPDATE public.purchase_order_items poi
    SET received_quantity = v_received_qty
    FROM public.purchase_orders po
    WHERE poi.id = (v_item->>'id')::UUID
      AND poi.purchase_order_id = v_po_id
      AND po.id = v_po_id
    RETURNING poi.unit_cost INTO v_po_item_cost;

    IF v_mode = 'serial' THEN
      IF NOT v_has_lot OR COALESCE(v_lot->>'mode', '') <> 'serial' THEN
        RAISE EXCEPTION '「一機一號」的商品收貨時必須提供序號清單（p_lots, mode=serial）';
      END IF;

      v_serial_list := v_lot -> 'serials';
      IF jsonb_typeof(v_serial_list) <> 'array'
         OR COALESCE(jsonb_array_length(v_serial_list), 0) <> v_received_qty THEN
        RAISE EXCEPTION '序號數量（% 個）與收貨數量（% 件）不符',
          COALESCE(jsonb_array_length(v_serial_list), 0), v_received_qty;
      END IF;

      IF v_received_qty > 0 AND EXISTS (
        SELECT 1 FROM public.product_batches pb
        WHERE pb.variant_id = v_variant_id
          AND pb.tracking_mode = 'serial'
          AND pb.serial_number IN (SELECT value FROM jsonb_array_elements_text(v_serial_list))
      ) THEN
        RAISE EXCEPTION '序號與既有資料重複（此變體序號須唯一）';
      END IF;

      FOR v_serial_elem IN SELECT * FROM jsonb_array_elements_text(v_serial_list)
      LOOP
        IF COALESCE(btrim(v_serial_elem), '') = '' THEN
          RAISE EXCEPTION '序號不可為空';
        END IF;

        INSERT INTO public.product_batches (
          variant_id, tracking_mode, serial_number, quantity,
          unit_cost, purchase_order_id, purchase_order_item_id,
          received_at, status, created_by
        )
        VALUES (
          v_variant_id, 'serial', btrim(v_serial_elem), 1,
          COALESCE(NULLIF(v_lot->>'unit_cost', '')::NUMERIC, v_po_item_cost, 0),
          v_po_id, (v_item->>'id')::UUID,
          NOW(), 'active', v_created_by
        )
        RETURNING id INTO v_batch_id;

        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change, source_type,
          purchase_order_id, reference_code, batch_id, created_by
        )
        VALUES (
          v_product_id, v_variant_id, v_item_warehouse_id, 1, 'purchase_receipt',
          v_po_id, v_po_code, v_batch_id, v_created_by
        );
      END LOOP;
    ELSIF v_mode = 'batch' AND v_has_lot AND COALESCE(v_lot->>'mode', '') = 'batch' THEN
      v_batch_number := NULLIF(btrim(COALESCE(v_lot->>'batch_number', '')), '');
      IF v_batch_number IS NULL THEN
        RAISE EXCEPTION '批號商品收貨時必須提供 batch_number';
      END IF;
      v_batch_unit_cost := COALESCE(NULLIF(v_lot->>'unit_cost', '')::NUMERIC, NULLIF(v_lot->>'cost', '')::NUMERIC, v_po_item_cost, 0);

      IF v_received_qty > 0 AND EXISTS (
        SELECT 1 FROM public.product_batches pb
        WHERE pb.variant_id = v_variant_id
          AND pb.tracking_mode = 'batch'
          AND pb.batch_number = v_batch_number
      ) THEN
        RAISE EXCEPTION '批號 % 與既有資料重複（此變體批號須唯一）', v_batch_number;
      END IF;

      INSERT INTO public.product_batches (
        variant_id, tracking_mode, batch_number, quantity, unit_cost,
        purchase_order_id, purchase_order_item_id, received_at, status, created_by
      )
      VALUES (
        v_variant_id, 'batch', v_batch_number, GREATEST(v_received_qty, 1), v_batch_unit_cost,
        v_po_id, (v_item->>'id')::UUID, NOW(), 'active', v_created_by
      )
      RETURNING id INTO v_batch_id;

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        purchase_order_id, reference_code, batch_id, created_by
      )
      VALUES (
        v_product_id, v_variant_id, v_item_warehouse_id, v_received_qty, 'purchase_receipt',
        v_po_id, v_po_code, v_batch_id, v_created_by
      );
    ELSE
      IF v_has_lot AND (v_mode IS NULL OR v_mode = 'none') THEN
        RAISE EXCEPTION '此商品未啟用批號追蹤，無法收貨序號/批號';
      END IF;
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, purchase_order_id, reference_code, created_by)
      VALUES (v_product_id, v_variant_id, v_item_warehouse_id, v_received_qty, 'purchase_receipt', v_po_id, v_po_code, v_created_by);
    END IF;

    IF NOT (v_po_id = ANY(v_po_ids)) THEN
      v_po_ids := array_append(v_po_ids, v_po_id);
    END IF;
  END LOOP;

  FOREACH v_po_id IN ARRAY v_po_ids LOOP
    SELECT
      bool_and(poi.received_quantity >= poi.quantity),
      bool_or(poi.received_quantity > 0)
    INTO v_all_received, v_any_received
    FROM public.purchase_order_items poi
    WHERE poi.purchase_order_id = v_po_id;

    UPDATE public.purchase_orders
    SET status = CASE
                   WHEN v_all_received THEN 'received'::purchase_order_status
                   WHEN v_any_received THEN 'partial_received'::purchase_order_status
                   ELSE 'ordered'::purchase_order_status
                 END,
        received_date = CASE WHEN v_all_received THEN CURRENT_DATE ELSE NULL END
    WHERE id = v_po_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_items(jsonb, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_items(jsonb, uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 2. create_consignment_shipment_layer（簽名不變；movement 改走 helper）
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

    PERFORM public._ship_stock_movements(
      v_oi.product_id, v_oi.variant_id, v_warehouse_id, v_qty, 'consignment_out_shipment',
      NULL, v_co_id, v_coi_id, v_order_item_id, v_oi.order_code, p_created_by, 'store_consignment'
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
-- 3. create_order_with_sales_note（簽名不變；self 出貨改走 helper）
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
-- 4. direct_ship_order（簽名不變；self 出貨改走 helper）
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
-- 5. ship_from_pool（簽名不變；self 出貨改走 helper）
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
          PERFORM public._ship_stock_movements(
            v_item.product_id, v_item.variant_id, v_item_warehouse_id, v_item.quantity,
            'sales_shipment', v_sales_note_id, NULL, NULL, v_item.order_item_id,
            v_sales_note_code, p_created_by, 'self'
          );
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
-- 5b. create_consignment_shipment（寄賣草稿直接出貨 → 扣存走 helper）
--    （簽名不變；consignment_out_shipment 改走 _ship_stock_movements 依批/依台扣存）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_consignment_shipment(
  p_consignment_order_id uuid,
  p_created_by uuid,
  p_notes text DEFAULT NULL,
  p_shipped_at timestamptz DEFAULT NULL,
  p_delivery_type text DEFAULT NULL,
  p_delivery_method_id uuid DEFAULT NULL,
  p_shipping_fee numeric DEFAULT NULL,
  p_shipping_cost numeric DEFAULT NULL,
  p_tracking_company text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL,
  p_shipping_address jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'extensions'
AS $function$
DECLARE
  v_order RECORD;
  v_order_id UUID;
  v_order_code TEXT;
  v_item RECORD;
  v_ship_qty INTEGER;
  v_oi_id UUID;
  v_oi_qty INTEGER;
  v_oi_shipped INTEGER;
  v_own_wh UUID;
  v_shipped_at TIMESTAMPTZ;
  v_code TEXT;
  v_result JSONB;
  v_delivery JSONB;
  v_delivery_type TEXT;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());

  v_delivery := public._resolve_delivery(p_delivery_type, p_delivery_method_id);
  v_delivery_type := v_delivery->>'delivery_type';

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
    SELECT coi.id AS consignment_order_item_id, coi.order_item_id,
           coi.product_id, coi.variant_id, coi.unit_price,
           s.order_quantity - s.shipped_quantity AS remaining
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
  LOOP
    v_ship_qty := v_item.remaining;
    CONTINUE WHEN v_ship_qty IS NULL OR v_ship_qty <= 0;

    v_oi_id := v_item.order_item_id;
    IF v_oi_id IS NOT NULL THEN
      SELECT quantity, shipped_quantity INTO v_oi_qty, v_oi_shipped
      FROM public.order_items WHERE id = v_oi_id;
      IF NOT FOUND THEN
        v_oi_id := NULL;
      END IF;
    END IF;

    IF v_oi_id IS NULL THEN
      INSERT INTO public.order_items (
        order_id, product_id, variant_id, store_id,
        quantity, unit_price, shipped_quantity, status
      )
      VALUES (
        v_order_id, v_item.product_id, v_item.variant_id, v_order.store_id,
        v_ship_qty, v_item.unit_price, v_ship_qty, 'shipped'
      )
      RETURNING id INTO v_oi_id;

      UPDATE public.consignment_order_items
      SET order_item_id = v_oi_id
      WHERE id = v_item.consignment_order_item_id;
    ELSE
      UPDATE public.order_items
      SET shipped_quantity = v_oi_shipped + v_ship_qty,
          status = (CASE WHEN v_oi_shipped + v_ship_qty >= v_oi_qty THEN 'shipped' ELSE 'partial' END)::order_item_status,
          updated_at = NOW()
      WHERE id = v_oi_id;
    END IF;

    DELETE FROM public.shipping_pool WHERE order_item_id = v_oi_id;

    PERFORM public._ship_stock_movements(
      v_item.product_id, v_item.variant_id, v_own_wh, v_ship_qty, 'consignment_out_shipment',
      NULL, p_consignment_order_id, v_item.consignment_order_item_id, v_oi_id,
      v_order_code, p_created_by, 'store_consignment'
    );
  END LOOP;

  UPDATE public.consignment_orders
  SET status = 'active', shipped_at = v_shipped_at, updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';

  IF v_delivery_type = 'logistics' AND (v_delivery->>'method_id') IS NOT NULL THEN
    PERFORM public.upsert_shipment(
      'consignment_order', p_consignment_order_id, (v_delivery->>'method_id')::UUID,
      COALESCE(p_shipping_fee, (v_delivery->>'method_price')::NUMERIC),
      COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::NUMERIC),
      'one_time', p_tracking_company, p_tracking_number, p_tracking_url,
      v_shipped_at, p_notes, p_created_by, NULL
    );
    UPDATE public.consignment_orders
    SET delivery_method_id = (v_delivery->>'method_id')::UUID,
        delivery_method_title = v_delivery->>'method_title',
        delivery_method_code = v_delivery->>'method_code',
        shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::NUMERIC, 0),
        shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::NUMERIC, 0),
        shipping_address = COALESCE(shipping_address, p_shipping_address),
        delivery_type = v_delivery_type,
        updated_at = NOW()
    WHERE id = p_consignment_order_id;
  ELSIF v_delivery_type = 'delivery' THEN
    IF (v_delivery->>'method_id') IS NOT NULL THEN
      UPDATE public.consignment_orders
      SET delivery_method_id = (v_delivery->>'method_id')::UUID,
          delivery_method_title = v_delivery->>'method_title',
          delivery_method_code = v_delivery->>'method_code',
          shipping_fee = COALESCE(p_shipping_fee, (v_delivery->>'method_price')::NUMERIC, 0),
          shipping_cost = COALESCE(p_shipping_cost, (v_delivery->>'method_cost')::NUMERIC, 0),
          shipping_address = COALESCE(shipping_address, p_shipping_address),
          delivery_type = v_delivery_type,
          updated_at = NOW()
      WHERE id = p_consignment_order_id;
    ELSE
      UPDATE public.consignment_orders
      SET delivery_type = v_delivery_type, updated_at = NOW()
      WHERE id = p_consignment_order_id;
    END IF;
  ELSE
    UPDATE public.consignment_orders
    SET delivery_type = v_delivery_type, updated_at = NOW()
    WHERE id = p_consignment_order_id;
  END IF;

  UPDATE public.orders
  SET status = 'shipped', updated_at = NOW()
  WHERE id = v_order_id AND status IN ('pending', 'processing');

  SELECT code INTO v_code FROM public.consignment_orders WHERE id = p_consignment_order_id;

  v_result := jsonb_build_object(
    'consignment_order_id', p_consignment_order_id,
    'order_id', v_order_id,
    'order_code', v_order_code,
    'code', v_code
  );

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_consignment_shipment(uuid, uuid, text, timestamptz, text, uuid, numeric, numeric, text, text, text, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 6. delete_sales_note（還原依原出貨批次逐批寫回）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_sales_note(
  p_sales_note_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item RECORD;
  v_rest RECORD;
  v_new_shipped int;
  v_total_quantity int;
  v_order_ids UUID[] := '{}';
  v_pool_quantity int;
  v_own_warehouse_id UUID;
  v_consignment_wh_id UUID;
  v_is_consignment BOOLEAN;
  v_source_type TEXT;
  v_owner TEXT;
  v_sn_status TEXT;
  v_sn_code TEXT;
  v_plain_qty int;
BEGIN
  SELECT status, code INTO v_sn_status, v_sn_code FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;

  IF v_sn_status = 'received' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單已收貨，無法刪除', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'label', '已收貨狀態')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_entries ae
    WHERE ae.reference_type = 'sales_note' AND ae.reference_id = p_sales_note_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer
    WHERE aer.reference_type = 'sales_note' AND aer.reference_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已有會計分錄（如收款），請先至會計模組回退/刪除分錄', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'accounting', 'label', '會計分錄（收款）')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rep_commission_payouts rcp WHERE rcp.sales_note_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已完成業務佣金發放（或已登記），請先撤銷發放', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'rep_payout', 'label', '業務佣金發放')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_sales cs WHERE cs.sales_note_id = p_sales_note_id AND NOT cs.reversed
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單為寄賣確認銷售產生的收款單，請由寄賣流程反向處理', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'consignment_sale', 'label', '寄賣確認銷售')));
  END IF;

  SELECT id INTO v_own_warehouse_id FROM public.warehouses WHERE code = 'own';
  SELECT id INTO v_consignment_wh_id FROM public.warehouses WHERE code = 'supplier_consignment';

  FOR v_item IN
    SELECT si.order_item_id, si.quantity, si.inventory_source_type,
           oi.quantity AS total_quantity,
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

    v_is_consignment := v_item.inventory_source_type IN ('supplier_consignment', 'store_consignment')
      OR EXISTS (
        SELECT 1 FROM public.consignment_sales cs
        WHERE cs.order_item_id = v_item.order_item_id
          AND cs.sales_note_id = p_sales_note_id
          AND NOT cs.reversed
      );

    IF v_is_consignment THEN
      UPDATE public.consignment_sales
      SET reversed = true
      WHERE order_item_id = v_item.order_item_id
        AND sales_note_id = p_sales_note_id
        AND NOT reversed;

      IF v_item.inventory_source_type = 'store_consignment' THEN
        v_source_type := 'consignment_sale_reversal';
        v_owner := 'store_consignment';
      ELSE
        v_source_type := 'consignment_shipment_reversal';
        v_owner := 'supplier_consignment';
      END IF;

      -- 逐批（序號）還原：讀取原始出貨 movements 的批次+倉位分佈
      v_plain_qty := v_item.quantity;
      FOR v_rest IN
        SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
        FROM public.inventory_movements m
        WHERE m.sales_note_id = p_sales_note_id
          AND m.product_id = v_item.product_id
          AND m.variant_id IS NOT DISTINCT FROM v_item.variant_id
          AND m.source_type IN ('consignment_out_shipment', 'sales_shipment')
          AND m.batch_id IS NOT NULL
        GROUP BY m.batch_id, m.warehouse_id
      LOOP
        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change, source_type,
          sales_note_id, consignment_order_id, consignment_order_item_id,
          inventory_owner, reference_code, created_by, batch_id
        )
        SELECT
          v_item.product_id, v_item.variant_id,
          v_rest.warehouse_id, v_rest.qty, v_source_type,
          p_sales_note_id, m.consignment_order_id, m.consignment_order_item_id,
          v_owner, v_sn_code, NULL, v_rest.batch_id
        FROM public.inventory_movements m
        WHERE m.sales_note_id = p_sales_note_id
          AND m.batch_id = v_rest.batch_id
        LIMIT 1;
        v_plain_qty := v_plain_qty - v_rest.qty;
      END LOOP;

      IF v_plain_qty > 0 THEN
        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change, source_type,
          sales_note_id, consignment_order_id, consignment_order_item_id,
          inventory_owner, reference_code, created_by
        )
        SELECT
          v_item.product_id, v_item.variant_id,
          CASE WHEN v_item.inventory_source_type = 'store_consignment'
               THEN v_own_warehouse_id ELSE v_consignment_wh_id END,
          v_plain_qty, v_source_type,
          p_sales_note_id, m.consignment_order_id, m.consignment_order_item_id,
          v_owner, v_sn_code, NULL
        FROM public.inventory_movements m
        WHERE m.sales_note_id = p_sales_note_id
          AND m.consignment_order_item_id IS NOT NULL
          AND m.product_id = v_item.product_id
          AND m.variant_id IS NOT DISTINCT FROM v_item.variant_id
        LIMIT 1;
      END IF;

      CONTINUE;
    END IF;

    -- 一般（自有倉）：依出貨批次逐批回補，其餘以無批號的一般 deletion 回補
    v_plain_qty := v_item.quantity;
    FOR v_rest IN
      SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
      FROM public.inventory_movements m
      WHERE m.sales_note_id = p_sales_note_id
        AND m.order_item_id = v_item.order_item_id
        AND m.source_type = 'sales_shipment'
        AND m.batch_id IS NOT NULL
      GROUP BY m.batch_id, m.warehouse_id
    LOOP
      PERFORM public.upsert_sales_note_deletion_movement(
        p_sales_note_id, v_item.order_item_id, v_item.product_id, v_item.variant_id,
        v_rest.warehouse_id, v_rest.qty, v_sn_code, NULL, v_rest.batch_id
      );
      v_plain_qty := v_plain_qty - v_rest.qty;
    END LOOP;

    IF v_plain_qty > 0 THEN
      PERFORM public.upsert_sales_note_deletion_movement(
        p_sales_note_id, v_item.order_item_id, v_item.product_id, v_item.variant_id,
        v_own_warehouse_id, v_plain_qty, v_sn_code, NULL
      );
    END IF;

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

    -- 上限防呆：回補後不得超過訂單剩餘未出貨量；剩餘量 <= 0 時（殘留整列）直接刪除
    IF v_total_quantity - v_new_shipped <= 0 THEN
      DELETE FROM public.shipping_pool WHERE order_item_id = v_item.order_item_id;
    ELSE
      UPDATE public.shipping_pool
      SET quantity = v_total_quantity - v_new_shipped
      WHERE order_item_id = v_item.order_item_id
        AND quantity > v_total_quantity - v_new_shipped;
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_sales_note(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_sales_note(uuid) TO authenticated;

-- ------------------------------------------------------------
-- 7. correct_sales_note（Phase 1 依批次還原；Phase 2/3 出貨走 helper）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_sales_note(
  p_sales_note_id UUID,
  p_items_to_remove UUID[] DEFAULT '{}',
  p_items_to_add JSONB DEFAULT '[]',
  p_new_items JSONB DEFAULT '[]',
  p_created_by UUID DEFAULT NULL,
  p_price_updates JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_sn RECORD;
  v_own_wh UUID;
  v_consignment_wh UUID;
  v_item_order_item_id UUID;
  v_item_quantity INTEGER;
  v_elem JSONB;
  v_oi RECORD;
  v_sni RECORD;
  v_new_shipped INTEGER;
  v_pool_quantity INTEGER;
  v_affected_order_ids UUID[] := '{}';
  v_order_id UUID;
  v_all_shipped BOOLEAN;
  v_is_consignment BOOLEAN;
  v_source_type TEXT;
  v_owner TEXT;
  v_ship_wh UUID;
  v_remaining INTEGER;
  v_new_order_id UUID;
  v_new_order_item_id UUID;
  v_new_sni_code TEXT;
  v_removed_qty INTEGER := 0;
  v_added_qty INTEGER := 0;
  v_new_items_qty INTEGER := 0;
  v_result JSONB;
  v_pu_elem JSONB;
  v_pu_oi_id UUID;
  v_pu_new_price INTEGER;
  v_pu_old_price NUMERIC;
  v_pu_oi RECORD;
  v_pu_order_code TEXT;
  v_pu_other_sni RECORD;
  v_price_updates_result JSONB := '[]'::JSONB;
  v_other_notes JSONB;
  v_rest RECORD;
  v_plain_qty INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可修正銷貨單');
  END IF;

  SELECT * INTO v_sn FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;
  v_new_sni_code := v_sn.code;

  IF v_sn.status = 'received' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單已收貨，無法修正', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'label', '已收貨狀態')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounting_entries ae
    WHERE ae.reference_type = 'sales_note' AND ae.reference_id = p_sales_note_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer
    WHERE aer.reference_type = 'sales_note' AND aer.reference_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已有會計分錄（如收款），請先至會計模組回退/刪除分錄', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'accounting', 'label', '會計分錄（收款）')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rep_commission_payouts rcp WHERE rcp.sales_note_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已完成業務佣金發放（或已登記），請先撤銷發放', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'rep_payout', 'label', '業務佣金發放')));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_sales cs WHERE cs.sales_note_id = p_sales_note_id AND NOT cs.reversed
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單為寄賣確認銷售產生的收款單，請由寄賣流程反向處理', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'consignment_sale', 'label', '寄賣確認銷售')));
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  SELECT id INTO v_consignment_wh FROM public.warehouses WHERE code = 'supplier_consignment';

  -- Phase 1: 移除
  IF p_items_to_remove IS NOT NULL AND array_length(p_items_to_remove, 1) > 0 THEN
    FOREACH v_item_order_item_id IN ARRAY p_items_to_remove LOOP
      SELECT * INTO v_sni FROM public.sales_note_items WHERE id = v_item_order_item_id AND sales_note_id = p_sales_note_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '要移除的品項不存在於此銷貨單';
      END IF;

      SELECT * INTO v_oi FROM public.order_items WHERE id = v_sni.order_item_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION '品項對應的訂單項目不存在（資料異常）';
      END IF;

      v_is_consignment := v_sni.inventory_source_type IN ('supplier_consignment', 'store_consignment');

      -- 批次還原資料：在 DELETE 出貨 movements 前先讀取批次+倉位分佈
      IF NOT v_is_consignment THEN
        v_plain_qty := v_sni.quantity;
        FOR v_rest IN
          SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
          FROM public.inventory_movements m
          WHERE m.sales_note_id = p_sales_note_id
            AND m.order_item_id = v_sni.order_item_id
            AND m.source_type = 'sales_shipment'
            AND m.batch_id IS NOT NULL
          GROUP BY m.batch_id, m.warehouse_id
        LOOP
          PERFORM public.upsert_sales_note_deletion_movement(
            p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
            v_rest.warehouse_id, v_rest.qty, v_new_sni_code, p_created_by, v_rest.batch_id
          );
          v_plain_qty := v_plain_qty - v_rest.qty;
        END LOOP;
        IF v_plain_qty > 0 THEN
          PERFORM public.upsert_sales_note_deletion_movement(
            p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
            v_own_wh, v_plain_qty, v_new_sni_code, p_created_by
          );
        END IF;
      END IF;

      IF v_is_consignment THEN
        IF v_sni.inventory_source_type = 'store_consignment' THEN
          v_source_type := 'consignment_shipment_reversal';
          v_owner := 'store_consignment';
          v_ship_wh := v_own_wh;
        ELSE
          v_source_type := 'consignment_sale_reversal';
          v_owner := 'supplier_consignment';
          v_ship_wh := v_consignment_wh;
        END IF;

        IF v_sni.inventory_source_type = 'store_consignment' THEN
          -- 寄賣已出貨（store_consignment）：逐批還原
          v_plain_qty := v_sni.quantity;
          FOR v_rest IN
            SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
            FROM public.inventory_movements m
            WHERE m.sales_note_id = p_sales_note_id
              AND m.order_item_id = v_sni.order_item_id
              AND m.source_type = 'consignment_out_shipment'
              AND m.batch_id IS NOT NULL
            GROUP BY m.batch_id, m.warehouse_id
          LOOP
            INSERT INTO public.inventory_movements (
              product_id, variant_id, warehouse_id, quantity_change, source_type,
              sales_note_id, order_item_id, inventory_owner, reference_code, created_by, batch_id
            )
            VALUES (
              v_oi.product_id, v_oi.variant_id, v_rest.warehouse_id, v_rest.qty, v_source_type,
              p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by, v_rest.batch_id
            );
            v_plain_qty := v_plain_qty - v_rest.qty;
          END LOOP;
          IF v_plain_qty > 0 THEN
            INSERT INTO public.inventory_movements (
              product_id, variant_id, warehouse_id, quantity_change, source_type,
              sales_note_id, order_item_id, inventory_owner, reference_code, created_by
            )
            VALUES (
              v_oi.product_id, v_oi.variant_id, v_ship_wh, v_plain_qty, v_source_type,
              p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by
            );
          END IF;
        ELSE
          INSERT INTO public.inventory_movements (
            product_id, variant_id, warehouse_id, quantity_change, source_type,
            sales_note_id, order_item_id, inventory_owner, reference_code, created_by
          )
          VALUES (
            v_oi.product_id, v_oi.variant_id, v_ship_wh, v_sni.quantity, v_source_type,
            p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by
          );
        END IF;
      END IF;

      -- 出貨 movements（sales_shipment / consignment_out_shipment）在此才刪除，
      -- 確保上方批次還原先用原批次+倉位分布讀取並寫回
      DELETE FROM public.inventory_movements
      WHERE sales_note_id = p_sales_note_id
        AND order_item_id = v_sni.order_item_id
        AND source_type IN ('sales_shipment', 'consignment_out_shipment');

      v_new_shipped := GREATEST(0, v_oi.shipped_quantity - v_sni.quantity);
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped,
          status = CASE
                     WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                     WHEN v_new_shipped < v_oi.quantity THEN 'partial'::order_item_status
                     ELSE 'shipped'::order_item_status
                   END,
          updated_at = NOW()
      WHERE id = v_sni.order_item_id;

      SELECT quantity INTO v_pool_quantity FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      IF FOUND THEN
        UPDATE public.shipping_pool
        SET quantity = v_pool_quantity + v_sni.quantity
        WHERE order_item_id = v_sni.order_item_id;
      ELSE
        INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
        VALUES (v_sni.order_item_id, v_sni.quantity, v_sn.store_id, p_created_by);
      END IF;

      -- 上限防呆：回補後不得超過訂單剩餘未出貨量；剩餘量 <= 0 時（殘留整列）直接刪除
      IF v_oi.quantity - v_new_shipped <= 0 THEN
        DELETE FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      ELSE
        UPDATE public.shipping_pool
        SET quantity = v_oi.quantity - v_new_shipped
        WHERE order_item_id = v_sni.order_item_id
          AND quantity > v_oi.quantity - v_new_shipped;
      END IF;

      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      DELETE FROM public.sales_note_items WHERE id = v_sni.id;
      v_removed_qty := v_removed_qty + v_sni.quantity;
    END LOOP;
  END IF;

  -- Phase 2: 追加已有品項
  IF p_items_to_add IS NOT NULL AND jsonb_typeof(p_items_to_add) = 'array' AND jsonb_array_length(p_items_to_add) > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items_to_add)
    LOOP
      v_item_order_item_id := (v_elem->>'order_item_id')::UUID;
      v_item_quantity := (v_elem->>'quantity')::INTEGER;

      SELECT * INTO v_oi
      FROM public.order_items oi
      JOIN public.orders oo ON oo.id = oi.order_id
      WHERE oi.id = v_item_order_item_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION '要追加的品項不存在';
      END IF;

      IF v_oi.store_id <> v_sn.store_id THEN
        RAISE EXCEPTION '不可跨店家追加品項';
      END IF;

      v_remaining := v_oi.quantity - v_oi.shipped_quantity;
      IF v_item_quantity > v_remaining THEN
        RAISE EXCEPTION '品項未出貨量不足，剩餘 % 件', v_remaining;
      END IF;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
      VALUES (
        p_sales_note_id, v_item_order_item_id, v_item_quantity,
        CASE WHEN v_oi.consignment_mode THEN 'store_consignment' ELSE 'self' END,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id)
      );

      IF v_oi.consignment_mode THEN
        PERFORM public.allocate_inventory(
          v_oi.product_id, v_oi.variant_id, v_item_quantity, 'store_consignment', NULL,
          p_sales_note_id, v_item_order_item_id, v_new_sni_code, v_oi.unit_price, p_created_by
        );
      ELSE
        PERFORM public._ship_stock_movements(
          v_oi.product_id, v_oi.variant_id, v_own_wh, v_item_quantity, 'sales_shipment',
          p_sales_note_id, NULL, NULL, v_item_order_item_id, v_new_sni_code, p_created_by, 'self'
        );
      END IF;

      v_new_shipped := v_oi.shipped_quantity + v_item_quantity;
      UPDATE public.order_items
      SET shipped_quantity = v_new_shipped,
          status = CASE
                     WHEN v_new_shipped >= v_oi.quantity THEN 'shipped'::order_item_status
                     WHEN v_new_shipped > 0 THEN 'partial'::order_item_status
                     ELSE 'waiting'::order_item_status
                   END,
          updated_at = NOW()
      WHERE id = v_item_order_item_id;

      DELETE FROM public.shipping_pool
      WHERE order_item_id = v_item_order_item_id AND store_id = v_sn.store_id;

      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      v_added_qty := v_added_qty + v_item_quantity;
    END LOOP;
  END IF;

  -- Phase 3: 追加完全新品（自動建單）
  IF p_new_items IS NOT NULL AND jsonb_typeof(p_new_items) = 'array' AND jsonb_array_length(p_new_items) > 0 THEN
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_new_items)
    LOOP
      IF (v_elem->>'product_id') IS NULL THEN
        RAISE EXCEPTION '新品項缺少 product_id';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = (v_elem->>'product_id')::UUID) THEN
        RAISE EXCEPTION '新品項對應產品不存在';
      END IF;

      v_item_quantity := COALESCE((v_elem->>'quantity')::INTEGER, 1);
      IF v_item_quantity < 1 THEN
        RAISE EXCEPTION '新品項數量必須大於 0';
      END IF;

      INSERT INTO public.orders (store_id, created_by, status, source_type, access_token, notes)
      VALUES (v_sn.store_id, p_created_by, 'shipped', 'admin_proxy', gen_random_uuid(),
              '銷貨單修正自動建立（' || v_new_sni_code || '）')
      RETURNING id INTO v_new_order_id;

      INSERT INTO public.order_items (
        order_id, product_id, variant_id, store_id,
        quantity, unit_price, shipped_quantity, status,
        unit_cost, sort_order
      )
      VALUES (
        v_new_order_id,
        (v_elem->>'product_id')::UUID,
        NULLIF(v_elem->>'variant_id', '')::UUID,
        v_sn.store_id,
        v_item_quantity,
        COALESCE((v_elem->>'unit_price')::INTEGER,
          (SELECT COALESCE(p.unified_wholesale_price, p.unified_retail_price) FROM public.products p WHERE p.id = (v_elem->>'product_id')::UUID)),
        v_item_quantity,
        'shipped'::order_item_status,
        COALESCE(NULLIF(v_elem->>'unit_cost', '')::INTEGER, 0),
        1
      )
      RETURNING id INTO v_new_order_item_id;

      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
      VALUES (
        p_sales_note_id, v_new_order_item_id, v_item_quantity, 'self',
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id)
      );

      PERFORM public._ship_stock_movements(
        (v_elem->>'product_id')::UUID,
        NULLIF(v_elem->>'variant_id', '')::UUID,
        v_own_wh, v_item_quantity, 'sales_shipment',
        p_sales_note_id, NULL, NULL, v_new_order_item_id, v_new_sni_code, p_created_by, 'self'
      );

      IF NOT (v_new_order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_new_order_id);
      END IF;

      v_new_items_qty := v_new_items_qty + v_item_quantity;
    END LOOP;
  END IF;

  -- Phase 4: 價格更新（直接改 order_items.unit_price，單一資料源）
  IF p_price_updates IS NOT NULL AND jsonb_typeof(p_price_updates) = 'array' AND jsonb_array_length(p_price_updates) > 0 THEN
    FOR v_pu_elem IN SELECT * FROM jsonb_array_elements(p_price_updates)
    LOOP
      v_pu_oi_id := (v_pu_elem->>'order_item_id')::UUID;
      v_pu_new_price := (v_pu_elem->>'new_unit_price')::INTEGER;

      IF v_pu_new_price < 0 THEN
        RAISE EXCEPTION '價格不可為負數';
      END IF;

      SELECT oi.*, o.code AS order_code INTO v_pu_oi
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = v_pu_oi_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION '要修改價格的品項不存在';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.sales_note_items sni
        WHERE sni.sales_note_id = p_sales_note_id AND sni.order_item_id = v_pu_oi_id
      ) THEN
        RAISE EXCEPTION '品項不屬於此銷貨單';
      END IF;

      v_pu_old_price := v_pu_oi.unit_price;

      SELECT sni.id, sn.code INTO v_pu_other_sni
      FROM public.sales_note_items sni
      JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
      WHERE sni.order_item_id = v_pu_oi_id
        AND sn.id != p_sales_note_id
        AND sn.payment_status = 'paid'
      LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION '品項 "%" 已被銷貨單 %（已收款）引用，無法修改價格', v_pu_oi.product_id, v_pu_other_sni.code;
      END IF;

      v_other_notes := (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('code', sn.code, 'payment_status', sn.payment_status)), '[]'::jsonb)
        FROM public.sales_note_items sni
        JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
        WHERE sni.order_item_id = v_pu_oi_id
          AND sn.id != p_sales_note_id
      );

      UPDATE public.order_items
      SET unit_price = v_pu_new_price, updated_at = NOW()
      WHERE id = v_pu_oi_id;

      v_price_updates_result := v_price_updates_result || jsonb_build_object(
        'order_item_id', v_pu_oi_id,
        'product_id', v_pu_oi.product_id,
        'variant_id', v_pu_oi.variant_id,
        'old_unit_price', v_pu_old_price,
        'new_unit_price', v_pu_new_price,
        'order_code', v_pu_oi.order_code,
        'other_affected_sales_notes', v_other_notes
      );

      IF NOT (v_pu_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_pu_oi.order_id);
      END IF;
    END LOOP;
  END IF;

  -- Phase 5: 收尾
  UPDATE public.sales_notes SET updated_at = NOW() WHERE id = p_sales_note_id;

  FOREACH v_order_id IN ARRAY v_affected_order_ids LOOP
    SELECT COALESCE(bool_and(o2.shipped_quantity >= o2.quantity OR o2.status IN ('cancelled', 'discontinued')), false)
    INTO v_all_shipped
    FROM public.order_items o2
    WHERE o2.order_id = v_order_id;

    IF v_all_shipped THEN
      UPDATE public.orders SET status = 'shipped', updated_at = NOW()
      WHERE id = v_order_id AND status = 'processing';
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'ok', true,
    'sales_note_id', p_sales_note_id,
    'removed_quantity', v_removed_qty,
    'added_quantity', v_added_qty,
    'new_items_quantity', v_new_items_qty,
    'affected_orders', to_jsonb(v_affected_order_ids),
    'price_updates', v_price_updates_result,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', si.id,
        'order_item_id', si.order_item_id,
        'quantity', si.quantity,
        'inventory_source_type', si.inventory_source_type,
        'sort_order', si.sort_order
      ) ORDER BY si.sort_order)
      FROM public.sales_note_items si
      WHERE si.sales_note_id = p_sales_note_id
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 8. reverse_consignment_shipment（逐批還原出貨）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_rest RECORD;
  v_own_wh UUID;
  v_reverse_qty INTEGER;
  v_plain_qty INTEGER;
  v_oi_id UUID;
  v_oi_shipped INTEGER;
  v_oi_qty INTEGER;
  v_new_shipped INTEGER;
  v_pool_quantity INTEGER;
  v_reversed_items INTEGER := 0;
  v_reversed_quantity INTEGER := 0;
  v_result JSONB;
BEGIN
  SELECT * INTO v_order FROM public.consignment_orders WHERE id = p_consignment_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '寄賣單不存在';
  END IF;
  IF v_order.direction <> 'send_to_store' THEN
    RAISE EXCEPTION '僅店家方向寄賣單可回滾出貨';
  END IF;
  IF v_order.status <> 'active' THEN
    RAISE EXCEPTION '僅進行中的寄賣單可回滾出貨';
  END IF;
  IF v_order.received_at IS NOT NULL THEN
    RAISE EXCEPTION '店家已確認收貨，請改用「退回」流程';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_sales
    WHERE consignment_order_id = p_consignment_order_id AND NOT reversed
  ) THEN
    RAISE EXCEPTION '已有已售出紀錄，無法回滾出貨';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_sales_reports
    WHERE consignment_order_id = p_consignment_order_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION '尚有待審核的銷售回報，無法回滾出貨';
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  FOR v_item IN
    SELECT s.consignment_order_item_id AS coi_id,
           s.shipped_quantity,
           coi.order_item_id,
           coi.product_id,
           coi.variant_id
    FROM public.consignment_order_item_summary s
    JOIN public.consignment_order_items coi ON coi.id = s.consignment_order_item_id
    WHERE s.consignment_order_id = p_consignment_order_id
      AND s.shipped_quantity > 0
  LOOP
    v_reverse_qty := v_item.shipped_quantity;

    -- 1) 回補自有倉庫（consignment_shipment_reversal，+qty）——依出貨批次逐批還原
    v_plain_qty := v_reverse_qty;
    FOR v_rest IN
      SELECT m.batch_id, m.warehouse_id, -SUM(m.quantity_change) AS qty
      FROM public.inventory_movements m
      WHERE m.consignment_order_item_id = v_item.coi_id
        AND m.source_type = 'consignment_out_shipment'
        AND m.batch_id IS NOT NULL
      GROUP BY m.batch_id, m.warehouse_id
    LOOP
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        consignment_order_id, consignment_order_item_id,
        reference_code, inventory_owner, created_by, batch_id
      )
      VALUES (
        v_item.product_id, v_item.variant_id, v_rest.warehouse_id, v_rest.qty,
        'consignment_shipment_reversal',
        p_consignment_order_id, v_item.coi_id,
        v_order.code, 'store_consignment', p_created_by, v_rest.batch_id
      );
      v_plain_qty := v_plain_qty - v_rest.qty;
    END LOOP;

    IF v_plain_qty > 0 THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        consignment_order_id, consignment_order_item_id,
        reference_code, inventory_owner, created_by
      )
      VALUES (
        v_item.product_id, v_item.variant_id, v_own_wh, v_plain_qty,
        'consignment_shipment_reversal',
        p_consignment_order_id, v_item.coi_id,
        v_order.code, 'store_consignment', p_created_by
      );
    END IF;

    -- 2) 來源 order_items：先由 consignment_order_items.order_item_id 直接對應，
    --    若無再依 source_order_id + product/variant 精確匹配（避免 A+B 訂單時誤匹配）
    v_oi_id := v_item.order_item_id;
    IF v_oi_id IS NULL AND v_order.source_order_id IS NOT NULL THEN
      SELECT oi.id INTO v_oi_id
      FROM public.order_items oi
      WHERE oi.order_id = v_order.source_order_id
        AND oi.product_id = v_item.product_id
        AND oi.variant_id IS NOT DISTINCT FROM v_item.variant_id
      LIMIT 1;
    END IF;

    IF v_oi_id IS NOT NULL THEN
      SELECT quantity, shipped_quantity INTO v_oi_qty, v_oi_shipped
      FROM public.order_items WHERE id = v_oi_id;
      IF FOUND THEN
        v_new_shipped := GREATEST(0, v_oi_shipped - v_reverse_qty);
        UPDATE public.order_items
        SET shipped_quantity = v_new_shipped,
            status = CASE
                       WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                       WHEN v_new_shipped < v_oi_qty THEN 'partial'::order_item_status
                       ELSE 'shipped'::order_item_status
                     END,
            updated_at = NOW()
        WHERE id = v_oi_id;

        -- 3) 放回出貨池（有列累加、無列新增）
        SELECT quantity INTO v_pool_quantity
        FROM public.shipping_pool WHERE order_item_id = v_oi_id;
        IF FOUND THEN
          UPDATE public.shipping_pool
          SET quantity = v_pool_quantity + v_reverse_qty
          WHERE order_item_id = v_oi_id;
        ELSE
          INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
          SELECT v_oi_id, v_reverse_qty, o.store_id, o.created_by
          FROM public.orders o WHERE o.id = v_order.source_order_id;
        END IF;
      END IF;
    END IF;

    v_reversed_items := v_reversed_items + 1;
    v_reversed_quantity := v_reversed_quantity + v_reverse_qty;
  END LOOP;

  IF v_reversed_items = 0 THEN
    RAISE EXCEPTION '此寄賣單沒有可回滾的出貨紀錄';
  END IF;

  -- 4) 寄賣單回草稿；來源訂單全數回滾時降 processing
  UPDATE public.consignment_orders
  SET status = 'draft', updated_at = NOW()
  WHERE id = p_consignment_order_id;

  IF v_order.source_order_id IS NOT NULL THEN
    UPDATE public.orders
    SET status = 'processing', updated_at = NOW()
    WHERE id = v_order.source_order_id
      AND status = 'shipped'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi2
        WHERE oi2.order_id = v_order.source_order_id
          AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
      );
  END IF;

  v_result := jsonb_build_object(
    'consignment_order_id', p_consignment_order_id,
    'source_order_id', v_order.source_order_id,
    'reversed_items', v_reversed_items,
    'reversed_quantity', v_reversed_quantity
  );

  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------
-- 9. 4 支出貨 RPC 權限（簽名不變，重新 GRANT，避免 CREATE OR REPLACE 遺失）
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_consignment_shipment_layer(uuid, uuid, jsonb, timestamptz, text, uuid, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_with_sales_note(uuid, uuid, text, jsonb, timestamptz, uuid, boolean, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.direct_ship_order(uuid, uuid, text, timestamptz, uuid, jsonb, jsonb, uuid, numeric, jsonb, text, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ship_from_pool(uuid[], uuid, text, timestamptz, uuid, jsonb, jsonb, jsonb, uuid, numeric, jsonb, jsonb, text, numeric, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;