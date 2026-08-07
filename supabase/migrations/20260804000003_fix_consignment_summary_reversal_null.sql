-- ============================================================
-- 修正 consignment_order_item_summary（v1.4.1 hotfix）
-- 原因：FILTER 零列時 SUM() 回 NULL，導致
--   -SUM(out_shipment) - SUM(reversal) 在無 reversal 時為 NULL，
--   被 COALESCE 誤算成 0。
-- 修正：各項分別 COALESCE 後再相減。
-- ============================================================
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
  COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_receipt'), 0) AS received_quantity,
  COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_shipment'), 0)
    - COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_shipment_reversal'), 0) AS shipped_quantity,
  COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_return'), 0) AS returned_to_supplier,
  COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_return'), 0) AS returned_from_store,
  COALESCE(SUM(cs.quantity) FILTER (WHERE NOT cs.reversed), 0) AS sold_quantity,
  CASE
    WHEN co.direction = 'receive_from_supplier' THEN
      COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_receipt'), 0)
      - COALESCE(SUM(cs.quantity) FILTER (WHERE NOT cs.reversed), 0)
      - COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_in_return'), 0)
    ELSE
      COALESCE(-SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_shipment'), 0)
        - COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_shipment_reversal'), 0)
        - COALESCE(SUM(cs.quantity) FILTER (WHERE NOT cs.reversed), 0)
        - COALESCE(SUM(im.quantity_change) FILTER (WHERE im.source_type = 'consignment_out_return'), 0)
  END AS remaining_quantity
FROM public.consignment_order_items coi
JOIN public.consignment_orders co ON co.id = coi.consignment_order_id
LEFT JOIN public.inventory_movements im ON im.consignment_order_item_id = coi.id
LEFT JOIN public.consignment_sales cs ON cs.consignment_order_item_id = coi.id
GROUP BY coi.id, co.direction;

COMMENT ON VIEW public.consignment_order_item_summary IS
  '寄賣單品項統計視圖：收貨/出貨/銷售/退回/剩餘數量皆由此計算，不落庫避免不同步';
