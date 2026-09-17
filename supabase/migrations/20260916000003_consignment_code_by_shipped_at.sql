-- ============================================================
-- 寄賣單號碼改依出貨時間（shipped_at）+ 店家分群
-- 格式：CS{YYMM}{店碼}{0001}
--   · YYMM 看出貨時間（shipped_at；fallback created_at / NOW()），避免補單跨月
--   · 店碼取 stores.code（receive_from_supplier 無店碼時 fallback 'SP'）
--   · 流水 4 位，逐月逐店累加（system_sequences，key = consignment_{YYMM}_{store_id}）
--   · 草稿（draft）用暫存碼 CS-DRAFT-{id 前 8 碼}，出貨（draft→active）時才產正式碼
-- 附：create_consignment_shipment_layer 改為 canonical 6 參數簽名
--   （p_store_id, p_created_by, p_order_items, p_shipped_at, p_notes, p_warehouse_id），
--   修復本地 20260911000008 ship_from_pool 呼叫 5 參數而函式不存在的潛在 bug；
--   三支呼叫端（ship_from_pool / direct_ship_order / create_order_with_sales_note）
--   一併改傳 p_shipped_at 讓「下單即出貨」與出貨池補單的寄賣碼月份正確。
-- ============================================================

-- 1. consignment_orders 新增 shipped_at
ALTER TABLE public.consignment_orders
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

-- 2. 產號：逐月逐店累加
CREATE OR REPLACE FUNCTION public.next_consignment_code(
  p_shipped_at TIMESTAMPTZ,
  p_store_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yy TEXT;
  v_seq_key TEXT;
  v_new_val INTEGER;
  v_store_code TEXT;
BEGIN
  p_shipped_at := COALESCE(p_shipped_at, NOW());

  SELECT COALESCE(code, substring(id::text, 1, 4)) INTO v_store_code
  FROM public.stores WHERE id = p_store_id;

  v_store_code := COALESCE(v_store_code, 'SP');

  v_yy := to_char(p_shipped_at, 'YYMM');
  v_seq_key := 'consignment_' || v_yy || '_' || COALESCE(p_store_id::text, 'SP');

  INSERT INTO public.system_sequences (name, current_value, updated_at)
  VALUES (v_seq_key, 1, NOW())
  ON CONFLICT (name) DO UPDATE
  SET current_value = system_sequences.current_value + 1, updated_at = NOW()
  RETURNING current_value INTO v_new_val;

  RETURN 'CS' || v_yy || COALESCE(v_store_code, 'SP') || lpad(v_new_val::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_consignment_code(TIMESTAMPTZ, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.next_consignment_code(TIMESTAMPTZ, UUID) TO authenticated;

-- 3. 改寫 code trigger：INSERT 產號 + draft→active UPDATE 時把暫存碼換成正式碼
CREATE OR REPLACE FUNCTION public.trgfn_generate_consignment_code()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'draft' THEN
      NEW.code := 'CS-DRAFT-' || substr(replace(NEW.id::text, '-', ''), 1, 8);
      RETURN NEW;
    END IF;

    NEW.code := public.next_consignment_code(
      COALESCE(NEW.shipped_at, NEW.created_at, NOW()),
      NEW.store_id
    );
    RETURN NEW;
  END IF;

  -- UPDATE：草稿啟動（draft→active）且仍是暫存碼（或無碼）時產正式碼
  IF OLD.status = 'draft'
     AND NEW.status <> 'draft'
     AND (NEW.code LIKE 'CS-DRAFT-%' OR NEW.code IS NULL)
  THEN
    NEW.code := public.next_consignment_code(
      COALESCE(NEW.shipped_at, NEW.created_at, NOW()),
      NEW.store_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consignment_generate_code ON public.consignment_orders;
CREATE TRIGGER trg_consignment_generate_code
  BEFORE INSERT OR UPDATE OF status ON public.consignment_orders
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_generate_consignment_code();

-- ============================================================
-- 4. create_consignment_shipment_layer：canonical 6 參數
--    （取代舊 3 參數 (p_order_items, p_warehouse_id, p_created_by)）
-- ============================================================
DROP FUNCTION IF EXISTS public.create_consignment_shipment_layer(JSONB, UUID, UUID);

CREATE OR REPLACE FUNCTION public.create_consignment_shipment_layer(
  p_store_id UUID,
  p_created_by UUID,
  p_order_items JSONB,
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL
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
  v_shipped_at TIMESTAMPTZ;
  v_warehouse_id UUID;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

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
      INSERT INTO public.consignment_orders (direction, store_id, status, created_by, source_order_id, shipped_at)
      VALUES ('send_to_store', v_oi.store_id, 'active', p_created_by, v_oi.order_id, v_shipped_at)
      RETURNING id INTO v_co_id;
    ELSE
      UPDATE public.consignment_orders
      SET status = 'active', shipped_at = v_shipped_at, updated_at = NOW()
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
      v_oi.product_id, v_oi.variant_id, v_warehouse_id, -v_qty, 'consignment_out_shipment',
      v_co_id, v_coi_id, v_oi.order_code, 'store_consignment', p_created_by
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_consignment_shipment_layer(UUID, UUID, JSONB, TIMESTAMPTZ, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_consignment_shipment_layer(UUID, UUID, JSONB, TIMESTAMPTZ, TEXT, UUID) TO authenticated;

-- ============================================================
-- 5. create_consignment_shipment：落地 shipped_at（原 p_shipped_at 為 dead param）
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
  v_shipped_at TIMESTAMPTZ;
  v_code TEXT;
  v_result JSONB;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());

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

-- ============================================================
-- 6. 三支呼叫端改傳 p_shipped_at（列層改呼叫 canonical 6 參數 layer）
-- ============================================================

-- 6a. ship_from_pool（保有 audit_logs / 整池清理；僅改 layer 呼叫並串 shipped_at）
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

    -- 處理寄賣品項（改走 canonical 6 參數 layer，傳 shipped_at）
    IF jsonb_array_length(v_consignment_items) > 0 THEN
      PERFORM public.create_consignment_shipment_layer(
        v_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes
      );
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
$$;

REVOKE ALL ON FUNCTION public.ship_from_pool(UUID[], UUID, TEXT, TIMESTAMPTZ, UUID, JSONB, JSONB, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.ship_from_pool(UUID[], UUID, TEXT, TIMESTAMPTZ, UUID, JSONB, JSONB, JSONB) TO authenticated;

-- 6b. direct_ship_order：consignment 分支改傳 shipped_at + store_id + warehouse
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
    END LOOP;

    IF jsonb_array_length(v_consignment_items) > 0 THEN
      PERFORM public.create_consignment_shipment_layer(
        v_order.store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes, v_default_warehouse_id
      );
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

    IF v_source = 'self' THEN
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, order_item_id, reference_code, created_by)
      VALUES (v_item.product_id, v_item.variant_id, v_item_warehouse_id, -v_remaining_qty, 'sales_shipment', v_sales_note_id, v_item.id, v_sales_note_code, p_created_by);
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

REVOKE ALL ON FUNCTION public.direct_ship_order(UUID, UUID, TEXT, TIMESTAMPTZ, UUID, JSONB, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.direct_ship_order(UUID, UUID, TEXT, TIMESTAMPTZ, UUID, JSONB, JSONB) TO authenticated;

-- 6c. create_order_with_sales_note：consignment 分支改傳 shipped_at + store_id + warehouse
CREATE OR REPLACE FUNCTION public.create_order_with_sales_note(
  p_store_id UUID,
  p_created_by UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_shipped_at TIMESTAMPTZ DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_consignment_mode BOOLEAN DEFAULT false
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
  v_source TEXT;
  v_result JSONB;
  v_default_warehouse_id UUID;
  v_item_warehouse_id UUID;
  v_shipped_at TIMESTAMPTZ;
  v_consignment_items JSONB := '[]'::JSONB;
  v_temp_key TEXT;
  v_parent_temp TEXT;
BEGIN
  v_shipped_at := COALESCE(p_shipped_at, NOW());
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));

  INSERT INTO public.orders (store_id, created_by, notes, source_type, status, consignment_mode, access_token)
  VALUES (p_store_id, p_created_by, p_notes, 'admin_proxy', 'shipped', p_consignment_mode, gen_random_uuid())
  RETURNING id, code INTO v_order_id, v_order_code;

  IF NOT p_consignment_mode THEN
    v_access_token := gen_random_uuid();
    INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes, access_token, warehouse_id)
    VALUES (p_store_id, p_created_by, 'shipped', v_shipped_at, p_notes, v_access_token, v_default_warehouse_id)
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
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, reference_code, created_by)
      VALUES (v_product_id, v_variant_id, COALESCE((v_item->>'warehouse_id')::UUID, v_default_warehouse_id), -v_quantity, 'sales_shipment', v_sales_note_id, v_sales_note_code, p_created_by);
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
      p_store_id, p_created_by, v_consignment_items, v_shipped_at, p_notes, v_default_warehouse_id
    );
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
$$;

REVOKE ALL ON FUNCTION public.create_order_with_sales_note(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, UUID, BOOLEAN) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_with_sales_note(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, UUID, BOOLEAN) TO authenticated;