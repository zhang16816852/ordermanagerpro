-- Fix repair skip inventory across all paths (Plan H, anchored dynamic-SQL)
-- Targets remote function bodies (deletion is 9-param, consignment layer 14-param)
-- Guards are inserted AFTER 'BEGIN' (3 helpers) / BEFORE the return-line raise (layer)
DO $mig$
DECLARE
  v_def text;
  v_new text;
  v_anchor_ship text := 'BEGIN' || chr(10) || '  v_mode := NULL;';
  v_anchor_alloc text := 'BEGIN' || chr(10) || '  IF p_source = ''self'' THEN';
  v_anchor_del text := 'BEGIN' || chr(10) || '  IF EXISTS (' || chr(10) || '    SELECT 1 FROM public.inventory_movements';
  v_anchor_layer text := 'IF v_oi.line_type = ''return'' THEN';
  v_marker_ship text := '-- [repair-skip-inventory:ship]';
  v_marker_alloc text := '-- [repair-skip-inventory:alloc]';
  v_marker_del text := '-- [repair-skip-inventory:deletion]';
  v_marker_layer text := '-- [repair-skip-inventory:consignment]';
  v_guard_ship text := v_marker_ship || chr(10) ||
    '  -- skip inventory for repair lines (exchange + is_repair)' || chr(10) ||
    '  PERFORM 1 FROM public.order_items oi WHERE oi.id = p_order_item_id AND oi.line_type = ''exchange'' AND oi.is_repair;' || chr(10) ||
    '  IF FOUND THEN' || chr(10) ||
    '    RETURN; -- no inventory movements for repair lines' || chr(10) ||
    '  END IF;' || chr(10);
  v_guard_alloc text := v_marker_alloc || chr(10) ||
    '  -- skip inventory for repair lines (exchange + is_repair)' || chr(10) ||
    '  PERFORM 1 FROM public.order_items oi WHERE oi.id = p_order_item_id AND oi.line_type = ''exchange'' AND oi.is_repair;' || chr(10) ||
    '  IF FOUND THEN' || chr(10) ||
    '    RETURN ''[]''::jsonb; -- no allocation for repair lines' || chr(10) ||
    '  END IF;' || chr(10);
  v_guard_del text := v_marker_del || chr(10) ||
    '  -- skip inventory for repair lines (exchange + is_repair)' || chr(10) ||
    '  PERFORM 1 FROM public.order_items oi WHERE oi.id = p_order_item_id AND oi.line_type = ''exchange'' AND oi.is_repair;' || chr(10) ||
    '  IF FOUND THEN' || chr(10) ||
    '    RETURN; -- no reversal inventory movement for repair lines' || chr(10) ||
    '  END IF;' || chr(10);
  v_guard_layer text := v_marker_layer || chr(10) ||
    '    -- raise for repair lines in consignment path' || chr(10) ||
    '    PERFORM 1 FROM public.order_items oi WHERE oi.id = v_order_item_id AND oi.line_type = ''exchange'' AND oi.is_repair;' || chr(10) ||
    '    IF FOUND THEN' || chr(10) ||
    '      RAISE EXCEPTION ''送修列不支援寄賣路徑：%'', v_order_item_id;' || chr(10) ||
    '    END IF;' || chr(10);
BEGIN
  -- 1) _ship_stock_movements: insert guard right after BEGIN
  SELECT pg_get_functiondef('public._ship_stock_movements'::regproc) INTO v_def;
  IF position(v_marker_ship IN v_def) = 0 THEN
    IF position(v_anchor_ship IN v_def) = 0 THEN
      RAISE EXCEPTION '_ship_stock_movements: anchor not found';
    END IF;
    v_new := replace(v_def, v_anchor_ship,
      'BEGIN' || chr(10) || v_guard_ship || '  v_mode := NULL;');
    EXECUTE v_new;
  END IF;

  -- 2) allocate_inventory: insert guard right after BEGIN
  SELECT pg_get_functiondef('public.allocate_inventory'::regproc) INTO v_def;
  IF position(v_marker_alloc IN v_def) = 0 THEN
    IF position(v_anchor_alloc IN v_def) = 0 THEN
      RAISE EXCEPTION 'allocate_inventory: anchor not found';
    END IF;
    v_new := replace(v_def, v_anchor_alloc,
      'BEGIN' || chr(10) || v_guard_alloc || '  IF p_source = ''self'' THEN');
    EXECUTE v_new;
  END IF;

  -- 3) upsert_sales_note_deletion_movement: insert guard right after BEGIN
  SELECT pg_get_functiondef('public.upsert_sales_note_deletion_movement'::regproc) INTO v_def;
  IF position(v_marker_del IN v_def) = 0 THEN
    IF position(v_anchor_del IN v_def) = 0 THEN
      RAISE EXCEPTION 'upsert_sales_note_deletion_movement: anchor not found';
    END IF;
    v_new := replace(v_def, v_anchor_del,
      'BEGIN' || chr(10) || v_guard_del ||
      '  IF EXISTS (' || chr(10) || '    SELECT 1 FROM public.inventory_movements');
    EXECUTE v_new;
  END IF;

  -- 4) create_consignment_shipment_layer: raise before the return-line check
  SELECT pg_get_functiondef('public.create_consignment_shipment_layer'::regproc) INTO v_def;
  IF position(v_marker_layer IN v_def) = 0 THEN
    IF position(v_anchor_layer IN v_def) = 0 THEN
      RAISE EXCEPTION 'create_consignment_shipment_layer: anchor not found';
    END IF;
    v_new := replace(v_def, v_anchor_layer, v_guard_layer || v_anchor_layer);
    EXECUTE v_new;
  END IF;
END $mig$;
