-- ============================================================
-- 20261022000006_currency_fifo_rpc_add_accounting_entries.sql
-- 外幣 FIFO：所有 RPC 同一交易內寫入 accounting_entries，
-- 移除手動 UPDATE accounts.balance（由觸發器自動同步）
-- ============================================================

-- ---- create_currency_inbound ----
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
  v_category_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行外幣入帳');
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

  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, v_twd_equivalent, p_exchange_rate,
    p_source_type, p_source_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  INSERT INTO public.currency_batches (
    account_id, amount, exchange_rate, twd_equivalent,
    source_type, source_id, inbound_movement_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, p_exchange_rate, v_twd_equivalent,
    p_source_type, p_source_id, v_movement_id, p_transaction_date
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.currency_batch_inventory (
    batch_id, account_id, remaining_amount, updated_at
  ) VALUES (
    v_batch_id, p_account_id, p_amount, now()
  );

  SELECT id INTO v_category_id
  FROM public.accounting_categories
  WHERE type = 'income' AND is_active = true
  ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    'income', p_account_id, v_category_id, p_amount, p_amount, 'paid',
    '外幣入帳 (' || p_source_type || ')', 'currency_movement', v_movement_id, p_transaction_date::date, auth.uid()
  );

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

-- ---- consume_currency_fifo ----
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
  v_category_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行外幣消耗');
  END IF;

  v_result := public._consume_currency_fifo(
    p_account_id, p_amount, p_source_type, p_reference_id, p_receipt_id, p_transaction_date
  );

  IF (v_result->>'ok')::boolean = true THEN
    v_movement_id := (v_result->>'movement_id')::UUID;

    SELECT id INTO v_category_id
    FROM public.accounting_categories
    WHERE type = 'expense' AND is_active = true
    ORDER BY name LIMIT 1;

    INSERT INTO public.accounting_entries (
      type, account_id, category_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, transaction_date, created_by
    ) VALUES (
      'expense', p_account_id, v_category_id, p_amount, p_amount, 'paid',
      '外幣消耗 (' || p_source_type || ')', 'currency_movement', v_movement_id, p_transaction_date::date, auth.uid()
    );

    IF p_receipt_id IS NOT NULL THEN
      INSERT INTO public.currency_transaction_results (
        receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
      ) VALUES (
        p_receipt_id, p_account_id, 'exchange', md5(p_receipt_id::text),
        v_result, v_movement_id, now()
      ) ON CONFLICT (receipt_id) DO NOTHING;
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consume_currency_fifo(UUID, NUMERIC, TEXT, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ---- transfer_currency_fifo ----
CREATE OR REPLACE FUNCTION public.transfer_currency_fifo(
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount NUMERIC,
  p_fee_amount NUMERIC,
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
  v_from_category_id UUID;
  v_to_category_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行外幣轉帳');
  END IF;

  IF p_from_account_id = p_to_account_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源與目標帳戶不能相同');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '轉帳金額必須大於 0');
  END IF;

  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  IF p_from_account_id < p_to_account_id THEN
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_from_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源帳戶不存在或已停用');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_to_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '目標帳戶不存在或已停用');
  END IF;

  v_from_result := public._consume_currency_fifo(
    p_from_account_id, p_amount, 'transfer', p_reference_id, NULL, p_transaction_date
  );

  IF (v_from_result->>'ok')::boolean = false THEN
    RETURN v_from_result;
  END IF;

  v_total_twd_cost := (v_from_result->>'total_twd_cost')::NUMERIC;

  IF p_fee_amount > 0 THEN
    v_fee_result := public._consume_currency_fifo(
      p_from_account_id, p_fee_amount, 'transfer_fee', p_reference_id, NULL, p_transaction_date
    );

    IF (v_fee_result->>'ok')::boolean = false THEN
      RETURN jsonb_build_object('ok', false, 'reason', '手續費消耗失敗：' || (v_fee_result->>'reason'));
    END IF;

    v_fee_twd_cost := (v_fee_result->>'total_twd_cost')::NUMERIC;
  END IF;

  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_to_account_id, p_amount, v_total_twd_cost,
    CASE WHEN p_amount > 0 THEN v_total_twd_cost / p_amount ELSE 0 END,
    'transfer_in', p_reference_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_to_movement_id;

  FOR v_consumption IN
    SELECT cbc.batch_id, cbc.consumed_amount, cbc.historical_twd_cost,
           cb.exchange_rate, cb.amount as batch_amount
    FROM public.currency_batch_consumptions cbc
    JOIN public.currency_batches cb ON cb.id = cbc.batch_id
    WHERE cbc.movement_id = (v_from_result->>'movement_id')::UUID
      AND cbc.status = 'active'
  LOOP
    INSERT INTO public.currency_batches (
      account_id, amount, exchange_rate, twd_equivalent,
      source_type, source_id, transfer_source_batch_id, inbound_movement_id, transaction_date
    ) VALUES (
      p_to_account_id, v_consumption.consumed_amount, v_consumption.exchange_rate,
      v_consumption.historical_twd_cost, 'transfer_in', p_reference_id,
      v_consumption.batch_id, v_to_movement_id, p_transaction_date
    ) RETURNING id INTO v_new_batch_id;

    INSERT INTO public.currency_batch_inventory (
      batch_id, account_id, remaining_amount, updated_at
    ) VALUES (
      v_new_batch_id, p_to_account_id, v_consumption.consumed_amount, now()
    );
  END LOOP;

  SELECT id INTO v_from_category_id
  FROM public.accounting_categories
  WHERE type = 'expense' AND is_active = true
  ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, transfer_to_account_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    'expense', p_from_account_id, v_from_category_id, p_to_account_id, p_amount, p_amount, 'paid',
    '外幣轉帳支出 (' || p_reference_id::text || ')', 'currency_movement', (v_from_result->>'movement_id')::UUID, p_transaction_date::date, auth.uid()
  );

  SELECT id INTO v_to_category_id
  FROM public.accounting_categories
  WHERE type = 'income' AND is_active = true
  ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    'income', p_to_account_id, v_to_category_id, p_amount, p_amount, 'paid',
    '外幣轉帳收入 (' || p_reference_id::text || ')', 'currency_movement', v_to_movement_id, p_transaction_date::date, auth.uid()
  );

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

-- ---- exchange_currency_fifo ----
CREATE OR REPLACE FUNCTION public.exchange_currency_fifo(
  p_from_account_id UUID,
  p_to_account_id UUID,
  p_amount NUMERIC,
  p_twd_gross_received NUMERIC,
  p_bank_fee NUMERIC,
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
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行換匯');
  END IF;

  IF p_from_account_id = p_to_account_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源與目標帳戶不能相同');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '換匯金額必須大於 0');
  END IF;

  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  IF p_from_account_id < p_to_account_id THEN
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.accounts WHERE id = p_to_account_id FOR UPDATE;
    PERFORM 1 FROM public.accounts WHERE id = p_from_account_id FOR UPDATE;
  END IF;

  SELECT currency INTO v_from_currency FROM public.accounts WHERE id = p_from_account_id AND is_active = true;
  IF v_from_currency IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '來源帳戶不存在或已停用');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_to_account_id AND is_active = true AND currency = 'TWD') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '目標帳戶必須為 TWD 帳戶');
  END IF;

  v_twd_net_received := p_twd_gross_received - COALESCE(p_bank_fee, 0);

  v_from_result := public._consume_currency_fifo(
    p_from_account_id, p_amount, 'exchange', p_reference_id, NULL, p_transaction_date
  );

  IF (v_from_result->>'ok')::boolean = false THEN
    RETURN v_from_result;
  END IF;

  v_fifo_historical_cost := (v_from_result->>'total_twd_cost')::NUMERIC;
  v_exchange_gain_loss := v_twd_net_received - v_fifo_historical_cost;

  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_from_account_id, -p_amount, -v_fifo_historical_cost,
    v_fifo_historical_cost / p_amount,
    'exchange', p_reference_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  INSERT INTO public.accounting_entries (
    type, account_id, transfer_to_account_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by,
    original_currency, original_amount, exchange_rate
  ) VALUES (
    'expense', p_from_account_id, p_to_account_id, v_fifo_historical_cost,
    v_fifo_historical_cost, 'paid',
    '外幣換匯（FIFO 歷史成本）', 'currency_exchange', v_movement_id, p_transaction_date::date, auth.uid(),
    v_from_currency, p_amount, v_fifo_historical_cost / p_amount
  );

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

  IF COALESCE(p_bank_fee, 0) > 0 THEN
    INSERT INTO public.accounting_entries (
      type, account_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, transaction_date, created_by
    ) VALUES (
      'expense', p_to_account_id, p_bank_fee, p_bank_fee, 'paid',
      '換匯銀行手續費', 'currency_exchange', v_movement_id, p_transaction_date::date, auth.uid()
    );
  END IF;

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

-- ---- pay_purchase_order_foreign ----
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
  v_category_id UUID;
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

  SELECT id INTO v_category_id
  FROM public.accounting_categories
  WHERE type = 'expense' AND is_active = true
  ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    'expense', p_account_id, v_category_id, p_amount, p_amount, 'paid',
    '外幣採購付款 (' || p_purchase_order_id::text || ')', 'currency_movement', v_movement_id, p_transaction_date::date, auth.uid()
  );

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

-- ---- pay_freight_foreign ----
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
  v_category_id UUID;
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

  SELECT id INTO v_category_id
  FROM public.accounting_categories
  WHERE type = 'expense' AND is_active = true
  ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    'expense', p_account_id, v_category_id, p_amount, p_amount, 'paid',
    '外幣運費付款 (' || p_freight_id::text || ')', 'currency_movement', v_movement_id, p_transaction_date::date, auth.uid()
  );

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

-- ---- refund_currency_fifo ----
CREATE OR REPLACE FUNCTION public.refund_currency_fifo(
  p_account_id UUID,
  p_amount NUMERIC,
  p_source_type TEXT,
  p_source_id UUID,
  p_original_movement_id UUID,
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
  v_category_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行退款');
  END IF;

  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶不存在或已停用');
  END IF;

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

  IF p_source_type = 'reversal' AND p_original_movement_id IS NOT NULL THEN
    SELECT exchange_rate INTO v_exchange_rate
    FROM public.currency_movements WHERE id = p_original_movement_id;
  ELSE
    SELECT exchange_rate INTO v_exchange_rate
    FROM public.currency_batches
    WHERE account_id = p_account_id AND status = 'active'
    ORDER BY transaction_date DESC LIMIT 1;
    v_exchange_rate := COALESCE(v_exchange_rate, 1);
  END IF;

  v_twd_equivalent := p_amount * v_exchange_rate;

  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, reference_id, receipt_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, v_twd_equivalent, v_exchange_rate,
    p_source_type, p_source_id, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  SELECT id INTO v_category_id
  FROM public.accounting_categories
  WHERE type = 'income' AND is_active = true
  ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    'income', p_account_id, v_category_id, p_amount, p_amount, 'paid',
    '外幣退款 (' || p_source_type || ')', 'currency_movement', v_movement_id, p_transaction_date::date, auth.uid()
  );

  IF p_source_type = 'reversal' AND p_original_movement_id IS NOT NULL THEN
    FOR v_batch_id IN
      SELECT batch_id FROM public.currency_batch_consumptions
      WHERE movement_id = p_original_movement_id AND status = 'active'
    LOOP
      UPDATE public.currency_batch_consumptions
      SET status = 'reversed'
      WHERE movement_id = p_original_movement_id AND batch_id = v_batch_id;

      UPDATE public.currency_batch_inventory
      SET remaining_amount = remaining_amount + (
        SELECT consumed_amount FROM public.currency_batch_consumptions
        WHERE movement_id = p_original_movement_id AND batch_id = v_batch_id
      ),
      updated_at = now()
      WHERE batch_id = v_batch_id;
    END LOOP;
  ELSE
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

-- ---- import_currency_opening_balance ----
CREATE OR REPLACE FUNCTION public.import_currency_opening_balance(
  p_account_id UUID,
  p_amount NUMERIC,
  p_exchange_rate NUMERIC,
  p_source_type TEXT,
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
  v_category_id UUID;
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

  INSERT INTO public.currency_movements (
    account_id, amount_change, twd_equivalent, exchange_rate,
    source_type, receipt_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, v_twd_equivalent, p_exchange_rate,
    p_source_type, p_receipt_id, p_transaction_date
  ) RETURNING id INTO v_movement_id;

  SELECT id INTO v_category_id
  FROM public.accounting_categories
  WHERE type = 'income' AND is_active = true
  ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    'income', p_account_id, v_category_id, p_amount, p_amount, 'paid',
    '外幣期初導入 (' || p_source_type || ')', 'currency_movement', v_movement_id, p_transaction_date::date, auth.uid()
  );

  INSERT INTO public.currency_batches (
    account_id, amount, exchange_rate, twd_equivalent,
    source_type, inbound_movement_id, transaction_date
  ) VALUES (
    p_account_id, p_amount, p_exchange_rate, v_twd_equivalent,
    p_source_type, v_movement_id, p_transaction_date
  ) RETURNING id INTO v_batch_id;

  INSERT INTO public.currency_batch_inventory (
    batch_id, account_id, remaining_amount, updated_at
  ) VALUES (
    v_batch_id, p_account_id, p_amount, now()
  );

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