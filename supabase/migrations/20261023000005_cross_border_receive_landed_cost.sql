-- ============================================================
-- P4 / M2：receive_purchase_items 成本取值改為 landed_unit_cost 優先
-- 檔名：20261023000005_cross_border_receive_landed_cost.sql
-- 依賴：20261023000004 (purchase_order_items.landed_unit_cost)
-- 可獨立驗證與回滾：是（重發原版即可）
-- ------------------------------------------------------------
-- 基底：20260927000001_serial_ship_surgical.sql L37-222（含 tracking serial/batch 分支）
-- 唯一改動：v_po_item_cost := COALESCE(poi.landed_unit_cost, poi.unit_cost)
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase_items(
  p_items JSONB,
  p_warehouse_id UUID DEFAULT NULL,
  p_lots JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_variant_id UUID;
  v_received_qty INTEGER;
  v_po_id UUID;
  v_po_code TEXT;
  v_item_warehouse_id UUID;
  v_default_warehouse_id UUID;
  v_po_ids UUID[];
  v_all_received BOOLEAN;
  v_any_received BOOLEAN;
  v_mode TEXT;
  v_lot JSONB;
  v_has_lot BOOLEAN;
  v_po_item_cost NUMERIC := 0;
  v_serial_list JSONB;
  v_serial_elem TEXT;
  v_batch_number TEXT;
  v_batch_unit_cost NUMERIC := 0;
  v_batch_id UUID;
  v_created_by UUID;
BEGIN
  v_default_warehouse_id := COALESCE(p_warehouse_id, (SELECT id FROM public.warehouses WHERE code = 'own'));
  v_po_ids := '{}';

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_received_qty := (v_item->>'received_quantity')::INTEGER;
    v_po_id := (v_item->>'purchase_order_id')::UUID;
    v_po_code := v_item->>'purchase_order_code';
    v_item_warehouse_id := COALESCE(
      (v_item->>'warehouse_id')::UUID,
      v_default_warehouse_id
    );
    v_created_by := NULLIF(v_item->>'created_by', '')::UUID;
    v_has_lot := false;
    v_lot := NULL;

    IF p_lots IS NOT NULL AND jsonb_typeof(p_lots) = 'array' THEN
      SELECT e INTO v_lot
      FROM jsonb_array_elements(p_lots) e
      WHERE (e->>'purchase_order_item_id')::UUID = (v_item->>'id')::UUID
      LIMIT 1;
      v_has_lot := v_lot IS NOT NULL;
    END IF;

    -- 變體追蹤模式（無變體＝不追蹤）
    v_mode := NULL;
    IF v_variant_id IS NOT NULL THEN
      SELECT tracking_mode INTO v_mode FROM public.product_variants WHERE id = v_variant_id;
    END IF;

    UPDATE public.purchase_order_items poi
    SET received_quantity = v_received_qty
    FROM public.purchase_orders po
    WHERE poi.id = (v_item->>'id')::UUID
      AND poi.purchase_order_id = v_po_id
      AND po.id = v_po_id
    RETURNING COALESCE(poi.landed_unit_cost, poi.unit_cost) INTO v_po_item_cost;

    IF v_mode = 'serial' THEN
      IF NOT v_has_lot OR COALESCE(v_lot->>'mode', '') <> 'serial' THEN
        RAISE EXCEPTION '「一機一號」的商品收貨時必須提供序號清單（p_lots, mode=serial）';
      END IF;

      v_serial_list := v_lot -> 'serials';
      IF jsonb_typeof(v_serial_list) <> 'array'
         OR COALESCE(jsonb_array_length(v_serial_list), 0) <> v_received_qty THEN
        RAISE EXCEPTION '序號數量（% 個）與收貨數量（% 件）不符',
          COALESCE(jsonb_array_length(v_serial_list), 0), v_received_qty;
      END IF;

      IF v_received_qty > 0 AND EXISTS (
        SELECT 1 FROM public.product_batches pb
        WHERE pb.variant_id = v_variant_id
          AND pb.tracking_mode = 'serial'
          AND pb.serial_number IN (SELECT value FROM jsonb_array_elements_text(v_serial_list))
      ) THEN
        RAISE EXCEPTION '序號與既有資料重複（此變體序號須唯一）';
      END IF;

      FOR v_serial_elem IN SELECT * FROM jsonb_array_elements_text(v_serial_list)
      LOOP
        IF COALESCE(btrim(v_serial_elem), '') = '' THEN
          RAISE EXCEPTION '序號不可為空';
        END IF;

        INSERT INTO public.product_batches (
          variant_id, tracking_mode, serial_number, quantity,
          unit_cost, purchase_order_id, purchase_order_item_id,
          received_at, status, created_by
        )
        VALUES (
          v_variant_id, 'serial', btrim(v_serial_elem), 1,
          COALESCE(NULLIF(v_lot->>'unit_cost', '')::NUMERIC, v_po_item_cost, 0),
          v_po_id, (v_item->>'id')::UUID,
          NOW(), 'active', v_created_by
        )
        RETURNING id INTO v_batch_id;

        INSERT INTO public.inventory_movements (
          product_id, variant_id, warehouse_id, quantity_change, source_type,
          purchase_order_id, reference_code, batch_id, created_by
        )
        VALUES (
          v_product_id, v_variant_id, v_item_warehouse_id, 1, 'purchase_receipt',
          v_po_id, v_po_code, v_batch_id, v_created_by
        );
      END LOOP;
    ELSIF v_mode = 'batch' AND v_has_lot AND COALESCE(v_lot->>'mode', '') = 'batch' THEN
      v_batch_number := NULLIF(btrim(COALESCE(v_lot->>'batch_number', '')), '');
      IF v_batch_number IS NULL THEN
        RAISE EXCEPTION '批號商品收貨時必須提供 batch_number';
      END IF;
      v_batch_unit_cost := COALESCE(NULLIF(v_lot->>'unit_cost', '')::NUMERIC, NULLIF(v_lot->>'cost', '')::NUMERIC, v_po_item_cost, 0);

      IF v_received_qty > 0 AND EXISTS (
        SELECT 1 FROM public.product_batches pb
        WHERE pb.variant_id = v_variant_id
          AND pb.tracking_mode = 'batch'
          AND pb.batch_number = v_batch_number
      ) THEN
        RAISE EXCEPTION '批號 % 與既有資料重複（此變體批號須唯一）', v_batch_number;
      END IF;

      INSERT INTO public.product_batches (
        variant_id, tracking_mode, batch_number, quantity, unit_cost,
        purchase_order_id, purchase_order_item_id, received_at, status, created_by
      )
      VALUES (
        v_variant_id, 'batch', v_batch_number, GREATEST(v_received_qty, 1), v_batch_unit_cost,
        v_po_id, (v_item->>'id')::UUID, NOW(), 'active', v_created_by
      )
      RETURNING id INTO v_batch_id;

      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        purchase_order_id, reference_code, batch_id, created_by
      )
      VALUES (
        v_product_id, v_variant_id, v_item_warehouse_id, v_received_qty, 'purchase_receipt',
        v_po_id, v_po_code, v_batch_id, v_created_by
      );
    ELSE
      IF v_has_lot AND (v_mode IS NULL OR v_mode = 'none') THEN
        RAISE EXCEPTION '此商品未啟用批號追蹤，無法收貨序號/批號';
      END IF;
      INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, purchase_order_id, reference_code, created_by)
      VALUES (v_product_id, v_variant_id, v_item_warehouse_id, v_received_qty, 'purchase_receipt', v_po_id, v_po_code, v_created_by);
    END IF;

    IF NOT (v_po_id = ANY(v_po_ids)) THEN
      v_po_ids := array_append(v_po_ids, v_po_id);
    END IF;
  END LOOP;

  FOREACH v_po_id IN ARRAY v_po_ids LOOP
    SELECT
      bool_and(poi.received_quantity >= poi.quantity),
      bool_or(poi.received_quantity > 0)
    INTO v_all_received, v_any_received
    FROM public.purchase_order_items poi
    WHERE poi.purchase_order_id = v_po_id;

    UPDATE public.purchase_orders
    SET status = CASE
                   WHEN v_all_received THEN 'received'::purchase_order_status
                   WHEN v_any_received THEN 'partial_received'::purchase_order_status
                   ELSE 'ordered'::purchase_order_status
                 END,
        received_date = CASE WHEN v_all_received THEN CURRENT_DATE ELSE NULL END
    WHERE id = v_po_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_items(JSONB, UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_items(JSONB, UUID, JSONB) TO authenticated;
