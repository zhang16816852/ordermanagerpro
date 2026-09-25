-- ============================================================
-- 20260923000002_extend_consignment_shipment_delivery.sql
-- 寄賣出貨（create_consignment_shipment）支援配送參數：
--   * 訂單「轉寄賣草稿」複製 delivery_type＋shipping_address（後續出貨繼承）
--   * create_consignment_shipment：4 參數 → 12 參數（尾端全 DEFAULT）
--       + p_delivery_type / p_delivery_method_id / p_shipping_fee / p_shipping_cost
--       + p_tracking_company / p_tracking_number / p_tracking_url / p_shipping_address
--     ⚠️ 先 DROP 舊精確簽名（4 參數）再 CREATE（單一簽名，避免 PGRST203 overload）
--   * 配送解析走共用 helper public._resolve_delivery
--   * logistics：建立 1 個包裹（upsert_shipment）＋寫寄賣單方法快照/地址
--   * delivery：套用預設送貨方法快照、不建包裹
--   * pickup：只寫類型
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. convert_order_to_consignment_draft：草稿複製配送資訊
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_order_to_consignment_draft(
  p_order_id UUID,
  p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_order RECORD;
  v_co_id UUID;
  v_item RECORD;
  v_unshipped INTEGER;
  v_oi_id UUID;
  v_coi_id UUID;
BEGIN
  SELECT id, status, store_id, source_type, consignment_mode, delivery_type, shipping_address
  INTO v_order
  FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '訂單不存在');
  END IF;

  -- 已是寄賣鏡像單，不可再轉
  IF v_order.source_type = 'consignment' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此為寄賣鏡像訂單，請至寄賣管理處理');
  END IF;

  IF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅待確認（pending）訂單可轉寄賣草稿');
  END IF;

  -- 檢查是否有未出貨品項
  SELECT COALESCE(SUM(oi.quantity - oi.shipped_quantity), 0)::INTEGER
  INTO v_unshipped
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.status NOT IN ('cancelled', 'discontinued');
  IF v_unshipped IS NULL OR v_unshipped <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此訂單沒有未出貨品項');
  END IF;

  -- 尋找既有未取消的寄賣草稿，避免重複建立
  IF v_order.consignment_mode THEN
    SELECT id INTO v_co_id
    FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND source_order_id = p_order_id
      AND status IN ('draft', 'active')
    LIMIT 1;
    IF v_co_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'consignment_order_id', v_co_id, 'order_id', p_order_id, 'reused', true);
    END IF;
  END IF;

  -- 標記寄賣模式（維持 pending，不出貨）
  IF NOT v_order.consignment_mode THEN
    UPDATE public.orders
    SET consignment_mode = true, updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  -- 建立寄賣草稿（未出貨）；配送資訊自來源訂單快照
  INSERT INTO public.consignment_orders (
    direction, store_id, status, source_order_id, created_by, note,
    delivery_type, shipping_address
  )
  SELECT 'send_to_store', v_order.store_id, 'draft', p_order_id, p_created_by,
         o.notes, o.delivery_type, o.shipping_address
  FROM public.orders o WHERE o.id = p_order_id
  RETURNING id INTO v_co_id;

  -- 逐項鏡像 order_items → consignment_order_items（不扣庫存）
  FOR v_item IN
    SELECT oi.id, oi.product_id, oi.variant_id, oi.quantity, oi.shipped_quantity,
           oi.unit_price, oi.unit_cost
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND oi.status NOT IN ('cancelled', 'discontinued')
      AND (oi.quantity - oi.shipped_quantity) > 0
  LOOP
    -- 若已連結既有寄賣品項則沿用
    SELECT id INTO v_coi_id
    FROM public.consignment_order_items
    WHERE consignment_order_id = v_co_id
      AND order_item_id = v_item.id
    LIMIT 1;

    IF v_coi_id IS NULL THEN
      INSERT INTO public.consignment_order_items (
        consignment_order_id, order_item_id, product_id, variant_id,
        quantity, unit_price, unit_cost
      )
      VALUES (
        v_co_id, v_item.id, v_item.product_id, v_item.variant_id,
        v_item.quantity - v_item.shipped_quantity,
        v_item.unit_price, COALESCE(v_item.unit_cost, 0)
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'consignment_order_id', v_co_id,
    'order_id', p_order_id,
    'reused', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_order_to_consignment_draft(UUID, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_order_to_consignment_draft(UUID, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 2. create_consignment_shipment：4 參數 → 12 參數（含配送）
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_consignment_shipment(UUID, UUID, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_delivery_type TEXT DEFAULT NULL,
  p_delivery_method_id UUID DEFAULT NULL,
  p_shipping_fee NUMERIC DEFAULT NULL,
  p_shipping_cost NUMERIC DEFAULT NULL,
  p_tracking_company TEXT DEFAULT NULL,
  p_tracking_number TEXT DEFAULT NULL,
  p_tracking_url TEXT DEFAULT NULL,
  p_shipping_address JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
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

  -- 來源訂單：優先重用既有（草稿建立時已建），僅 legacy 才補建
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

    -- 重用既有 order_item；無則補建並回填連結
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

    -- 已出貨 ⇒ 不在出貨池
    DELETE FROM public.shipping_pool WHERE order_item_id = v_oi_id;

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_item.product_id, v_item.variant_id, v_own_wh, -v_ship_qty, 'consignment_out_shipment',
      p_consignment_order_id, v_item.consignment_order_item_id,
      v_order_code, 'store_consignment', p_created_by
    );
  END LOOP;

  -- 啟動（draft→active）：落地 shipped_at，code 由 trigger 依 shipped_at 產正式碼
  UPDATE public.consignment_orders
  SET status = 'active', shipped_at = v_shipped_at, updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';

  -- 配送：類型驅動（logistics 建 1 包；delivery 套預設方法不建包；pickup 只寫類型）
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
    -- pickup：只寫類型
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
$$;

REVOKE ALL ON FUNCTION public.create_consignment_shipment(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, JSONB) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_consignment_shipment(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, UUID, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMIT;