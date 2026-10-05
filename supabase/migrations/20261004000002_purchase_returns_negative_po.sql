-- 20261004000001 採購退貨改為「負數採購單」批次匯入
--
-- 目標：
--   1. purchase_orders.purpose CHECK 放寬為 general / repair_parts / purchase_return。
--   2. purchase_orders  新增可空 source_purchase_order_id（退貨來源單，ON DELETE SET NULL）。
--   3. 新增 RPC import_purchase_returns_batch：每張退貨單一個子交易，建立負數 PO
--      （purpose=purchase_return、status=received、quantity/received_quantity/total_amount 皆為負）、
--      回寫原採購單品項 returned_quantity、寫 inventory_movements(source_type='purchase_return')
--      使庫存扣減，並在 p_post_entries=true 時建立「供應商退貨沖帳」income 分錄。
--
-- 設計取捨：
--   * 負數採購單取代舊的 purchase_order_returns / purchase_order_return_items 流程；
--     舊 tables 與 process_purchase_return RPC 保留為 legacy，前端不再呼叫。
--   * 商品解析沿用 _po_resolve_item（主對照優先 → 最近更新者），與採購匯入一致。
--   * 退貨品項以「正數」數量傳入，RPC 內部轉為負數寫入，避免前端符號錯誤。
--   * p_post_entries 為「選用」：不勾選時只做庫存回補，不動帳務。
--   * 批號／序號追蹤目前全站 0 筆資料（product_batches / product_batch_inventory 皆空），
--     故本 RPC 不處理 batch，與既有 process_purchase_return 行為一致。

-- ============================================================================
-- 1. purpose CHECK 放寬
-- ============================================================================
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_purpose_check;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_purpose_check
  CHECK (purpose IN ('general', 'repair_parts', 'purchase_return'));

-- ============================================================================
-- 2. 退貨來源單
-- ============================================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS source_purchase_order_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'purchase_orders_source_purchase_order_id_fkey'
       AND conrelid = 'public.purchase_orders'::regclass
  ) THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_source_purchase_order_id_fkey
      FOREIGN KEY (source_purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_po_source_po
  ON public.purchase_orders(source_purchase_order_id)
  WHERE source_purchase_order_id IS NOT NULL;

-- ============================================================================
-- 3. RPC：採購退貨批次匯入（負數採購單）
-- ============================================================================
CREATE OR REPLACE FUNCTION public.import_purchase_returns_batch(
  p_supplier_id uuid,
  p_groups jsonb,
  p_post_entries boolean DEFAULT false,
  p_account_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_uid uuid := COALESCE(p_created_by, auth.uid());
  v_groups jsonb;
  v_group jsonb;
  v_line jsonb;
  v_res jsonb;
  v_total integer := 0;
  v_success integer := 0;
  v_idx integer := 0;
  v_line_idx integer;
  v_results jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_err text;
  v_ref text;
  v_notes text;
  v_order_date date;
  v_source_po uuid;
  v_warehouse uuid;
  v_own_warehouse uuid;
  v_po_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric;
  v_label text;
  v_sum numeric := 0;
  v_total_abs numeric := 0;
  v_item_names jsonb := '[]'::jsonb;
  v_demand jsonb := '{}'::jsonb;
  v_dkey text;
  v_dentry jsonb;
  v_category uuid;
  v_entry_id uuid;
  v_credit numeric;
  v_src_item_id uuid;
  v_take integer;
  v_remaining integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可匯入採購退貨');
  END IF;
  IF p_supplier_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '請選擇供應商');
  END IF;
  IF jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'p_groups 必須為 JSON 陣列';
  END IF;

  SELECT id INTO v_own_warehouse FROM public.warehouses WHERE code = 'own';
  IF v_own_warehouse IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  IF COALESCE(p_post_entries, false) AND p_account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', '需建立沖帳分錄時請選擇入帳帳戶');
  END IF;
  IF COALESCE(p_post_entries, false) THEN
    SELECT id INTO v_category
      FROM public.accounting_categories
     WHERE (p_category_id IS NOT NULL AND id = p_category_id)
        OR (p_category_id IS NULL AND name = '供應商退貨沖帳' AND type = 'income' AND is_active)
     LIMIT 1;
    IF v_category IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', '找不到「供應商退貨沖帳」會計分類');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '入帳帳戶不存在');
    END IF;
  END IF;

  v_groups := p_groups;
  v_total := jsonb_array_length(v_groups);

  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    v_idx := v_idx + 1;
    v_err := NULL;

    BEGIN
      v_ref := NULLIF(btrim(COALESCE(v_group->>'supplier_return_number', '')), '');
      v_notes := NULLIF(btrim(COALESCE(v_group->>'notes', '')), '');
      v_order_date := COALESCE(NULLIF(v_group->>'order_date', '')::date, CURRENT_DATE);
      v_source_po := NULLIF(v_group->>'source_purchase_order_id', '')::uuid;
      v_warehouse := COALESCE(
        NULLIF(v_group->>'warehouse_id', '')::uuid,
        v_own_warehouse
      );

      IF jsonb_typeof(v_group->'items') <> 'array' OR jsonb_array_length(v_group->'items') = 0 THEN
        RAISE EXCEPTION '沒有品項';
      END IF;

      IF v_source_po IS NOT NULL THEN
        PERFORM 1 FROM public.purchase_orders
         WHERE id = v_source_po AND supplier_id = p_supplier_id AND status <> 'cancelled';
        IF NOT FOUND THEN
          RAISE EXCEPTION '找不到可退貨的原採購單（可能已取消或屬其他供應商）';
        END IF;
      END IF;

      -- 同 (供應商, 退貨單號) 序列化，避免併行重複匯入
      IF v_ref IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(p_supplier_id::text || ':return:' || v_ref));
        IF EXISTS (
          SELECT 1 FROM public.purchase_orders
           WHERE supplier_id = p_supplier_id
             AND purpose = 'purchase_return'
             AND supplier_order_number = v_ref
             AND status <> 'cancelled'
        ) THEN
          v_results := v_results || jsonb_build_object(
            'index', v_idx,
            'status', 'skipped',
            'supplier_return_number', v_ref,
            'reason', '此退貨單號已存在於本供應商的採購退貨單'
          );
          CONTINUE;
        END IF;
      END IF;

      -- Phase 1：先完整解析所有品項（尚未寫入）→ 任一失敗整張中止
      v_line_idx := 0;
      v_sum := 0;
      v_item_names := '[]'::jsonb;
      v_demand := '{}'::jsonb;
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_group->'items')
      LOOP
        v_line_idx := v_line_idx + 1;
        v_res := public._po_resolve_item(
          p_supplier_id,
          v_line->>'sku',
          v_line->>'name',
          v_line->>'vendor_product_id'
        );
        IF v_res IS NULL THEN
          RAISE EXCEPTION '第 % 個品項找不到對應商品（料號：%／品名：%／廠商料號：%）',
            v_line_idx,
            COALESCE(NULLIF(v_line->>'sku', ''), '(未填)'),
            COALESCE(NULLIF(v_line->>'name', ''), '(未填)'),
            COALESCE(NULLIF(v_line->>'vendor_product_id', ''), '(未填)');
        END IF;

        v_product_id := (v_res->>'product_id')::uuid;
        v_variant_id := NULLIF(v_res->>'variant_id', '')::uuid;
        v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::integer, 0);
        v_label := COALESCE(v_res->>'name', v_line->>'name', v_line->>'sku', '(未命名)');

        -- 成本優先序：檔案單價 → 供應商對照成本 → 原採購單品項單價 → 0
        -- ⚠️ 對照表常缺成本（fallback_price 多為 0），有原單時必須以原單單價回退，
        --    否則整張退貨額會算成 0、沖帳分錄也不會產生。
        v_cost := NULLIF(v_line->>'unit_cost', '')::numeric;
        IF v_cost IS NULL THEN
          v_cost := NULLIF(v_res->>'unit_cost', '')::numeric;
        END IF;
        IF (v_cost IS NULL OR v_cost = 0) AND v_source_po IS NOT NULL THEN
          SELECT poi.unit_cost INTO v_cost
            FROM public.purchase_order_items poi
           WHERE poi.purchase_order_id = v_source_po
             AND poi.product_id = v_product_id
             AND poi.variant_id IS NOT DISTINCT FROM v_variant_id
           ORDER BY (received_quantity - returned_quantity) DESC, sort_order, id
           LIMIT 1;
        END IF;
        v_cost := COALESCE(v_cost, 0);

        IF v_qty <= 0 THEN
          RAISE EXCEPTION '第 % 個品項（%）退貨數量必須大於 0（檔案數量會自動轉為負數）', v_line_idx, v_label;
        END IF;
        IF v_cost < 0 THEN
          RAISE EXCEPTION '第 % 個品項（%）單價不可為負', v_line_idx, v_label;
        END IF;
        IF v_variant_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.product_variants pv
           WHERE pv.id = v_variant_id AND pv.product_id = v_product_id
        ) THEN
          RAISE EXCEPTION '第 % 個品項（%）的變體不屬於該商品', v_line_idx, v_label;
        END IF;

        -- 累計同商品需求（key = product_id|variant_id）。
        -- ⚠️ 必須「合計」驗證而非逐列驗證：同一商品在檔案內出現兩列時，
        --    逐列檢查各自都通過，會讓 returned_quantity 超過 received_quantity。
        v_dkey := v_product_id::text || '|' || COALESCE(v_variant_id::text, '');
        v_demand := jsonb_set(
          v_demand,
          ARRAY[v_dkey],
          jsonb_build_object(
            'product_id', v_product_id,
            'variant_id', v_variant_id,
            'name', v_label,
            'qty', COALESCE((v_demand->v_dkey->>'qty')::integer, 0) + v_qty
          )
        );

        v_sum := v_sum + (v_qty * v_cost);
        v_item_names := v_item_names || jsonb_build_object(
          'product_id', v_product_id,
          'variant_id', v_variant_id,
          'name', v_label,
          'quantity', v_qty,
          'unit_cost', v_cost
        );
      END LOOP;

      -- 有原單時以「同商品合計數量」驗證可退量（received - returned）
      IF v_source_po IS NOT NULL THEN
        FOR v_dkey, v_dentry IN SELECT key, value FROM jsonb_each(v_demand)
        LOOP
          IF COALESCE((
            SELECT SUM(poi.received_quantity - poi.returned_quantity)
              FROM public.purchase_order_items poi
             WHERE poi.purchase_order_id = v_source_po
               AND poi.product_id = (v_dentry->>'product_id')::uuid
               AND poi.variant_id IS NOT DISTINCT FROM NULLIF(v_dentry->>'variant_id', '')::uuid
          ), 0) < (v_dentry->>'qty')::integer THEN
            RAISE EXCEPTION '品項（%）退貨數量超過原採購單可退數量（合計 % 件）',
              v_dentry->>'name', (v_dentry->>'qty')::integer;
          END IF;
        END LOOP;
      END IF;

      -- Phase 2：建立負數採購單（status=received、退貨當日即入帳）
      INSERT INTO public.purchase_orders (
        supplier_id, status, purpose, order_date, received_date,
        expected_date, supplier_order_number, total_amount, notes, created_by,
        source_purchase_order_id
      )
      VALUES (
        p_supplier_id,
        'received'::public.purchase_order_status,
        'purchase_return',
        v_order_date,
        v_order_date,
        NULL,
        v_ref,
        -v_sum,
        v_notes,
        v_uid,
        v_source_po
      )
      RETURNING id INTO v_po_id;

      -- Phase 3：建立負數品項（received_quantity 同為負 → 狀態語意一致）
      --          若指定原採購單，同時把退回量記回該品項的 returned_quantity。
      --          退回量可跨同一商品/變體的多列來源品項分配（見下方迴圈）。
      v_line_idx := 0;
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_item_names)
      LOOP
        v_line_idx := v_line_idx + 1;
        INSERT INTO public.purchase_order_items (
          purchase_order_id, product_id, variant_id,
          quantity, received_quantity, unit_cost, sort_order
        )
        VALUES (
          v_po_id,
          (v_line->>'product_id')::uuid,
          NULLIF(v_line->>'variant_id', '')::uuid,
          -(v_line->>'quantity')::integer,
          -(v_line->>'quantity')::integer,
          (v_line->>'unit_cost')::numeric,
          v_line_idx
        );

        IF v_source_po IS NOT NULL THEN
          -- ⚠️ 併行安全：逐列鎖定來源品項並以 LEAST 分配，直到滿足本輸入列數量為止。
          --    Phase 1 的合計檢查只是「讀取當下」的快照，這裡才是最終守門。
          --    同一商品/變體在原採購單可能分散於多列，故不可只挑單一列累加；
          --    鎖定後再讀一次可退量，避免併行寫入造成超退。
          v_remaining := (v_line->>'quantity')::integer;
          WHILE v_remaining > 0 LOOP
            SELECT poi.id INTO v_src_item_id
              FROM public.purchase_order_items poi
             WHERE poi.purchase_order_id = v_source_po
               AND poi.product_id = (v_line->>'product_id')::uuid
               AND poi.variant_id IS NOT DISTINCT FROM NULLIF(v_line->>'variant_id', '')::uuid
               AND (poi.received_quantity - poi.returned_quantity) > 0
             ORDER BY (poi.received_quantity - poi.returned_quantity) DESC, poi.sort_order, poi.id
             LIMIT 1
               FOR UPDATE;
            EXIT WHEN NOT FOUND;

            SELECT LEAST(poi.received_quantity - poi.returned_quantity, v_remaining)
              INTO v_take
              FROM public.purchase_order_items poi
             WHERE poi.id = v_src_item_id;

            UPDATE public.purchase_order_items
               SET returned_quantity = returned_quantity + v_take
             WHERE id = v_src_item_id;

            v_remaining := v_remaining - v_take;
          END LOOP;
          IF v_remaining > 0 THEN
            RAISE EXCEPTION '品項（%）退貨數量超過原採購單可退數量', v_line->>'name';
          END IF;
        END IF;
      END LOOP;

      -- Phase 4：庫存回補（負數 quantity_change → BEFORE INSERT trigger 同步 product_inventory）
      v_line_idx := 0;
      FOR v_line IN SELECT * FROM jsonb_array_elements(v_item_names)
      LOOP
        v_line_idx := v_line_idx + 1;
        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change,
          source_type, purchase_order_id, reference_code, note, created_by
        )
        VALUES (
          (v_line->>'product_id')::uuid,
          NULLIF(v_line->>'variant_id', '')::uuid,
          v_warehouse,
          -(v_line->>'quantity')::integer,
          'purchase_return',
          v_po_id,
          COALESCE(v_ref, v_po_id::text),
          '退回供應商' || CASE WHEN v_notes IS NOT NULL THEN '：' || v_notes ELSE '' END,
          v_uid
        );
      END LOOP;

      v_total_abs := v_total_abs + v_sum;

      -- Phase 5：選用會計沖帳（收入 = 供應商應退款額）
      IF COALESCE(p_post_entries, false) AND v_sum > 0 THEN
        v_credit := v_sum;
        INSERT INTO public.accounting_entries (
          type, account_id, category_id, amount, paid_amount, payment_status,
          description, reference_type, reference_id, transaction_date,
          counterparty_name, created_by
        )
        VALUES (
          'income', p_account_id, v_category, v_credit, v_credit, 'paid',
          '廠商退貨沖帳' || CASE WHEN v_ref IS NOT NULL THEN '（' || v_ref || '）' ELSE '' END,
          'purchase_order', v_po_id, v_order_date,
          (SELECT name FROM public.suppliers WHERE id = p_supplier_id),
          v_uid
        )
        RETURNING id INTO v_entry_id;

        UPDATE public.accounts SET balance = balance + v_credit WHERE id = p_account_id;

        INSERT INTO public.accounting_entry_references (
          entry_id, reference_type, reference_id, item_name, amount_applied
        )
        VALUES (
          v_entry_id, 'purchase_order', v_po_id,
          '採購退貨' || CASE WHEN v_ref IS NOT NULL THEN '：' || v_ref ELSE '' END,
          v_credit
        );
      END IF;

      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object(
        'index', v_idx,
        'status', 'created',
        'purchase_order_id', v_po_id,
        'supplier_return_number', v_ref,
        'source_purchase_order_id', v_source_po,
        'total_amount', -v_sum,
        'created_items', v_item_names
      );
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_errors := v_errors || jsonb_build_object(
        'index', v_idx,
        'supplier_return_number', v_ref,
        'reason', v_err
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'total', v_total,
    'success', v_success,
    'total_credit', v_total_abs,
    'results', v_results,
    'errors', v_errors
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.import_purchase_returns_batch(uuid, jsonb, boolean, uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_purchase_returns_batch(uuid, jsonb, boolean, uuid, uuid, uuid) TO authenticated;