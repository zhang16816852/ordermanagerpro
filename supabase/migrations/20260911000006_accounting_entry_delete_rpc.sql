-- ============================================================
-- 20260911000006_accounting_entry_delete_rpc.sql
-- delete_accounting_entry：單一事務回退帳戶餘額 + 刪除分錄 + 清理子表，
--   取代前端多步非原子刪除（毀損 shipping_settlement_periods.is_settled /
--   孤立 rep_commission_payouts 與銷售單收款狀態）。
--   回傳 {ok, reason, adopted_by}。
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_accounting_entry(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_acc RECORD;
  v_dest RECORD;
  v_signed NUMERIC;
  v_received NUMERIC;
  v_sales_note_ids UUID[] := '{}';
  v_note_id UUID;
  v_lines JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除會計分錄');
  END IF;

  SELECT * INTO v_entry FROM public.accounting_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '分錄不存在');
  END IF;

  -- 1. 收集受影響的銷貨單 IDs（entry row + references 子表）
  IF v_entry.reference_type = 'sales_note' AND v_entry.reference_id IS NOT NULL THEN
    v_sales_note_ids := array_append(v_sales_note_ids, v_entry.reference_id);
  END IF;
  FOR v_note_id IN
    SELECT aer.reference_id
    FROM public.accounting_entry_references aer
    WHERE aer.entry_id = p_entry_id AND aer.reference_type = 'sales_note' AND aer.reference_id IS NOT NULL
  LOOP
    IF NOT (v_note_id = ANY(v_sales_note_ids)) THEN
      v_sales_note_ids := array_append(v_sales_note_ids, v_note_id);
    END IF;
  END LOOP;

  -- 2. 回退帳戶餘額
  IF v_entry.type IN ('transfer', 'currency_exchange', 'topup') THEN
    -- 來源帳戶回加、目的地帳戶回扣
    IF v_entry.account_id IS NOT NULL THEN
      SELECT * INTO v_acc FROM public.accounts WHERE id = v_entry.account_id;
      IF FOUND THEN
        UPDATE public.accounts SET balance = v_acc.balance + v_entry.amount, updated_at = now() WHERE id = v_entry.account_id;
      END IF;
    END IF;
    IF v_entry.transfer_to_account_id IS NOT NULL THEN
      SELECT * INTO v_acc FROM public.accounts WHERE id = v_entry.transfer_to_account_id;
      IF FOUND THEN
        v_received := CASE
          WHEN v_entry.type = 'currency_exchange' AND v_entry.exchange_rate IS NOT NULL AND v_entry.exchange_rate <> 0
            THEN COALESCE(v_entry.original_amount, 0) * v_entry.exchange_rate
          ELSE v_entry.amount
        END;
        UPDATE public.accounts SET balance = v_acc.balance - v_received, updated_at = now() WHERE id = v_entry.transfer_to_account_id;
      END IF;
    END IF;
  ELSIF v_entry.type IN ('income', 'expense') THEN
    IF v_entry.account_id IS NOT NULL THEN
      SELECT * INTO v_acc FROM public.accounts WHERE id = v_entry.account_id;
      IF FOUND THEN
        v_signed := CASE WHEN v_entry.type = 'income' THEN v_entry.amount ELSE -v_entry.amount END;
        UPDATE public.accounts SET balance = v_acc.balance - v_signed, updated_at = now() WHERE id = v_entry.account_id;
      END IF;
    END IF;
  END IF;

  -- 3. 清理解除運費月結期間綁定（避免 shipping_settlement_periods 卡在 is_settled=true 且 entry_id=NULL）
  UPDATE public.shipping_settlement_periods
  SET is_settled = false, entry_id = NULL
  WHERE entry_id = p_entry_id;

  -- 4. 刪除子表與分錄（rep_commission_payouts 依 entry_id ON DELETE CASCADE）
  DELETE FROM public.accounting_entry_references WHERE entry_id = p_entry_id;
  DELETE FROM public.accounting_entries WHERE id = p_entry_id;

  -- 5. 同步銷貨單收款狀態
  FOR v_note_id IN SELECT unnest(v_sales_note_ids) LOOP
    PERFORM public.sync_sales_note_payment_status(v_note_id);
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_accounting_entry(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_accounting_entry(UUID) TO authenticated;