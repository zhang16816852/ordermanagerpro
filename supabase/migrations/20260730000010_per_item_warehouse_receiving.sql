-- ============================================================
-- Rewrite receive_purchase_items to:
-- 1. Accept per-item warehouse_id (each item can specify a warehouse)
-- 2. Handle purchase_order_items UPDATE (so client doesn't need to)
-- 3. Handle purchase_orders status UPDATE atomically
-- 4. Support multiple POs in one batch
-- ============================================================

CREATE OR REPLACE FUNCTION public.receive_purchase_items(
  p_items JSONB,
  p_warehouse_id UUID DEFAULT NULL
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

    UPDATE public.purchase_order_items
    SET received_quantity = v_received_qty
    WHERE id = (v_item->>'id')::UUID
      AND purchase_order_id = v_po_id;

    INSERT INTO public.inventory_movements (product_id, variant_id, warehouse_id, quantity_change, source_type, purchase_order_id, reference_code)
    VALUES (v_product_id, v_variant_id, v_item_warehouse_id, v_received_qty, 'purchase_receipt', v_po_id, v_po_code);

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
