-- 修正 consignment_order_item_summary：避免 inventory_movements × consignment_sales fan-out
-- 原 view 用單一 FROM + 兩個 LEFT JOIN + GROUP BY，當一個品項同時有多筆 movement 與 sales 時，
-- 兩個 LEFT JOIN 笛卡爾相乘，SUM(cs.quantity) 被 movement 筆數重複加總，導致 sold_quantity 放大。
-- 改為先分別聚合 movements / sales，再 JOIN，避免 fan-out。
CREATE OR REPLACE VIEW public.consignment_order_item_summary AS
SELECT
  coi.id AS consignment_order_item_id,
  coi.consignment_order_id,
  co.direction,
  coi.product_id,
  coi.variant_id,
  coi.quantity AS order_quantity,
  coi.unit_price,
  coi.unit_cost,
  COALESCE(im.received,0) AS received_quantity,
  COALESCE(im.shipped,0) - COALESCE(im.reversal,0) AS shipped_quantity,
  COALESCE(im.returned_to_supplier,0) AS returned_to_supplier,
  COALESCE(im.returned_from_store,0) AS returned_from_store,
  COALESCE(cs.sold,0) AS sold_quantity,
  CASE WHEN co.direction = 'receive_from_supplier' THEN
    COALESCE(im.received,0) - COALESCE(cs.sold,0) - COALESCE(im.returned_to_supplier,0)
  ELSE
    COALESCE(im.shipped,0) - COALESCE(im.reversal,0) - COALESCE(cs.sold,0) - COALESCE(im.returned_from_store,0)
  END AS remaining_quantity
FROM public.consignment_order_items coi
JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
LEFT JOIN (
  SELECT consignment_order_item_id,
    COALESCE(SUM(quantity_change) FILTER (WHERE source_type = 'consignment_in_receipt'),0) AS received,
    COALESCE(-SUM(quantity_change) FILTER (WHERE source_type = 'consignment_out_shipment'),0) AS shipped,
    COALESCE(SUM(quantity_change) FILTER (WHERE source_type = 'consignment_shipment_reversal'),0) AS reversal,
    COALESCE(-SUM(quantity_change) FILTER (WHERE source_type = 'consignment_in_return'),0) AS returned_to_supplier,
    COALESCE(SUM(quantity_change) FILTER (WHERE source_type = 'consignment_out_return'),0) AS returned_from_store
  FROM public.inventory_movements
  GROUP BY consignment_order_item_id
) im ON im.consignment_order_item_id = coi.id
LEFT JOIN (
  SELECT consignment_order_item_id, COALESCE(SUM(quantity) FILTER (WHERE NOT reversed),0) AS sold
  FROM public.consignment_sales
  GROUP BY consignment_order_item_id
) cs ON cs.consignment_order_item_id = coi.id;
