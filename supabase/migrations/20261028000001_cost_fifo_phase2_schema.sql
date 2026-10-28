-- ============================================================
-- Cost FIFO Phase 2：懸空層（suspense）schema 擴充
-- 依賴：20261023000008 (inventory_movements.unit_cost), 20261023000005 (receive landed cost)
-- ============================================================

-- ------------------------------------------------------------
-- 1. inventory_movements：新增成本配對欄位
-- ------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS cost_match_status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (cost_match_status IN ('confirmed','pending_match','matched','unmatched','reversed')),
  ADD COLUMN IF NOT EXISTS matched_batch_id UUID REFERENCES public.product_batches(id),
  ADD COLUMN IF NOT EXISTS original_cost_status TEXT;

CREATE INDEX IF NOT EXISTS idx_invmov_cost_match_status
  ON public.inventory_movements(cost_match_status)
  WHERE cost_match_status <> 'confirmed';

CREATE INDEX IF NOT EXISTS idx_invmov_matched_batch
  ON public.inventory_movements(matched_batch_id)
  WHERE matched_batch_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. order_items：新增成本配對欄位
-- ------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cost_match_status TEXT NOT NULL DEFAULT 'estimated'
    CHECK (cost_match_status IN ('estimated','fifo_confirmed','fifo_partial','fifo_pending','reversed')),
  ADD COLUMN IF NOT EXISTS cost_source_batch_id UUID REFERENCES public.product_batches(id),
  ADD COLUMN IF NOT EXISTS original_cost_status TEXT,
  ADD COLUMN IF NOT EXISTS cost_recalculated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_order_items_cost_match_status
  ON public.order_items(cost_match_status)
  WHERE cost_match_status <> 'fifo_confirmed';

-- ------------------------------------------------------------
-- 3. product_inventory：新增 available / suspense 量
-- ------------------------------------------------------------
ALTER TABLE public.product_inventory
  ADD COLUMN IF NOT EXISTS available_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suspense_quantity INTEGER NOT NULL DEFAULT 0;

-- backfill：available = quantity（尚未有懸空概念前，全部視為可用）
UPDATE public.product_inventory
SET available_quantity = quantity
WHERE available_quantity = 0 AND quantity > 0;

-- ------------------------------------------------------------
-- 4. inventory_movement_cost_allocations：後補配對明細表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_movement_cost_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  movement_id UUID NOT NULL REFERENCES public.inventory_movements(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES public.product_batches(id),
  matched_quantity INTEGER NOT NULL CHECK (matched_quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_by UUID REFERENCES public.profiles(id),
  UNIQUE (movement_id, batch_id)
);

CREATE INDEX idx_imca_movement ON public.inventory_movement_cost_allocations(movement_id);
CREATE INDEX idx_imca_batch ON public.inventory_movement_cost_allocations(batch_id);

ALTER TABLE public.inventory_movement_cost_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_view_imca" ON public.inventory_movement_cost_allocations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admins_manage_imca" ON public.inventory_movement_cost_allocations
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ============================================================
-- End of migration 20261028000001
-- ============================================================