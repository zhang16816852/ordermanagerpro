-- 修正 process_order_return_lines stock 分支：inventory_movements.inventory_owner 為 NOT NULL DEFAULT 'self'，
-- 原 00005 誤傳 NULL 會違反約束；改以 'self'（退貨入自有倉），與既有 customer_return 慣例一致。
CREATE OR REPLACE FUNCTION public.process_order_return_lines(
  p_line_ids UUID[],
  p_action TEXT DEFAULT 'stock',
  p_warehouse_id UUID DEFAULT NULL,
  p_refund_account_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID;
  v_line RECORD;
  v_own_wh UUID;
  v_total_refund NUMERIC := 0;
  v_entry_id UUID;
  v_amount NUMERIC;
  v_store_name TEXT;
  v_desc TEXT;
  v_order_ids UUID[] := '{}';
  v_refund_by_order JSONB := '{}'::jsonb;
  v_order_code TEXT;
  v_order_id UUID;
  v_processed INTEGER := 0;
  v_label TEXT;
  v_result JSONB;
BEGIN
  v_uid := COALESCE(p_created_by, auth.uid());

  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可處理退貨列');
  END IF;

  IF p_line_ids IS NULL OR array_length(p_line_ids, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', '未指定退貨列');
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('stock', 'exchange', 'repaired') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '處理動作必須為 stock / exchange / repaired');
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_line_ids) lid
    LEFT JOIN public.order_items oi ON oi.id = lid
    WHERE oi.id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '退貨列不存在');
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
    RETURN jsonb_build_object('ok', false, 'reason', '含已處理的退貨列（僅能處理 pending 狀態）');
  END IF;

  v_own_wh := COALESCE(p_warehouse_id, (
    SELECT id FROM public.warehouses
    WHERE code = 'own' OR type = '自有倉'
    ORDER BY (code = 'own') DESC, is_active DESC
    LIMIT 1
  ));
  IF v_own_wh IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '找不到退貨入庫倉庫');
  END IF;

  FOR v_line IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           o.store_id, o.code AS order_code
    FROM unnest(p_line_ids) lid
    JOIN public.order_items oi ON oi.id = lid
    JOIN public.orders o ON o.id = oi.order_id
  LOOP
    IF NOT (v_line.order_id = ANY(v_order_ids)) THEN
      v_order_ids := array_append(v_order_ids, v_line.order_id);
      v_refund_by_order := jsonb_set(v_refund_by_order, ARRAY[v_line.order_id::text], to_jsonb(0));
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
  END LOOP;

  IF p_action = 'stock' AND v_total_refund > 0 THEN
    IF p_refund_account_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', '退貨金額大於 0 但未指定退款帳戶');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_refund_account_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '退款帳戶不存在');
    END IF;
    IF p_category_id IS NOT NULL AND
       NOT EXISTS (SELECT 1 FROM public.accounting_categories WHERE id = p_category_id AND is_active) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '指定的會計分類不存在或已停用');
    END IF;
    IF p_category_id IS NULL THEN
      SELECT id INTO p_category_id FROM public.accounting_categories
      WHERE name = '客戶退貨退款' AND type = 'expense' AND is_active
      LIMIT 1;
      IF p_category_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', '找不到「客戶退貨退款」會計分類（請先於會計分類建立）');
      END IF;
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

    UPDATE public.accounts
    SET balance = balance - v_total_refund, updated_at = NOW()
    WHERE id = p_refund_account_id;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'action', p_action,
    'total_refund', v_total_refund,
    'entry_id', v_entry_id,
    'order_ids', to_jsonb(v_order_ids)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.process_order_return_lines(uuid[], text, uuid, uuid, uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_order_return_lines(uuid[], text, uuid, uuid, uuid, text, uuid) TO authenticated;