-- ============================================================
-- P5 / M3：外幣付款 pay_freight_foreign 重寫 + pay_purchase_order_foreign 6→5 參數
-- 檔名：20261023000006_cross_border_foreign_payment.sql
-- 依賴：20261023000001 (accounts/currency_movements), 20261023000003 (purchase_freight_costs)
-- 可獨立驗證與回滾：部分（pay_purchase_order_foreign DROP 為不可逆，需重建舊簽名）
-- ============================================================

-- ------------------------------------------------------------
-- 1. pay_freight_foreign（6 參數、CREATE OR REPLACE、簽名不變）
-- ------------------------------------------------------------
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
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_freight public.purchase_freight_costs%ROWTYPE;
  v_po public.purchase_orders%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_result JSONB;
  v_movement_id UUID;
  v_entry_id UUID;
  v_category_id UUID;
  v_supplier_name TEXT;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行運費付款');
  END IF;

  -- 冪等
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  SELECT * INTO v_freight FROM public.purchase_freight_costs WHERE id = p_freight_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '運費單據不存在');
  END IF;
  IF v_freight.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '運費已付款，不可重複付款');
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_freight.purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  SELECT * INTO v_account FROM public.accounts WHERE id = p_account_id;
  IF NOT FOUND OR NOT v_account.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶不存在或已停用');
  END IF;
  IF v_account.currency IS DISTINCT FROM v_freight.currency THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶幣別與運費幣別不一致');
  END IF;

  -- 金額一致性守門
  IF abs(COALESCE(p_amount, 0) - v_freight.amount) > 0.01 THEN
    RAISE EXCEPTION '付款金額與運費單據不符（應付 %，實付 %）', v_freight.amount, p_amount;
  END IF;

  -- 扣外幣 FIFO（helper 不動 accounts.balance；trigger 自動同步）
  v_result := public._consume_currency_fifo(
    p_account_id, p_amount, 'freight_payment', COALESCE(p_reference_id, p_freight_id), p_receipt_id, p_transaction_date
  );
  IF (v_result->>'ok')::boolean = false THEN
    RETURN v_result;
  END IF;

  -- 台幣 expense 分錄
  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_freight.supplier_id;

  SELECT id INTO v_category_id
    FROM public.accounting_categories
   WHERE type = 'expense' AND is_active = true
   ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by,
    original_currency, original_amount, exchange_rate, counterparty_name
  ) VALUES (
    'expense', p_account_id, v_category_id, v_freight.amount_twd, v_freight.amount_twd, 'paid',
    '外幣運費付款 (' || v_freight.id::text || ')', 'purchase_order', v_freight.purchase_order_id,
    p_transaction_date::date, v_uid,
    v_freight.currency, v_freight.amount, v_freight.exchange_rate, v_supplier_name
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.accounting_entry_references (
    entry_id, reference_type, reference_id, item_name, amount_applied
  ) VALUES (
    v_entry_id, 'purchase_order', v_freight.purchase_order_id,
    '運費 ' || v_freight.freight_type, -v_freight.amount_twd
  );

  -- 回填運費列
  UPDATE public.purchase_freight_costs
     SET payment_status = 'paid',
         paid_date = p_transaction_date::date,
         payment_account_id = p_account_id,
         currency_movement_id = (v_result->>'movement_id')::UUID,
         accounting_entry_id = v_entry_id,
         updated_at = now()
   WHERE id = p_freight_id;

  -- 冪等結果
  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'freight_payment', md5(p_receipt_id::text),
      jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'amount_twd', v_freight.amount_twd, 'exchange_rate', v_freight.exchange_rate),
      (v_result->>'movement_id')::UUID, now()
    ) ON CONFLICT (receipt_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'movement_id', (v_result->>'movement_id')::UUID,
    'amount_twd', v_freight.amount_twd,
    'exchange_rate', v_freight.exchange_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_freight_foreign(UUID, UUID, NUMERIC, UUID, UUID, TIMESTAMPTZ) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_freight_foreign(UUID, UUID, NUMERIC, UUID, UUID, TIMESTAMPTZ) TO authenticated;

-- ------------------------------------------------------------
-- 2. pay_purchase_order_foreign（DROP 舊 6 參數 → CREATE 5 參數）
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pay_purchase_order_foreign(UUID, UUID, NUMERIC, UUID, UUID, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.pay_purchase_order_foreign(
  p_account_id UUID,
  p_purchase_order_id UUID,
  p_amount NUMERIC,
  p_receipt_id UUID,
  p_transaction_date TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_po public.purchase_orders%ROWTYPE;
  v_account public.accounts%ROWTYPE;
  v_result JSONB;
  v_movement_id UUID;
  v_entry_id UUID;
  v_category_id UUID;
  v_supplier_name TEXT;
  v_expected_foreign NUMERIC;
  v_twd_amount NUMERIC(14,2);
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可執行採購付款');
  END IF;

  -- 冪等
  IF p_receipt_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id) THEN
      RETURN (SELECT result_json FROM public.currency_transaction_results WHERE receipt_id = p_receipt_id);
    END IF;
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  SELECT * INTO v_account FROM public.accounts WHERE id = p_account_id;
  IF NOT FOUND OR NOT v_account.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶不存在或已停用');
  END IF;
  IF v_account.currency IS DISTINCT FROM v_po.currency THEN
    RETURN jsonb_build_object('ok', false, 'reason', '帳戶幣別與採購單幣別不一致');
  END IF;

  v_expected_foreign := COALESCE(v_po.original_total_amount, v_po.total_amount);
  IF abs(COALESCE(p_amount, 0) - v_expected_foreign) > 0.01 THEN
    RAISE EXCEPTION '付款金額與採購單不符（應付 %，實付 %）', v_expected_foreign, p_amount;
  END IF;

  v_twd_amount := COALESCE(v_po.total_amount, 0);

  -- 扣外幣 FIFO（helper 不動 accounts.balance；trigger 自動同步）
  v_result := public._consume_currency_fifo(
    p_account_id, p_amount, 'purchase_payment', p_purchase_order_id, p_receipt_id, p_transaction_date
  );
  IF (v_result->>'ok')::boolean = false THEN
    RETURN v_result;
  END IF;
  v_movement_id := (v_result->>'movement_id')::UUID;

  SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_po.supplier_id;

  SELECT id INTO v_category_id
    FROM public.accounting_categories
   WHERE type = 'expense' AND is_active = true
   ORDER BY name LIMIT 1;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by,
    original_currency, original_amount, exchange_rate, counterparty_name
  ) VALUES (
    'expense', p_account_id, v_category_id, v_twd_amount, v_twd_amount, 'paid',
    '外幣採購付款 (' || p_purchase_order_id::text || ')', 'purchase_order', p_purchase_order_id,
    p_transaction_date::date, v_uid,
    v_po.currency, COALESCE(v_po.original_total_amount, v_po.total_amount), v_po.exchange_rate, v_supplier_name
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.accounting_entry_references (
    entry_id, reference_type, reference_id, item_name, amount_applied
  ) VALUES (
    v_entry_id, 'purchase_order', p_purchase_order_id,
    '採購付款', -v_twd_amount
  );

  IF p_receipt_id IS NOT NULL THEN
    INSERT INTO public.currency_transaction_results (
      receipt_id, account_id, operation_type, request_hash, result_json, group_id, created_at
    ) VALUES (
      p_receipt_id, p_account_id, 'purchase_payment', md5(p_receipt_id::text),
      jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'amount_twd', v_twd_amount, 'exchange_rate', v_po.exchange_rate),
      v_movement_id, now()
    ) ON CONFLICT (receipt_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry_id,
    'movement_id', v_movement_id,
    'amount_twd', v_twd_amount,
    'exchange_rate', v_po.exchange_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_purchase_order_foreign(UUID, UUID, NUMERIC, UUID, TIMESTAMPTZ) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_purchase_order_foreign(UUID, UUID, NUMERIC, UUID, TIMESTAMPTZ) TO authenticated;
