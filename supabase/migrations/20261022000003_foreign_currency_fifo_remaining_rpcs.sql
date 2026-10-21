-- ============================================================
-- 外幣 FIFO（Foreign Currency FIFO）系統 — 核心 RPC（修正版）
-- Migration: 20261022000002_foreign_currency_fifo_rpcs.sql
-- ============================================================

-- ============================================================
-- 1. _consume_currency_fifo (內部 Helper)
-- ============================================================
CREATE OR REPLACE FUNCTION public._consume_currency_fifo(
  p_account_id UUID,
  p_amount NUMERIC,
  p_source_type TEXT,
  p_reference_id UUID,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_remaining NUMERIC := p_amount;
  v_consumed NUMERIC;
  v_movement_id UUID;
  v_result JSONB := '[]'::JSONB;
  v_total_twd_cost NUMERIC := 0;
  v_batch_count INT := 0;
  v_available_total NUMERIC := 0;
BEGIN
  -- 1. 冪等檢查：若 receipt_id 已存在，回傳已存在的結果
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  -- 2. 鎖定候選批次（FIFO: 最早取得優先）
  -- 先計算總可用餘額
  SELECT COALESCE(SUM(cbi.remaining_amount), 0) INTO v_available_total
  FROM public.currency_batches cb
  JOIN public.currency_batch_inventory cbi ON cbi.batch_id = cb.id
  WHERE cb.account_id = p_account_id
    AND cbi.remaining_amount > 0
    AND cb.status = 'active';

  -- 3. 檢查總剩餘是否足夠
  IF v_available_total < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', '外幣餘額不足（需要 ' || p_amount || '，可用 ' || v_available_total || '）',
      'available', v_available_total,
      'shortfall', p_amount - v_available_total
    );
  END IF;

  -- 4. 鎖定候選批次
  FOR v_batch IN
    SELECT cb.id, cb.amount, cb.exchange_rate, cb.twd_equivalent,
           cbi.remaining_amount, cb.account_id
    FROM public.currency_batches cb
    JOIN public.currency_batch_inventory cbi ON cbi.batch_id = cb.id
    WHERE cb.account_id = p_account_id
      AND cbi.remaining_amount > 0
      AND cb.status = 'active'
    ORDER BY cb.transaction_date ASC, cb.created_at ASC, cb.id ASC
    FOR UPDATE OF cb, cbi
  LOOP
    IF v_remaining <= 0 THEN
      EXIT;
    END IF;

    v_consumed := LEAST(v_remaining, v_batch.remaining_amount);

    -- 5. 更新批次剩餘數量
    UPDATE public.currency_batch_inventory
    SET remaining_amount = remaining_amount - v_consumed,
        updated_at = now()
    WHERE batch_id = v_batch.id;

    -- 6. 記錄消耗明細（稍後與 movement_id 關聯）
    v_result := v_result || jsonb_build_object(
      'batch_id', v_batch.id,
      'consumed_amount', v_consumed,
      'exchange_rate', v_batch.exchange_rate,
      'historical_twd_cost', v_consumed * v_batch.exchange_rate
    );

    v_total_twd_cost := v_total_twd_cost + (v_consumed * v_batch.exchange_rate);
    v_remaining := v_remaining - v_consumed;
    v_batch_count := v_batch_count + 1;
  END LOOP;

  -- 7. 寫入 currency_movements
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_account_id, -p_amount, -v_total_twd_cost,
    CASE WHEN p_amount > 0 THEN v_total_twd_cost / p_amount ELSE 0 END,  -- 加權平均匯率
    p_source_type, p_reference_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  -- 8. 寫入 currency_batch_consumptions
  FOR v_batch IN SELECT * FROM jsonb_array_elements(v_result)
  LOOP
    INSERT INTO public.currency_batch_consumptions (
      movement_id, batch_id, consumed_amount, historical_twd_cost, status, receipt_id
    ) VALUES (
      v_movement_id,
      (v_batch->>'batch_id')::UUID,
      (v_batch->>'consumed_amount')::NUMERIC,
      (v_batch->>'historical_twd_cost')::NUMERIC,
      'active',
      p_receipt_id
    );
  END LOOP;

  -- 9. 回傳結果
  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', v_movement_id,
    'consumed_batches', v_result,
    'total_twd_cost', v_total_twd_cost,
    'consumed_amount', p_amount,
    'remaining_qty', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public._consume_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public._consume_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 2. create_currency_inbound (外幣入帳)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_currency_inbound(
  p_account_id UUID,
  p_amount NUMERIC,
  p_exchange_rate NUMERIC,
  p_source_type TEXT,
  p_source_id UUID,
  p_transaction_date TIMESTAMPTZ,
  p_receipt_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_movement_id UUID;
  v_twd_equivalent NUMERIC;
BEGIN
  -- 權限檢查
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行外幣入帳');
  END IF;

  -- 冪等檢查
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  -- 驗證帳戶存在且為外幣帳戶
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶不存在或已停用');
  END IF;

  v_twd_equivalent := p_amount * p_exchange_rate;

  -- 1. 建立 movement
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, v_twd_equivalent, p_exchange_rate,
    p_source_type, p_source_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  -- 2. 建立 batch
  INSERT INTO public.currency_batches (
    account_id, amount, exchange_rate, twd_equivalent,
    source_type, source_id, inbound_movement_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, p_exchange_rate, v_twd_equivalent,
    p_source_type, p_source_id, v_movement_id, p_transaction_date
  ) RETURNING id INTO v_batch_id;

  -- 3. 建立 batch inventory
  INSERT INTO public.currency_batch_inventory (
    batch_id, account_id, remaining_amount, updated_at
  ) VALUES (
    v_batch_id, p_account_id, p_amount, now()
  );

  -- 4. 寫入 transaction result
  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'inbound', md5(p_receipt_id::text), 
      jsonb_build_object('ok', true, 'movement_id', v_movement_id, 'batch_id', v_batch_id, 'amount', p_amount, 'twd_equivalent', v_twd_equivalent),
      v_movement_id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', v_movement_id,
    'batch_id', v_batch_id,
    'amount', p_amount,
    'twd_equivalent', v_twd_equivalent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_currency_inbound(UUID, NUMERIC, NUMERIC, TEXT, UUID, TIMESTAMPTZ, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_currency_inbound(UUID, NUMERIC, NUMERIC, TEXT, UUID, TIMESTAMPTZ, UUID) TO authenticated;

-- ============================================================
-- 3. consume_currency_fifo (公開 RPC)
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_currency_fifo(
  p_account_id UUID,
  p_amount NUMERIC,
  p_source_type TEXT,
  p_reference_id UUID,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_movement_id UUID;
BEGIN
  -- 權限檢查
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行外幣消耗');
  END IF;

  -- 呼叫內部 helper
  v_result := public._consume_currency_fifo(
    p_account_id, p_amount, p_source_type, p_reference_id, p_receipt_id, p_transaction_date
  );

  -- 若 helper 成功，寫入 transaction result
  IF (v_result->>'ok')::boolean = true AND p_receipt_id IS NOT NULL THEN
    v_movement_id := (v_result->>'movement_id')::UUID;
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'exchange', md5(p_receipt_id::text),
      v_result, v_movement_id, now()
    ) ON CONFLICT (receipt_id) DO NOTHING;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consume_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 4. reverse_currency_fifo (沖銷)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reverse_currency_fifo(
  p_movement_id UUID,
  p_reason TEXT,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig_movement RECORD;
  v_consumption RECORD;
  v_reversal_movement_id UUID;
  v_total_reversed NUMERIC := 0;
  v_total_twd NUMERIC := 0;
  v_group_id UUID;
BEGIN
  -- 權限檢查
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行沖銷');
  END IF;

  -- 冪等檢查
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  -- 查詢原始 movement
  SELECT * INTO v_orig_movement FROM public.currency_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '原始異動不存在');
  END IF;

  -- 拒絕沖銷 reversal 本身
  IF v_orig_movement.source_type = 'reversal' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '不能沖銷沖銷紀錄本身');
  END IF;

  -- 檢查是否已被沖銷
  IF EXISTS (SELECT 1 FROM public.currency_movements WHERE reference_id = p_movement_id AND source_type = 'reversal') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '此異動已被沖銷');
  END IF;

  -- 鎖定候選批次
  FOR v_consumption IN
    SELECT cbc.*, cb.account_id
    FROM public.currency_batch_consumptions cbc
    JOIN public.currency_batches cb ON cb.id = cbc.batch_id
    WHERE cbc.movement_id = p_movement_id AND cbc.status = 'active'
    FOR UPDATE OF cbc
  LOOP
    -- 恢復批次剩餘數量
    UPDATE public.currency_batch_inventory
    SET remaining_amount = remaining_amount + v_consumption.consumed_amount,
        updated_at = now()
    WHERE batch_id = v_consumption.batch_id;

    -- 標記消耗為已沖銷
    UPDATE public.currency_batch_consumptions
    SET status = 'reversed'
    WHERE id = v_consumption.id;

    v_total_reversed := v_total_reversed + v_consumption.consumed_amount;
    v_total_twd := v_total_twd + v_consumption.historical_twd_cost;
  END LOOP;

  -- 寫入反向 movement
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    v_orig_movement.account_id, -v_orig_movement.amount_change, -v_orig_movement.twd_equivalent,
    v_orig_movement.exchange_rate, 'reversal', p_movement_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_reversal_movement_id;

  -- 寫入 transaction result
  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, v_orig_movement.account_id, 'reversal', md5(p_receipt_id::text),
      jsonb_build_object('ok', true, 'reversal_movement_id', v_reversal_movement_id, 'reversed_amount', v_total_reversed, 'reversed_twd_cost', v_total_twd),
      v_orig_movement.id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reversal_movement_id', v_reversal_movement_id,
    'reversed_amount', v_total_reversed,
    'reversed_twd_cost', v_total_twd
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_currency_fifo(UUID, TEXT, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reverse_currency_fifo(UUID, TEXT, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 5. transfer_currency_fifo (外幣轉帳)
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_currency_fifo(
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount NUMERIC,              -- 轉出本金
  p_fee_amount NUMERIC,          -- 手續費（額外扣款）
  p_reference_id UUID,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_result JSONB;
  v_fee_result JSONB;
  v_to_movement_id UUID;
  v_consumption RECORD;
  v_new_batch_id UUID;
  v_group_id UUID := gen_random_uuid();
  v_total_twd_cost NUMERIC := 0;
  v_fee_twd_cost NUMERIC := 0;
BEGIN
  -- 權限檢查
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行外幣轉帳');
  END IF;

  -- 基本驗證
  IF p_from_account_id = p_to_account_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源與目標帳戶不能相同');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '轉帳金額必須大於 0');
  END IF;

  -- 冪等檢查
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  -- 鎖定帳戶（依 UUID 排序）
  IF p_from_account_id < p_to_account_id THEN
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
  END IF;

  -- 驗證帳戶存在且為外幣
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_from_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源帳戶不存在或已停用');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_to_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '目標帳戶不存在或已停用');
  END IF;

  -- 1. 消耗轉帳本金（FIFO）
  -- 使用 NULL receipt_id 避免冪等衝突（轉帳的冪等由外層 receipt_id 保護）
  v_from_result := public._consume_currency_fifo(
    p_from_account_id, p_amount, 'transfer', p_reference_id, NULL, p_transaction_date
  );

  IF (v_from_result->>'ok')::boolean = false THEN
    RETURN v_from_result;
  END IF;

  v_total_twd_cost := (v_from_result->>'total_twd_cost')::NUMERIC;

  -- 2. 消耗手續費（額外扣款，獨立 FIFO）
  IF p_fee_amount > 0 THEN
    v_fee_result := public._consume_currency_fifo(
      p_from_account_id, p_fee_amount, 'transfer_fee', p_reference_id, NULL, p_transaction_date
    );

    IF (v_fee_result->>'ok')::boolean = false THEN
      RETURN jsonb_build_object('ok', false, 'reason', '手續費消耗失敗：' || (v_fee_result->>'reason'));
    END IF;

    v_fee_twd_cost := (v_fee_result->>'total_twd_cost')::NUMERIC;
  END IF;

  -- 3. 建立轉入帳戶的 movement
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_to_account_id, p_amount, v_total_twd_cost,
    CASE WHEN p_amount > 0 THEN v_total_twd_cost / p_amount ELSE 0 END,
    'transfer_in', p_reference_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_to_movement_id;

  -- 4. 建立轉入帳戶的承接批次（每個來源批次對應一個承接批次）
  FOR v_consumption IN
    SELECT cbc.batch_id, cbc.consumed_amount, cbc.historical_twd_cost,
           cb.exchange_rate, cb.amount as batch_amount
    FROM public.currency_batch_consumptions cbc
    JOIN public.currency_batches cb ON cb.id = cbc.batch_id
    WHERE cbc.movement_id = (v_from_result->>'movement_id')::UUID
      AND cbc.status = 'active'
  LOOP
    -- 建立承接批次
    INSERT INTO public.currency_batches (
      account_id, amount, exchange_rate, twd_equivalent,
      source_type, source_id, transfer_source_batch_id, inbound_movement_id, transaction_date
    ) VALUES (
      p_to_account_id, v_consumption.consumed_amount, v_consumption.exchange_rate,
      v_consumption.historical_twd_cost, 'transfer_in', p_reference_id,
      v_consumption.batch_id, v_to_movement_id, p_transaction_date
    ) RETURNING id INTO v_new_batch_id;

    -- 建立承接批次庫存
    INSERT INTO public.currency_batch_inventory (
      batch_id, account_id, remaining_amount, updated_at
    ) VALUES (
      v_new_batch_id, p_to_account_id, v_consumption.consumed_amount, now()
    );
  END LOOP;

  -- 5. 寫入 transaction result
  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_from_account_id, 'transfer', md5(p_receipt_id::text),
      jsonb_build_object(
        'ok', true,
        'from_movement_id', (v_from_result->>'movement_id')::UUID,
        'to_movement_id', v_to_movement_id,
        'fee_movement_id', (v_fee_result->>'movement_id')::UUID,
        'transferred_amount', p_amount,
        'fee_amount', p_fee_amount,
        'total_deducted', p_amount + p_fee_amount,
        'received_amount', p_amount,
        'total_twd_cost', v_total_twd_cost,
        'fee_twd_cost', v_fee_twd_cost,
        'group_id', v_group_id
      ),
      v_group_id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'from_movement_id', (v_from_result->>'movement_id')::UUID,
    'to_movement_id', v_to_movement_id,
    'fee_movement_id', (v_fee_result->>'movement_id')::UUID,
    'transferred_amount', p_amount,
    'fee_amount', p_fee_amount,
    'total_deducted', p_amount + p_fee_amount,
    'received_amount', p_amount,
    'total_twd_cost', v_total_twd_cost,
    'fee_twd_cost', v_fee_twd_cost,
    'group_id', v_group_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_currency_fifo(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transfer_currency_fifo(UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 6. exchange_currency_fifo (換匯)
-- ============================================================
CREATE OR REPLACE FUNCTION public.exchange_currency_fifo(
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount NUMERIC,
  p_twd_gross_received NUMERIC,  -- 毛額台幣收入
  p_bank_fee NUMERIC,            -- 銀行手續費
  p_reference_id UUID,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from_result JSONB;
  v_movement_id UUID;
  v_twd_net_received NUMERIC;
  v_fifo_historical_cost NUMERIC;
  v_exchange_gain_loss NUMERIC;
  v_group_id UUID := gen_random_uuid();
  v_from_currency TEXT;
BEGIN
  -- 權限檢查
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行換匯');
  END IF;

  -- 基本驗證
  IF p_from_account_id = p_to_account_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源與目標帳戶不能相同');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '換匯金額必須大於 0');
  END IF;

  -- 冪等檢查
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  -- 鎖定帳戶（依 UUID 排序）
  IF p_from_account_id < p_to_account_id THEN
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
  END IF;

  -- 驗證帳戶
  SELECT currency INTO v_from_currency FROM public.accounts WHERE id = p_from_account_id AND is_active = true;
  IF v_from_currency IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源帳戶不存在或已停用');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_to_account_id AND is_active = true AND currency = 'TWD') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '目標帳戶必須為 TWD 帳戶');
  END IF;

  -- 計算淨收款
  v_twd_net_received := p_twd_gross_received - COALESCE(p_bank_fee, 0);

  -- 1. FIFO 消耗外幣
  v_from_result := public._consume_currency_fifo(
    p_from_account_id, p_amount, 'exchange', p_reference_id, NULL, p_transaction_date
  );

  IF (v_from_result->>'ok')::boolean = false THEN
    RETURN v_from_result;
  END IF;

  v_fifo_historical_cost := (v_from_result->>'total_twd_cost')::NUMERIC;

  -- 2. 計算匯兌損益
  v_exchange_gain_loss := v_twd_net_received - v_fifo_historical_cost;

  -- 3. 寫入 currency_movements (換匯)
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_from_account_id, -p_amount, -v_fifo_historical_cost,
    v_fifo_historical_cost / p_amount,
    'exchange', p_reference_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  -- 4. 更新帳戶餘額
  -- 外幣帳戶：-p_amount（外幣數量）
  UPDATE public.accounts SET balance = balance - p_amount, updated_at = now()
  WHERE id = p_from_account_id;

  -- TWD 帳戶：+v_twd_net_received（實際收到的 TWD）
  UPDATE public.accounts SET balance = balance + v_twd_net_received, updated_at = now()
  WHERE id = p_to_account_id;

  -- 5. 寫入 accounting_entries（FIFO 歷史成本）
  INSERT INTO public.accounting_entries (
    type, account_id, transfer_to_account_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by,
    original_currency, original_amount, exchange_rate
  ) VALUES (
    'currency_exchange', p_from_account_id, p_to_account_id, v_fifo_historical_cost,
    v_fifo_historical_cost, 'paid',
    '外幣換匯（FIFO 歷史成本）', 'currency_exchange', v_movement_id, p_transaction_date::date, auth.uid(),
    v_from_currency, p_amount, v_fifo_historical_cost / p_amount
  );

  -- 6. 寫入 accounting_entries（匯兌損益）
  IF v_exchange_gain_loss <> 0 THEN
    INSERT INTO public.accounting_entries (
      type, account_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, transaction_date, created_by
    ) VALUES (
      CASE WHEN v_exchange_gain_loss > 0 THEN 'income' ELSE 'expense' END,
      p_to_account_id, ABS(v_exchange_gain_loss), ABS(v_exchange_gain_loss), 'paid',
      '匯兌' || CASE WHEN v_exchange_gain_loss > 0 THEN '收益' ELSE '損失' END,
      'currency_exchange', v_movement_id, p_transaction_date::date, auth.uid()
    );
  END IF;

  -- 7. 寫入 accounting_entries（銀行手續費，若有）
  IF COALESCE(p_bank_fee, 0) > 0 THEN
    INSERT INTO public.accounting_entries (
      type, account_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, transaction_date, created_by
    ) VALUES (
      'expense', p_to_account_id, p_bank_fee, p_bank_fee, 'paid',
      '換匯銀行手續費', 'currency_exchange', v_movement_id, p_transaction_date::date, auth.uid()
    );
  END IF;

  -- 8. 寫入 transaction result
  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_from_account_id, 'exchange', md5(p_receipt_id::text),
      jsonb_build_object(
        'ok', true,
        'movement_id', v_movement_id,
        'twd_gross_received', p_twd_gross_received,
        'bank_fee', COALESCE(p_bank_fee, 0),
        'twd_net_received', v_twd_net_received,
        'fifo_historical_cost', v_fifo_historical_cost,
        'exchange_gain_loss', v_exchange_gain_loss,
        'group_id', v_group_id
      ),
      v_group_id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', v_movement_id,
    'twd_gross_received', p_twd_gross_received,
    'bank_fee', COALESCE(p_bank_fee, 0),
    'twd_net_received', v_twd_net_received,
    'fifo_historical_cost', v_fifo_historical_cost,
    'exchange_gain_loss', v_exchange_gain_loss,
    'group_id', v_group_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exchange_currency_fifo(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.exchange_currency_fifo(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 7. pay_purchase_order_foreign (支付採購單)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pay_purchase_order_foreign(
  p_account_id UUID,
  p_purchase_order_id UUID,
  p_amount NUMERIC,
  p_reference_id UUID,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_movement_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行採購付款');
  END IF;

  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.purchase_orders WHERE id = p_purchase_order_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  v_result := public._consume_currency_fifo(
    p_account_id, p_amount, 'purchase_payment', p_reference_id, NULL, p_transaction_date
  );

  IF (v_result->>'ok')::boolean = false THEN
    RETURN v_result;
  END IF;

  v_movement_id := (v_result->>'movement_id')::UUID;

  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'purchase_payment', md5(p_receipt_id::text),
      v_result, v_movement_id, now()
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_purchase_order_foreign(UUID, UUID, NUMERIC, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_purchase_order_foreign(UUID, UUID, NUMERIC, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 8. pay_freight_foreign (支付運費)
-- ============================================================
CREATE OR REPLACE FUNCTION public.pay_freight_foreign(
  p_account_id UUID,
  p_freight_id UUID,
  p_amount NUMERIC,
  p_reference_id UUID,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_movement_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行運費付款');
  END IF;

  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  v_result := public._consume_currency_fifo(
    p_account_id, p_amount, 'freight_payment', p_reference_id, NULL, p_transaction_date
  );

  IF (v_result->>'ok')::boolean = false THEN
    RETURN v_result;
  END IF;

  v_movement_id := (v_result->>'movement_id')::UUID;

  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'freight_payment', md5(p_receipt_id::text),
      v_result, v_movement_id, now()
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_freight_foreign(UUID, UUID, NUMERIC, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_freight_foreign(UUID, UUID, NUMERIC, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 9. refund_currency_fifo (退款)
-- ============================================================
CREATE OR REPLACE FUNCTION public.refund_currency_fifo(
  p_account_id UUID,
  p_amount NUMERIC,
  p_source_type TEXT,  -- 'purchase_refund' / 'sales_refund' / 'reversal'
  p_source_id UUID,
  p_original_movement_id UUID,  -- 原付款 movement ID（用於 reversal）
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_movement_id UUID;
  v_twd_equivalent NUMERIC;
  v_exchange_rate NUMERIC;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行退款');
  END IF;

  -- 冪等檢查
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  -- 驗證帳戶
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶不存在或已停用');
  END IF;

  -- 若為 reversal，驗證原 movement 存在
  IF p_source_type = 'reversal' THEN
    IF p_original_movement_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', '沖銷必須指定原 movement ID');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.currency_movements WHERE id = p_original_movement_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '原異動不存在');
    END IF;
    IF EXISTS (SELECT 1 FROM public.currency_movements WHERE reference_id = p_original_movement_id AND source_type = 'reversal') THEN
      RETURN jsonb_build_object('ok', false, 'reason', '此異動已被沖銷');
    END IF;
  END IF;

  -- 計算匯率（使用原批次匯率或當日匯率）
  IF p_source_type = 'reversal' AND p_original_movement_id IS NOT NULL THEN
    SELECT exchange_rate INTO v_exchange_rate
    FROM public.currency_movements WHERE id = p_original_movement_id;
  ELSE
    -- 使用當日匯率（需要呼叫端提供，或從最新批次取得）
    SELECT exchange_rate INTO v_exchange_rate
    FROM public.currency_batches
    WHERE account_id = p_account_id AND status = 'active'
    ORDER BY transaction_date DESC LIMIT 1;
    v_exchange_rate := COALESCE(v_exchange_rate, 1);
  END IF;

  v_twd_equivalent := p_amount * v_exchange_rate;

  -- 建立 refund movement
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, v_twd_equivalent, v_exchange_rate,
    p_source_type, p_source_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  -- 若為 reversal，建立反向消耗記錄
  IF p_source_type = 'reversal' AND p_original_movement_id IS NOT NULL THEN
    -- 恢復原 movement 的所有消耗
    FOR v_batch_id IN
      SELECT batch_id FROM public.currency_batch_consumptions
      WHERE movement_id = p_original_movement_id AND status = 'active'
    LOOP
      -- 更新消耗狀態為 reversed
      UPDATE public.currency_batch_consumptions
      SET status = 'reversed'
      WHERE movement_id = p_original_movement_id AND batch_id = v_batch_id;

      -- 恢復批次剩餘數量
      UPDATE public.currency_batch_inventory
      SET remaining_amount = remaining_amount + (
        SELECT consumed_amount FROM public.currency_batch_consumptions
        WHERE movement_id = p_original_movement_id AND batch_id = v_batch_id
      ),
      updated_at = now()
      WHERE batch_id = v_batch_id;
    END LOOP;
  ELSE
    -- 新建批次（退款入帳）
    INSERT INTO public.currency_batches (
      account_id, amount, exchange_rate, twd_equivalent,
      source_type, source_id, inbound_movement_id, transaction_date
    ) VALUES (
      p_account_id, p_amount, v_exchange_rate, v_twd_equivalent,
      p_source_type, p_source_id, v_movement_id, p_transaction_date
    ) RETURNING id INTO v_batch_id;

    INSERT INTO public.currency_batch_inventory (
      batch_id, account_id, remaining_amount, updated_at
    ) VALUES (
      v_batch_id, p_account_id, p_amount, now()
    );
  END IF;

  -- 寫入 transaction result
  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'refund', md5(p_receipt_id::text),
      jsonb_build_object('ok', true, 'movement_id', v_movement_id, 'amount', p_amount, 'twd_equivalent', v_twd_equivalent),
      v_movement_id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', v_movement_id,
    'amount', p_amount,
    'twd_equivalent', v_twd_equivalent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.refund_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 9. import_currency_opening_balance (期初導入)
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_currency_opening_balance(
  p_account_id UUID,
  p_amount NUMERIC,
  p_exchange_rate NUMERIC,
  p_source_type TEXT,  -- 'initial' or 'initial_estimated'
  p_transaction_date TIMESTAMPTZ,
  p_receipt_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_movement_id UUID;
  v_twd_equivalent NUMERIC;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行期初導入');
  END IF;

  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶不存在或已停用');
  END IF;

  v_twd_equivalent := p_amount * p_exchange_rate;

  -- 建立 movement
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, receipt_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, v_twd_equivalent, p_exchange_rate,
    p_source_type, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  -- 建立 batch
  INSERT INTO public.currency_batches (
    account_id, amount, exchange_rate, twd_equivalent,
    source_type, inbound_movement_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, p_exchange_rate, v_twd_equivalent,
    p_source_type, v_movement_id, p_transaction_date
  ) RETURNING id INTO v_batch_id;

  -- 建立 batch inventory
  INSERT INTO public.currency_batch_inventory (
    batch_id, account_id, remaining_amount, updated_at
  ) VALUES (
    v_batch_id, p_account_id, p_amount, now()
  );

  -- 寫入 transaction result
  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'inbound', md5(p_receipt_id::text),
      jsonb_build_object('ok', true, 'movement_id', v_movement_id, 'batch_id', v_batch_id, 'amount', p_amount, 'twd_equivalent', v_twd_equivalent),
      v_movement_id, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', v_movement_id,
    'batch_id', v_batch_id,
    'amount', p_amount,
    'twd_equivalent', v_twd_equivalent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_currency_opening_balance(UUID, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_currency_opening_balance(UUID, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, UUID) TO authenticated;

-- ============================================================
-- 10. reconcile_currency_fifo (驗算 RPC)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reconcile_currency_fifo(
  p_account_id UUID,
  p_currency TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_balance NUMERIC;
  v_batch_remaining NUMERIC;
  v_movement_sum NUMERIC;
  v_consumption_sum NUMERIC;
  v_historical_cost_sum NUMERIC;
  v_discrepancies JSONB := '[]'::JSONB;
  v_ok BOOLEAN := true;
BEGIN
  -- 1. 帳戶餘額驗算
  SELECT COALESCE(SUM(amount_change), 0) INTO v_movement_sum
  FROM public.currency_movements
  WHERE account_id = p_account_id;

  SELECT balance INTO v_account_balance
  FROM public.accounts
  WHERE id = p_account_id;

  -- 注意：外幣帳戶餘額 = SUM(currency_movements.amount_change)
  -- 但 accounts.balance 可能是 TWD 帳面價值，不是外幣數量
  -- 這裡只驗算 currency_movements 的一致性

  -- 2. 批次剩餘加總驗算
  SELECT COALESCE(SUM(remaining_amount), 0) INTO v_batch_remaining
  FROM public.currency_batch_inventory
  WHERE account_id = p_account_id;

  IF v_batch_remaining <> v_movement_sum THEN
    v_ok := false;
    v_discrepancies := v_discrepancies || jsonb_build_object(
      'type', 'batch_balance_mismatch',
      'expected', v_movement_sum,
      'actual', v_batch_remaining
    );
  END IF;

  -- 3. 消耗加總驗算
  SELECT COALESCE(SUM(consumed_amount), 0) INTO v_consumption_sum
  FROM public.currency_batch_consumptions cbc
  JOIN public.currency_batches cb ON cb.id = cbc.batch_id
  WHERE cb.account_id = p_account_id AND cbc.status = 'active';

  -- 4. 歷史台幣成本驗算
  SELECT COALESCE(SUM(historical_twd_cost), 0) INTO v_historical_cost_sum
  FROM public.currency_batch_consumptions cbc
  JOIN public.currency_batches cb ON cb.id = cbc.batch_id
  WHERE cb.account_id = p_account_id AND cbc.status = 'active';

  -- 5. 批次消耗一致性驗算
  -- currency_batches.amount - currency_batch_inventory.remaining_amount = SUM(consumed_amount WHERE batch_id = this batch AND status = 'active')

  RETURN jsonb_build_object(
    'ok', v_ok,
    'account_id', p_account_id,
    'movement_sum', v_movement_sum,
    'batch_remaining', v_batch_remaining,
    'consumption_sum', v_consumption_sum,
    'historical_cost_sum', v_historical_cost_sum,
    'discrepancies', v_discrepancies
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_currency_fifo(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_currency_fifo(UUID, TEXT) TO authenticated;