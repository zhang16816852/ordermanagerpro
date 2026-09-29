-- ============================================================
-- 20260927000001_serial_ship_surgical.sql
-- 序號/批號追蹤：補齊遠端缺少的 3 個批次感知缺口的「外科手術式」migration。
--
-- 背景：原計劃直接套用 20260924000003_product_serial_ship_rpcs.sql 會被否決——
--   00003 是 return-line（line_type）前的版本，整包套用會把遠端已上線的
--   return-line-aware/batch-aware 版本（00005/00008 等）覆寫成舊版，造成退貨回歸。
--   故只取 00003 中「遠端真正缺少、且與既有行為超集相容」的段落，另立本 migration。
--
-- 本檔三段：
--   1. receive_purchase_items      → 3 參數版（尾端 p_lots jsonb DEFAULT NULL）
--      收貨支援序號（serial）/批號（batch）；無 p_lots 時與原 2 參數版行為一致。
--   2. create_consignment_shipment → 12 參數版，consignment_out_shipment 改走
--      _ship_stock_movements 依 FIFO 拆批扣存（支援序號/批號）。除 movement 處理外
--      與遠端現行 body 逐字一致（含 _resolve_delivery／upsert_shipment／狀態收斂）。
--   3. delete_sales_note           → merge 版：以遠端現行 return-aware body 為基底，
--      一般（自有倉）列與寄賣列皆改為「依原出貨批次（sales_shipment /
--      consignment_out_shipment 且 batch_id 非空）逐批還原」，其餘以無批次一般回補；
--      return 列維持 signed 單筆回補。寄賣 source_type mapping 以遠端現行為準
--      （store_consignment → consignment_shipment_reversal）。
--
-- ⚠️ 不觸碰遠端既有之 create_consignment_shipment_layer /
--    create_order_with_sales_note / direct_ship_order / ship_from_pool /
--    correct_sales_note / reverse_consignment_shipment（已 batch+return aware）。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. receive_purchase_items（p_lots jsonb DEFAULT NULL）
--    序號：每台一列 product_batches（serial_number、quantity=1）+ 逐台 movement。
--    批號：一批一列（batch_number、quantity=GREATEST(qty,1)）+ 單筆 movement。
--    無 p_lots / 無追蹤：照舊單筆 movement（與原 2 參數版一致）。
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
-- 2. create_consignment_shipment（寄賣草稿直接出貨 → 扣存走 helper）
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
-- 3. delete_sales_note（return-aware 基底 + 依原出貨批次逐批還原）
--    merge 規則：
--      * 一般（自有倉）列：先按 batch_id（sales_shipment）逐批還原（bounds 用原批次倉位），
--        剩餘未批次部分以無批次 sales_note_deletion 回補；return 列維持 signed 單筆回補。
--      * 寄賣列：source_type mapping 以「遠端現行」為準
--        （store_consignment → consignment_shipment_reversal），逐批還原後剩餘以無批次回補。
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
  v_abs_qty INTEGER;
  v_is_return_line BOOLEAN;
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
           oi.shipped_quantity, oi.order_id, oi.product_id, oi.variant_id, oi.line_type,
           oi.return_status
    FROM public.sales_note_items si
    JOIN public.order_items oi ON si.order_item_id = oi.id
    WHERE si.sales_note_id = p_sales_note_id
  LOOP
    IF NOT (v_item.order_id = ANY(v_order_ids)) THEN
      v_order_ids := array_append(v_order_ids, v_item.order_id);
    END IF;

    v_abs_qty := ABS(v_item.quantity);
    v_is_return_line := (v_item.line_type = 'return');

    v_new_shipped := GREATEST(0, v_item.shipped_quantity - v_abs_qty);
    v_total_quantity := v_item.total_quantity;

    UPDATE public.order_items
    SET shipped_quantity = v_new_shipped,
        status = CASE
                    WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                    WHEN v_new_shipped < v_total_quantity THEN 'partial'::order_item_status
                    ELSE 'shipped'::order_item_status
                 END,
        return_status = CASE WHEN v_is_return_line THEN 'pending'::text ELSE return_status END,
        line_note = CASE WHEN v_is_return_line
                         THEN regexp_replace(COALESCE(line_note, ''), '(；)?(退貨出貨入庫|出貨退回入庫)$', '')
                         ELSE line_note END
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
        v_source_type := 'consignment_shipment_reversal';
        v_owner := 'store_consignment';
      ELSE
        v_source_type := 'consignment_sale_reversal';
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

    -- 庫存逆轉：一般列依原出貨批次逐批回補（有 batch_id 者），其餘以一般 deletion 回補；
    -- 退貨列維持 signed 單筆回補（-abs，回補出貨所加之庫存）。
    IF v_is_return_line THEN
      PERFORM public.upsert_sales_note_deletion_movement(
        p_sales_note_id, v_item.order_item_id, v_item.product_id, v_item.variant_id,
        v_own_warehouse_id, -v_abs_qty, v_sn_code, NULL
      );
    ELSE
      v_plain_qty := v_abs_qty;
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
    END IF;

    SELECT quantity INTO v_pool_quantity
    FROM public.shipping_pool WHERE order_item_id = v_item.order_item_id;

    IF FOUND THEN
      UPDATE public.shipping_pool
      SET quantity = v_pool_quantity + v_abs_qty
      WHERE order_item_id = v_item.order_item_id;
    ELSE
      INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
      SELECT v_item.order_item_id, v_abs_qty, o.store_id, o.created_by
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_sales_note(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_sales_note(uuid) TO authenticated;

COMMIT;