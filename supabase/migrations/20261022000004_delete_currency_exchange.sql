-- ============================================================
-- 20261022000004_delete_currency_exchange.sql
-- delete_currency_exchange：刪除一筆換匯（sell）的完整回滾，
--   取代對 currency_exchange 類型分錄的通用刪除（避免 FIFO 異動殘留、
--   帳戶餘額以錯誤金額回算）。
--   回傳 {ok, reason}。
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_currency_exchange(p_movement_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement RECORD;
  v_foreign_amount NUMERIC;
  v_cost NUMERIC;
  v_gain_loss NUMERIC;
  v_twd_net NUMERIC;
  v_foreign_account UUID;
  v_twd_account UUID;
  v_consumption RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可刪除換匯紀錄');
  END IF;

  SELECT * INTO v_movement FROM public.currency_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '換匯異動不存在');
  END IF;

  IF v_movement.source_type <> 'exchange' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '非換匯異動，請使用一般刪除');
  END IF;

  -- 已被沖銷
  IF EXISTS (SELECT 1 FROM public.currency_movements WHERE reference_id = p_movement_id AND source_type = 'reversal') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此換匯已被沖銷');
  END IF;

  v_foreign_account := v_movement.account_id;
  v_foreign_amount := abs(v_movement.amount_change);

  -- 從 accounting_entries 計算 FIFO 成本與匯兌損益
  SELECT COALESCE((SELECT amount FROM public.accounting_entries
                    WHERE reference_type = 'currency_exchange' AND reference_id = p_movement_id AND type = 'currency_exchange'
                    LIMIT 1), 0)
    INTO v_cost;

  SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)
    INTO v_gain_loss
  FROM public.accounting_entries
  WHERE reference_type = 'currency_exchange' AND reference_id = p_movement_id AND type IN ('income', 'expense');

  v_twd_net := v_cost + v_gain_loss;

  SELECT transfer_to_account_id INTO v_twd_account
  FROM public.accounting_entries
  WHERE reference_type = 'currency_exchange' AND reference_id = p_movement_id AND type = 'currency_exchange'
  LIMIT 1;

  -- 鎖定帳戶
  IF v_foreign_account IS NOT NULL THEN
    PERFORM 1 FROM public.accounts WHERE id = v_foreign_account FOR UPDATE;
  END IF;
  IF v_twd_account IS NOT NULL THEN
    PERFORM 1 FROM public.accounts WHERE id = v_twd_account FOR UPDATE;
  END IF;

  -- 還原 FIFO 批次
  FOR v_consumption IN
    SELECT cbc.* FROM public.currency_batch_consumptions cbc
    WHERE cbc.movement_id = p_movement_id AND cbc.status = 'active'
    FOR UPDATE OF cbc
  LOOP
    UPDATE public.currency_batch_inventory
    SET remaining_amount = remaining_amount + v_consumption.consumed_amount,
        updated_at = now()
    WHERE batch_id = v_consumption.batch_id;

    UPDATE public.currency_batch_consumptions
    SET status = 'reversed'
    WHERE id = v_consumption.id;
  END LOOP;

  -- 刪除 movement
  DELETE FROM public.currency_movements WHERE id = p_movement_id;

  -- 刪除相關 accounting_entries
  DELETE FROM public.accounting_entries WHERE reference_type = 'currency_exchange' AND reference_id = p_movement_id;

  -- 回算帳戶餘額
  IF v_foreign_account IS NOT NULL THEN
    UPDATE public.accounts SET balance = balance + v_foreign_amount, updated_at = now() WHERE id = v_foreign_account;
  END IF;
  IF v_twd_account IS NOT NULL THEN
    UPDATE public.accounts SET balance = balance - v_twd_net, updated_at = now() WHERE id = v_twd_account;
  END IF;

  RETURN jsonb_build_object('ok', true, 'movement_id', p_movement_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_currency_exchange(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_currency_exchange(UUID) TO authenticated;