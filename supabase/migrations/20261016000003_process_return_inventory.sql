CREATE OR REPLACE FUNCTION public.process_order_return_lines(
  p_line_ids UUID[],
  p_action TEXT DEFAULT 'stock',
  p_warehouse_id UUID DEFAULT NULL,
  p_refund_account_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_uid UUID := COALESCE(p_created_by, auth.uid());
  v_line RECORD;
  v_order_ids UUID[];
  v_processed INT := 0;
  v_total_refund NUMERIC := 0;
  v_refund_by_order JSONB := '{}';
  v_own_wh UUID;
  v_defective_wh UUID;
  v_repair_wh UUID;
  v_label TEXT;
  v_entry_id UUID;
  v_store_name TEXT;
  v_desc TEXT;
  v_order_id UUID;
  v_order_code TEXT;
  v_amount NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '未登入');
  END IF;

  IF NOT has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可處理退貨');
  END IF;

  IF p_line_ids IS NULL OR array_length(p_line_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '未指定退貨品項');
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('stock', 'exchange', 'repaired') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '處理動作必須為 stock / exchange / repaired');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    WHERE oi.line_type <> 'return'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '選取範圍包含非退貨列的品項');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    WHERE oi.return_status <> 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '選取範圍包含已處理的退貨品項');
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own' AND is_active LIMIT 1;
  SELECT id INTO v_defective_wh FROM public.warehouses WHERE code = 'defective' AND is_active LIMIT 1;
  SELECT id INTO v_repair_wh FROM public.warehouses WHERE code = 'repair' AND is_active LIMIT 1;

  IF v_own_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到自有倉');
  END IF;

  IF p_action = 'exchange' AND v_defective_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到瑕疵倉');
  END IF;

  IF p_action = 'repaired' AND v_repair_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到送修倉');
  END IF;

  IF p_action = 'stock' AND p_warehouse_id IS NULL THEN
    p_warehouse_id := v_own_wh;
  END IF;

  IF p_action = 'stock' AND NOT EXISTS (
    SELECT 1 FROM public.warehouses WHERE id = p_warehouse_id AND is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '指定的倉庫不存在或已停用');
  END IF;

  IF p_action = 'stock' AND v_total_refund > 0 AND p_refund_account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '退款金額大於 0 時必須指定退款帳戶');
  END IF;

  IF p_refund_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_refund_account_id AND is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '指定的退款帳戶不存在或已停用');
  END IF;

  IF p_category_id IS NOT NULL AND
     NOT EXISTS (SELECT 1 FROM public.accounting_categories WHERE id = p_category_id AND is_active) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '指定的會計分類不存在或已停用');
  END IF;

  IF p_category_id IS NULL AND p_action = 'stock' AND v_total_refund > 0 THEN
    SELECT id INTO p_category_id FROM public.accounting_categories
    WHERE name = '客戶退貨退款' AND type = 'expense' AND is_active
    LIMIT 1;
    IF p_category_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', '找不到「客戶退貨退款」會計分類（請先於會計分類建立）');
    END IF;
  END IF;

  v_label := CASE p_action
    WHEN 'stock' THEN '退庫存'
    WHEN 'exchange' THEN '換貨'
    ELSE '送修歸還'
  END;

  FOR v_line IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           o.store_id, o.code AS order_code
    FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    JOIN public.orders o ON o.id = oi.order_id
    ORDER BY lid
  LOOP
    IF p_action = 'stock' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, order_item_id, inventory_owner, reference_code, note, created_by
      ) VALUES (
        v_line.product_id, v_line.variant_id, v_own_wh, v_line.quantity, 0,
        'customer_return', v_line.id, 'self', v_line.order_code,
        '客戶退貨' || COALESCE(NULLIF(p_description, ''), ''), v_uid
      );
    ELSIF p_action = 'exchange' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, order_item_id, inventory_owner, reference_code, note, created_by
      ) VALUES (
        v_line.product_id, v_line.variant_id, v_defective_wh, v_line.quantity, 0,
        'customer_return', v_line.id, 'self', v_line.order_code,
        '換貨退回瑕疵品' || COALESCE(NULLIF(p_description, ''), ''), v_uid
      );
    ELSIF p_action = 'repaired' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, balance_after,
        source_type, order_item_id, inventory_owner, reference_code, note, created_by
      ) VALUES (
        v_line.product_id, v_line.variant_id, v_repair_wh, v_line.quantity, 0,
        'customer_return', v_line.id, 'self', v_line.order_code,
        '送修退回' || COALESCE(NULLIF(p_description, ''), ''), v_uid
      );
    END IF;

    IF p_action = 'stock' THEN
      v_total_refund := v_total_refund + COALESCE(v_line.unit_price, 0) * v_line.quantity;
      v_refund_by_order := jsonb_set(
        v_refund_by_order,
        ARRAY[v_line.order_id::text],
        to_jsonb(
          COALESCE((v_refund_by_order->>v_line.order_id::text)::numeric, 0)
          + COALESCE(v_line.unit_price, 0) * v_line.quantity
        )
      );
    END IF;

    UPDATE public.order_items
    SET return_status = p_action::text,
        line_note = CASE
          WHEN line_note IS NULL OR line_note = '' THEN '已' || v_label
          ELSE line_note || '｜已' || v_label
        END,
        updated_at = NOW()
    WHERE id = v_line.id;

    v_processed := v_processed + 1;
  END LOOP;

  IF p_action = 'stock' AND v_total_refund > 0 THEN
    SELECT st.name INTO v_store_name
    FROM public.stores st
    WHERE st.id = (SELECT store_id FROM public.orders WHERE id = v_order_ids[1]);

    v_desc := COALESCE(NULLIF(p_description, ''), '客戶退貨退款');

    INSERT INTO public.accounting_entries (
      type, account_id, category_id, amount, paid_amount, payment_status,
      description, reference_type, reference_id, counterparty_name, transaction_date, created_by
    ) VALUES (
      'expense', p_refund_account_id, p_category_id, v_total_refund, v_total_refund, 'paid',
      v_desc, 'order', v_order_ids[1], v_store_name, CURRENT_DATE, v_uid
    ) RETURNING id INTO v_entry_id;

    FOREACH v_order_id IN ARRAY v_order_ids LOOP
      v_amount := COALESCE((v_refund_by_order->>v_order_id::text)::numeric, 0);
      CONTINUE WHEN v_amount <= 0;
      SELECT code INTO v_order_code FROM public.orders WHERE id = v_order_id;
      INSERT INTO public.accounting_entry_references (
        entry_id, reference_type, reference_id, item_name, amount_applied
      ) VALUES (
        v_entry_id, 'order', v_order_id,
        '退貨退款（' || COALESCE(v_order_code, '') || '）', v_amount
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'action', p_action,
    'total_refund', v_total_refund
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

REVOKE ALL ON FUNCTION public.process_order_return_lines(UUID[], TEXT, UUID, UUID, UUID, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_order_return_lines(UUID[], TEXT, UUID, UUID, UUID, TEXT, UUID) TO authenticated;
