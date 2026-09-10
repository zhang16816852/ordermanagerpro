-- ============================================================
-- 20260911000004_repair_order_delete_guard.sql
-- 1) 補維修單 DELETE RLS policy
-- 2) delete_repair_order_if_safe：守門維修單刪除
--    檢查 repair_order_items（已扣庫存/FIFO 批次）/
--    inventory_movements（repair_part_usage）/
--    accounting_entries 引用，回傳 {ok, reason, adopted_by}。
-- ============================================================

-- 1) 補 DELETE RLS policy（維修單僅 admin 可刪）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'repair_orders'
      AND policyname = 'Admins can delete repair orders'
  ) THEN
    CREATE POLICY "Admins can delete repair orders"
      ON public.repair_orders
      FOR DELETE
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END
$$;

-- 2) delete_repair_order_if_safe
CREATE OR REPLACE FUNCTION public.delete_repair_order_if_safe(p_repair_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB := '[]'::jsonb;
  v_code TEXT;
  v_status TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除維修單');
  END IF;

  SELECT code, status INTO v_code, v_status FROM public.repair_orders WHERE id = p_repair_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '維修單不存在');
  END IF;

  -- 已有維修單品項且已扣庫存
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'repair_item',
    'label', '維修品項（已扣庫存）'
  )), '[]'::jsonb) INTO v_lines
  FROM public.repair_order_items roi
  WHERE roi.repair_order_id = p_repair_order_id
    AND roi.is_stock_deducted = true;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此維修單已有品項扣過庫存，無法直接刪除（請先辦理退料）', 'adopted_by', v_lines);
  END IF;

  -- 已有進貨批次引用（FIFO）
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'kind', 'purchase_batch',
    'label', '進貨批次引用'
  )), '[]'::jsonb) INTO v_lines
  FROM public.repair_order_items roi
  WHERE roi.repair_order_id = p_repair_order_id
    AND roi.purchase_order_item_id IS NOT NULL;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此維修單有進貨批次引用，無法直接刪除', 'adopted_by', v_lines);
  END IF;

  -- 已有庫存異動（repair_part_usage）
  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'kind', 'inventory',
    'label', '庫存異動'
  )), '[]'::jsonb) INTO v_lines
  FROM public.inventory_movements im
  WHERE im.repair_order_id = p_repair_order_id;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此維修單已有庫存異動紀錄，無法刪除', 'adopted_by', v_lines);
  END IF;

  -- 已被會計分錄引用
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', 'accounting', 'label', '會計分錄')), '[]'::jsonb) INTO v_lines
  FROM (
    SELECT 1 FROM public.accounting_entries ae WHERE ae.reference_type = 'repair_order' AND ae.reference_id = p_repair_order_id
    UNION
    SELECT 1 FROM public.accounting_entry_references aer WHERE aer.reference_type = 'repair_order' AND aer.reference_id = p_repair_order_id
  ) x;
  IF v_lines <> '[]'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此維修單已有會計分錄，請先回退分錄', 'adopted_by', v_lines);
  END IF;

  DELETE FROM public.repair_orders WHERE id = p_repair_order_id;

  RETURN jsonb_build_object('ok', true, 'code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_repair_order_if_safe(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_repair_order_if_safe(UUID) TO authenticated;
