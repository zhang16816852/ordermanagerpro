-- ============================================================
-- 20260916000001_fix_sales_note_deletion_merge.sql
-- 修復 23505：銷貨單「修正（correct_sales_note）先移除、再加回同一品項」後，
--   delete_sales_note 對同一 (sales_note_id, order_item_id) 再次 INSERT sales_note_deletion
--   撞上部分唯一索引 idx_invmov_unique_deletion 而整支回滾。
--
-- 解法：新增共用 helper upsert_sales_note_deletion_movement——
--   若同 key 已有 sales_note_deletion 列則「累加」數量（不新增列），並手動同步
--   product_inventory（BEFORE INSERT trigger 只對 INSERT 生效，UPDATE 不會自動扣/加）；
--   否則照舊 INSERT（由 trigger 處理庫存）。
--   delete_sales_note 與 correct_sales_note（Phase 1 移除）的非寄賣分支皆改用此 helper。
-- ============================================================

-- ---------- 共用 helper ----------
CREATE OR REPLACE FUNCTION public.upsert_sales_note_deletion_movement(
  p_sales_note_id UUID,
  p_order_item_id UUID,
  p_product_id UUID,
  p_variant_id UUID,
  p_warehouse_id UUID,
  p_quantity INTEGER,
  p_reference_code TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE sales_note_id = p_sales_note_id
      AND order_item_id = p_order_item_id
      AND source_type = 'sales_note_deletion'
  ) THEN
    -- 已有同 key 的 deletion 列（先前修正移除留下）→ 累加數量、不新增列
    UPDATE public.product_inventory
    SET quantity = quantity + p_quantity, updated_at = NOW()
    WHERE product_id = p_product_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id
      AND warehouse_id = p_warehouse_id
    RETURNING quantity INTO v_new_balance;

    IF NOT FOUND THEN
      INSERT INTO public.product_inventory (product_id, variant_id, warehouse_id, quantity, updated_at)
      VALUES (p_product_id, p_variant_id, p_warehouse_id, p_quantity, NOW())
      RETURNING quantity INTO v_new_balance;
    END IF;

    UPDATE public.inventory_movements
    SET quantity_change = quantity_change + p_quantity,
        balance_after = COALESCE(v_new_balance, quantity_change),
        reference_code = COALESCE(p_reference_code, reference_code),
        created_by = COALESCE(p_created_by, created_by)
    WHERE sales_note_id = p_sales_note_id
      AND order_item_id = p_order_item_id
      AND source_type = 'sales_note_deletion';
  ELSE
    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      sales_note_id, order_item_id, reference_code, created_by
    )
    VALUES (
      p_product_id, p_variant_id, p_warehouse_id, p_quantity, 'sales_note_deletion',
      p_sales_note_id, p_order_item_id, p_reference_code, p_created_by
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_sales_note_deletion_movement(uuid, uuid, uuid, uuid, uuid, integer, text, uuid) FROM public, anon, authenticated;
-- 此 helper 僅供 delete_sales_note / correct_sales_note（SECURITY DEFINER）內部呼叫，
-- 不開放給一般 authenticated 直接執行（避免任意加庫存）。

-- ============================================================
-- delete_sales_note：非寄賣分支改用 helper（累加既有 deletion，避免 23505）
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_sales_note(
  p_sales_note_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item RECORD;
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
        v_source_type := 'consignment_shipment_reversal';
        v_owner := 'store_consignment';
      ELSE
        v_source_type := 'consignment_sale_reversal';
        v_owner := 'supplier_consignment';
      END IF;

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, consignment_order_id, consignment_order_item_id,
        inventory_owner, reference_code, created_by
      )
      SELECT
        v_item.product_id, v_item.variant_id,
        CASE WHEN v_item.inventory_source_type = 'store_consignment'
             THEN v_own_warehouse_id ELSE v_consignment_wh_id END,
        v_item.quantity, v_source_type,
        p_sales_note_id, m.consignment_order_id, m.consignment_order_item_id,
        v_owner, v_sn_code, NULL
      FROM public.inventory_movements m
      WHERE m.sales_note_id = p_sales_note_id
        AND m.consignment_order_item_id IS NOT NULL
        AND m.product_id = v_item.product_id
        AND m.variant_id IS NOT DISTINCT FROM v_item.variant_id
      LIMIT 1;

      CONTINUE;
    END IF;

    PERFORM public.upsert_sales_note_deletion_movement(
      p_sales_note_id, v_item.order_item_id, v_item.product_id, v_item.variant_id,
      v_own_warehouse_id, v_item.quantity, v_sn_code, NULL
    );

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

-- ============================================================
-- correct_sales_note：Phase 1 移除之非寄賣分支改用同 helper（累加，避免重複修正再次 23505）
-- ============================================================
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

  -- Phase 1: 移除品項
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

      DELETE FROM public.inventory_movements
      WHERE sales_note_id = p_sales_note_id
        AND order_item_id = v_sni.order_item_id
        AND source_type IN ('sales_shipment', 'consignment_out_shipment');

      v_is_consignment := v_sni.inventory_source_type IN ('supplier_consignment', 'store_consignment');
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
        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change, source_type,
          sales_note_id, order_item_id, inventory_owner, reference_code, created_by
        )
        VALUES (
          v_oi.product_id, v_oi.variant_id, v_ship_wh, v_sni.quantity, v_source_type,
          p_sales_note_id, v_sni.order_item_id, v_owner, v_new_sni_code, p_created_by
        );
      ELSE
        PERFORM public.upsert_sales_note_deletion_movement(
          p_sales_note_id, v_sni.order_item_id, v_oi.product_id, v_oi.variant_id,
          v_own_wh, v_sni.quantity, v_new_sni_code, p_created_by
        );
      END IF;

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
        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change, source_type,
          sales_note_id, order_item_id, reference_code, created_by
        )
        VALUES (
          v_oi.product_id, v_oi.variant_id, v_own_wh, -v_item_quantity, 'sales_shipment',
          p_sales_note_id, v_item_order_item_id, v_new_sni_code, p_created_by
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

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, order_item_id, reference_code, created_by
      )
      VALUES (
        (v_elem->>'product_id')::UUID,
        NULLIF(v_elem->>'variant_id', '')::UUID,
        v_own_wh, -v_item_quantity, 'sales_shipment',
        p_sales_note_id, v_new_order_item_id, v_new_sni_code, p_created_by
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

REVOKE ALL ON FUNCTION public.delete_sales_note(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_sales_note(uuid) TO authenticated;