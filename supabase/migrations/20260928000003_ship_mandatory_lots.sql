-- 20260928000003_ship_mandatory_lots.sql
-- 出貨強制指定批號/序號（僅針對 product_variants.tracking_mode IN ('serial','batch')）
--
-- 設計：以 GUC app.ship_lots 作為出貨批號來源的中介（沿用 app.sales_note_correction 的既有慣例）。
--   * 五支出貨 RPC（create_consignment_shipment / create_order_with_sales_note /
--     direct_ship_order / direct_ship_orders / ship_from_pool）尾端新增 p_lots 參數，
--     並於函式內 set_config('app.ship_lots', <lots>, true)。
--   * 基礎函式 public._ship_stock_movements 在 tracking_mode 非 none/NULL 時：
--       - GUC 已設（即使為 '[]'）→ 強制依 GUC 內的指定批號/序號扣庫存（不足或不符即 RAISE）。
--       - GUC 未設（NULL，例如 correct_sales_note 路徑）→ 維持原 FIFO 行為。
--   * create_consignment_shipment_layer 不改簽名（由呼叫端設定 GUC，基礎函式讀取）。
--
-- p_lots 元素：{"ref": "<order_item_id>", "batch_id"?: uuid, "quantity"?: int, "serial_number"?: text}
--   - 同一 ref 可重複（批次拆分）。
--   - SUM(quantity) 必須等於該次出貨數量；serial 模式每個元素固定 1 件。
--   - create_order_with_sales_note 的 ref 為前端 temp_key（因品項尚未落庫），函式內以
--     _new_item_map 重新映射為實際 order_item_id。
--
-- 本檔以 DO block 動態讀取遠端現有 prosrc 後以唯一錨點字串 replace() 插入，錨點不唯一或找不到即 RAISE
-- （fail-loud，絕不盲改）。冪等：以 marker 判斷是否已套用。

-- ============================================================================
-- 1) 基礎函式 _ship_stock_movements：新增 DECLARE 變數 + GUC 強制扣帳分支
-- ============================================================================
DO $mig_base$
DECLARE
  v_oid    oid;
  v_def    text;
  v_ident  text;
  v_body   text;
  v_anchor text := '  v_take INTEGER;';
  v_bodyanchor text := '  v_to_go := p_quantity;';
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = '_ship_stock_movements') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one function named _ship_stock_movements';
  END IF;

  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_ship_stock_movements';

  IF position('[ship-mandatory-lots:base-decl]' IN v_def) = 0 THEN

    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'anchor not found: base decl (%)', v_anchor;
    END IF;
    IF (length(v_def) - length(replace(v_def, v_bodyanchor, ''))) / length(v_bodyanchor) <> 1 THEN
      RAISE EXCEPTION 'anchor not found: base body (%)', v_bodyanchor;
    END IF;

    v_def := replace(v_def, v_anchor,
      v_anchor || chr(10) ||
      '  -- [ship-mandatory-lots:base-decl]' || chr(10) ||
      '  v_lots_raw TEXT;' || chr(10) ||
      '  v_lots JSONB;' || chr(10) ||
      '  v_i INTEGER;' || chr(10) ||
      '  v_elem JSONB;' || chr(10) ||
      '  v_qty INTEGER;' || chr(10) ||
      '  v_bid UUID;' || chr(10) ||
      '  v_avail INTEGER;' || chr(10) ||
      '  v_alloc INTEGER;');

    v_body := $patch$  -- [ship-mandatory-lots:base-body]
  v_lots_raw := current_setting('app.ship_lots', true);
  IF v_lots_raw IS NOT NULL THEN
    v_lots := NULLIF(v_lots_raw, '')::jsonb;
    IF v_lots IS NULL THEN
      v_lots := '[]'::jsonb;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_lots) AS e
      WHERE p_order_item_id IS NOT NULL AND e->>'ref' = p_order_item_id::text
    ) THEN
      RAISE EXCEPTION '此商品需指定批號/序號才能出貨';
    END IF;

    v_alloc := 0;
    FOR v_i IN 0 .. jsonb_array_length(v_lots) - 1 LOOP
      v_elem := v_lots->v_i;
      IF p_order_item_id IS NULL OR v_elem->>'ref' IS DISTINCT FROM p_order_item_id::text THEN
        CONTINUE;
      END IF;

      v_bid := NULL;
      IF NULLIF(v_elem->>'batch_id', '') IS NOT NULL THEN
        v_bid := (v_elem->>'batch_id')::uuid;
      ELSIF NULLIF(v_elem->>'serial_number', '') IS NOT NULL THEN
        SELECT pb.id INTO v_bid
        FROM public.product_batches pb
        WHERE pb.variant_id = p_variant_id
          AND pb.tracking_mode = v_mode
          AND pb.status = 'active'
          AND pb.serial_number = v_elem->>'serial_number'
        ORDER BY pb.created_at ASC, pb.id ASC
        LIMIT 1;
      END IF;

      IF v_bid IS NULL THEN
        RAISE EXCEPTION '此商品需指定批號/序號才能出貨';
      END IF;

      v_qty := 1;
      IF NULLIF(v_elem->>'quantity', '') IS NOT NULL THEN
        v_qty := GREATEST((v_elem->>'quantity')::int, 1);
      END IF;
      IF v_mode = 'serial' THEN
        v_qty := 1;
      END IF;

      SELECT COALESCE(SUM(pbi.quantity), 0) INTO v_avail
      FROM public.product_batch_inventory pbi
      WHERE pbi.batch_id = v_bid AND pbi.warehouse_id = p_warehouse_id;

      IF v_avail < v_qty THEN
        RAISE EXCEPTION '批號/序號庫存不足，無法出貨';
      END IF;

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, consignment_order_id, consignment_order_item_id, order_item_id,
        reference_code, inventory_owner, created_by, batch_id
      )
      VALUES (
        p_product_id, p_variant_id, p_warehouse_id, -v_qty, p_source_type,
        p_sales_note_id, p_consignment_order_id, p_consignment_order_item_id, p_order_item_id,
        p_reference_code, p_inventory_owner, p_created_by, v_bid
      );

      v_alloc := v_alloc + v_qty;
    END LOOP;

    IF v_alloc <> p_quantity THEN
      RAISE EXCEPTION '批號/序號數量與出貨數量不符';
    END IF;

    RETURN;
  END IF;

$patch$;

    v_def := replace(v_def, v_bodyanchor, v_body || v_bodyanchor);
    EXECUTE v_def;

    v_ident := pg_get_function_identity_arguments(v_oid);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public, anon, authenticated', '_ship_stock_movements', v_ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', '_ship_stock_movements', v_ident);
  END IF;
END
$mig_base$;

-- ============================================================================
-- 2) 四支出貨 RPC：尾端新增 p_lots，並於 BEGIN 後 set_config
--    (create_consignment_shipment / direct_ship_order / direct_ship_orders / ship_from_pool)
-- ============================================================================
DO $mig_rpc$
DECLARE
  v_names  text[] := ARRAY['create_consignment_shipment','direct_ship_order','direct_ship_orders','ship_from_pool'];
  v_name   text;
  v_oid    oid;
  v_def    text;
  v_ident  text;
  v_rpos   int;
  v_marker text;
  v_patch  text;
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    v_marker := '[ship-mandatory-lots:firststmt:' || v_name || ']';

    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = v_name) <> 1 THEN
      RAISE EXCEPTION 'expected exactly one function named %', v_name;
    END IF;

    SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF position(v_marker IN v_def) = 0 THEN

      IF (length(v_def) - length(replace(v_def, E'\nBEGIN\n', ''))) / length(E'\nBEGIN\n') <> 1 THEN
        RAISE EXCEPTION 'anchor not found: BEGIN for %', v_name;
      END IF;
      IF (length(v_def) - length(replace(v_def, E'\n RETURNS ', ''))) / length(E'\n RETURNS ') <> 1 THEN
        RAISE EXCEPTION 'anchor not found: RETURNS for %', v_name;
      END IF;

      v_ident := pg_get_function_identity_arguments(v_oid);
      EXECUTE format('DROP FUNCTION public.%I(%s)', v_name, v_ident);

      v_rpos := position(E'\n RETURNS ' IN v_def);
      v_def := overlay(v_def placing ', p_lots jsonb DEFAULT NULL' from (v_rpos - 1) for 0);

      v_patch := E'\nBEGIN\n  -- ' || v_marker || chr(10) ||
                 E'  PERFORM set_config(''app.ship_lots'', COALESCE(NULLIF(p_lots::text, ''''), ''[]''), true);' || chr(10);
      v_def := replace(v_def, E'\nBEGIN\n', v_patch);

      EXECUTE v_def;

      SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name;
      v_ident := pg_get_function_identity_arguments(v_oid);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public, anon', v_name, v_ident);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', v_name, v_ident);
    END IF;
  END LOOP;
END
$mig_rpc$;

-- ============================================================================
-- 3) create_order_with_sales_note：尾端新增 p_lots，並於迴圈內 _new_item_map 寫入後
--    以 _new_item_map 將 temp_key(前端 ref) 重新映射為實際 order_item_id 後 set_config。
-- ============================================================================
DO $mig_cowsn$
DECLARE
  v_name   text := 'create_order_with_sales_note';
  v_oid    oid;
  v_def    text;
  v_ident  text;
  v_rpos   int;
  v_marker text := '[ship-mandatory-lots:cowsn]';
  v_anchor text;
  v_patch  text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one function named %', v_name;
  END IF;

  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = v_name;

  IF position(v_marker IN v_def) = 0 THEN

    v_anchor := E'    v_temp_key := v_item->>''temp_key'';\n    IF v_temp_key IS NOT NULL THEN\n      INSERT INTO _new_item_map (temp_key, item_id) VALUES (v_temp_key, v_order_item_id);\n    END IF;';

    IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'anchor not found: cowsn map insert';
    END IF;
    IF (length(v_def) - length(replace(v_def, E'\n RETURNS ', ''))) / length(E'\n RETURNS ') <> 1 THEN
      RAISE EXCEPTION 'anchor not found: cowsn RETURNS';
    END IF;

    v_ident := pg_get_function_identity_arguments(v_oid);
    EXECUTE format('DROP FUNCTION public.%I(%s)', v_name, v_ident);

    v_rpos := position(E'\n RETURNS ' IN v_def);
    v_def := overlay(v_def placing ', p_lots jsonb DEFAULT NULL' from (v_rpos - 1) for 0);

    v_patch := v_anchor || chr(10) ||
      '    -- ' || v_marker || chr(10) ||
      E'    PERFORM set_config(''app.ship_lots'', COALESCE((' || chr(10) ||
      E'      SELECT jsonb_agg(jsonb_set(e, ARRAY[''ref''], to_jsonb(m.item_id::text)))' || chr(10) ||
      E'      FROM jsonb_array_elements(COALESCE(p_lots, ''[]''::jsonb)) AS e' || chr(10) ||
      E'      JOIN _new_item_map m ON m.temp_key = e->>''ref''' || chr(10) ||
      E'    ), ''[]''::jsonb)::text, true);';
    v_def := replace(v_def, v_anchor, v_patch);

    EXECUTE v_def;

    SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;
    v_ident := pg_get_function_identity_arguments(v_oid);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM public, anon', v_name, v_ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', v_name, v_ident);
  END IF;
END
$mig_cowsn$;
