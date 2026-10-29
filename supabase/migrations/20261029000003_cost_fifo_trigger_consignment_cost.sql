-- ============================================================
-- Fix: trigger consignment_out_sale unit_cost from consignment order item
-- 依賴：trgfn_inventory_movement_unit_cost
-- ============================================================

CREATE OR REPLACE FUNCTION public.trgfn_inventory_movement_unit_cost()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.unit_cost IS NOT NULL THEN
    IF NEW.batch_id IS NULL AND NEW.source_type IN ('sales_shipment','consignment_out_shipment','repair_part_usage') THEN
      NEW.cost_match_status := 'pending_match';
    END IF;
    RETURN NEW;
  END IF;

  -- Priority 1: batch cost
  IF NEW.batch_id IS NOT NULL THEN
    SELECT pb.unit_cost INTO NEW.unit_cost
      FROM public.product_batches pb
     WHERE pb.id = NEW.batch_id;
  END IF;

  -- Priority 1.5: consignment_out_sale → consignment order item unit_cost
  IF NEW.unit_cost IS NULL AND NEW.source_type = 'consignment_out_sale' AND NEW.consignment_order_item_id IS NOT NULL THEN
    SELECT coi.unit_cost INTO NEW.unit_cost
      FROM public.consignment_order_items coi
     WHERE coi.id = NEW.consignment_order_item_id;
  END IF;

  -- Priority 2: 最近一筆進貨成本（variant）
  IF NEW.unit_cost IS NULL AND NEW.variant_id IS NOT NULL THEN
    SELECT im.unit_cost INTO NEW.unit_cost
      FROM public.inventory_movements im
     WHERE im.variant_id = NEW.variant_id
       AND im.source_type = 'purchase_receipt'
       AND im.unit_cost IS NOT NULL
     ORDER BY im.created_at DESC
     LIMIT 1;
  END IF;

  -- Priority 3: 最近一筆進貨成本（product）
  IF NEW.unit_cost IS NULL AND NEW.variant_id IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT im.unit_cost INTO NEW.unit_cost
      FROM public.inventory_movements im
     WHERE im.product_id = NEW.product_id
       AND im.source_type = 'purchase_receipt'
       AND im.unit_cost IS NOT NULL
     ORDER BY im.created_at DESC
     LIMIT 1;
  END IF;

  -- Priority 4: 變體批發價
  IF NEW.unit_cost IS NULL AND NEW.variant_id IS NOT NULL THEN
    SELECT NULLIF(pv.wholesale_price, 0) INTO NEW.unit_cost
      FROM public.product_variants pv
     WHERE pv.id = NEW.variant_id;
  END IF;

  -- Priority 5: 產品統一/批發價
  IF NEW.unit_cost IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT NULLIF(p.unified_wholesale_price, 0) INTO NEW.unit_cost
      FROM public.products p
     WHERE p.id = NEW.product_id;
  END IF;

  IF NEW.batch_id IS NULL AND NEW.source_type IN ('sales_shipment','consignment_out_shipment','repair_part_usage') THEN
    NEW.cost_match_status := 'pending_match';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trgfn_inventory_movement_unit_cost() FROM public, anon, authenticated;