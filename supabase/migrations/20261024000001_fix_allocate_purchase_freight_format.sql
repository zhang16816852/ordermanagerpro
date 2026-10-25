-- ============================================================
-- P3 / M2：落地成本分攤引擎 _po_allocate_freight + allocate_purchase_freight
-- 檔名：20261023000004_cross_border_freight_allocation.sql
-- 依賴：20261023000003 (purchase_freight_costs, stale trigger)
-- 可獨立驗證與回滾：是
-- ============================================================

-- ------------------------------------------------------------
-- 1. _po_allocate_freight (內部 helper，REVOKE 全部、不 GRANT)
--    p_dry_run=true 時只計算、零寫入；false 時 apply。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._po_allocate_freight(
  p_po_id   UUID,
  p_actor   UUID DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_po RECORD;
  v_total_twd NUMERIC(14,2) := 0;
  v_method TEXT;
  v_actual_weight NUMERIC;
  v_sum_weight NUMERIC := 0;
  v_factor NUMERIC := 1;
  v_fallback BOOLEAN := false;
  v_warnings JSONB := '[]'::JSONB;
  v_n INT := 0;
  v_total_cent BIGINT := 0;
  v_sum_w NUMERIC := 0;
  v_gap_cent BIGINT := 0;
  v_base_cent BIGINT;
  v_rem BIGINT;
  v_rank INT := 0;
  -- 台幣總成本（整數，供最終入成本用：Σ(new_landed × quantity) = 此值）
  v_total_landed_twd BIGINT := 0;
  -- 補償品項：最後一個 quantity > 0 的品項，由它承擔四捨五入誤差
  v_comp_id UUID;
  v_comp_qty NUMERIC;
  v_non_comp_sum NUMERIC := 0;
  -- temp table name
  v_tbl TEXT := 'pg_temp._po_alloc_' || replace(p_po_id::text, '-', '');
BEGIN
  -- 1. 讀 PO
  SELECT po.id, po.currency, po.freight_allocation_method, po.freight_actual_weight,
         po.total_amount, po.freight_allocation_stale
    INTO v_po
    FROM public.purchase_orders po
   WHERE po.id = p_po_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '採購單不存在';
  END IF;

  v_method := COALESCE(NULLIF(v_po.freight_allocation_method, ''), 'by_quantity');
  v_actual_weight := v_po.freight_actual_weight;

  -- 2. 運費總額（台幣）
  SELECT COALESCE(SUM(pfc.amount_twd), 0) INTO v_total_twd
    FROM public.purchase_freight_costs pfc
   WHERE pfc.purchase_order_id = p_po_id;

  -- 3. 建立臨時工作表
  EXECUTE format('DROP TABLE IF EXISTS %I', v_tbl);
  EXECUTE format(
    'CREATE TEMP TABLE %I (
       poi_id UUID, product_id UUID, variant_id UUID, quantity NUMERIC,
       unit_cost NUMERIC, sort_order INT, id UUID,
       raw_weight NUMERIC, raw_volume NUMERIC, manual_weight NUMERIC,
       w NUMERIC DEFAULT 0, base_cent BIGINT DEFAULT 0, rem BIGINT DEFAULT 0,
       rank INT DEFAULT 0, allocated NUMERIC(14,2) DEFAULT 0,
       new_landed NUMERIC(14,2) DEFAULT 0,
       old_allocated NUMERIC(14,2) DEFAULT 0, old_landed NUMERIC(14,2) DEFAULT 0
     ) ON COMMIT DROP', v_tbl);

  -- 4. 載入品項 + 推導權重基底（快照回寫準備）
  EXECUTE format(
    'INSERT INTO %I (poi_id, product_id, variant_id, quantity, unit_cost, sort_order, id,
                     raw_weight, raw_volume, manual_weight, old_allocated, old_landed)
     SELECT poi.id, poi.product_id, poi.variant_id, poi.quantity, poi.unit_cost,
            COALESCE(poi.sort_order, 0), poi.id,
            COALESCE(poi.weight_kg, pv.weight_kg, p.weight_kg, 0),
            COALESCE(poi.volume_m3, pv.volume_m3, p.volume_m3, 0),
            COALESCE(poi.freight_manual_weight, 0),
            COALESCE(poi.allocated_freight, 0),
            COALESCE(poi.landed_unit_cost, poi.unit_cost)
       FROM public.purchase_order_items poi
       LEFT JOIN public.products p ON p.id = poi.product_id
       LEFT JOIN public.product_variants pv ON pv.id = poi.variant_id
      WHERE poi.purchase_order_id = $1', v_tbl)
  USING p_po_id;

  -- 校正因子：Σ (raw_weight * quantity)
  EXECUTE format('SELECT COALESCE(SUM(raw_weight * quantity), 0) FROM %I', v_tbl) INTO v_sum_weight;

  IF v_actual_weight IS NOT NULL AND v_sum_weight > 0 THEN
    v_factor := v_actual_weight / v_sum_weight;
  ELSIF v_actual_weight IS NOT NULL AND v_sum_weight = 0 THEN
    v_factor := 1;
    v_warnings := v_warnings || jsonb_build_array('無重量資料，校正因子未套用');
  ELSE
    v_factor := 1;
  END IF;

  -- 5. 逐品項權重 w_i
  IF v_method = 'by_quantity' THEN
    EXECUTE format('UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity ELSE 0 END WHERE poi_id IS NOT NULL', v_tbl);
  ELSIF v_method = 'by_weight' THEN
    EXECUTE format('UPDATE %I SET w = CASE WHEN quantity > 0 THEN raw_weight * quantity * $1 ELSE 0 END WHERE poi_id IS NOT NULL', v_tbl) USING v_factor;
  ELSIF v_method = 'by_volume' THEN
    EXECUTE format('UPDATE %I SET w = CASE WHEN quantity > 0 THEN raw_volume * quantity ELSE 0 END WHERE poi_id IS NOT NULL', v_tbl);
  ELSIF v_method = 'by_value' THEN
    EXECUTE format('UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity * COALESCE(unit_cost,0) ELSE 0 END WHERE poi_id IS NOT NULL', v_tbl);
  ELSIF v_method = 'manual' THEN
    EXECUTE format('UPDATE %I SET w = COALESCE(manual_weight, 0) WHERE poi_id IS NOT NULL', v_tbl);
  ELSE
    EXECUTE format('UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity ELSE 0 END WHERE poi_id IS NOT NULL', v_tbl);
    v_method := 'by_quantity';
  END IF;

  -- 6. 權重歸零 fallback
  EXECUTE format('SELECT COALESCE(SUM(w), 0) FROM %I', v_tbl) INTO v_sum_w;
  IF v_sum_w = 0 AND v_method <> 'by_quantity' THEN
    v_fallback := true;
    EXECUTE format('UPDATE %I SET w = CASE WHEN quantity > 0 THEN quantity ELSE 0 END WHERE poi_id IS NOT NULL', v_tbl);
    EXECUTE format('SELECT COALESCE(SUM(w), 0) FROM %I', v_tbl) INTO v_sum_w;
  END IF;
  IF v_sum_w = 0 THEN
    -- 全部 quantity=0 → 平均分攤
    v_fallback := true;
    v_warnings := v_warnings || jsonb_build_array('所有品項數量為 0，採平均分攤');
    EXECUTE format('UPDATE %I SET w = 1 WHERE poi_id IS NOT NULL', v_tbl);
    EXECUTE format('SELECT COALESCE(SUM(w), 0) FROM %I', v_tbl) INTO v_sum_w;
  END IF;

  -- 7. 最大餘數法（整數分）
  v_total_cent := round(v_total_twd * 100)::BIGINT;
  -- base_cent_i = floor(total_cent * w_i / sum_w)
  EXECUTE format(
    'UPDATE %I SET base_cent = (SELECT (trunc(($1::numeric * w / $2::numeric))::bigint) FROM (SELECT 1) x) WHERE poi_id IS NOT NULL',
    v_tbl) USING v_total_cent, v_sum_w;
  -- simpler: do per-row
  EXECUTE format('UPDATE %I SET base_cent = floor($1::numeric * w / $2::numeric)::bigint WHERE poi_id IS NOT NULL', v_tbl) USING v_total_cent, v_sum_w;
  EXECUTE format('SELECT COALESCE(SUM(base_cent),0) FROM %I', v_tbl) INTO v_base_cent;
  -- compute gap
  EXECUTE format('SELECT $1::bigint - COALESCE(SUM(base_cent),0) FROM %I', v_tbl) INTO v_gap_cent USING v_total_cent;

  -- remainder_i = (total_cent * w_i) % sum_w
  EXECUTE format('UPDATE %I SET rem = (($1::bigint * w)::numeric %% $2::numeric)::bigint WHERE poi_id IS NOT NULL', v_tbl) USING v_total_cent, v_sum_w;

  -- rank: ORDER BY rem DESC, sort_order ASC, id ASC
  EXECUTE format(
    'WITH r AS (
       SELECT poi_id, ROW_NUMBER() OVER (ORDER BY rem DESC, sort_order ASC, id ASC) AS rn
       FROM %I
     )
     UPDATE %I t SET rank = r.rn FROM r WHERE t.poi_id = r.poi_id', v_tbl, v_tbl);

  -- allocated_i cents = base_cent + (rank <= gap ? 1 : 0) cents (0.01)
  EXECUTE format(
    'UPDATE %I SET allocated = (base_cent + CASE WHEN rank <= $1 THEN 1 ELSE 0 END)::numeric / 100.0 WHERE poi_id IS NOT NULL',
    v_tbl) USING v_gap_cent;

  -- new_landed_unit_cost
  -- 台幣總成本（整數），非補償品項單價取整數，補償品項反推使 Σ(new_landed × quantity) 精確相等
  v_total_landed_twd := round(v_po.total_amount + v_total_twd);

  -- 補償品項：最後一個 quantity > 0 的品項（依 sort_order, id 倒序）
  EXECUTE format(
    'SELECT poi_id, quantity FROM %I WHERE quantity > 0 ORDER BY sort_order DESC, id DESC LIMIT 1',
    v_tbl) INTO v_comp_id, v_comp_qty;

  -- 非補償品項：單價取整數；補償品項暫設 NULL，稍後反推
  EXECUTE format(
    'UPDATE %I SET new_landed = CASE
       WHEN poi_id = %L THEN NULL
       WHEN quantity > 0 THEN round((unit_cost * quantity + allocated) / quantity, 0)::numeric
       ELSE unit_cost END', v_tbl, v_comp_id);

  -- 計算非補償品項的 Σ(new_landed × quantity)，再反推補償品項
  IF v_comp_id IS NOT NULL THEN
    EXECUTE format(
      'SELECT COALESCE(SUM(new_landed * quantity), 0) FROM %I WHERE poi_id <> %L AND quantity > 0 AND new_landed IS NOT NULL',
      v_tbl, v_comp_id) INTO v_non_comp_sum;

    EXECUTE format(
  'UPDATE %I
      SET new_landed = ($1 - $2) / $3
    WHERE poi_id = $4',
  v_tbl
)
USING
  v_total_landed_twd,
  v_non_comp_sum,
  v_comp_qty,
  v_comp_id;
  END IF;

  -- 8. 建立 changes JSON（含顯示用欄位）
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(jsonb_build_object(
        ''purchase_order_item_id'', poi_id,
        ''product_id'', product_id,
        ''variant_id'', variant_id,
        ''quantity'', quantity,
        ''weight'', raw_weight,
        ''weight_effective'', raw_weight * $2,
        ''old_allocated_freight'', old_allocated,
        ''new_allocated_freight'', allocated,
        ''old_landed_unit_cost'', old_landed,
        ''new_landed_unit_cost'', new_landed
      ) ORDER BY sort_order, id), ''[]''::jsonb)
     FROM ' || v_tbl, v_tbl) INTO v_changes USING p_po_id, v_factor;

  -- 9. apply（若非 dry-run）
  IF NOT p_dry_run THEN
    -- 回寫 weight/volume 快照 + allocated + landed
    EXECUTE format(
      'UPDATE public.purchase_order_items poi SET
         weight_kg = t.raw_weight,
         volume_m3 = t.raw_volume,
         allocated_freight = t.allocated,
         landed_unit_cost = t.new_landed
       FROM %I t WHERE poi.id = t.poi_id', v_tbl);

    UPDATE public.purchase_orders
       SET freight_weight_factor = v_factor,
           freight_allocation_stale = false,
           landed_total_amount = total_amount + v_total_twd,
           updated_at = now()
     WHERE id = p_po_id;
  END IF;

  -- 10. 清理 temp table
  EXECUTE format('DROP TABLE IF EXISTS %I', v_tbl);

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'method', v_method,
    'weight_factor', v_factor,
    'actual_weight', v_actual_weight,
    'base_weight_total', v_sum_weight,
    'freight_total_twd', v_total_twd,
    'fallback', v_fallback,
    'warnings', v_warnings,
    'changes', v_changes
  );
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      EXECUTE format('DROP TABLE IF EXISTS %I', v_tbl);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public._po_allocate_freight(UUID, UUID, BOOLEAN) FROM public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. allocate_purchase_freight (對外，admin/store member/sales_rep)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_purchase_freight(
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT po.id INTO v_po
    FROM public.purchase_orders po WHERE po.id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  IF NOT public.has_role(v_uid, 'admin'::public.system_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN public._po_allocate_freight(p_purchase_order_id, v_uid, (NOT p_apply));
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_purchase_freight(UUID, BOOLEAN) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_purchase_freight(UUID, BOOLEAN) TO authenticated;
