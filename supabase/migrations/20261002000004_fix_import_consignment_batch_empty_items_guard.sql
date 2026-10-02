-- ============================================================
-- import_consignment_batch：補上「沒有品項」守門（三值邏輯）
--
-- 問題：群組未帶 items 鍵時 v_group->>items 為 SQL NULL，而 jsonb_typeof()
--       與 jsonb_array_length() 皆為 strict → 都回 NULL，於是
--         NULL <> 'array' OR NULL = 0
--       整條條件為 NULL，`IF NULL` 不成立 → 守門被完全略過。
--       結果會建立出 0 品項的寄賣單；active 分支另會多建一張 0 品項的
--       來源訂單，draft 分支自 20261002000003 起亦會建立 pending 來源單。
-- 修正：改用 `IS DISTINCT FROM 'array'`，使 NULL（以及物件／純量）一律
--       視為非陣列 → 正確拋出「沒有品項」。
--
-- 簽名不變（單一 jsonb,uuid 簽名），以 20261002000003 的最新 body 為基底重發。
-- ============================================================

CREATE OR REPLACE FUNCTION public.import_consignment_batch(
  p_rows jsonb,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_creator uuid := COALESCE(p_created_by, auth.uid());
  v_groups jsonb;
  v_group jsonb;
  v_idx integer := -1;
  v_direction_raw text;
  v_direction text;
  v_status_raw text;
  v_status text;
  v_store jsonb;
  v_target_store_id uuid;
  v_supplier jsonb;
  v_supplier_id uuid;
  v_ts timestamptz;
  v_notes text;
  v_items jsonb;
  v_item jsonb;
  v_con_id uuid;
  v_con_code text;
  v_custom_con_code text;
  v_ord_id uuid;
  v_ord_code text;
  v_count integer;
  v_res jsonb;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_oi_id uuid;
  v_coi_id uuid;
  v_item_rows jsonb := '[]';
  v_own_wh uuid;
  v_supplier_wh uuid;
  v_results jsonb := '[]';
  v_errors jsonb := '[]';
  v_total integer;
  v_success integer := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows 必須為 JSON 陣列';
  END IF;
  IF NOT (SELECT public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION '僅管理員可匯入寄賣單';
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;
  SELECT id INTO v_supplier_wh FROM public.warehouses WHERE code = 'supplier_consignment';
  IF v_supplier_wh IS NULL THEN
    RAISE EXCEPTION '找不到供應商寄賣倉';
  END IF;

  v_groups := p_rows;
  v_total := jsonb_array_length(v_groups);

  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_direction_raw := COALESCE(NULLIF(v_group->>'direction', ''), 'send_to_store');
      v_direction := CASE WHEN v_direction_raw IN ('send_to_store', '寄出', '店家出貨', '店家方向') THEN 'send_to_store'
                          WHEN v_direction_raw IN ('receive_from_supplier', '進貨', '廠商進貨', '廠商方向') THEN 'receive_from_supplier'
                          ELSE v_direction_raw END;
      IF v_direction NOT IN ('send_to_store', 'receive_from_supplier') THEN
        RAISE EXCEPTION '方向僅支援 send_to_store / receive_from_supplier（收到 %）', v_direction_raw;
      END IF;

      v_status_raw := COALESCE(NULLIF(v_group->>'status', ''), 'active');
      v_status := CASE WHEN v_status_raw IN ('active', '已出貨', '生效') THEN 'active'
                       WHEN v_status_raw IN ('draft', '草稿') THEN 'draft'
                       WHEN v_status_raw IN ('shipped', '已出貨') THEN 'active'
                       ELSE v_status_raw END;
      IF v_status NOT IN ('draft', 'active') THEN
        RAISE EXCEPTION '寄賣狀態僅支援 draft / active（收到 %）', v_status_raw;
      END IF;

      v_ts := COALESCE(NULLIF(v_group->>'shipped_date', '')::timestamptz, NOW());
      v_notes := NULLIF(v_group->>'notes', '');
      v_custom_con_code := NULLIF(v_group->>'consignment_code', '');

      IF v_custom_con_code IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.consignment_orders WHERE code = v_custom_con_code) THEN
        RAISE EXCEPTION '寄賣單編號已存在：%', v_custom_con_code;
      END IF;

      v_items := v_group->'items';
      IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION '沒有品項';
      END IF;

      v_con_id := NULL;
      v_ord_id := NULL;
      v_ord_code := NULL;
      v_count := 0;

      IF v_direction = 'send_to_store' THEN
        v_store := public.import_resolve_store(v_group->>'store_code');
        IF v_store IS NULL THEN
          RAISE EXCEPTION '店家不存在：%', COALESCE(v_group->>'store_code', '(未填)');
        END IF;
        v_target_store_id := (v_store->>'store_id')::uuid;

        IF v_status = 'draft' THEN
          -- 草稿：建立 pending 來源訂單 + waiting 鏡像品項，避免孤兒寄賣單
          INSERT INTO public.orders (store_id, created_by, notes, source_type, status,
                                     consignment_mode, code, created_at)
          VALUES (v_target_store_id, v_creator, v_notes, 'consignment', 'pending',
                  true, NULLIF(v_group->>'order_code', ''), v_ts)
          RETURNING id, code INTO v_ord_id, v_ord_code;

          INSERT INTO public.consignment_orders (code, direction, store_id, status, note, created_by, created_at, source_order_id)
          VALUES ('CS-TMP', 'send_to_store', v_target_store_id, 'draft', v_notes, v_creator, v_ts, v_ord_id)
          RETURNING id, code INTO v_con_id, v_con_code;

          FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
          LOOP
            v_res := public.import_resolve_item(v_item->>'sku', v_item->>'name');
            IF v_res IS NULL THEN
              RAISE EXCEPTION '找不到商品：%', COALESCE(v_item->>'sku', v_item->>'name', '(未填)');
            END IF;
            v_qty := (v_item->>'quantity')::integer;
            IF v_qty IS NULL OR v_qty <= 0 THEN
              RAISE EXCEPTION '數量必須為正整數（收到 %）', v_qty;
            END IF;
            v_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, (v_res->>'fallback_price')::numeric, 0);
            v_cost := COALESCE(NULLIF(v_item->>'unit_cost', '')::numeric, (v_res->>'fallback_price')::numeric, 0);

            INSERT INTO public.order_items (order_id, product_id, variant_id, store_id, quantity,
                                            unit_price, unit_cost, shipped_quantity, status, sort_order,
                                            created_at, updated_at)
            VALUES (v_ord_id, (v_res->>'product_id')::uuid, NULLIF(v_res->>'variant_id', '')::uuid,
                    v_target_store_id, v_qty, v_price, v_cost, 0, 'waiting', v_count, v_ts, v_ts)
            RETURNING id INTO v_oi_id;

            INSERT INTO public.consignment_order_items (consignment_order_id, product_id, variant_id, quantity, unit_price, unit_cost, order_item_id)
            VALUES (v_con_id, (v_res->>'product_id')::uuid, NULLIF(v_res->>'variant_id', '')::uuid,
                    v_qty, v_price, v_cost, v_oi_id);

            v_count := v_count + 1;
          END LOOP;

        ELSE
          -- active：自動建立來源訂單（consignment_mode=true）避免孤兒
          INSERT INTO public.orders (store_id, created_by, notes, source_type, status,
                                     consignment_mode, code, created_at)
          VALUES (v_target_store_id, v_creator, v_notes, 'consignment', 'shipped',
                  true, NULLIF(v_group->>'order_code', ''), v_ts)
          RETURNING id, code INTO v_ord_id, v_ord_code;

          v_item_rows := '[]';
          FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
          LOOP
            v_res := public.import_resolve_item(v_item->>'sku', v_item->>'name');
            IF v_res IS NULL THEN
              RAISE EXCEPTION '找不到商品：%', COALESCE(v_item->>'sku', v_item->>'name', '(未填)');
            END IF;
            v_qty := (v_item->>'quantity')::integer;
            IF v_qty IS NULL OR v_qty <= 0 THEN
              RAISE EXCEPTION '數量必須為正整數（收到 %）', v_qty;
            END IF;
            v_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, (v_res->>'fallback_price')::numeric, 0);
            v_cost := COALESCE(NULLIF(v_item->>'unit_cost', '')::numeric, (v_res->>'fallback_price')::numeric, 0);

            INSERT INTO public.order_items (order_id, product_id, variant_id, store_id, quantity,
                                            unit_price, unit_cost, shipped_quantity, status, sort_order,
                                            created_at, updated_at)
            VALUES (v_ord_id, (v_res->>'product_id')::uuid, NULLIF(v_res->>'variant_id', '')::uuid,
                    v_target_store_id, v_qty, v_price, v_cost, v_qty, 'shipped', v_count, v_ts, v_ts)
            RETURNING id INTO v_oi_id;

            v_item_rows := v_item_rows || jsonb_build_object(
              'oi_id', v_oi_id,
              'product_id', v_res->>'product_id',
              'variant_id', v_res->>'variant_id',
              'qty', v_qty, 'price', v_price, 'cost', v_cost);
            v_count := v_count + 1;
          END LOOP;

          -- 先 INSERT draft（拿 CS-DRAFT 暫存碼）再 UPDATE 為 active 帶自訂碼，
          -- 如此自訂 code 才能保留（INSERT 非 draft 會被 trigger 覆寫）
          INSERT INTO public.consignment_orders (code, direction, store_id, status, note, created_by, created_at)
          VALUES ('CS-TMP', 'send_to_store', v_target_store_id, 'draft', v_notes, v_creator, v_ts)
          RETURNING id INTO v_con_id;

          UPDATE public.consignment_orders
          SET status = 'active',
              code = v_custom_con_code,
              source_order_id = v_ord_id,
              shipped_at = v_ts,
              updated_at = NOW()
          WHERE id = v_con_id
          RETURNING code INTO v_con_code;

          v_count := 0;
          FOR v_item IN SELECT * FROM jsonb_array_elements(v_item_rows)
          LOOP
            INSERT INTO public.consignment_order_items (consignment_order_id, product_id, variant_id, quantity, unit_price, unit_cost, order_item_id)
            VALUES (v_con_id, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
                    (v_item->>'qty')::integer, (v_item->>'price')::numeric, (v_item->>'cost')::numeric,
                    (v_item->>'oi_id')::uuid)
            RETURNING id INTO v_coi_id;

            INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change,
                                                    source_type, consignment_order_id, consignment_order_item_id,
                                                    order_item_id, reference_code, inventory_owner, created_by)
            VALUES ((v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid, v_own_wh,
                    -(v_item->>'qty')::integer, 'consignment_out_shipment',
                    v_con_id, v_coi_id, (v_item->>'oi_id')::uuid, v_ord_code, 'store_consignment', v_creator);
            v_count := v_count + 1;
          END LOOP;
        END IF;
      ELSE
        -- receive_from_supplier
        v_supplier := public.import_resolve_supplier(v_group->>'supplier_code');
        IF v_supplier IS NULL THEN
          RAISE EXCEPTION '供應商不存在：%', COALESCE(v_group->>'supplier_code', '(未填)');
        END IF;
        v_supplier_id := (v_supplier->>'supplier_id')::uuid;

        IF v_status = 'draft' THEN
          INSERT INTO public.consignment_orders (code, direction, supplier_id, status, note, created_by, created_at)
          VALUES ('CS-TMP', 'receive_from_supplier', v_supplier_id, 'draft', v_notes, v_creator, v_ts)
          RETURNING id, code INTO v_con_id, v_con_code;

          FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
          LOOP
            v_res := public.import_resolve_item(v_item->>'sku', v_item->>'name');
            IF v_res IS NULL THEN
              RAISE EXCEPTION '找不到商品：%', COALESCE(v_item->>'sku', v_item->>'name', '(未填)');
            END IF;
            v_qty := (v_item->>'quantity')::integer;
            IF v_qty IS NULL OR v_qty <= 0 THEN
              RAISE EXCEPTION '數量必須為正整數（收到 %）', v_qty;
            END IF;
            v_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, (v_res->>'fallback_price')::numeric, 0);
            v_cost := COALESCE(NULLIF(v_item->>'unit_cost', '')::numeric, (v_res->>'fallback_price')::numeric, 0);
            INSERT INTO public.consignment_order_items (consignment_order_id, product_id, variant_id, quantity, unit_price, unit_cost)
            VALUES (v_con_id, (v_res->>'product_id')::uuid, NULLIF(v_res->>'variant_id', '')::uuid,
                    v_qty, v_price, v_cost);
            v_count := v_count + 1;
          END LOOP;
        ELSE
          INSERT INTO public.consignment_orders (code, direction, supplier_id, status, note, created_by, created_at)
          VALUES ('CS-TMP', 'receive_from_supplier', v_supplier_id, 'draft', v_notes, v_creator, v_ts)
          RETURNING id INTO v_con_id;

          UPDATE public.consignment_orders
          SET status = 'active',
              code = v_custom_con_code,
              shipped_at = v_ts,
              received_at = v_ts,
              received_by = v_creator,
              updated_at = NOW()
          WHERE id = v_con_id
          RETURNING code INTO v_con_code;

          FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
          LOOP
            v_res := public.import_resolve_item(v_item->>'sku', v_item->>'name');
            IF v_res IS NULL THEN
              RAISE EXCEPTION '找不到商品：%', COALESCE(v_item->>'sku', v_item->>'name', '(未填)');
            END IF;
            v_qty := (v_item->>'quantity')::integer;
            IF v_qty IS NULL OR v_qty <= 0 THEN
              RAISE EXCEPTION '數量必須為正整數（收到 %）', v_qty;
            END IF;
            v_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, (v_res->>'fallback_price')::numeric, 0);
            v_cost := COALESCE(NULLIF(v_item->>'unit_cost', '')::numeric, (v_res->>'fallback_price')::numeric, 0);

            INSERT INTO public.consignment_order_items (consignment_order_id, product_id, variant_id, quantity, unit_price, unit_cost)
            VALUES (v_con_id, (v_res->>'product_id')::uuid, NULLIF(v_res->>'variant_id', '')::uuid,
                    v_qty, v_price, v_cost)
            RETURNING id INTO v_coi_id;

            INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change,
                                                    source_type, consignment_order_id, consignment_order_item_id,
                                                    reference_code, inventory_owner, created_by)
            VALUES ((v_res->>'product_id')::uuid, NULLIF(v_res->>'variant_id', '')::uuid, v_supplier_wh,
                    v_qty, 'consignment_in_receipt', v_con_id, v_coi_id,
                    v_con_code, 'supplier_consignment', v_creator);
            v_count := v_count + 1;
          END LOOP;
        END IF;
      END IF;

      v_results := v_results || jsonb_build_object(
        'index', v_idx, 'direction', v_direction, 'consignment_id', v_con_id,
        'consignment_code', v_con_code, 'source_order_id', v_ord_id,
        'order_code', v_ord_code, 'item_count', v_count);
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'reason', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('total', v_total, 'success', v_success,
                            'results', v_results, 'errors', v_errors);
END;
$$;
REVOKE ALL ON FUNCTION public.import_consignment_batch(jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_consignment_batch(jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.import_consignment_batch IS '匯入寄賣單：send_to_store 自動建來源訂單（含 draft），僅 admin';