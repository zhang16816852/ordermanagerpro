-- ============================================================
-- 20260924000011_delete_consignment_draft_if_clean.sql
-- 寄賣草稿完整刪除：取消「草稿」狀態的寄賣單 = 徹底刪除，
--   不再保留 status='cancelled' 空殻。
--   守門（僅 draft 可刪）：
--     - 指定寄賣單存在且 status='draft'
--     - 無庫存異動（inventory_movements.consignment_order_id）
--     - 無寄賣銷售回報/銷售記錄/結算/退回參照（這幾張表皆為無 CASCADE
--       之普通 REFERENCES，有資料會擋 DELETE，故先顯式守門回 {ok:false}）
--   鏡像來源訂單：若 send_to_store 草稿由 convert_order_to_consignment_draft
--   建立（source_order_id 指向 pending 普通訂單），刪除草稿後該參照已解除，
--   再以有守門的 delete_order_if_unadopted 一併刪除該 pending 來源訂單；
--   若來源訂單已不是 pending（已被出貨/處理）一律保留。
--   全程單一交易：來源訂單刪除失敗（被其他單據採用）即 RAISE 整筆回滾。
-- ============================================================

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
  -- 參照解除，此時才可通過 delete_order_if_unadopted 的守門
  IF v_co.source_order_id IS NOT NULL THEN
    SELECT status INTO v_src_status
    FROM public.orders
    WHERE id = v_co.source_order_id;

    IF FOUND AND v_src_status = 'pending' THEN
      v_del := public.delete_order_if_unadopted(v_co.source_order_id);
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