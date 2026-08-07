-- ============================================================
-- 回滾後重出貨清理出貨池（v1.5 修補）
-- 目的：維持不變式「order_items 已出貨 ⇒ shipping_pool 無該品項」
-- 背景：reverse_consignment_shipment 回滾時會把品項放回 shipping_pool，
--   但重出貨路徑（create_consignment_shipment / direct_ship_order /
--   create_consignment_shipment_layer）都不消耗 pool，造成 pool 殘留、
--   可被再次從出貨池出貨（重複出貨/重複建寄賣層）。
-- 修正：
--   1. create_consignment_shipment_layer：對出貨的 order_item_id 刪 pool
--   2. create_consignment_shipment：對出貨的 order_item_id 刪 pool
--   3. direct_ship_order（寄賣 + 一般分支）：對出貨的 order_item_id 刪 pool
--   4. reverse_consignment_shipment：pool 回補由「累加」改「覆寫」，
--      避免回滾後又「轉出貨池」時與既有 pool 列疊加
-- ============================================================

-- ============================================================
-- 1. create_consignment_shipment_layer：出貨即清對應 pool 列
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_consignment_shipment_layer(
  p_order_items JSONB,
  p_warehouse_id UUID,
  p_created_by UUID
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_rec JSONB;
  v_order_item_id UUID;
  v_qty INTEGER;
  v_oi RECORD;
  v_co_id UUID;
  v_coi_id UUID;
BEGIN
  FOR v_rec IN SELECT * FROM jsonb_array_elements(p_order_items)
  LOOP
    v_order_item_id := (v_rec->>'order_item_id')::UUID;
    v_qty := (v_rec->>'quantity')::INTEGER;
    CONTINUE WHEN v_qty IS NULL OR v_qty <= 0;

    -- 已出貨 ⇒ 不在出貨池（防止回滾後重出貨 pool 殘留導致重複出貨）
    DELETE FROM public.shipping_pool WHERE order_item_id = v_order_item_id;

    SELECT oi.product_id, oi.variant_id, oi.unit_price, oi.store_id, oi.order_id,
           o.code AS order_code
    INTO v_oi
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = v_order_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_item 不存在：%', v_order_item_id;
    END IF;

    SELECT id INTO v_co_id FROM public.consignment_orders
    WHERE direction = 'send_to_store'
      AND store_id = v_oi.store_id
      AND source_order_id = v_oi.order_id
      AND status IN ('draft', 'active')
    LIMIT 1;

    IF v_co_id IS NULL THEN
      INSERT INTO public.consignment_orders (direction, store_id, status, created_by, source_order_id)
      VALUES ('send_to_store', v_oi.store_id, 'active', p_created_by, v_oi.order_id)
      RETURNING id INTO v_co_id;
    ELSE
      UPDATE public.consignment_orders
      SET status = 'active', updated_at = NOW()
      WHERE id = v_co_id AND status = 'draft';
    END IF;

    -- 重用既有寄賣品項（草稿建立時已預先建立並連結 order_item_id）
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

    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_oi.product_id, v_oi.variant_id, p_warehouse_id, -v_qty, 'consignment_out_shipment',
      v_co_id, v_coi_id, v_oi.order_code, 'store_consignment', p_created_by
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 2. create_consignment_shipment：出貨即清對應 pool 列
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_consignment_shipment(
  p_consignment_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL
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
  v_result JSONB;
BEGIN
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

  UPDATE public.consignment_orders
  SET status = 'active', updated_at = NOW()
  WHERE id = p_consignment_order_id AND status = 'draft';

  UPDATE public.orders
  SET status = 'shipped', updated_at = NOW()
  WHERE id = v_order_id AND status IN ('pending', 'processing');

  v_result := jsonb_build_object(
    'consignment_order_id', p_consignment_order_id,
    'order_id', v_order_id,
    'order_code', v_order_code
  );

  RETURN v_result;
END;
$$;

-- ============================================================
-- 3. direct_ship_order：寄賣 + 一般分支出貨即清對應 pool 列
-- ============================================================
CREATE OR REPLACE FUNCTION public.direct_ship_order(
  p_order_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_warehouse_map JSONB DEFAULT '{}',
  p_source_map JSONB DEFAULT '{}'
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
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_source TEXT;
  v_shipped_at TIMESTAMPTZ;
  v_consignment_items JSONB := '[]'::JSONB;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;

  IF v_order.status NOT IN ('processing', 'pending') THEN
    RAISE EXCEPTION '僅能對處理中或待確認的訂單執行轉銷貨單';
  END IF;

  -- 寄賣模式：不開銷貨單，逐項標 shipped + 建立寄賣層
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

      -- 已出貨 ⇒ 不在出貨池
      DELETE FROM public.shipping_pool WHERE order_item_id = v_item.id;
    END LOOP;

    IF jsonb_array_length(v_consignment_items) > 0 THEN
      PERFORM public.create_consignment_shipment_layer(v_consignment_items, v_default_warehouse_id, p_created_by);
    END IF;

    UPDATE public.orders
    SET status = 'shipped', updated_at = NOW()
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

  INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
  VALUES (v_order.store_id, p_created_by, 'shipped', v_shipped_at, v_sn_notes, v_access_token, v_default_warehouse_id)
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

    -- 已出貨 ⇒ 不在出貨池
    DELETE FROM public.shipping_pool WHERE order_item_id = v_item.id;

    IF v_source = 'self' THEN
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_remaining_qty, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
-- 4. reverse_consignment_shipment：pool 回補改「覆寫」避免累加
-- ============================================================
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
  v_own_wh UUID;
  v_reverse_qty INTEGER;
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

    -- 1) 回補自有倉庫（consignment_shipment_reversal，+qty）
    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      consignment_order_id, consignment_order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      v_item.product_id, v_item.variant_id, v_own_wh, v_reverse_qty,
      'consignment_shipment_reversal',
      p_consignment_order_id, v_item.coi_id,
      v_order.code, 'store_consignment', p_created_by
    );

    -- 2) 來源 order_items：優先既有連結，legacy 依 product/variant 補找
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

        -- 3) 放回出貨池（覆寫：既有列設為回滾量，避免與後續「轉出貨池」累加）
        SELECT quantity INTO v_pool_quantity
        FROM public.shipping_pool WHERE order_item_id = v_oi_id;
        IF FOUND THEN
          UPDATE public.shipping_pool
          SET quantity = v_reverse_qty
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
