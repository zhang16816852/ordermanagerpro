-- ============================================================
-- P5 / M3：inventory_movements 新增 unit_cost（成本唯一計算值）
-- 檔名：20261023000008_inventory_movements_unit_cost.sql
-- 依賴：20261023000003 (purchase_freight_costs), 20261023000005 (receive landed cost)
-- 可獨立驗證與回滾：是（ALTER TABLE + UPDATE，冪等）
-- ============================================================

-- ------------------------------------------------------------
-- 1. 新增 unit_cost 欄位
-- ------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2) NULL CHECK (unit_cost >= 0);

-- ------------------------------------------------------------
-- 2. Backfill：tracked movement 從 product_batches 取成本
--    非 tracked 的 purchase_receipt 從 purchase_order_items.landed_unit_cost / unit_cost 取（best effort）
-- ------------------------------------------------------------
-- tracked（有 batch_id）：以 batch unit_cost 回填
UPDATE public.inventory_movements im
SET unit_cost = pb.unit_cost
FROM public.product_batches pb
WHERE im.batch_id = pb.id
  AND im.unit_cost IS NULL;

-- 非 tracked 的 purchase_receipt：以對應 PO item 的 landed_unit_cost（fallback unit_cost）回填
UPDATE public.inventory_movements im
SET unit_cost = COALESCE(poi.landed_unit_cost, poi.unit_cost)
FROM public.purchase_order_items poi
WHERE im.purchase_order_id = poi.purchase_order_id
  AND im.product_id = poi.product_id
  AND im.variant_id IS NOT DISTINCT FROM poi.variant_id
  AND im.source_type = 'purchase_receipt'
  AND im.unit_cost IS NULL
  AND im.batch_id IS NULL;

-- ------------------------------------------------------------
-- 3. 索引（加速以 unit_cost 查詢的報表）
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invmov_unit_cost ON public.inventory_movements(unit_cost) WHERE unit_cost IS NOT NULL;

-- ============================================================
-- End of migration 000008
-- ============================================================
