-- ============================================================
-- Backfill order_items.unit_cost 快照
--
-- order_items.unit_cost 絕大多數為 0/null，而 mapping/PO 成本查詢
-- 受 RLS 限制（admin-only），非 admin 使用者無法透過 mapping/PO 層取得成本，
-- 導致「品項已綁定採購單/廠商對照仍顯示成本未知」。
--
-- 本 migration 以 admin 身分（可讀 mapping/PO）把成本寫回 order_items.unit_cost
-- 作為快照（resolveUnitCost 最高優先），優先序與前端一致：
--   1. supplier_product_mappings.vendor_unit_cost（廠商對照）
--   2. purchase_order_items.unit_cost（最近一筆採購，排除退貨單）
-- 僅更新目前為 0/null 的品項；已有快照者不動。
-- ============================================================

UPDATE order_items oi
SET unit_cost = COALESCE(
  (SELECT spm.vendor_unit_cost
     FROM supplier_product_mappings spm
    WHERE spm.internal_product_id = oi.product_id
      AND spm.internal_variant_id IS NOT DISTINCT FROM oi.variant_id
      AND spm.vendor_unit_cost IS NOT NULL
      AND spm.vendor_unit_cost > 0
    ORDER BY spm.is_primary DESC, spm.updated_at DESC NULLS LAST, spm.created_at DESC NULLS LAST
    LIMIT 1),
  (SELECT poi.unit_cost
     FROM purchase_order_items poi
     JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.product_id = oi.product_id
      AND poi.variant_id IS NOT DISTINCT FROM oi.variant_id
      AND poi.unit_cost IS NOT NULL
      AND poi.unit_cost > 0
      AND po.purpose IS DISTINCT FROM 'purchase_return'
    ORDER BY COALESCE(po.received_date, po.order_date, poi.created_at::date) DESC NULLS LAST
    LIMIT 1)
)
WHERE (oi.unit_cost IS NULL OR oi.unit_cost = 0)
  AND EXISTS (
        SELECT 1 FROM supplier_product_mappings spm
         WHERE spm.internal_product_id = oi.product_id
           AND spm.internal_variant_id IS NOT DISTINCT FROM oi.variant_id
           AND spm.vendor_unit_cost IS NOT NULL AND spm.vendor_unit_cost > 0
        UNION ALL
        SELECT 1 FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE poi.product_id = oi.product_id
          AND poi.variant_id IS NOT DISTINCT FROM oi.variant_id
          AND poi.unit_cost IS NOT NULL AND poi.unit_cost > 0
          AND po.purpose IS DISTINCT FROM 'purchase_return'
      );
