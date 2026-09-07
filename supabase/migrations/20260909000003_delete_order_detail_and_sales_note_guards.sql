-- ============================================================
-- 20260909000003_delete_order_detail_and_sales_note_guards.sql
-- 1) delete_order_if_unadopted：改回傳「被哪張單據採用」的明細（單號/類型/數量），
--    供前端 toast 明確顯示採用來源。
-- 2) delete_sales_note：加守門——已有收款分錄（accounting_entries income）／
--    業務佣金發放登記（rep_commission_payouts）／銷售已記帳（consignment_sales confirmed）
--    的銷貨單直接擋下並回傳原因（RETURNS JSONB），避免**會計紀錄與帳戶餘額**
--    在刪單後變成孤兒（原本分錄以 reference_type='sales_note' 字串關聯，刪單不會清理）。
--    寄賣銷售已記帳者請由寄賣流程反向處理（reverse / return），不可直接刪銷貨單。
-- ============================================================

-- ============================================================
-- 1) delete_order_if_unadopted：回傳被採用明細
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_order_if_unadopted(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status  TEXT;
  v_source  TEXT;
  v_lines   JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除訂單');
  END IF;

  SELECT status, source_type INTO v_status, v_source
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '訂單不存在');
  END IF;

  -- 寄賣鏡像訂單（send_to_store 同步建立的 orders）不可直接刪除
  IF v_source = 'consignment' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣鏡像訂單請至寄賣管理處理');
  END IF;

  -- 已被銷貨單採用：列出銷貨單編號
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'sales_note',
    'code', sn.code,
    'label', '銷貨單'
  )), '[]'::jsonb) INTO v_lines
  FROM public.sales_note_items sni
  JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
  JOIN public.order_items oi ON oi.id = sni.order_item_id
  WHERE oi.order_id = p_order_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被銷貨單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 尚有品項在出貨池
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'shipping_pool', 'label', '出貨池')), '[]'::jsonb) INTO v_lines
  FROM public.shipping_pool sp
  WHERE sp.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '仍有品項在出貨池，請先移出訂單', 'adopted_by', v_lines);
  END IF;

  -- 已被寄賣單採用（來源單）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'consignment',
    'code', co.code,
    'label', '寄賣單'
  )), '[]'::jsonb) INTO v_lines
  FROM public.consignment_orders co
  WHERE co.source_order_id = p_order_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被寄賣單採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 寄賣品項已出貨
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'consignment_item', 'label', '寄賣品項')), '[]'::jsonb) INTO v_lines
  FROM public.consignment_order_items coi
  WHERE coi.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣品項已出貨，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 寄賣銷售已記帳
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'consignment_sale', 'label', '寄賣銷售')), '[]'::jsonb) INTO v_lines
  FROM public.consignment_sales cs
  WHERE cs.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣銷售已記帳，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存異動紀錄
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind', 'inventory', 'label', '庫存異動')), '[]'::jsonb) INTO v_lines
  FROM public.inventory_movements im
  WHERE im.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有庫存異動紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 銷貨退貨曾參照此訂單品項
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'return', 'label', '銷貨退貨')), '[]'::jsonb) INTO v_lines
  FROM public.sales_note_return_items sri
  WHERE sri.order_item_id IN (
    SELECT oi2.id FROM public.order_items oi2 WHERE oi2.order_id = p_order_id
  );
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '曾登記退貨，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被採購單採用（source_quantities jsonb 含此訂單 id）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'purchase_order',
    'code', po.code,
    'label', '採購單'
  )), '[]'::jsonb) INTO v_lines
  FROM public.purchase_order_items poi
  JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
  WHERE poi.source_quantities ? p_order_id::text;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被採購單採用，請先解除連結', 'adopted_by', v_lines);
  END IF;

  -- 已被會計分錄採用（entry row 或 entry_references 子表 two-path）
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'accounting', 'label', '會計分錄')), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT 1 FROM public.accounting_entries ae WHERE ae.reference_type = 'order' AND ae.reference_id = p_order_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer WHERE aer.reference_type = 'order' AND aer.reference_id = p_order_id
  ) x;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被會計分錄採用，無法刪除', 'adopted_by', v_lines);
  END IF;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ============================================================
-- 2) delete_sales_note：加 收款分錄 / 佣金發放 / 寄賣銷售記帳 守門
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
  -- ---------- 守門：已收貨 ／ 有會計紀錄者不可刪除 ----------
  SELECT status, code INTO v_sn_status, v_sn_code FROM public.sales_notes WHERE id = p_sales_note_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單不存在');
  END IF;

  IF v_sn_status = 'received' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '銷貨單已收貨，無法刪除', 'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'label', '已收貨狀態')));
  END IF;

  -- 已有收款分錄（entry row 或 entry_references 子表）
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

  -- 銷售已記帳（寄賣確認後的收款銷貨單）不可直接刪除，須由寄賣流程反向處理
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

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, sales_note_id, order_item_id, reference_code, created_by)
    VALUES (v_item.product_id, v_item.variant_id, v_own_warehouse_id, v_item.quantity, 'sales_note_deletion', p_sales_note_id, v_item.order_item_id, v_sn_code, NULL);

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