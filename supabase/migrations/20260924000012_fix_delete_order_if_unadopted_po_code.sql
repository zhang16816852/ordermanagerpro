-- ============================================================
-- 20260924000012_fix_delete_order_if_unadopted_po_code.sql
-- 修復 delete_order_if_unadopted 採購單守門參照不存在欄位 po.code
-- （purchase_orders 沒有 code 欄，實際單號欄位為 supplier_order_number）
-- 此 bug 自 20260909000003 即存在，凡訂單被採購單採用時該守門會拋 42703。
-- 20260924000011 的 delete_consignment_draft_if_clean 亦因呼叫此函式受影響。
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

  -- 訂單含退貨列（line_type='return'，含送修/已結清）
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'order_return_line', 'label', '訂單退貨列')), '[]'::jsonb) INTO v_lines
  FROM public.order_items oi2
  WHERE oi2.order_id = p_order_id AND oi2.line_type = 'return';
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '訂單含退貨列，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被採購單採用（source_quantities jsonb 含此訂單 id）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'purchase_order',
    'code', COALESCE(po.supplier_order_number, po.id::text),
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

REVOKE ALL ON FUNCTION public.delete_order_if_unadopted(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_order_if_unadopted(UUID) TO authenticated;