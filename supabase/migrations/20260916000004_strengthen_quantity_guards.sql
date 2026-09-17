-- ============================================================
-- 20260916000004_strengthen_quantity_guards.sql
-- 補強「訂單 ↔ 出貨池 ↔ 銷售單/寄賣單」之間的數量關係檢查。
-- 根因：ship_from_pool / create_consignment_shipment 本就信賴上游
-- 設定數量，出貨時沒有二次驗證；update_order_with_items 對已出貨
-- 品項的改量/刪除也無守門。
-- 本次補強（皆不異動簽名，僅 REPLACE body）：
--   1. ship_from_pool：每項出貨前檢查 pool 數量 ≤ 訂單剩餘
--      （quantity - shipped_quantity），超賣直接 RAISE。
--   2. create_consignment_shipment：重用既有 order_item 時，
--      檢查 shipped_quantity 累加後不會超過 order_item.quantity。
--   3. create_consignment_shipment_layer：要求傳入出貨量 ≤
--      order_item 宣告總量（低成本 sanity bound，杜絕荒謬輸入）。
--   4. update_order_with_items：刪除既有品項時，已出貨
--      （shipped_quantity > 0 或已被銷貨單/寄賣引用）一律擋下；
--      既有品項新數量不可低於 shipped_quantity。
-- ============================================================

-- ============================================================
-- 1. ship_from_pool：出貨前剩餘量檢查
-- ============================================================
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

      -- 數量守門：出貨池數量不可超過訂單剩餘未出貨量（防止超賣/重複出貨）
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

-- ============================================================
-- 2. create_consignment_shipment：重用既有 order_item 時檢查剩餘量
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
      -- 數量守門：累加後不可超過來源 order_item 宣告總量（防止重複/超量出貨）
      IF v_oi_shipped + v_ship_qty > v_oi_qty THEN
        RAISE EXCEPTION '寄賣出貨量 % 超出來源訂單品項剩餘：已出貨 % / 總量 %（order_item %）',
          v_ship_qty, v_oi_shipped, v_oi_qty, v_oi_id;
      END IF;

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

REVOKE ALL ON FUNCTION public.create_consignment_shipment(UUID, UUID, TEXT, TIMESTAMPTZ) FROM public;
GRANT EXECUTE ON FUNCTION public.create_consignment_shipment(UUID, UUID, TEXT, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 3. create_consignment_shipment_layer：出貨量不得超過 order_item 宣告總量
--    （低成本 sanity bound。呼叫端必須在更新 shipped_quantity 之前完成
--      剩餘量驗證，故此處不讀 shipped_quantity，避免與已更新值衝突。）
-- ============================================================
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

    SELECT oi.product_id, oi.variant_id, oi.unit_price, oi.store_id, oi.order_id, oi.quantity,
           o.code AS order_code
    INTO v_oi
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = v_order_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'order_item 不存在：%', v_order_item_id;
    END IF;

    -- 數量守門：傳入出貨量不可超過 order_item 宣告總量（杜絕荒謬/重複輸入）
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
-- 4. update_order_with_items：刪除/改量守門（不依賴收款狀態）
-- ============================================================
DROP FUNCTION IF EXISTS public.update_order_with_items(uuid, text, jsonb, uuid[]);

CREATE OR REPLACE FUNCTION public.update_order_with_items(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]',
  p_deleted_item_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_item_id UUID;
  v_temp_key TEXT;
  v_parent_temp TEXT;
  v_has_paid_note BOOLEAN;
  v_paid_note_code TEXT;
  v_affecting_changes BOOLEAN;
  v_shipped_deletion BOOLEAN;
  v_low_quantity BOOLEAN;
BEGIN
  -- 守門：若訂單已有已收款的銷貨單，擋下會影響會計的品項變更
  --（sales_notes 經 sales_note_items.order_item_id → order_items 關聯訂單）
  SELECT EXISTS (
    SELECT 1 FROM public.sales_notes sn
    JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    WHERE oi.order_id = p_order_id
      AND sn.payment_status = 'paid'
  ) INTO v_has_paid_note;

  IF v_has_paid_note THEN
    -- 判斷是否有「會影響會計金額」的變更：
    -- 1) 有要刪除的既有品項
    -- 2) 有新品項（id IS NULL）
    -- 3) 既有品項的 quantity 或 unit_price 與 DB 不一致
    v_affecting_changes := false;

    IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.id = ANY(p_deleted_item_ids) AND oi.order_id = p_order_id
      ) THEN
        v_affecting_changes := true;
      END IF;
    END IF;

    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) AS el
        WHERE (el->>'id') IS NULL
      ) THEN
        v_affecting_changes := true;
      END IF;
    END IF;

    IF NOT v_affecting_changes AND p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS el
        JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
        WHERE (el->>'id') IS NOT NULL
          AND (
            oi.quantity <> (el->>'quantity')::INT
            OR oi.unit_price <> (el->>'unit_price')::NUMERIC
          )
      ) INTO v_affecting_changes;
    END IF;

    IF v_affecting_changes THEN
      SELECT sn.code INTO v_paid_note_code
      FROM public.sales_notes sn
      JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
      JOIN public.order_items oi ON oi.id = sni.order_item_id
      WHERE oi.order_id = p_order_id AND sn.payment_status = 'paid'
      LIMIT 1;
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '此訂單已有已收款的銷貨單（' || COALESCE(v_paid_note_code, '') || '），修改品項、數量或單價會導致會計紀錄不一致。請先至會計模組回退收款後再修改。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'paid_sales_note', 'code', v_paid_note_code, 'label', '已收款銷貨單'))
      );
    END IF;
    -- 僅備註/排序變更：允許繼續
  END IF;

  -- 數量守門（不依賴收款狀態，處理「已出貨但未收款」或寄賣已出貨的品項）：
  -- 1) 刪除既有品項：已出貨（shipped_quantity > 0）不可直接刪除
  --    （sales_note_items.order_item_id 為 FK，且刪除已出貨品項會弄垮銷售/寄賣紀錄）
  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.order_items oi
      WHERE oi.id = ANY(p_deleted_item_ids)
        AND oi.order_id = p_order_id
        AND oi.shipped_quantity > 0
    ) INTO v_shipped_deletion;

    IF v_shipped_deletion THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '有品項已出貨（shipped_quantity > 0），無法直接刪除；請先至銷貨單/寄賣管理回滾出貨後再移除。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'shipped_order_item', 'code', NULL::text, 'label', '已出貨品項'))
      );
    END IF;
  END IF;

  -- 2) 既有品項新數量不可低於已出貨數量（防止負剩餘）
  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS el
      JOIN public.order_items oi ON oi.id = (el->>'id')::UUID AND oi.order_id = p_order_id
      WHERE (el->>'id') IS NOT NULL
        AND (el->>'quantity')::INT < oi.shipped_quantity
    ) INTO v_low_quantity;

    IF v_low_quantity THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '品項新數量不可低於已出貨數量（shipped_quantity）；請先於銷貨單/寄賣管理回滾出貨量後再調整。',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'quantity_below_shipped', 'code', NULL::text, 'label', '數量低於已出貨'))
      );
    END IF;
  END IF;

  -- 1. 更新訂單備註
  UPDATE orders
  SET notes = p_notes, updated_at = now()
  WHERE id = p_order_id;

  -- 若只有備註變更，直接返回
  IF (p_items IS NULL OR jsonb_array_length(p_items) = 0)
     AND (p_deleted_item_ids IS NULL OR array_length(p_deleted_item_ids, 1) = 0) THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- 2. 刪除被移除的品項（軟刪除後端提交；子行因 ON DELETE CASCADE 隨父行刪除）
  IF p_deleted_item_ids IS NOT NULL AND array_length(p_deleted_item_ids, 1) > 0 THEN
    DELETE FROM order_items
    WHERE id = ANY(p_deleted_item_ids)
      AND order_id = p_order_id;
  END IF;

  -- 3. 更新既有品項（id IS NOT NULL）
  UPDATE order_items oi
  SET quantity = (iu.elem->>'quantity')::INT,
      unit_price = (iu.elem->>'unit_price')::NUMERIC,
      unit_cost = COALESCE(NULLIF((iu.elem->>'unit_cost'), '')::NUMERIC, 0),
      sort_order = (iu.elem->>'sort_order')::INT,
      selected_model_name = (iu.elem->>'selected_model_name')::TEXT,
      parent_order_item_id = CASE
        WHEN (iu.elem->>'parent_temp_key') IS NOT NULL THEN NULL
        ELSE NULLIF(iu.elem->>'parent_order_item_id', '')::UUID
      END,
      shipping_payment = NULLIF(iu.elem->>'shipping_payment', ''),
      updated_at = now()
  FROM (
    SELECT elem
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NOT NULL
  ) iu
  WHERE oi.id = (iu.elem->>'id')::UUID
    AND oi.order_id = p_order_id;

  -- 4. 插入新品項（id IS NULL）——先全數插入並紀錄 temp_key → 新 id
  CREATE TEMP TABLE _new_item_map (temp_key text PRIMARY KEY, item_id uuid)
    ON COMMIT DROP;

  FOR v_elem IN
    SELECT elem FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NULL
    ORDER BY (elem->>'sort_order')::INT NULLS LAST
  LOOP
    INSERT INTO order_items (
      order_id, product_id, variant_id, quantity, unit_price,
      unit_cost, selected_model_name, store_id, sort_order, shipping_payment
    )
    SELECT
      p_order_id,
      (v_elem->>'product_id')::UUID,
      NULLIF(v_elem->>'variant_id', '')::UUID,
      (v_elem->>'quantity')::INT,
      (v_elem->>'unit_price')::NUMERIC,
      COALESCE(NULLIF(v_elem->>'unit_cost', '')::NUMERIC, 0),
      NULLIF(v_elem->>'selected_model_name', ''),
      o.store_id,
      (v_elem->>'sort_order')::INT,
      NULLIF(v_elem->>'shipping_payment', '')
    FROM orders o
    WHERE o.id = p_order_id
    RETURNING id INTO v_item_id;

    v_temp_key := v_elem->>'temp_key';
    IF v_temp_key IS NOT NULL THEN
      INSERT INTO _new_item_map (temp_key, item_id) VALUES (v_temp_key, v_item_id);
    END IF;
  END LOOP;

  -- 5. 承接子行：以 parent_temp_key 找到父行新 id
  FOR v_elem, v_temp_key, v_parent_temp IN
    SELECT elem, elem->>'temp_key', elem->>'parent_temp_key'
    FROM jsonb_array_elements(p_items) AS elem
    WHERE (elem->>'id') IS NULL
      AND (elem->>'parent_temp_key') IS NOT NULL
  LOOP
    UPDATE order_items oi
    SET parent_order_item_id = m.item_id
    FROM _new_item_map m
    WHERE m.temp_key = v_parent_temp
      AND oi.id = (SELECT item_id FROM _new_item_map WHERE temp_key = v_temp_key)
      AND oi.order_id = p_order_id;
  END LOOP;

  DROP TABLE _new_item_map;

  RETURN jsonb_build_object('ok', true);
END;
$$;