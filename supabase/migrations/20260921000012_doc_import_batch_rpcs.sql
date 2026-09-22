-- ============================================================
-- 三種單據批次匯入 RPC（僅 admin）
-- 用途：系統遷移／初期上線回填既有資料
--   import_orders_batch        → 訂單（含品項）
--   import_sales_notes_batch   → 銷貨單（自動建立來源訂單 + 扣自有倉庫存 + inventory_movements）
--   import_consignment_batch   → 寄賣單（send_to_store 自動建立來源訂單避免孤兒；
--                                 receive_from_supplier 獨立建立）
-- 共同設計：
--   * p_rows 為 JSON 陣列，每個元素＝一筆「單據群組」{ store_code, [codes], [date], items: [...] }
--   * 每群組以子交易隔離：失敗只回滾該群組，不回滾其他群組
--   * 回傳 { total, success, results[], errors[] }，errors 含失敗原因
--   * 單號規則：orders/sales_notes 自帶 code 則直接使用（trigger 只在 code IS NULL 產號）；
--     consignment 自帶 code 走「INSERT draft → UPDATE status=active 帶 code」路徑
--     （INSERT 非 draft 會被 trigger 強制覆寫，UPDATE draft→active 只在 CS-DRAFT/空碼時產號）
--   * 歷史日期：各群組可帶 order_date / shipped_date，作為 created_at 產號日期段
-- ============================================================

-- ------------------------------------------------------------
-- 共用 helper：以 SKU／名稱解析商品（商品層級或變體層級）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_resolve_item(
  p_sku text,
  p_item_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_sku text := NULLIF(btrim(COALESCE(p_sku, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_item_name, '')), '');
  v_product_id uuid;
  v_variant_id uuid;
  v_label text;
  v_fallback numeric;
BEGIN
  IF v_sku IS NOT NULL THEN
    SELECT v.id, v.product_id, COALESCE(v.name, p.name),
           COALESCE(v.wholesale_price, p.unified_wholesale_price, 0)
      INTO v_variant_id, v_product_id, v_label, v_fallback
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE v.sku = v_sku
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id,
                                'name', v_label, 'fallback_price', v_fallback);
    END IF;
    SELECT p.id, NULL::uuid, p.name, COALESCE(p.unified_wholesale_price, 0)
      INTO v_product_id, v_variant_id, v_label, v_fallback
      FROM public.products p
     WHERE p.code = v_sku OR p.name = v_sku
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('product_id', v_product_id, 'variant_id', NULL,
                                'name', v_label, 'fallback_price', v_fallback);
    END IF;
  END IF;

  IF v_name IS NOT NULL THEN
    SELECT v.id, v.product_id, COALESCE(v.name, p.name),
           COALESCE(v.wholesale_price, p.unified_wholesale_price, 0)
      INTO v_variant_id, v_product_id, v_label, v_fallback
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE v.name = v_name
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('product_id', v_product_id, 'variant_id', v_variant_id,
                                'name', v_label, 'fallback_price', v_fallback);
    END IF;
    SELECT p.id, NULL::uuid, p.name, COALESCE(p.unified_wholesale_price, 0)
      INTO v_product_id, v_variant_id, v_label, v_fallback
      FROM public.products p
     WHERE p.name = v_name
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('product_id', v_product_id, 'variant_id', NULL,
                                'name', v_label, 'fallback_price', v_fallback);
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.import_resolve_item(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_resolve_item(text, text) TO authenticated;

-- ------------------------------------------------------------
-- 共用 helper：以代碼／名稱解析店家
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_resolve_store(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_code text := NULLIF(btrim(COALESCE(p_code, '')), '');
  v_store uuid;
  v_name text;
  v_store_code text;
BEGIN
  IF v_code IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id, name, code INTO v_store, v_name, v_store_code
    FROM public.stores
   WHERE code = v_code OR name = v_code
   ORDER BY (code = v_code) DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('store_id', v_store, 'name', v_name, 'code', v_store_code);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.import_resolve_store(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_resolve_store(text) TO authenticated;

-- ------------------------------------------------------------
-- 共用 helper：以代碼／名稱解析供應商
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_resolve_supplier(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_code text := NULLIF(btrim(COALESCE(p_code, '')), '');
  v_supplier uuid;
  v_name text;
BEGIN
  IF v_code IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id, name INTO v_supplier, v_name
    FROM public.suppliers
   WHERE name = v_code
   LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('supplier_id', v_supplier, 'name', v_name);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.import_resolve_supplier(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_resolve_supplier(text) TO authenticated;

-- ============================================================
-- 1. 匯入訂單
-- 每群組：{ store_code, order_code?, order_date?, status?('pending'|'processing'), notes?, items:[{sku,name?,quantity,unit_price?,unit_cost?}] }
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_orders_batch(
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
  v_store jsonb;
  v_target_store_id uuid;
  v_status text;
  v_ts timestamptz;
  v_notes text;
  v_items jsonb;
  v_item jsonb;
  v_ord_id uuid;
  v_ord_code text;
  v_ord_count integer;
  v_res jsonb;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_results jsonb := '[]';
  v_errors jsonb := '[]';
  v_total integer;
  v_success integer := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows 必須為 JSON 陣列';
  END IF;
  IF NOT (SELECT public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION '僅管理員可匯入訂單';
  END IF;

  v_groups := p_rows;
  v_total := jsonb_array_length(v_groups);

  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_store := public.import_resolve_store(v_group->>'store_code');
      IF v_store IS NULL THEN
        RAISE EXCEPTION '店家不存在：%', COALESCE(v_group->>'store_code', '(未填)');
      END IF;
      v_target_store_id := (v_store->>'store_id')::uuid;

      v_status := COALESCE(NULLIF(v_group->>'status', ''), 'processing');
      IF v_status NOT IN ('pending', 'processing') THEN
        RAISE EXCEPTION '訂單狀態僅支援 pending/processing（收到 %）', v_status;
      END IF;

      v_notes := NULLIF(v_group->>'notes', '');
      v_ts := COALESCE(NULLIF(v_group->>'order_date', '')::timestamptz, NOW());

      IF NULLIF(v_group->>'order_code', '') IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.orders WHERE code = v_group->>'order_code') THEN
        RAISE EXCEPTION '訂單編號已存在：%', v_group->>'order_code';
      END IF;

      v_items := v_group->'items';
      IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION '沒有品項';
      END IF;

      INSERT INTO public.orders (store_id, created_by, notes, source_type, status,
                                 consignment_mode, code, created_at)
      VALUES (v_target_store_id, v_creator, v_notes, 'admin_proxy',
              v_status::public.order_status, false, NULLIF(v_group->>'order_code', ''), v_ts)
      RETURNING id, code INTO v_ord_id, v_ord_code;

      v_ord_count := 0;
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
                v_target_store_id, v_qty, v_price, v_cost, 0, 'waiting', v_ord_count, v_ts, v_ts);

        v_ord_count := v_ord_count + 1;
      END LOOP;

      v_results := v_results || jsonb_build_object(
        'index', v_idx, 'order_id', v_ord_id, 'order_code', v_ord_code, 'item_count', v_ord_count);
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'reason', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('total', v_total, 'success', v_success,
                            'results', v_results, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.import_orders_batch(jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_orders_batch(jsonb, uuid) TO authenticated;

-- ============================================================
-- 2. 匯入銷貨單（自動建立來源訂單 + 扣自有倉庫存）
-- 每群組：{ store_code, order_code?, sales_code?, shipped_date?, notes?,
--           items:[{sku,name?,quantity,unit_price?,unit_cost?}] }
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_sales_notes_batch(
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
  v_store jsonb;
  v_target_store_id uuid;
  v_ts timestamptz;
  v_notes text;
  v_items jsonb;
  v_item jsonb;
  v_ord_id uuid;
  v_ord_code text;
  v_sn_id uuid;
  v_sn_code text;
  v_sn_count integer;
  v_res jsonb;
  v_qty integer;
  v_price numeric;
  v_cost numeric;
  v_oi_id uuid;
  v_own_wh uuid;
  v_results jsonb := '[]';
  v_errors jsonb := '[]';
  v_total integer;
  v_success integer := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows 必須為 JSON 陣列';
  END IF;
  IF NOT (SELECT public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION '僅管理員可匯入銷貨單';
  END IF;

  SELECT id INTO v_own_wh FROM public.warehouses WHERE code = 'own';
  IF v_own_wh IS NULL THEN
    RAISE EXCEPTION '找不到自有倉庫';
  END IF;

  v_groups := p_rows;
  v_total := jsonb_array_length(v_groups);

  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_store := public.import_resolve_store(v_group->>'store_code');
      IF v_store IS NULL THEN
        RAISE EXCEPTION '店家不存在：%', COALESCE(v_group->>'store_code', '(未填)');
      END IF;
      v_target_store_id := (v_store->>'store_id')::uuid;

      v_ts := COALESCE(NULLIF(v_group->>'shipped_date', '')::timestamptz, NOW());
      v_notes := NULLIF(v_group->>'notes', '');

      IF NULLIF(v_group->>'order_code', '') IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.orders WHERE code = v_group->>'order_code') THEN
        RAISE EXCEPTION '訂單編號已存在：%', v_group->>'order_code';
      END IF;
      IF NULLIF(v_group->>'sales_code', '') IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.sales_notes WHERE code = v_group->>'sales_code') THEN
        RAISE EXCEPTION '銷貨單編號已存在：%', v_group->>'sales_code';
      END IF;

      v_items := v_group->'items';
      IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
        RAISE EXCEPTION '沒有品項';
      END IF;

      -- 來源訂單（匯入銷貨時自動補訂單，避免孤兒）
      INSERT INTO public.orders (store_id, created_by, notes, source_type, status,
                                 consignment_mode, code, created_at)
      VALUES (v_target_store_id, v_creator, v_notes, 'admin_proxy', 'shipped',
              false, NULLIF(v_group->>'order_code', ''), v_ts)
      RETURNING id, code INTO v_ord_id, v_ord_code;

      -- 銷貨單（shipped，直接產號或沿用自帶碼）
      INSERT INTO public.sales_notes (store_id, created_by, status, shipped_at, notes,
                                      warehouse_id, code, created_at)
      VALUES (v_target_store_id, v_creator, 'shipped', v_ts, v_notes,
              v_own_wh, NULLIF(v_group->>'sales_code', ''), v_ts)
      RETURNING id, code INTO v_sn_id, v_sn_code;

      v_sn_count := 0;
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
                v_target_store_id, v_qty, v_price, v_cost, v_qty, 'shipped', v_sn_count, v_ts, v_ts)
        RETURNING id INTO v_oi_id;

        INSERT INTO public.sales_note_items (sales_note_id, order_item_id, quantity,
                                             inventory_source_type, sort_order)
        VALUES (v_sn_id, v_oi_id, v_qty, 'self', v_sn_count);

        -- 扣自有倉庫存（庫存異動 trigger 自動同步 product_inventory.balance_after）
        INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change,
                                                source_type, sales_note_id, order_item_id, reference_code, created_by)
        VALUES ((v_res->>'product_id')::uuid, NULLIF(v_res->>'variant_id', '')::uuid, v_own_wh, -v_qty,
                'sales_shipment', v_sn_id, v_oi_id, v_sn_code, v_creator);

        v_sn_count := v_sn_count + 1;
      END LOOP;

      v_results := v_results || jsonb_build_object(
        'index', v_idx, 'order_id', v_ord_id, 'order_code', v_ord_code,
        'sales_note_id', v_sn_id, 'sales_code', v_sn_code, 'item_count', v_sn_count);
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('index', v_idx, 'reason', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('total', v_total, 'success', v_success,
                            'results', v_results, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.import_sales_notes_batch(jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_sales_notes_batch(jsonb, uuid) TO authenticated;

-- ============================================================
-- 3. 匯入寄賣單
-- 每群組：{ direction?('send_to_store'|'receive_from_supplier'),
--           store_code (寄出) | supplier_code (廠商進貨),
--           consignment_code?, order_code?, shipped_date?, status?('draft'|'active'),
--           notes?, items:[{sku,name?,quantity,unit_price?,unit_cost?}] }
-- send_to_store active 必自動建立來源訂單（consignment_mode=true）避免孤兒；
-- receive_from_supplier 依庫存來源寫 supplier_consignment 倉 +qty。
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
      IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
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
          -- 草稿：不建來源訂單（CHECK 允許 draft 無 source_order_id）
          INSERT INTO public.consignment_orders (code, direction, store_id, status, note, created_by, created_at)
          VALUES ('CS-TMP', 'send_to_store', v_target_store_id, 'draft', v_notes, v_creator, v_ts)
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

COMMENT ON FUNCTION public.import_orders_batch IS '匯入訂單（含品項），僅 admin';
COMMENT ON FUNCTION public.import_sales_notes_batch IS '匯入銷貨單：自動建來源訂單 + 扣自有倉庫存，僅 admin';
COMMENT ON FUNCTION public.import_consignment_batch IS '匯入寄賣單：send_to_store 自動建來源訂單，僅 admin';