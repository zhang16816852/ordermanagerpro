-- ============================================================
-- P6 / M4：成本重算與追扣 purchase_cost_adjustments + rep_commission_payouts 改造 + 3 RPC
-- 檔名：20261023000007_cross_border_cost_adjustment.sql
-- 依賴：20261023000004 (_po_allocate_freight), 20261023000001 (purchase_orders)
-- 可獨立驗證與回滾：部分（DROP CONSTRAINT 不可逆）
-- ============================================================

-- ------------------------------------------------------------
-- 1. purchase_cost_adjustments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_cost_adjustments (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id       UUID        NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  purchase_order_item_id  UUID        NULL REFERENCES public.purchase_order_items(id) ON DELETE SET NULL,
  order_item_id           UUID        NULL REFERENCES public.order_items(id) ON DELETE SET NULL,
  sales_note_id           UUID        NULL REFERENCES public.sales_notes(id) ON DELETE SET NULL,
  rep_id                  UUID        NULL REFERENCES auth.users(id),
  old_unit_cost           NUMERIC(14,2) NULL,
  new_unit_cost           NUMERIC(14,2) NULL,
  delta_amount            NUMERIC(14,2) NULL,
  commission_delta        NUMERIC(14,2) NULL,
  reason                  TEXT        NULL,
  created_by              UUID        NULL REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pca_po        ON public.purchase_cost_adjustments(purchase_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pca_order_item ON public.purchase_cost_adjustments(order_item_id) WHERE order_item_id IS NOT NULL;

ALTER TABLE public.purchase_cost_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pca_admin_all ON public.purchase_cost_adjustments;
CREATE POLICY pca_admin_all
  ON public.purchase_cost_adjustments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::public.system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::public.system_role));

-- ------------------------------------------------------------
-- 2. rep_commission_payouts 改造
-- ------------------------------------------------------------
ALTER TABLE public.rep_commission_payouts
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'payout'
    CHECK (kind IN ('payout','adjustment')),
  ADD COLUMN IF NOT EXISTS collection_status TEXT NULL
    CHECK (collection_status IN ('pending','collected'));

ALTER TABLE public.rep_commission_payouts
  DROP CONSTRAINT IF EXISTS rep_commission_payouts_rep_id_sales_note_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_commission_payouts_payout
  ON public.rep_commission_payouts(rep_id, sales_note_id) WHERE kind = 'payout';

-- ------------------------------------------------------------
-- 3. _po_allocate_freight 已存在（migration 000004）；recalculate 呼叫 dry-run
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 4. recalculate_purchase_order_landed_costs (dry-run/apply)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_purchase_order_landed_costs(
  p_purchase_order_id UUID,
  p_apply BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_po RECORD;
  v_alloc JSONB;
  v_changes JSONB := '[]'::JSONB;
  v_commission JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
  v_poi RECORD;
  v_linked_oids UUID[];
  v_oi RECORD;
  v_new_landed NUMERIC(14,2);
  v_old_unit_cost NUMERIC(14,2);
  v_new_unit_cost NUMERIC(14,2);
  v_delta_unit NUMERIC(14,2);
  v_delta_amount NUMERIC(14,2);
  v_oi_list UUID[];
  v_oi_new NUMERIC(14,2);
  v_oi_qty NUMERIC;
  v_weighted_num NUMERIC;
  v_weighted_den NUMERIC;
  v_affected_sn UUID;
  v_rep RECORD;
  v_has_payout BOOLEAN;
  v_old_comm NUMERIC;
  v_new_comm NUMERIC;
  v_delta_comm NUMERIC;
  v_entry_id UUID;
  v_affected_oi UUID[] := ARRAY[]::UUID[];
  v_affected_oi_old NUMERIC[] := ARRAY[]::NUMERIC[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  -- dry-run 分攤取得 new landed
  v_alloc := public._po_allocate_freight(p_purchase_order_id, v_uid, true);
  IF (v_alloc->>'ok')::boolean = false THEN
    RETURN v_alloc;
  END IF;

  -- 逐 PO 品項計算新舊 landed + 連結 order_items
  FOR v_poi IN
    SELECT poi.id AS poi_id, poi.product_id, poi.variant_id, poi.quantity,
           poi.unit_cost, poi.allocated_freight, poi.landed_unit_cost,
           poi.source_order_item_ids, poi.source_order_ids, poi.source_quantities
      FROM public.purchase_order_items poi
     WHERE poi.purchase_order_id = p_purchase_order_id
  LOOP
    -- 取此 PO 品項對應的 new landed（從 alloc changes 找）
    v_new_landed := NULL;
    SELECT (c->>'new_landed_unit_cost')::numeric INTO v_new_landed
      FROM jsonb_array_elements(v_alloc->'changes') c
     WHERE (c->>'purchase_order_item_id')::uuid = v_poi.poi_id;
    v_new_landed := COALESCE(v_new_landed, v_poi.landed_unit_cost, v_poi.unit_cost);

    -- 連結 order_items
    v_oi_list := ARRAY[]::UUID[];
    IF v_poi.source_order_item_ids IS NOT NULL AND array_length(v_poi.source_order_item_ids, 1) > 0 THEN
      SELECT array_agg(oi.id) INTO v_oi_list
        FROM public.order_items oi
       WHERE oi.id = ANY(v_poi.source_order_item_ids);
    ELSE
      -- fuzzy fallback
      IF v_poi.source_order_ids IS NOT NULL AND array_length(v_poi.source_order_ids, 1) > 0 THEN
        SELECT array_agg(oi.id) INTO v_oi_list
          FROM public.order_items oi
         WHERE oi.order_id = ANY(v_poi.source_order_ids)
           AND oi.product_id = v_poi.product_id
           AND oi.variant_id IS NOT DISTINCT FROM v_poi.variant_id;
      END IF;
    END IF;
    v_oi_list := COALESCE(v_oi_list, ARRAY[]::UUID[]);

    -- 多對一：若多個 poi 指向同一 order_item，new_unit_cost 取加權平均
    -- 此處先收集 per-order_item 的 (new_landed, qty) 用於後續 weighted avg
    -- 簡化：直接用 v_new_landed 作為該 poi 對應 order_items 的新成本
    -- （多 poi → 同 oi 的加權平均在 apply 階段處理，此處先記錄 delta per poi）

    v_old_unit_cost := COALESCE(v_poi.landed_unit_cost, v_poi.unit_cost, 0);

    -- build change entry
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id', v_poi.poi_id,
      'product_id', v_poi.product_id,
      'variant_id', v_poi.variant_id,
      'old_unit_cost', v_old_unit_cost,
      'new_unit_cost', v_new_landed,
      'delta_unit_cost', round(v_new_landed - v_old_unit_cost, 2),
      'linked_order_item_ids', to_jsonb(v_oi_list)
    ));

    -- apply
    IF p_apply THEN
      -- 更新 PO 品項 allocated/landed
      UPDATE public.purchase_order_items
         SET allocated_freight = (SELECT (c->>'new_allocated_freight')::numeric FROM jsonb_array_elements(v_alloc->'changes') c WHERE (c->>'purchase_order_item_id')::uuid = v_poi.poi_id),
             landed_unit_cost = v_new_landed,
             updated_at = now()
       WHERE id = v_poi.poi_id;

      -- 更新連結的 order_items.unit_cost
      IF array_length(v_oi_list, 1) > 0 THEN
        -- weighted avg across multiple pois handled later; here set per-poi
        -- For multi-poi → same oi, we approximate by applying v_new_landed directly
        -- (full weighted avg requires cross-poi aggregation; simplified for v1)
        -- capture old costs before overwrite
        FOR v_oi IN SELECT id, unit_cost FROM public.order_items WHERE id = ANY(v_oi_list) LOOP
          v_affected_oi_old := v_affected_oi_old || COALESCE(v_oi.unit_cost, 0);
        END LOOP;
        UPDATE public.order_items
           SET unit_cost = v_new_landed
         WHERE id = ANY(v_oi_list);
        v_affected_oi := v_affected_oi || v_oi_list;
      END IF;

      -- 寫 purchase_cost_adjustments（per order_item）
      IF array_length(v_oi_list, 1) > 0 THEN
        FOREACH v_oi_qty IN ARRAY v_oi_list::text[]::uuid[] LOOP
          NULL;
        END LOOP;
        -- insert one adjustment per linked order_item
        INSERT INTO public.purchase_cost_adjustments (
          purchase_order_id, purchase_order_item_id, order_item_id,
          old_unit_cost, new_unit_cost, delta_amount, reason, created_by
        )
        SELECT p_purchase_order_id, v_poi.poi_id, oi.id,
               v_old_unit_cost, v_new_landed,
               round((v_new_landed - v_old_unit_cost) * oi.quantity, 2),
               '運費分攤重算', v_uid
        FROM public.order_items oi
        WHERE oi.id = ANY(v_oi_list);
      END IF;
    END IF;
  END LOOP;

  -- apply: PO 層
  IF p_apply THEN
    UPDATE public.purchase_orders
       SET freight_weight_factor = (v_alloc->>'weight_factor')::numeric,
           freight_allocation_stale = false,
           landed_total_amount = total_amount + (v_alloc->>'freight_total_twd')::numeric,
           updated_at = now()
     WHERE id = p_purchase_order_id;

    -- 佣金差額：對每個受影響 sales_note
    FOR v_affected_sn IN
      SELECT DISTINCT sni.sales_note_id
        FROM public.sales_note_items sni
        JOIN public.order_items oi ON oi.id = sni.order_item_id
       WHERE oi.id = ANY(v_affected_oi)
    LOOP
      FOR v_rep IN
        SELECT rsa.rep_id, ur.commission_rate
          FROM public.sales_notes sn
          JOIN public.rep_store_assignments rsa ON rsa.store_id = sn.store_id
          JOIN public.user_roles ur ON ur.user_id = rsa.rep_id
         WHERE sn.id = v_affected_sn
      LOOP
        SELECT EXISTS (
          SELECT 1 FROM public.rep_commission_payouts
           WHERE rep_id = v_rep.rep_id AND sales_note_id = v_affected_sn AND kind = 'payout'
        ) INTO v_has_payout;
        IF v_has_payout THEN
          v_old_comm := 0; v_new_comm := 0;
          FOR v_oi IN
            SELECT sni.order_item_id, sni.quantity AS sn_qty, oi.unit_price,
                   oi.variant_id, oi.product_id,
                   (SELECT pv.wholesale_price FROM public.product_variants pv WHERE pv.id = oi.variant_id) AS pv_cost
              FROM public.sales_note_items sni
              JOIN public.order_items oi ON oi.id = sni.order_item_id
             WHERE sni.sales_note_id = v_affected_sn
               AND sni.order_item_id = ANY(v_affected_oi)
          LOOP
            DECLARE
              v_idx INT;
              v_old_cost NUMERIC;
              v_new_cost NUMERIC;
              v_rc_cost NUMERIC;
            BEGIN
              v_idx := array_position(v_affected_oi, v_oi.order_item_id);
              v_old_cost := CASE WHEN v_idx IS NOT NULL THEN v_affected_oi_old[v_idx] ELSE 0 END;
              v_new_cost := (SELECT unit_cost FROM public.order_items WHERE id = v_oi.order_item_id);
              SELECT cost INTO v_rc_cost
                FROM public.rep_product_costs
               WHERE rep_id = v_rep.rep_id
                 AND product_id = v_oi.product_id
                 AND (variant_id IS NOT DISTINCT FROM v_oi.variant_id)
               ORDER BY (variant_id IS NOT NULL) DESC LIMIT 1;
              v_old_cost := COALESCE(NULLIF(v_old_cost,0), v_rc_cost, v_oi.pv_cost, 0);
              v_new_cost := COALESCE(NULLIF(v_new_cost,0), v_rc_cost, v_oi.pv_cost, 0);
              v_old_comm := v_old_comm + GREATEST(0, (v_oi.unit_price - v_old_cost) * v_oi.sn_qty) * COALESCE(v_rep.commission_rate,0) / 100.0;
              v_new_comm := v_new_comm + GREATEST(0, (v_oi.unit_price - v_new_cost) * v_oi.sn_qty) * COALESCE(v_rep.commission_rate,0) / 100.0;
            END;
          END LOOP;
          v_delta_comm := v_new_comm - v_old_comm;
          IF v_delta_comm <> 0 THEN
            PERFORM public.register_rep_commission_adjustment(
              v_rep.rep_id, v_affected_sn, v_delta_comm, NULL, '成本重算差額', v_uid
            );
            v_commission := v_commission || jsonb_build_array(jsonb_build_object(
              'rep_id', v_rep.rep_id, 'sales_note_id', v_affected_sn, 'delta', v_delta_comm
            ));
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', (NOT p_apply),
    'changes', v_changes,
    'commission', v_commission,
    'warnings', v_warnings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_purchase_order_landed_costs(UUID, BOOLEAN) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_purchase_order_landed_costs(UUID, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 5. register_rep_commission_adjustment
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_rep_commission_adjustment(
  p_rep_id UUID,
  p_sales_note_id UUID,
  p_amount NUMERIC,
  p_paid_date DATE DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := COALESCE(p_created_by, auth.uid());
  v_entry_id UUID;
  v_category_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可登記佣金差額');
  END IF;

  SELECT id INTO v_category_id
    FROM public.accounting_categories
   WHERE type = 'expense' AND name = '業務分潤' AND is_active = true
   ORDER BY name LIMIT 1;
  IF v_category_id IS NULL THEN
    SELECT id INTO v_category_id
      FROM public.accounting_categories
     WHERE type = 'expense' AND is_active = true
     ORDER BY name LIMIT 1;
  END IF;

  INSERT INTO public.accounting_entries (
    type, account_id, category_id, amount, paid_amount, payment_status,
    description, reference_type, reference_id, transaction_date, created_by
  ) VALUES (
    CASE WHEN p_amount >= 0 THEN 'expense' ELSE 'income' END,
    NULL, v_category_id, abs(p_amount), 0, 'unpaid',
    COALESCE(p_description, '佣金差額調整'), 'sales_note', p_sales_note_id,
    COALESCE(p_paid_date, CURRENT_DATE), v_uid
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.accounting_entry_references (
    entry_id, reference_type, reference_id, item_name, amount_applied
  ) VALUES (
    v_entry_id, 'sales_note', p_sales_note_id, '佣金差額', p_amount
  );

  INSERT INTO public.rep_commission_payouts (
    rep_id, sales_note_id, amount, paid_date, note, entry_id, kind, collection_status
  ) VALUES (
    p_rep_id, p_sales_note_id, p_amount, p_paid_date, p_description, v_entry_id, 'adjustment', 'pending'
  );

  RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.register_rep_commission_adjustment(UUID, UUID, NUMERIC, DATE, TEXT, UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_rep_commission_adjustment(UUID, UUID, NUMERIC, DATE, TEXT, UUID) TO authenticated;

-- ------------------------------------------------------------
-- 6. settle_rep_commission_adjustment
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_rep_commission_adjustment(
  p_adjustment_id UUID,
  p_paid_date DATE,
  p_entry_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_adj public.rep_commission_payouts%ROWTYPE;
  v_amount NUMERIC;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可結算佣金差額');
  END IF;

  SELECT * INTO v_adj FROM public.rep_commission_payouts WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '調整紀錄不存在');
  END IF;
  IF v_adj.kind <> 'adjustment' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅 adjustment 可結算');
  END IF;
  IF v_adj.collection_status = 'collected' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已結算');
  END IF;

  v_amount := v_adj.amount;

  -- accounts.balance 調整：追回（amount<0? ) 依計畫：追回＝+、補發＝-
  -- amount 為佣金差額：佣金減少（多發）→ 追回 amount 為負 adjustment → 收回 +|amount|
  -- 簡化：若 amount < 0（追回）balance += abs(amount)；若 amount > 0（補發）balance -= amount
  IF v_adj.entry_id IS NOT NULL THEN
    UPDATE public.accounts
       SET balance = balance + CASE WHEN v_amount < 0 THEN -v_amount ELSE -v_amount END,
           updated_at = now()
     WHERE id = (SELECT account_id FROM public.accounting_entries WHERE id = v_adj.entry_id);
  END IF;

  UPDATE public.rep_commission_payouts
     SET collection_status = 'collected',
         paid_date = p_paid_date
   WHERE id = p_adjustment_id;

  RETURN jsonb_build_object('ok', true, 'adjustment_id', p_adjustment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_rep_commission_adjustment(UUID, DATE, UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_rep_commission_adjustment(UUID, DATE, UUID) TO authenticated;
