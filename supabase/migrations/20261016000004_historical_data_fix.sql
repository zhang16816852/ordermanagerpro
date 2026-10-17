DO $$
DECLARE
  v_repair_wh UUID;
  v_defective_wh UUID;
  v_own_wh UUID;
  r RECORD;
BEGIN
  SELECT id INTO v_own_wh FROM warehouses WHERE code = 'own' AND is_active LIMIT 1;
  SELECT id INTO v_defective_wh FROM warehouses WHERE code = 'defective' AND is_active LIMIT 1;
  SELECT id INTO v_repair_wh FROM warehouses WHERE code = 'repair' AND is_active LIMIT 1;

  IF v_own_wh IS NULL THEN
    RAISE NOTICE '自有倉不存在，跳過歷史資料補正';
    RETURN;
  END IF;

  IF v_defective_wh IS NULL THEN
    RAISE NOTICE '瑕疵倉不存在，跳過 exchange 相關補正';
  END IF;

  IF v_repair_wh IS NULL THEN
    RAISE NOTICE '送修倉不存在，跳過 repaired 相關補正';
  END IF;

  FOR r IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           o.store_id, o.code AS order_code, oi.shipped_quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.line_type = 'exchange'
      AND oi.shipped_quantity > 0
      AND NOT EXISTS (
        SELECT 1 FROM inventory_movements im
        WHERE im.order_item_id = oi.id
          AND im.source_type = 'sales_shipment'
          AND im.warehouse_id = v_own_wh
      )
  LOOP
    INSERT INTO inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, balance_after,
      source_type, order_item_id, inventory_owner, reference_code, note, created_by
    ) VALUES (
      r.product_id, r.variant_id, v_own_wh, -r.quantity, 0,
      'sales_shipment', r.id, 'self', r.order_code,
      '歷史換貨補扣', NULL
    );
  END LOOP;

  FOR r IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           o.store_id, o.code AS order_code
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.line_type = 'return'
      AND oi.return_status = 'exchange'
      AND v_defective_wh IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM inventory_movements im
        WHERE im.order_item_id = oi.id
          AND im.source_type = 'customer_return'
          AND im.warehouse_id = v_defective_wh
      )
  LOOP
    INSERT INTO inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, balance_after,
      source_type, order_item_id, inventory_owner, reference_code, note, created_by
    ) VALUES (
      r.product_id, r.variant_id, v_defective_wh, r.quantity, 0,
      'customer_return', r.id, 'self', r.order_code,
      '歷史換貨退回補入瑕疵倉', NULL
    );
  END LOOP;

  FOR r IN
    SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price,
           o.store_id, o.code AS order_code
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.line_type = 'return'
      AND oi.return_status = 'repaired'
      AND v_repair_wh IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM inventory_movements im
        WHERE im.order_item_id = oi.id
          AND im.source_type = 'customer_return'
          AND im.warehouse_id = v_repair_wh
      )
  LOOP
    INSERT INTO inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, balance_after,
      source_type, order_item_id, inventory_owner, reference_code, note, created_by
    ) VALUES (
      r.product_id, r.variant_id, v_repair_wh, r.quantity, 0,
      'customer_return', r.id, 'self', r.order_code,
      '歷史送修退回補入送修倉', NULL
    );
  END LOOP;

  ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_item_is_repair_scope;
  ALTER TABLE order_items ADD CONSTRAINT chk_order_item_is_repair_scope
    CHECK (NOT is_repair OR line_type IN ('return', 'exchange'));

  UPDATE order_items
  SET line_type = 'exchange',
      return_status = NULL
  WHERE line_type = 'return'
    AND is_repair = true;

  RAISE NOTICE '歷史資料補正完成';
END $$;
