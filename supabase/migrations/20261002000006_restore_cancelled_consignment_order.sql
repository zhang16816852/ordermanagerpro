-- ============================================================
-- restore_cancelled_consignment_order：復原被取消的寄賣單
--
-- 背景：useConsignment.cancelOrderMutation 對非草稿單只是把 status 設為
--   'cancelled'（寄賣單本身與品項都保留），因此可反向復原。
--   草稿則走 delete_consignment_draft_if_clean 硬刪除，無法復原（不在本函式範圍）。
--
-- 守門設計：
--   ① 僅 'cancelled' 可復原 → 'active'。因為復原目標固定為 'active'，
--      任何已有銷售／結算紀錄的單（原本可能是 settled）一律拒絕，
--      避免把已結算單錯誤降級為 active。
--   ② 不得存在任何業務紀錄：庫存異動／銷售回報／寄賣銷售／結算／退回。
--   ③ send_to_store 的來源訂單由 FK（NO ACTION）保證仍存在；
--      本函式不重建來源訂單，故不需處理鏡像 order_items。
--
-- 權限：僅管理員（has_role(auth.uid(),'admin')），與其餘守門 RPC 一致。
-- ============================================================

CREATE OR REPLACE FUNCTION public.restore_cancelled_consignment_order(
  p_consignment_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_co   RECORD;
  v_code TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可復原寄賣單');
  END IF;

  SELECT * INTO v_co
  FROM public.consignment_orders
  WHERE id = p_consignment_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '寄賣單不存在');
  END IF;

  IF v_co.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅已取消的寄賣單可復原');
  END IF;

  -- ② 業務紀錄守門
  IF EXISTS (SELECT 1 FROM public.inventory_movements im
             WHERE im.consignment_order_id = p_consignment_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有庫存異動紀錄，無法復原');
  END IF;

  IF EXISTS (SELECT 1 FROM public.consignment_sales_reports csr
             WHERE csr.consignment_order_id = p_consignment_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有銷售回報，無法復原');
  END IF;

  IF EXISTS (SELECT 1 FROM public.consignment_sales cs
             WHERE cs.consignment_order_id = p_consignment_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有寄賣銷售紀錄，無法復原');
  END IF;

  IF EXISTS (SELECT 1 FROM public.consignment_settlements cst
             WHERE cst.consignment_order_id = p_consignment_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有結算紀錄，無法復原');
  END IF;

  IF EXISTS (SELECT 1 FROM public.consignment_returns cr
             WHERE cr.consignment_order_id = p_consignment_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已有退回紀錄，無法復原');
  END IF;

  -- 復原為 active。
  -- ⚠️ 單號不會改變：trgfn_generate_consignment_code 僅在 OLD.status='draft'
  --    且為暫存碼（CS-DRAFT-…/NULL）時才產正式碼，cancelled→active 沿用原號，
  --    同一列不變動故也不會觸發 code UNIQUE 衝突。
  UPDATE public.consignment_orders
  SET status = 'active'
  WHERE id = p_consignment_order_id
  RETURNING code INTO v_code;

  RETURN jsonb_build_object('ok', true, 'consignment_code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_cancelled_consignment_order(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.restore_cancelled_consignment_order(UUID) TO authenticated;

COMMENT ON FUNCTION public.restore_cancelled_consignment_order(UUID) IS '復原已取消的寄賣單為 active（僅管理員；草稿為硬刪除故不適用）';