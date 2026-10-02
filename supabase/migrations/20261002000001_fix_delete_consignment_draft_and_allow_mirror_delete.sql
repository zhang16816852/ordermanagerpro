-- ============================================================
-- 20261002000001_fix_delete_consignment_draft_and_allow_mirror_delete.sql
-- 修復「寄賣草稿無法完整刪除」
--
-- 根因：delete_consignment_draft_if_clean 先刪 consignment_orders（解除
--   consignment_orders.source_order_id 參照），再呼叫 delete_order_if_unadopted
--   刪除鏡像來源單。但 delete_order_if_unadopted 的第一道守門是
--   「source_type='consignment' 的寄賣鏡像訂單不可直接刪除」，
--   該判斷與寄賣單是否已被刪除無關 → 一律命中 → RAISE → 整筆交易回滾。
--
-- 修法：delete_order_if_unadopted 新增 p_allow_consignment_mirror 參數
--   （預設 false，行為與原版完全相同），僅由 delete_consignment_draft_if_clean
--   在「寄賣單已刪除」的語境下傳 true。其餘守門（銷貨單／出貨池／寄賣品項／
--   寄賣銷售／庫存異動／退貨／採購單／會計）一律保留不動。
--
-- 簽名變更處理：舊的 1 參數版先 DROP 再以 2 參數版 CREATE，避免與舊簽名
--   並存造成 PostgREST PGRST203（ambiguous function）。因新參數帶 DEFAULT，
--   既有單參數呼叫端（含前端與其他 RPC）不需改動。
-- ============================================================

-- ⚠️ 務必以「線上最新 body」為基底，不可從舊 migration 複製，否則會還原已修的 bug。
DROP FUNCTION IF EXISTS public.delete_order_if_unadopted(UUID);

CREATE OR REPLACE FUNCTION public.delete_order_if_unadopted(
  p_order_id UUID,
  p_allow_consignment_mirror BOOLEAN DEFAULT false
)
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

  -- 寄賣鏡像訂單（send_to_store 同步建立的 orders）不可直接刪除。
  -- 唯一例外：寄賣草稿完整刪除流程已先刪除寄賣單本體，此時該參照已解除，
  -- 由 delete_consignment_draft_if_clean 明確授權（p_allow_consignment_mirror = true）。
  IF v_source = 'consignment' AND NOT p_allow_consignment_mirror THEN
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
  -- ⚠️ purchase_orders 沒有 code 欄，單號欄位為 supplier_order_number
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

REVOKE ALL ON FUNCTION public.delete_order_if_unadopted(UUID, BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_order_if_unadopted(UUID, BOOLEAN) TO authenticated;


-- ------------------------------------------------------------
-- delete_consignment_draft_if_clean：呼叫端改傳 p_allow_consignment_mirror = true
-- 簽名與其餘邏輯不變。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_consignment_draft_if_clean(p_consignment_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_co          RECORD;
  v_src_status  TEXT;
  v_del         JSONB;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除寄賣草稿');
  END IF;

  SELECT * INTO v_co
  FROM public.consignment_orders
  WHERE id = p_consignment_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣單不存在');
  END IF;

  IF v_co.status <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅草稿狀態的寄賣單可完整刪除');
  END IF;

  -- 草稿不應有任何業務紀錄，防呆守門
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements im
    WHERE im.consignment_order_id = p_consignment_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有庫存異動紀錄，無法刪除');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_sales_reports csr
    WHERE csr.consignment_order_id = p_consignment_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有銷售回報，無法刪除');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_sales cs
    WHERE cs.consignment_order_id = p_consignment_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有寄賣銷售紀錄，無法刪除');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_settlements cst
    WHERE cst.consignment_order_id = p_consignment_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有結算紀錄，無法刪除');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.consignment_returns cr
    WHERE cr.consignment_order_id = p_consignment_order_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有退回紀錄，無法刪除');
  END IF;

  -- 刪除寄賣單位身（consignment_order_items 經 FK ON DELETE CASCADE）
  DELETE FROM public.consignment_orders
  WHERE id = p_consignment_order_id;

  -- 鏡像 pending 來源訂單：草稿已刪，consignment_orders.source_order_id
  -- 參照解除，此時才可通過 delete_order_if_unadopted 的守門。
  -- 傳 true 授權刪除「寄賣鏡像單」本身（source_type='consignment'）。
  IF v_co.source_order_id IS NOT NULL THEN
    SELECT status INTO v_src_status
    FROM public.orders
    WHERE id = v_co.source_order_id;

    IF FOUND AND v_src_status = 'pending' THEN
      v_del := public.delete_order_if_unadopted(v_co.source_order_id, TRUE);
      IF (v_del->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION '無法同時刪除來源訂單：%', v_del->>'reason';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_consignment_draft_if_clean(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_consignment_draft_if_clean(UUID) TO authenticated;