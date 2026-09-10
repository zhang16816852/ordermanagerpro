-- ============================================================
-- 20260911000007_correct_sales_note.sql
-- 銷貨單修正（不刪單、保活 QR/access_token）
-- 同一張 sales_notes（access_token 不變）內完成三種操作：
--   A. 移除品項（p_items_to_remove）：
--      還原庫存（inventory_movements 反向）＋放回出貨池＋恢復 shipped_quantity
--   B. 追加已有品項（p_items_to_add）：
--      從出貨池／同店家訂單未出貨量拉入，扣庫存＋增加 shipped_quantity
--   C. 追加完全新品（p_new_items）：
--      自動建立簡易訂單（status='shipped', source_type='admin_proxy'）＋ order_item ＋出貨
-- 守門：非 received、無會計分錄（two-path）、無佣金發放、無寄賣記帳、僅 admin
-- 維持不變式：sales_note_items.order_item_id → order_items 連結永不失聯，
--   庫存增減一律有 inventory_movements 對應，無孤兒資料。
-- ============================================================

CREATE OR REPLACE FUNCTION public.correct_sales_note(
  p_sales_note_id UUID,
  p_items_to_remove UUID[] DEFAULT '{}',
  p_items_to_add JSONB DEFAULT '[]',
  p_new_items JSONB DEFAULT '[]',
  p_created_by UUID DEFAULT NULL
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
  v_item_idx INTEGER;
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
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可修正銷貨單');
  END IF;

  -- ---------- 守門 ----------
  SELECT * INTO v_sn FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;
  v_new_sni_code := v_sn.code;

  IF v_sn.status = 'received' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單已收貨，無法修正', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'label', '已收貨狀態')));
  END IF;

  -- 已有會計分錄（entry row 或 entry_references 子表）
  IF EXISTS (
    SELECT 1 FROM public.accounting_entries ae
    WHERE ae.reference_type = 'sales_note' AND ae.reference_id = p_sales_note_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer
    WHERE aer.reference_type = 'sales_note' AND aer.reference_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已有會計分錄（如收款），請先至會計模組回退/刪除分錄', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'accounting', 'label', '會計分錄（收款）')));
  END IF;

  -- 已有業務佣金發放登記
  IF EXISTS (
    SELECT 1 FROM public.rep_commission_payouts rcp WHERE rcp.sales_note_id = p_sales_note_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單已完成業務佣金發放（或已登記），請先撤銷發放', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'rep_payout', 'label', '業務佣金發放')));
  END IF;

  -- 寄賣銷售已記帳
  IF EXISTS (
    SELECT 1 FROM public.consignment_sales cs WHERE cs.sales_note_id = p_sales_note_id AND NOT cs.reversed
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此銷貨單為寄賣確認銷售產生的收款單，請由寄賣流程反向處理', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'consignment_sale', 'label', '寄賣確認銷售')));
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  SELECT id INTO v_consignment_wh FROM public.warehouses WHERE code = 'supplier_consignment';

  -- ---------- Phase 1: 移除品項 ----------
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

      -- 1a. 刪除舊的 sales_shipment movement（釋放 unique index (sales_note_id, order_item_id)）
      DELETE FROM public.inventory_movements
      WHERE sales_note_id = p_sales_note_id
        AND order_item_id = v_sni.order_item_id
        AND source_type IN ('sales_shipment', 'consignment_out_shipment');

      -- 1b. 寫入反向 inventory movement（還原庫存）
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
        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change, source_type,
          sales_note_id, order_item_id, reference_code, created_by
        )
        VALUES (
          v_oi.product_id, v_oi.variant_id, v_own_wh, v_sni.quantity, 'sales_note_deletion',
          p_sales_note_id, v_sni.order_item_id, v_new_sni_code, p_created_by
        );
      END IF;

      -- 1c. 恢復 order_items.shipped_quantity + 狀態重算
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

      -- 1d. 放回出貨池（有列累加、無列新增；idx_shipping_pool_order_item 單 order_item_id 唯一）
      SELECT quantity INTO v_pool_quantity FROM public.shipping_pool WHERE order_item_id = v_sni.order_item_id;
      IF FOUND THEN
        UPDATE public.shipping_pool
        SET quantity = v_pool_quantity + v_sni.quantity
        WHERE order_item_id = v_sni.order_item_id;
      ELSE
        INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
        VALUES (v_sni.order_item_id, v_sni.quantity, v_sn.store_id, p_created_by);
      END IF;

      -- 1e. 記錄受影響訂單
      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      -- 1f. 刪除 sales_note_item
      DELETE FROM public.sales_note_items WHERE id = v_sni.id;

      v_removed_qty := v_removed_qty + v_sni.quantity;
    END LOOP;
  END IF;

  -- ---------- Phase 2: 追加已有品項 ----------
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

      -- 同店家守門
      IF v_oi.store_id <> v_sn.store_id THEN
        RAISE EXCEPTION '不可跨店家追加品項';
      END IF;

      -- 未出貨量充足守門
      v_remaining := v_oi.quantity - v_oi.shipped_quantity;
      IF v_item_quantity > v_remaining THEN
        RAISE EXCEPTION '品項未出貨量不足，剩餘 % 件', v_remaining;
      END IF;

      -- 2a. 建立 sales_note_item
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
      VALUES (
        p_sales_note_id, v_item_order_item_id, v_item_quantity,
        CASE WHEN v_oi.consignment_mode THEN 'store_consignment' ELSE 'self' END,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id)
      );

      -- 2b. 扣庫存
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

      -- 2c. 增加 shipped_quantity + 狀態重算
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

      -- 2d. 若該品項在出貨池則移除
      DELETE FROM public.shipping_pool
      WHERE order_item_id = v_item_order_item_id AND store_id = v_sn.store_id;

      -- 2e. 記錄受影響訂單
      IF NOT (v_oi.order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_oi.order_id);
      END IF;

      v_added_qty := v_added_qty + v_item_quantity;
    END LOOP;
  END IF;

  -- ---------- Phase 3: 追加完全新品（自動建單） ----------
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

      -- 3a. 建立簡易訂單（status='shipped', source_type='admin_proxy', 永久分享 token）
      INSERT INTO public.orders (store_id, created_by, status, source_type, access_token, notes)
      VALUES (v_sn.store_id, p_created_by, 'shipped', 'admin_proxy', gen_random_uuid(),
              '銷貨單修正自動建立（' || v_new_sni_code || '）')
      RETURNING id INTO v_new_order_id;

      -- 3b. 建立 order_item（直接出貨狀態）
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

      -- 3c. 建立 sales_note_item
      INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity, inventory_source_type, sort_order)
      VALUES (
        p_sales_note_id, v_new_order_item_id, v_item_quantity, 'self',
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.sales_note_items WHERE sales_note_id = p_sales_note_id)
      );

      -- 3d. 扣庫存
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

      -- 3e. 記錄受影響訂單
      IF NOT (v_new_order_id = ANY(v_affected_order_ids)) THEN
        v_affected_order_ids := array_append(v_affected_order_ids, v_new_order_id);
      END IF;

      v_new_items_qty := v_new_items_qty + v_item_quantity;
    END LOOP;
  END IF;

  -- ---------- Phase 4: 收尾 ----------
  UPDATE public.sales_notes SET updated_at = NOW() WHERE id = p_sales_note_id;

  -- 受影響訂單狀態收斂：全數出貨 → shipped
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

  -- 回傳目前銷貨單品項快照（供前端刷新）
  v_result := jsonb_build_object(
    'ok', true,
    'sales_note_id', p_sales_note_id,
    'removed_quantity', v_removed_qty,
    'added_quantity', v_added_qty,
    'new_items_quantity', v_new_items_qty,
    'affected_orders', to_jsonb(v_affected_order_ids),
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

-- 權限收斂：僅 authenticated 可執行（函式內另有 admin 守門）
REVOKE ALL ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.correct_sales_note(uuid, uuid[], jsonb, jsonb, uuid) TO authenticated;