-- ============================================================
-- 20260909000001_delete_order_if_unadopted.sql
-- 完整刪除「沒被其他單據採用」的訂單：
--   檢查訂單是否已被 銷貨單 / 出貨池 / 寄賣單 / 庫存異動 /
--   採購單(source_quantities jsonb) / 會計分錄 採用，
--   全數乾淨才 DELETE（order_items 經 FK CASCADE、parent/child 同上）。
--   僅 admin 可執行，回傳 {ok, reason}。
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

  -- 已被銷貨單採用
  IF EXISTS (
    SELECT 1 FROM public.sales_note_items sni
    JOIN public.order_items oi ON oi.id = sni.order_item_id
    WHERE oi.order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被銷貨單採用，無法刪除');
  END IF;

  -- 尚有品項在出貨池
  IF EXISTS (
    SELECT 1 FROM public.shipping_pool sp
    JOIN public.order_items oi ON oi.id = sp.order_item_id
    WHERE oi.order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '仍有品項在出貨池，請先移出訂單');
  END IF;

  -- 已被寄賣單採用（來源單／寄賣品項）
  IF EXISTS (
    SELECT 1 FROM public.consignment_orders co WHERE co.source_order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被寄賣單採用，無法刪除');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_order_items coi
    JOIN public.order_items oi ON oi.id = coi.order_item_id
    WHERE oi.order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣品項已出貨，無法刪除');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_sales cs
    JOIN public.order_items oi ON oi.id = cs.order_item_id
    WHERE oi.order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣銷售已記帳，無法刪除');
  END IF;

  -- 已有庫存異動紀錄（出貨／退貨／維修扣料）
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements im
    JOIN public.order_items oi ON oi.id = im.order_item_id
    WHERE oi.order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有庫存異動紀錄，無法刪除');
  END IF;

  -- 銷貨退貨曾參照此訂單品項
  IF EXISTS (
    SELECT 1 FROM public.sales_note_return_items sri
    JOIN public.order_items oi ON oi.id = sri.order_item_id
    WHERE oi.order_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '曾登記退貨，無法刪除');
  END IF;

  -- 已被採購單採用（source_quantities jsonb 含此訂單 id）
  IF EXISTS (
    SELECT 1 FROM public.purchase_order_items poi
    WHERE poi.source_quantities ? p_order_id::text
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被採購單採用，請先解除連結');
  END IF;

  -- 已被會計分錄採用
  IF EXISTS (
    SELECT 1 FROM public.accounting_entries ae
    WHERE ae.reference_type = 'order' AND ae.reference_id = p_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已被會計分錄採用，無法刪除');
  END IF;

  DELETE FROM public.orders
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_order_if_unadopted(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_order_if_unadopted(UUID) TO authenticated;