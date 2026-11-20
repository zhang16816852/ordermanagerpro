-- ============================================================
-- View 化：全部建議項目（Phase 1-3）
-- 建立 11 個 View 以加速前端查詢，取代 JS 聚合與複雜 nested join
-- ============================================================

-- A. 門市銷售彙總
CREATE OR REPLACE VIEW public.store_sales_summary AS
SELECT
  sn.store_id,
  COUNT(DISTINCT sn.id) AS note_count,
  COALESCE(SUM(sn.shipping_fee),0)
    + COALESCE(SUM(
        CASE WHEN oi.line_type IN ('return','defective')
             THEN -ABS(COALESCE(sni.quantity,0))
             ELSE COALESCE(sni.quantity,0) END
        * COALESCE(oi.unit_price,0)
      ),0) AS revenue,
  COALESCE(SUM(CASE WHEN sn.payment_status <> 'paid' THEN
    COALESCE(sn.shipping_fee,0) + COALESCE(sni.quantity,0) * COALESCE(oi.unit_price,0)
  END),0) AS unpaid_amount
FROM public.sales_notes sn
LEFT JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
LEFT JOIN public.order_items oi ON oi.id = sni.order_item_id
GROUP BY sn.store_id;

-- B. 訂單總額
CREATE OR REPLACE VIEW public.order_totals AS
SELECT
  o.id AS order_id,
  COALESCE(SUM(CASE WHEN oi.line_type = 'return' THEN -oi.quantity * COALESCE(oi.unit_price,0)
                    ELSE oi.quantity * COALESCE(oi.unit_price,0) END),0)
    + COALESCE(o.shipping_fee,0) AS total_amount,
  COUNT(oi.id) AS item_count
FROM public.orders o
LEFT JOIN public.order_items oi ON oi.order_id = o.id
GROUP BY o.id, o.shipping_fee;

-- C. 品項需求彙總
CREATE OR REPLACE VIEW public.order_demand_summary AS
SELECT
  oi.product_id,
  oi.variant_id,
  SUM(oi.quantity - COALESCE(oi.shipped_quantity,0)) AS pending_quantity,
  COUNT(DISTINCT oi.order_id) AS order_count
FROM public.order_items oi
WHERE oi.status NOT IN ('cancelled','discontinued','out_of_stock')
  AND oi.line_type NOT IN ('return','defective')
GROUP BY oi.product_id, oi.variant_id;

-- D. 業務佣金彙總
CREATE OR REPLACE VIEW public.rep_commission_summary AS
SELECT
  o.id AS order_id,
  o.store_id,
  o.sales_rep_id,
  COALESCE(SUM(
    GREATEST(0,
      (oi.quantity * COALESCE(oi.unit_price,0))
      - (oi.quantity * COALESCE(
          NULLIF(oi.unit_cost,0),
          rpc.cost,
          pv.wholesale_price,
          0
        ))
    ) * COALESCE(ur.commission_rate,0) / 100.0
  ),0) AS commission_amount,
  COALESCE(SUM(oi.quantity * COALESCE(oi.unit_price,0)),0) AS revenue,
  COALESCE(SUM(oi.quantity * COALESCE(
    NULLIF(oi.unit_cost,0),
    rpc.cost,
    pv.wholesale_price,
    0
  )),0) AS cost
FROM public.orders o
LEFT JOIN public.order_items oi ON oi.order_id = o.id
LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id
LEFT JOIN public.rep_product_costs rpc ON rpc.rep_id = o.sales_rep_id
  AND rpc.product_id = oi.product_id
  AND (rpc.variant_id IS NOT DISTINCT FROM oi.variant_id)
LEFT JOIN public.user_roles ur ON ur.user_id = o.sales_rep_id
WHERE oi.line_type NOT IN ('return','defective')
GROUP BY o.id, o.store_id, o.sales_rep_id, ur.commission_rate;

-- E. 銷貨單明細展開
CREATE OR REPLACE VIEW public.sales_note_detail AS
SELECT
  sn.id AS sales_note_id,
  sn.code,
  sn.store_id,
  s.name AS store_name,
  sn.status,
  sn.payment_status,
  sn.shipped_at,
  sn.received_at,
  sn.shipping_fee,
  sn.access_token,
  sni.id AS sales_note_item_id,
  sni.order_item_id,
  sni.quantity,
  sni.returned_quantity,
  sni.inventory_source_type,
  sni.sort_order,
  oi.product_id,
  oi.variant_id,
  oi.quantity AS order_quantity,
  oi.unit_price,
  oi.line_type,
  oi.line_note,
  p.name AS product_name,
  pv.name AS variant_name,
  pv.sku AS variant_sku
FROM public.sales_notes sn
LEFT JOIN public.stores s ON s.id = sn.store_id
LEFT JOIN public.sales_note_items sni ON sni.sales_note_id = sn.id
LEFT JOIN public.order_items oi ON oi.id = sni.order_item_id
LEFT JOIN public.products p ON p.id = oi.product_id
LEFT JOIN public.product_variants pv ON pv.id = oi.variant_id;

-- F. 寄賣品項統計（擴充 estimated_remaining_value）
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
  END AS remaining_quantity,
  COALESCE(coi.unit_price,0) * (CASE WHEN co.direction = 'receive_from_supplier' THEN
    COALESCE(im.received,0) - COALESCE(cs.sold,0) - COALESCE(im.returned_to_supplier,0)
  ELSE
    COALESCE(im.shipped,0) - COALESCE(im.reversal,0) - COALESCE(cs.sold,0) - COALESCE(im.returned_from_store,0)
  END) AS estimated_remaining_value
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

-- G. 採購單明細展開
CREATE OR REPLACE VIEW public.purchase_order_detail AS
SELECT
  po.id AS purchase_order_id,
  po.supplier_id,
  sup.name AS supplier_name,
  po.status,
  po.purpose,
  po.order_date,
  po.expected_date,
  po.received_date,
  po.total_amount,
  po.supplier_order_number,
  poi.id AS purchase_order_item_id,
  poi.product_id,
  poi.variant_id,
  poi.quantity,
  poi.received_quantity,
  poi.returned_quantity,
  poi.unit_cost,
  poi.sort_order,
  poi.source_order_ids,
  poi.source_quantities,
  p.name AS product_name,
  pv.name AS variant_name,
  pv.sku AS variant_sku
FROM public.purchase_orders po
LEFT JOIN public.suppliers sup ON sup.id = po.supplier_id
LEFT JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
LEFT JOIN public.products p ON p.id = poi.product_id
LEFT JOIN public.product_variants pv ON pv.id = poi.variant_id;

-- H. 維修零件成本/營收彙總
CREATE OR REPLACE VIEW public.repair_order_items_summary AS
SELECT
  roi.repair_order_id,
  COALESCE(SUM(roi.quantity * COALESCE(roi.unit_cost,0)),0) AS parts_cost,
  COALESCE(SUM(roi.quantity * COALESCE(roi.unit_price,0)),0) AS parts_revenue,
  COUNT(roi.id) AS item_count
FROM public.repair_order_items roi
GROUP BY roi.repair_order_id;

-- I. 庫存餘額展開
DROP VIEW IF EXISTS public.product_inventory_detail;
CREATE VIEW public.product_inventory_detail AS
SELECT
  pi.id,
  pi.product_id,
  pi.variant_id,
  pi.warehouse_id,
  pi.quantity,
  pi.suspense_quantity,
  pi.updated_at,
  p.name AS product_name,
  p.code AS product_code,
  p.item_type,
  pv.name AS variant_name,
  pv.sku AS variant_sku,
  pv.retail_price,
  w.name AS warehouse_name,
  w.code AS warehouse_code,
  w.type AS warehouse_type
FROM public.product_inventory pi
LEFT JOIN public.products p ON p.id = pi.product_id
LEFT JOIN public.product_variants pv ON pv.id = pi.variant_id
LEFT JOIN public.warehouses w ON w.id = pi.warehouse_id;

-- J. 訂單出貨狀態
CREATE OR REPLACE VIEW public.order_shipment_status AS
SELECT
  o.id AS order_id,
  CASE
    WHEN COUNT(oi.id) FILTER (WHERE oi.line_type NOT IN ('return','defective')) = 0 THEN 'shipped'
    WHEN COUNT(oi.id) FILTER (WHERE oi.status IN ('cancelled','discontinued','out_of_stock')) = COUNT(oi.id) FILTER (WHERE oi.line_type NOT IN ('return','defective')) THEN 'shipped'
    WHEN COUNT(oi.id) FILTER (WHERE oi.status = 'shipped' AND oi.line_type NOT IN ('return','defective')) = COUNT(oi.id) FILTER (WHERE oi.line_type NOT IN ('return','defective')) THEN 'shipped'
    ELSE 'processing'
  END AS shipment_status
FROM public.orders o
LEFT JOIN public.order_items oi ON oi.order_id = o.id
GROUP BY o.id;

-- K. 產品有效型號（variants 層）
CREATE OR REPLACE VIEW public.product_effective_models AS
SELECT
  v.id AS variant_id,
  v.product_id,
  pem.model_id,
  pem.source,
  pem.group_id,
  dm.name AS model_name,
  dm.brand_id AS model_brand_id,
  db.name AS model_brand_name
FROM public.product_variants v
JOIN public.product_effective_models_base pem ON pem.product_id = v.product_id
LEFT JOIN public.device_models dm ON dm.id = pem.model_id
LEFT JOIN public.device_brands db ON db.id = dm.brand_id;

-- 授權
GRANT SELECT ON public.store_sales_summary TO authenticated;
GRANT SELECT ON public.order_totals TO authenticated;
GRANT SELECT ON public.order_demand_summary TO authenticated;
GRANT SELECT ON public.rep_commission_summary TO authenticated;
GRANT SELECT ON public.sales_note_detail TO authenticated;
GRANT SELECT ON public.consignment_order_item_summary TO authenticated;
GRANT SELECT ON public.purchase_order_detail TO authenticated;
GRANT SELECT ON public.repair_order_items_summary TO authenticated;
GRANT SELECT ON public.product_inventory_detail TO authenticated;
GRANT SELECT ON public.order_shipment_status TO authenticated;
GRANT SELECT ON public.product_effective_models TO authenticated;