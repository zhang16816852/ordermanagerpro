-- ============================================================
-- 外幣 FIFO（Foreign Currency FIFO）系統 — 核心 RPC
-- Migration: 20261022000002_foreign_currency_fifo_rpcs.sql
-- ============================================================

-- ============================================================
-- 1. _consume_currency_fifo (內部 Helper)
-- ============================================================
-- 依 FIFO 順序消耗外幣批次，支援多批次配對。
-- 回傳 JSONB：{ok, consumed_batches: [...], total_twd_cost, remaining_qty}
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
BEGIN
  -- 1. 冪等檢查：若 receipt_id 已存在，回傳已存在的結果
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  -- 2. 鎖定候選批次（FIFO: 最早取得優先）
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

    -- 3. 更新批次剩餘數量
    UPDATE public.currency_batch_inventory
    SET remaining_amount = remaining_amount - v_consumed,
        updated_at = now()
    WHERE batch_id = v_batch.id;

    -- 4. 記錄消耗明細（稍後與 movement_id 關聯）
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

  -- 5. 檢查是否足夠
  IF v_remaining > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', '外幣餘額不足（需要 ' || p_amount || '，剩餘 ' || (p_amount - v_remaining) || '）',
      'consumed', p_amount - v_remaining,
      'shortfall', v_remaining
    );
  END IF;

  -- 6. 寫入 currency_movements
  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_account_id, -p_amount, -v_total_twd_cost,
    v_total_twd_cost / p_amount,  -- 加權平均匯率
    p_source_type, p_reference_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  -- 7. 寫入 currency_batch_consumptions
  FOR v_batch IN SELECT * FROM jsonb_array_elements(v_result)
  LOOP
    INSERT INTO public.currency_batch_consumptions (
      movement_id, batch_id, consumed_amount, historical_twd_cost, status
    ) VALUES (
      v_movement_id,
      (v_batch->>'batch_id')::UUID,
      (v_batch->>'consumed_amount')::NUMERIC,
      (v_batch->>'historical_twd_cost')::NUMERIC,
      'active'
    );
  END LOOP;

  -- 8. 回傳結果
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