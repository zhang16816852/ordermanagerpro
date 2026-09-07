-- ============================================================
-- 20260909000004_delete_purchase_order_if_empty.sql
-- 新增 RPC delete_purchase_order_if_empty(p_purchase_order_id)：
--   已收貨（任一 item received_quantity > 0）／已有庫存異動（purchase_receipt /
--   purchase_return / consignment_in_*）／已有會計分錄（支出/結帳，entry row 或
--   entry_references 子表 / 運費月結 / 佣金成本與 採購單相關分錄）的採購單直接擋下，
--   並回傳被採用的單據/類型明細（RETURNS JSONB）。
--   未收貨且無會計紀錄的乾淨採購單才 DELETE（purchase_order_items FK CASCADE）。
--   用途：取代前端原生 DELETE（後者遇已收貨採購單會撞 CHECK constraint 拋模糊錯誤，
--   且無法回滾庫存與會計）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_purchase_order_if_empty(p_purchase_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB := '[]'::jsonb;
  v_status TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除採購單');
  END IF;

  SELECT status INTO v_status FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  -- 已收貨
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'received', 'label', '已收貨')), '[]'::jsonb) INTO v_lines
  FROM public.purchase_order_items poi
  WHERE poi.purchase_order_id = p_purchase_order_id AND poi.received_quantity > 0;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單已收貨，無法刪除（會影響庫存，請改用採購退貨）', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存異動（收貨／退貨／寄賣入庫）——即使 received_quantity=0 也可能有分批收貨後退回等殘留異動
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'inventory', 'label', '庫存異動')), '[]'::jsonb) INTO v_lines
  FROM public.inventory_movements im
  WHERE im.purchase_order_id = p_purchase_order_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此採購單已有庫存異動紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有會計分錄（entry row 或 entry_references 子表：採購付款、運費月結、跨單結帳等）
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'accounting', 'label', '會計分錄')), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT 1 FROM public.accounting_entries ae WHERE ae.reference_type = 'purchase_order' AND ae.reference_id = p_purchase_order_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer WHERE aer.reference_type = 'purchase_order' AND aer.reference_id = p_purchase_order_id
  ) x;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此採購單已有會計分錄（付款/月結/結帳），請先回退分錄', 'adopted_by', v_lines);
  END IF;

  DELETE FROM public.purchase_orders WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_purchase_order_if_empty(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_purchase_order_if_empty(UUID) TO authenticated;