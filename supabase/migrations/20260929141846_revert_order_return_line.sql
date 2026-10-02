-- ============================================================
-- 20260929141846_revert_order_return_line.sql
--
-- 檔名對齊說明：本檔原名為 20260930000002_revert_order_return_line.sql，實際
--   套用遠端的時間為 2026-09-29 14:18:46 UTC，故遠端 ledger 記為
--   version=20260929141846。本檔改名為 20260929141846_... 與 ledger 對齊；
--   ledger 該列所記錄的程式碼本體與本檔完全一致（僅此註解頭文字不同）。
--
-- 新增 RPC public.revert_order_return_line：撤銷「誤標為退貨」的訂單品項，
--   一次交易內還原為「一般銷售」：
--     1) 若該品項已出貨進銷貨單（負數列）→ 移除該列並回沖庫存
--        （複用 upsert_sales_note_deletion_movement，語意同 correct_sales_note Phase 1 的
--          退貨分支：-ABS(qty) 的 sales_note_deletion，並刪除原 customer_return movement）
--     2) 設回 line_type='sale'、return_status=NULL、is_repair=false、清理退貨 line_note
--     3) 出貨池回補（維持「已出貨 ⇒ 不在出貨池」不變式，且剩餘量為正時放回池中）
--     4) 訂單狀態收斂（撤銷列不再享有 return 豁免 → 可正確降回 processing）
--
-- 守門沿用 correct_sales_note 同一組條件（每張綁定銷貨單逐一檢查）：
--   已收貨 / 會計分錄（entry row + references 雙路徑）/ 業務佣金發放 / 未逆轉寄賣確認銷售
--   / 庫存來源非 self（寄賣路徑請改走寄賣出貨回滾）
--   → 已收款銷貨單會被擋下並帶出單號，提示先至會計模組回退收款。
--
-- 注意：本 RPC 僅「還原誤標」，不做退款。退款請使用 process_order_return_lines（僅 pending 列）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.revert_order_return_line(
  p_order_item_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_oi RECORD;
  v_sni RECORD;
  v_own_wh UUID;
  v_new_shipped INTEGER;
  v_remaining INTEGER;
  v_all_shipped BOOLEAN;
  v_abs_qty INTEGER;
  v_total_removed INTEGER := 0;
  v_removed_notes TEXT[] := '{}';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可撤銷退貨');
  END IF;

  SELECT * INTO v_oi FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '品項不存在');
  END IF;

  IF v_oi.line_type IS DISTINCT FROM 'return' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此品項並非退貨列，無需撤銷');
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到自有倉（warehouses.code = own），無法回沖庫存');
  END IF;

  -- ------------------------------------------------------------
  -- 守門：逐一檢查此品項綁定的所有銷貨單
  -- ------------------------------------------------------------
  FOR v_sni IN
    SELECT sni.id AS sni_id, sni.sales_note_id, sni.quantity AS sni_quantity,
           sni.inventory_source_type, sn.code AS sn_code, sn.status AS sn_status
    FROM public.sales_note_items sni
    JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
    WHERE sni.order_item_id = p_order_item_id
  LOOP
    IF v_sni.sn_status = 'received' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '銷貨單 ' || v_sni.sn_code || ' 已收貨，無法撤銷退貨；請先於銷貨單依收貨流程處理',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'sales_note', 'code', v_sni.sn_code, 'label', '已收貨銷貨單'))
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.accounting_entries ae
      WHERE ae.reference_type = 'sales_note' AND ae.reference_id = v_sni.sales_note_id
      UNION
      SELECT 1 FROM public.accounting_entry_references aer
      WHERE aer.reference_type = 'sales_note' AND aer.reference_id = v_sni.sales_note_id
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '銷貨單 ' || v_sni.sn_code || ' 已有會計分錄（如收款），請先至會計模組回退/刪除分錄後再撤銷退貨',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'accounting', 'code', v_sni.sn_code, 'label', '會計分錄（收款）'))
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.rep_commission_payouts rcp WHERE rcp.sales_note_id = v_sni.sales_note_id
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '銷貨單 ' || v_sni.sn_code || ' 已完成業務佣金發放，請先撤銷發放',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'rep_payout', 'code', v_sni.sn_code, 'label', '業務佣金發放'))
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.consignment_sales cs
      WHERE cs.sales_note_id = v_sni.sales_note_id AND NOT cs.reversed
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '銷貨單 ' || v_sni.sn_code || ' 為寄賣確認銷售產生的收款單，請由寄賣流程反向處理',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'consignment_sale', 'code', v_sni.sn_code, 'label', '寄賣確認銷售'))
      );
    END IF;

    IF v_sni.inventory_source_type IS DISTINCT FROM 'self' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', '銷貨單 ' || v_sni.sn_code || ' 此退貨列的庫存來源為 '
                  || COALESCE(v_sni.inventory_source_type, 'unknown')
                  || '（非自有庫存），請改用寄賣出貨回滾流程處理',
        'adopted_by', jsonb_build_array(jsonb_build_object('kind', 'inventory_source', 'code', v_sni.sn_code, 'label', '非自有庫存來源'))
      );
    END IF;
  END LOOP;

  -- ------------------------------------------------------------
  -- 撤銷：移除銷貨單上的負數退貨列並回沖庫存
  -- ------------------------------------------------------------
  FOR v_sni IN
    SELECT sni.id AS sni_id, sni.sales_note_id, sni.quantity AS sni_quantity, sn.code AS sn_code
    FROM public.sales_note_items sni
    JOIN public.sales_notes sn ON sn.id = sni.sales_note_id
    WHERE sni.order_item_id = p_order_item_id
  LOOP
    v_abs_qty := ABS(v_sni.sni_quantity);

    -- 庫存逆轉：扣回 abs（customer_return 回補的反向）
    PERFORM public.upsert_sales_note_deletion_movement(
      v_sni.sales_note_id, p_order_item_id, v_oi.product_id, v_oi.variant_id,
      v_own_wh, -v_abs_qty, v_sni.sn_code, COALESCE(p_created_by, auth.uid())
    );

    -- 刪除原始出貨/退貨回補 movements（此時庫存已回沖完成）
    DELETE FROM public.inventory_movements
    WHERE sales_note_id = v_sni.sales_note_id
      AND order_item_id = p_order_item_id
      AND source_type IN ('sales_shipment', 'consignment_out_shipment', 'customer_return');

    DELETE FROM public.sales_note_items WHERE id = v_sni.sni_id;

    v_total_removed := v_total_removed + v_abs_qty;
    v_removed_notes := array_append(v_removed_notes, v_sni.sn_code);

    UPDATE public.sales_notes SET updated_at = NOW() WHERE id = v_sni.sales_note_id;
  END LOOP;

  -- ------------------------------------------------------------
  -- 還原訂單品項為「一般銷售」
  -- ------------------------------------------------------------
  v_new_shipped := GREATEST(0, v_oi.shipped_quantity - v_total_removed);
  v_remaining := v_oi.quantity - v_new_shipped;

  UPDATE public.order_items
  SET line_type = 'sale',
      return_status = NULL,
      is_repair = false,
      line_note = NULLIF(
        regexp_replace(COALESCE(line_note, ''), '(；)?(退貨出貨入庫|出貨退回入庫)$', ''),
        ''
      ),
      shipped_quantity = v_new_shipped,
      status = CASE
                 WHEN v_new_shipped = 0 THEN 'waiting'::order_item_status
                 WHEN v_new_shipped < v_oi.quantity THEN 'partial'::order_item_status
                 ELSE 'shipped'::order_item_status
               END,
      updated_at = NOW()
  WHERE id = p_order_item_id;

  -- ------------------------------------------------------------
  -- 出貨池：維持「已出貨 ⇒ 不在出貨池」；剩餘量 > 0 時放回池中（此時 line_type 已為 sale，
  -- ship_from_pool 會以「正數」出貨，正是撤銷退貨後期望的行為）
  -- ------------------------------------------------------------
  IF v_remaining <= 0 THEN
    DELETE FROM public.shipping_pool WHERE order_item_id = p_order_item_id;
  ELSE
    UPDATE public.shipping_pool
    SET quantity = v_remaining
    WHERE order_item_id = p_order_item_id;

    IF NOT FOUND THEN
      INSERT INTO public.shipping_pool (order_item_id, quantity, store_id, created_by)
      VALUES (p_order_item_id, v_remaining, v_oi.store_id, COALESCE(p_created_by, auth.uid()));
    END IF;
  END IF;

  -- ------------------------------------------------------------
  -- 訂單狀態收斂：撤銷列不再享有 return 豁免（改以「非本列的退貨列」豁免），
  -- 故誤標退貨被還原後，訂單可正確自 shipped 降回 processing（與 delete_sales_note 一致）
  -- ------------------------------------------------------------
  SELECT bool_and(
           oi.shipped_quantity >= oi.quantity
           OR oi.status IN ('cancelled', 'discontinued')
           OR (oi.line_type = 'return' AND oi.id <> p_order_item_id)
         )
  INTO v_all_shipped
  FROM public.order_items oi
  WHERE oi.order_id = v_oi.order_id;

  IF v_all_shipped THEN
    UPDATE public.orders SET status = 'shipped', updated_at = NOW() WHERE id = v_oi.order_id;
  ELSE
    UPDATE public.orders SET status = 'processing', updated_at = NOW()
    WHERE id = v_oi.order_id
      AND status = 'shipped'
      AND NOT EXISTS (
        SELECT 1 FROM public.order_items oi2
        WHERE oi2.order_id = v_oi.order_id
          AND (oi2.shipped_quantity > 0 OR oi2.status IN ('shipped', 'partial'))
      );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_item_id', p_order_item_id,
    'order_code', (SELECT code FROM public.orders WHERE id = v_oi.order_id),
    'order_status', (SELECT status FROM public.orders WHERE id = v_oi.order_id),
    'removed_sales_notes', to_jsonb(v_removed_notes),
    'removed_qty', v_total_removed,
    'shipped_quantity', v_new_shipped,
    'pool_quantity', (SELECT quantity FROM public.shipping_pool WHERE order_item_id = p_order_item_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revert_order_return_line(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revert_order_return_line(uuid, uuid) TO authenticated;
