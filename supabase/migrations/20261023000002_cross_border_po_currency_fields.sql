-- ============================================================
-- P1 (後半) / M0：PO 幣別骨架 + set_purchase_order_currency RPC
--              + _po_create_with_items / update_purchase_order_with_items body 擴充
-- 檔名：20261023000002_cross_border_po_currency_fields.sql（原 20261022000005，因前綴與已 commit 之外幣 FIFO 檔撞號而改名）
-- 依賴：20261023000001 (countries/currencies)
-- 可獨立驗證與回滾：是
-- ============================================================

-- ------------------------------------------------------------
-- 1. purchase_orders 新增 9 欄
-- ------------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS currency                  TEXT        NOT NULL DEFAULT 'TWD' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS exchange_rate             NUMERIC(16,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  ADD COLUMN IF NOT EXISTS original_total_amount     NUMERIC(14,2) NULL,
  ADD COLUMN IF NOT EXISTS origin_country_code       TEXT        NULL REFERENCES public.countries(code),
  ADD COLUMN IF NOT EXISTS freight_allocation_method TEXT        NOT NULL DEFAULT 'by_value'
        CHECK (freight_allocation_method IN ('by_quantity','by_weight','by_volume','by_value','manual')),
  ADD COLUMN IF NOT EXISTS freight_actual_weight     NUMERIC(12,3) NULL CHECK (freight_actual_weight >= 0),
  ADD COLUMN IF NOT EXISTS freight_weight_factor     NUMERIC(12,6) NOT NULL DEFAULT 1 CHECK (freight_weight_factor > 0),
  ADD COLUMN IF NOT EXISTS freight_allocation_stale  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS landed_total_amount       NUMERIC(14,2) NULL;

-- ------------------------------------------------------------
-- 2. purchase_order_items 新增 7 欄
-- ------------------------------------------------------------
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS source_order_item_ids UUID[]          NULL,
  ADD COLUMN IF NOT EXISTS original_unit_cost     NUMERIC(12,2)  NULL,
  ADD COLUMN IF NOT EXISTS allocated_freight      NUMERIC(14,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landed_unit_cost       NUMERIC(14,2)  NULL,
  ADD COLUMN IF NOT EXISTS weight_kg              NUMERIC(10,3)  NULL CHECK (weight_kg >= 0),
  ADD COLUMN IF NOT EXISTS volume_m3              NUMERIC(12,6)  NULL CHECK (volume_m3 >= 0),
  ADD COLUMN IF NOT EXISTS freight_manual_weight  NUMERIC(14,4)  NULL CHECK (freight_manual_weight >= 0);

CREATE INDEX IF NOT EXISTS idx_poi_freight
  ON public.purchase_order_items(purchase_order_id)
  WHERE allocated_freight <> 0;

-- ------------------------------------------------------------
-- 3. set_purchase_order_currency（小 RPC，admin，PO 幣別欄位寫入）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_purchase_order_currency(
  p_purchase_order_id      uuid,
  p_currency               text,
  p_exchange_rate          numeric,
  p_original_total_amount  numeric DEFAULT NULL,
  p_origin_country_code    text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_status public.purchase_order_status;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可編輯採購單');
  END IF;

  SELECT status INTO v_status
    FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已取消的採購單不可變更幣別');
  END IF;

  IF p_currency = 'TWD' THEN
    p_exchange_rate := 1;
    p_original_total_amount := NULL;
  END IF;

  UPDATE public.purchase_orders
     SET currency               = p_currency,
         exchange_rate          = p_exchange_rate,
         original_total_amount  = COALESCE(p_original_total_amount, original_total_amount),
         origin_country_code    = COALESCE(p_origin_country_code, origin_country_code)
   WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object('ok', true, 'purchase_order_id', p_purchase_order_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_purchase_order_currency(uuid, text, numeric, numeric, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_purchase_order_currency(uuid, text, numeric, numeric, text) TO authenticated;

-- ------------------------------------------------------------
-- 4. _po_create_with_items（CREATE OR REPLACE，簽名不變，item-level 新欄位）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._po_create_with_items(
  p_supplier_id uuid, p_order_date date, p_status text, p_purpose text,
  p_expected_date date, p_supplier_order_number text, p_notes text,
  p_items jsonb, p_created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_po_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_idx integer := 0;
  v_total numeric := 0;
  v_created jsonb := '[]';
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric;
  v_source_ids uuid[];
  v_source_qty jsonb;
  v_source_order_item_ids uuid[];
  v_original_unit_cost numeric;
  v_weight_kg numeric;
  v_volume_m3 numeric;
  v_freight_manual_weight numeric;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '沒有品項';
  END IF;

  INSERT INTO public.purchase_orders (
    supplier_id, status, purpose, order_date, expected_date,
    supplier_order_number, total_amount, notes, created_by
  )
  VALUES (
    p_supplier_id,
    COALESCE(NULLIF(p_status, ''), 'draft')::public.purchase_order_status,
    COALESCE(NULLIF(p_purpose, ''), 'general'),
    COALESCE(p_order_date, CURRENT_DATE),
    p_expected_date,
    NULLIF(btrim(COALESCE(p_supplier_order_number, '')), ''),
    0,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    COALESCE(p_created_by, auth.uid())
  )
  RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_idx := v_idx + 1;
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_variant_id := NULLIF(v_line->>'variant_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::integer, 0);
    v_cost := COALESCE(NULLIF(v_line->>'unit_cost', '')::numeric, 0);

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION '第 % 個品項缺少商品', v_idx;
    END IF;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION '第 % 個品項數量必須大於 0', v_idx;
    END IF;
    IF v_cost < 0 THEN
      RAISE EXCEPTION '第 % 個品項單價不可為負', v_idx;
    END IF;
    IF v_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants pv WHERE pv.id = v_variant_id AND pv.product_id = v_product_id
    ) THEN
      RAISE EXCEPTION '第 % 個品項的變體不屬於該商品', v_idx;
    END IF;

    -- source_order_ids（既有）
    IF v_line ? 'source_order_ids' THEN
      IF v_line->'source_order_ids' = 'null'::jsonb THEN
        v_source_ids := NULL;
      ELSIF jsonb_typeof(v_line->'source_order_ids') = 'array' THEN
        SELECT COALESCE(array_agg(t.val::uuid), '{}') INTO v_source_ids
          FROM jsonb_array_elements_text(v_line->'source_order_ids') AS t(val);
      ELSE
        RAISE EXCEPTION '第 % 個品項的來源訂單格式錯誤', v_idx;
      END IF;
    ELSE
      v_source_ids := NULL;
    END IF;

    -- source_quantities（既有）
    IF v_line ? 'source_quantities' THEN
      IF v_line->'source_quantities' = 'null'::jsonb THEN
        v_source_qty := NULL;
      ELSIF jsonb_typeof(v_line->'source_quantities') = 'object' THEN
        v_source_qty := NULLIF(v_line->'source_quantities', '{}'::jsonb);
      ELSE
        RAISE EXCEPTION '第 % 個品項的來源數量格式錯誤', v_idx;
      END IF;
    ELSE
      v_source_qty := NULL;
    END IF;

    -- source_order_item_ids（新，M4 精確連結）
    IF v_line ? 'source_order_item_ids' THEN
      IF v_line->'source_order_item_ids' = 'null'::jsonb THEN
        v_source_order_item_ids := NULL;
      ELSIF jsonb_typeof(v_line->'source_order_item_ids') = 'array' THEN
        SELECT COALESCE(array_agg(t.val::uuid), '{}') INTO v_source_order_item_ids
          FROM jsonb_array_elements_text(v_line->'source_order_item_ids') AS t(val);
      ELSE
        RAISE EXCEPTION '第 % 個品項的來源訂單品項格式錯誤', v_idx;
      END IF;
    ELSE
      v_source_order_item_ids := NULL;
    END IF;

    v_original_unit_cost := NULLIF(v_line->>'original_unit_cost', '')::numeric;
    v_weight_kg := COALESCE(NULLIF(v_line->>'weight_kg', '')::numeric, NULLIF(v_line->>'weight', '')::numeric);
    v_volume_m3 := COALESCE(NULLIF(v_line->>'volume_m3', '')::numeric, NULLIF(v_line->>'volume', '')::numeric);
    v_freight_manual_weight := NULLIF(v_line->>'freight_manual_weight', '')::numeric;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, variant_id, quantity, received_quantity, unit_cost, sort_order,
      source_order_ids, source_quantities,
      source_order_item_ids, original_unit_cost, weight_kg, volume_m3, freight_manual_weight
    )
    VALUES (
      v_po_id, v_product_id, v_variant_id, v_qty, 0, v_cost, v_idx,
      v_source_ids, v_source_qty,
      v_source_order_item_ids, v_original_unit_cost, v_weight_kg, v_volume_m3, v_freight_manual_weight
    )
    RETURNING id INTO v_item_id;

    v_total := v_total + (v_qty * v_cost);
    v_created := v_created || jsonb_build_object(
      'id', v_item_id,
      'product_id', v_product_id,
      'variant_id', v_variant_id,
      'quantity', v_qty
    );
  END LOOP;

  UPDATE public.purchase_orders SET total_amount = v_total WHERE id = v_po_id;

  RETURN jsonb_build_object('ok', true, 'purchase_order_id', v_po_id, 'items', v_created);
END;
$function$;

-- ------------------------------------------------------------
-- 5. update_purchase_order_with_items（CREATE OR REPLACE，簽名不變）
--    item-level 新欄位採「條件式覆寫」：缺席＝保留原值；JSON null＝設 NULL
--    allocated_freight / landed_unit_cost 明確不碰（§2.7 守門）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_purchase_order_with_items(
  p_purchase_order_id uuid, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb,
  p_deleted_item_ids uuid[] DEFAULT '{}'::uuid[], p_status text DEFAULT NULL::text,
  p_order_date date DEFAULT NULL::date, p_expected_date date DEFAULT NULL::date,
  p_purpose text DEFAULT NULL::text, p_supplier_order_number text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_po_id uuid;
  v_po_status public.purchase_order_status;
  v_line jsonb;
  v_item_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric;
  v_sort integer := 0;
  v_total numeric := 0;
  v_received integer;
  v_consumed integer;
  v_has_batch boolean;
  v_po_locked boolean;
  v_new_status text;
  v_any_received boolean;
  v_source_ids uuid[];
  v_source_qty jsonb;
  v_has_src_ids boolean;
  v_has_src_qty boolean;
  v_source_order_item_ids uuid[];
  v_has_src_oi_ids boolean;
  v_original_unit_cost numeric;
  v_has_orig_cost boolean;
  v_weight_kg numeric;
  v_has_weight boolean;
  v_volume_m3 numeric;
  v_has_volume boolean;
  v_freight_manual_weight numeric;
  v_has_fmw boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.system_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '僅管理員可編輯採購單');
  END IF;

  SELECT status INTO v_po_status FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', '採購單不存在');
  END IF;

  v_po_locked := (v_po_status = 'cancelled');
  IF v_po_locked AND (
    jsonb_array_length(COALESCE(p_items, '[]')) > 0
    OR COALESCE(cardinality(p_deleted_item_ids), 0) > 0
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', '已取消的採購單不可變更品項');
  END IF;

  FOREACH v_item_id IN ARRAY COALESCE(p_deleted_item_ids, '{}')
  LOOP
    SELECT poi.received_quantity, poi.consumed_quantity,
           EXISTS (SELECT 1 FROM public.product_batches pb WHERE pb.purchase_order_item_id = poi.id)
      INTO v_received, v_consumed, v_has_batch
    FROM public.purchase_order_items poi
    WHERE poi.id = v_item_id AND poi.purchase_order_id = p_purchase_order_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', '要刪除的品項不存在於此採購單：' || v_item_id);
    END IF;
    IF v_received > 0 OR v_consumed > 0 OR v_has_batch THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        '品項已收貨／已使用，無法刪除（請改用採購退貨）', 'item_id', v_item_id);
    END IF;

    DELETE FROM public.purchase_order_items WHERE id = v_item_id;
  END LOOP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'))
  LOOP
    v_item_id := NULLIF(v_line->>'id', '')::uuid;
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_variant_id := NULLIF(v_line->>'variant_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_line->>'quantity', '')::integer, 0);
    v_cost := COALESCE(NULLIF(v_line->>'unit_cost', '')::numeric, 0);
    v_sort := v_sort + 1;

    v_has_src_ids := v_line ? 'source_order_ids';
    IF v_has_src_ids THEN
      IF v_line->'source_order_ids' = 'null'::jsonb THEN
        v_source_ids := NULL;
      ELSIF jsonb_typeof(v_line->'source_order_ids') = 'array' THEN
        SELECT COALESCE(array_agg(t.val::uuid), '{}') INTO v_source_ids
          FROM jsonb_array_elements_text(v_line->'source_order_ids') AS t(val);
      ELSE
        RAISE EXCEPTION '品項的來源訂單格式錯誤';
      END IF;
    END IF;

    v_has_src_qty := v_line ? 'source_quantities';
    IF v_has_src_qty THEN
      IF v_line->'source_quantities' = 'null'::jsonb THEN
        v_source_qty := NULL;
      ELSIF jsonb_typeof(v_line->'source_quantities') = 'object' THEN
        v_source_qty := NULLIF(v_line->'source_quantities', '{}'::jsonb);
      ELSE
        RAISE EXCEPTION '品項的來源數量格式錯誤';
      END IF;
    END IF;

    -- 條件式覆寫旗標（新欄位）
    v_has_src_oi_ids := v_line ? 'source_order_item_ids';
    v_has_orig_cost  := v_line ? 'original_unit_cost';
    v_has_weight     := (v_line ? 'weight_kg') OR (v_line ? 'weight');
    v_has_volume     := (v_line ? 'volume_m3') OR (v_line ? 'volume');
    v_has_fmw        := v_line ? 'freight_manual_weight';

    IF v_item_id IS NULL THEN
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION '新增品項缺少商品';
      END IF;
      IF v_qty <= 0 THEN
        RAISE EXCEPTION '新增品項數量必須大於 0';
      END IF;
      IF v_variant_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.product_variants pv WHERE pv.id = v_variant_id AND pv.product_id = v_product_id
      ) THEN
        RAISE EXCEPTION '新增品項的變體不屬於該商品';
      END IF;

      -- 解析新欄位（新增列）
      IF v_has_src_oi_ids THEN
        IF v_line->'source_order_item_ids' = 'null'::jsonb THEN
          v_source_order_item_ids := NULL;
        ELSIF jsonb_typeof(v_line->'source_order_item_ids') = 'array' THEN
          SELECT COALESCE(array_agg(t.val::uuid), '{}') INTO v_source_order_item_ids
            FROM jsonb_array_elements_text(v_line->'source_order_item_ids') AS t(val);
        ELSE
          RAISE EXCEPTION '品項的來源訂單品項格式錯誤';
        END IF;
      ELSE
        v_source_order_item_ids := NULL;
      END IF;
      v_original_unit_cost := CASE WHEN v_has_orig_cost THEN NULLIF(v_line->>'original_unit_cost', '')::numeric ELSE NULL END;
      v_weight_kg := CASE WHEN v_has_weight THEN COALESCE(NULLIF(v_line->>'weight_kg', '')::numeric, NULLIF(v_line->>'weight', '')::numeric) ELSE NULL END;
      v_volume_m3 := CASE WHEN v_has_volume THEN COALESCE(NULLIF(v_line->>'volume_m3', '')::numeric, NULLIF(v_line->>'volume', '')::numeric) ELSE NULL END;
      v_freight_manual_weight := CASE WHEN v_has_fmw THEN NULLIF(v_line->>'freight_manual_weight', '')::numeric ELSE NULL END;

      INSERT INTO public.purchase_order_items (
        purchase_order_id, product_id, variant_id, quantity, received_quantity, unit_cost, sort_order,
        source_order_ids, source_quantities,
        source_order_item_ids, original_unit_cost, weight_kg, volume_m3, freight_manual_weight
      )
      VALUES (
        p_purchase_order_id, v_product_id, v_variant_id, v_qty, 0, v_cost, v_sort,
        v_source_ids, v_source_qty,
        v_source_order_item_ids, v_original_unit_cost, v_weight_kg, v_volume_m3, v_freight_manual_weight
      );
      CONTINUE;
    END IF;

    SELECT received_quantity INTO v_received
      FROM public.purchase_order_items
     WHERE id = v_item_id AND purchase_order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '要更新的品項不存在於此採購單：%', v_item_id;
    END IF;
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION '品項缺少商品';
    END IF;
    IF v_qty < v_received THEN
      RAISE EXCEPTION '品項數量（%）不可小於已收貨數量（%）', v_qty, v_received;
    END IF;
    IF v_received > 0 AND (
      v_product_id IS DISTINCT FROM (SELECT product_id FROM public.purchase_order_items WHERE id = v_item_id)
      OR v_variant_id IS DISTINCT FROM (SELECT variant_id FROM public.purchase_order_items WHERE id = v_item_id)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', '品項已收貨，不可更換商品或變體');
    END IF;

    -- 解析新欄位（條件式覆寫）
    IF v_has_src_oi_ids THEN
      IF v_line->'source_order_item_ids' = 'null'::jsonb THEN
        v_source_order_item_ids := NULL;
      ELSIF jsonb_typeof(v_line->'source_order_item_ids') = 'array' THEN
        SELECT COALESCE(array_agg(t.val::uuid), '{}') INTO v_source_order_item_ids
          FROM jsonb_array_elements_text(v_line->'source_order_item_ids') AS t(val);
      ELSE
        RAISE EXCEPTION '品項的來源訂單品項格式錯誤';
      END IF;
    END IF;
    IF v_has_orig_cost THEN
      IF v_line->'original_unit_cost' = 'null'::jsonb THEN
        v_original_unit_cost := NULL;
      ELSE
        v_original_unit_cost := NULLIF(v_line->>'original_unit_cost', '')::numeric;
      END IF;
    END IF;
    IF v_has_weight THEN
      IF v_line->'weight_kg' = 'null'::jsonb OR v_line->'weight' = 'null'::jsonb THEN
        v_weight_kg := NULL;
      ELSE
        v_weight_kg := COALESCE(NULLIF(v_line->>'weight_kg', '')::numeric, NULLIF(v_line->>'weight', '')::numeric);
      END IF;
    END IF;
    IF v_has_volume THEN
      IF v_line->'volume_m3' = 'null'::jsonb OR v_line->'volume' = 'null'::jsonb THEN
        v_volume_m3 := NULL;
      ELSE
        v_volume_m3 := COALESCE(NULLIF(v_line->>'volume_m3', '')::numeric, NULLIF(v_line->>'volume', '')::numeric);
      END IF;
    END IF;
    IF v_has_fmw THEN
      IF v_line->'freight_manual_weight' = 'null'::jsonb THEN
        v_freight_manual_weight := NULL;
      ELSE
        v_freight_manual_weight := NULLIF(v_line->>'freight_manual_weight', '')::numeric;
      END IF;
    END IF;

    UPDATE public.purchase_order_items
       SET quantity = v_qty, unit_cost = v_cost, sort_order = v_sort,
           source_order_ids = CASE WHEN v_has_src_ids THEN v_source_ids ELSE source_order_ids END,
           source_quantities = CASE WHEN v_has_src_qty THEN v_source_qty ELSE source_quantities END,
           source_order_item_ids = CASE WHEN v_has_src_oi_ids THEN v_source_order_item_ids ELSE source_order_item_ids END,
           original_unit_cost = CASE WHEN v_has_orig_cost THEN v_original_unit_cost ELSE original_unit_cost END,
           weight_kg = CASE WHEN v_has_weight THEN v_weight_kg ELSE weight_kg END,
           volume_m3 = CASE WHEN v_has_volume THEN v_volume_m3 ELSE volume_m3 END,
           freight_manual_weight = CASE WHEN v_has_fmw THEN v_freight_manual_weight ELSE freight_manual_weight END
     WHERE id = v_item_id;
     -- 注意：allocated_freight / landed_unit_cost 明確不碰，保留原值（§2.7 守門）
  END LOOP;

  v_new_status := v_po_status::text;
  IF NULLIF(p_status, '') IS NOT NULL THEN
    IF p_status NOT IN ('draft', 'ordered', 'cancelled') THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        '採購單狀態僅支援 draft/ordered/cancelled（收到 ' || p_status || '）');
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id AND received_quantity > 0
    ) INTO v_any_received;
    IF v_any_received AND p_status IS DISTINCT FROM v_po_status::text THEN
      RETURN jsonb_build_object('ok', false, 'reason',
        '此採購單已有收貨品項，狀態由收貨結果決定，不可手動變更');
    END IF;
    v_new_status := p_status;
  END IF;

  UPDATE public.purchase_orders
     SET notes = COALESCE(p_notes, notes),
         order_date = COALESCE(p_order_date, order_date),
         expected_date = CASE WHEN p_expected_date IS NULL THEN expected_date ELSE p_expected_date END,
         purpose = COALESCE(NULLIF(p_purpose, ''), purpose),
         supplier_order_number = CASE
           WHEN p_supplier_order_number IS NULL THEN supplier_order_number
           ELSE NULLIF(btrim(p_supplier_order_number), '')
         END,
         status = v_new_status::public.purchase_order_status
   WHERE id = p_purchase_order_id;

  SELECT COALESCE(SUM(quantity * unit_cost), 0) INTO v_total
    FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id;
  UPDATE public.purchase_orders SET total_amount = v_total WHERE id = p_purchase_order_id;

  RETURN jsonb_build_object('ok', true, 'purchase_order_id', p_purchase_order_id, 'total_amount', v_total);
END;
$function$;
