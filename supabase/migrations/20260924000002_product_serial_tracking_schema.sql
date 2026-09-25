-- ============================================================
-- 20260924000002_product_serial_tracking_schema.sql
-- 產品「批號追蹤」：先做一機一號（serial），預留批號（batch）模式。
--
-- 設計原則：
--   * inventory_movements 是追溯日誌——新增 batch_id 欄位，
--     「哪批/哪台序號進到或出到哪張單」全由 movements 記錄。
--   * product_inventory 維持「總量」不變（既有 RPC/trigger 完全不受影響）；
--     批次級餘額並行存放於 product_batch_inventory（trigger 維護）。
--   * product_batches.remaining 不落庫，可用量 = product_batch_inventory.quantity。
--   * 出貨時由內部 helper `_ship_stock_movements` 依 FIFO（received_at 最早優先）
--     拆成逐批/逐台 movement；不足時（既有無序號庫存/混合模式）以無 batch 的
--     一般 movement 補足，不擋出貨（既有無序號量仍可先出）。
--   * DROP 兩個部分唯一索引 idx_invmov_unique_shipment/deletion：
--     同 (sales_note_id, order_item_id) 允許逐批/逐台多列。
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. product_variants.tracking_mode
-- ------------------------------------------------------------
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'none'
  CONSTRAINT chk_pv_tracking_mode CHECK (tracking_mode IN ('none', 'batch', 'serial'));

COMMENT ON COLUMN public.product_variants.tracking_mode IS
  '批號追蹤模式：none（不追蹤）| batch（批號分組）| serial（一機一號，每台一個序號）';

-- ------------------------------------------------------------
-- 2. product_batches：批號/序號主檔（serial + batch 共用一張）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('batch', 'serial')),
  serial_number TEXT,
  batch_number TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  purchase_order_item_id UUID REFERENCES public.purchase_order_items(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'void')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pb_serial_fields CHECK (
    (tracking_mode = 'serial' AND serial_number IS NOT NULL AND batch_number IS NULL AND quantity = 1)
    OR
    (tracking_mode = 'batch' AND batch_number IS NOT NULL AND serial_number IS NULL)
  )
);

COMMENT ON TABLE public.product_batches IS
  '產品批號/序號主檔。serial 模式：一列＝一台（quantity=1）；batch 模式：一列＝一批（quantity>1）。可用量存放於 product_batch_inventory，不在此表維護。';

-- 唯一性：同一變體內序號/批號不重複（partial，避免 NULL 互相不衝突）
CREATE UNIQUE INDEX IF NOT EXISTS idx_pb_unique_serial
  ON public.product_batches (variant_id, serial_number)
  WHERE tracking_mode = 'serial' AND serial_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pb_unique_batch
  ON public.product_batches (variant_id, batch_number)
  WHERE tracking_mode = 'batch' AND batch_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pb_variant ON public.product_batches (variant_id);
CREATE INDEX IF NOT EXISTS idx_pb_po_item ON public.product_batches (purchase_order_item_id);

ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_view_product_batches" ON public.product_batches;
CREATE POLICY "authenticated_view_product_batches" ON public.product_batches
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admins_manage_product_batches" ON public.product_batches;
CREATE POLICY "admins_manage_product_batches" ON public.product_batches
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ------------------------------------------------------------
-- 3. product_batch_inventory：批次級餘額（trigger 維護）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_batch_inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.product_batches(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_pbi_batch_warehouse UNIQUE (batch_id, warehouse_id)
);

COMMENT ON TABLE public.product_batch_inventory IS
  '批次/序號級庫存餘額（依倉位）。由 inventory_movements BEFORE INSERT trigger 自動維護，讀取即「該批可用量」。';

ALTER TABLE public.product_batch_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_view_product_batch_inventory" ON public.product_batch_inventory;
CREATE POLICY "authenticated_view_product_batch_inventory" ON public.product_batch_inventory
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admins_manage_product_batch_inventory" ON public.product_batch_inventory;
CREATE POLICY "admins_manage_product_batch_inventory" ON public.product_batch_inventory
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ------------------------------------------------------------
-- 4. inventory_movements.batch_id（追溯日誌）
-- ------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.product_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invmov_batch ON public.inventory_movements (batch_id);
CREATE INDEX IF NOT EXISTS idx_invmov_batch_sn ON public.inventory_movements (sales_note_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_invmov_batch_co ON public.inventory_movements (consignment_order_item_id, batch_id);

COMMENT ON COLUMN public.inventory_movements.batch_id IS
  '批次/序號追溯：該異動關聯的 product_batches（serial 時一列＝一台）。';

-- ------------------------------------------------------------
-- 5. 放寬「同一 (sales_note_id, order_item_id) 只能一列」限制
--    （逐批/逐台拆列的先決條件）
-- ------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_invmov_unique_shipment;
DROP INDEX IF EXISTS public.idx_invmov_unique_deletion;

-- ------------------------------------------------------------
-- 6. trigger 擴充：批次餘額維護
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trgfn_sync_inventory_on_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.product_inventory (product_id, variant_id, warehouse_id, quantity, updated_at)
  VALUES (NEW.product_id, NEW.variant_id, NEW.warehouse_id, NEW.quantity_change, NOW())
  ON CONFLICT (product_id, variant_id, warehouse_id)
  DO UPDATE SET
    quantity = product_inventory.quantity + EXCLUDED.quantity,
    updated_at = NOW()
  RETURNING quantity INTO NEW.balance_after;

  IF NEW.batch_id IS NOT NULL THEN
    INSERT INTO public.product_batch_inventory (batch_id, warehouse_id, quantity, updated_at)
    VALUES (NEW.batch_id, NEW.warehouse_id, NEW.quantity_change, NOW())
    ON CONFLICT (batch_id, warehouse_id)
    DO UPDATE SET
      quantity = product_batch_inventory.quantity + EXCLUDED.quantity,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 7. 出貨共用 helper：依追蹤模式拆批/拆台扣存
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ship_stock_movements(
  p_product_id UUID,
  p_variant_id UUID,
  p_warehouse_id UUID,
  p_quantity INTEGER,
  p_source_type TEXT,
  p_sales_note_id UUID DEFAULT NULL,
  p_consignment_order_id UUID DEFAULT NULL,
  p_consignment_order_item_id UUID DEFAULT NULL,
  p_order_item_id UUID DEFAULT NULL,
  p_reference_code TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_inventory_owner TEXT DEFAULT 'self'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_mode TEXT;
  v_batch RECORD;
  v_to_go INTEGER;
  v_take INTEGER;
BEGIN
  v_mode := NULL;
  IF p_variant_id IS NOT NULL THEN
    SELECT tracking_mode INTO v_mode FROM public.product_variants WHERE id = p_variant_id;
  END IF;

  IF v_mode IS NULL OR v_mode = 'none' THEN
    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      sales_note_id, consignment_order_id, consignment_order_item_id, order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      p_product_id, p_variant_id, p_warehouse_id, -p_quantity, p_source_type,
      p_sales_note_id, p_consignment_order_id, p_consignment_order_item_id, p_order_item_id,
      p_reference_code, p_inventory_owner, p_created_by
    );
    RETURN;
  END IF;

  v_to_go := p_quantity;

  -- FIFO：received_at 最早優先（同批內則依序號/批次碼）
  FOR v_batch IN
    SELECT pb.id,
           pbi.quantity AS avail,
           pb.serial_number,
           pb.batch_number
    FROM public.product_batches pb
    JOIN public.product_batch_inventory pbi ON pbi.batch_id = pb.id
    WHERE pb.variant_id = p_variant_id
      AND pb.tracking_mode = v_mode
      AND pb.status = 'active'
      AND pbi.warehouse_id = p_warehouse_id
      AND pbi.quantity > 0
    ORDER BY pb.received_at ASC, pb.created_at ASC, pb.id ASC
    FOR UPDATE OF pb, pbi
  LOOP
    EXIT WHEN v_to_go <= 0;

    IF v_mode = 'serial' THEN
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, consignment_order_id, consignment_order_item_id, order_item_id,
        reference_code, inventory_owner, created_by, batch_id
      )
      VALUES (
        p_product_id, p_variant_id, p_warehouse_id, -1, p_source_type,
        p_sales_note_id, p_consignment_order_id, p_consignment_order_item_id, p_order_item_id,
        p_reference_code, p_inventory_owner, p_created_by, v_batch.id
      );
      v_to_go := v_to_go - 1;
    ELSE
      v_take := LEAST(v_batch.avail, v_to_go);
      INSERT INTO public.inventory_movements (
        product_id, variant_id, warehouse_id, quantity_change, source_type,
        sales_note_id, consignment_order_id, consignment_order_item_id, order_item_id,
        reference_code, inventory_owner, created_by, batch_id
      )
      VALUES (
        p_product_id, p_variant_id, p_warehouse_id, -v_take, p_source_type,
        p_sales_note_id, p_consignment_order_id, p_consignment_order_item_id, p_order_item_id,
        p_reference_code, p_inventory_owner, p_created_by, v_batch.id
      );
      v_to_go := v_to_go - v_take;
    END IF;
  END LOOP;

  -- 剩餘（無序號/無批號的既有庫存，或該倉位批次不足）：以無 batch 的一般 movement 扣存（混合相容）
  IF v_to_go > 0 THEN
    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      sales_note_id, consignment_order_id, consignment_order_item_id, order_item_id,
      reference_code, inventory_owner, created_by
    )
    VALUES (
      p_product_id, p_variant_id, p_warehouse_id, -v_to_go, p_source_type,
      p_sales_note_id, p_consignment_order_id, p_consignment_order_item_id, p_order_item_id,
      p_reference_code, p_inventory_owner, p_created_by
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._ship_stock_movements(uuid, uuid, uuid, integer, text, uuid, uuid, uuid, uuid, text, uuid, text) FROM public;
REVOKE ALL ON FUNCTION public._ship_stock_movements(uuid, uuid, uuid, integer, text, uuid, uuid, uuid, uuid, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public._ship_stock_movements(uuid, uuid, uuid, integer, text, uuid, uuid, uuid, uuid, text, uuid, text) FROM authenticated;

COMMENT ON FUNCTION public._ship_stock_movements IS
  '內部共用：出貨扣存。tracked 變體依 FIFO 拆成逐批/逐台 movement（帶 batch_id），不足的既有無序號量以一般 movement 補足；僅供出貨 RPC 呼叫，不對外開放';

-- ------------------------------------------------------------
-- 8. upsert_sales_note_deletion_movement 支援批次還原
--    （DROP 舊 8 參數簽名後重建 9 參數版，避免 overload）
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_sales_note_deletion_movement(uuid, uuid, uuid, uuid, uuid, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.upsert_sales_note_deletion_movement(
  p_sales_note_id UUID,
  p_order_item_id UUID,
  p_product_id UUID,
  p_variant_id UUID,
  p_warehouse_id UUID,
  p_quantity INTEGER,
  p_reference_code TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE sales_note_id = p_sales_note_id
      AND order_item_id = p_order_item_id
      AND source_type = 'sales_note_deletion'
      AND batch_id IS NOT DISTINCT FROM p_batch_id
  ) THEN
    -- 已有同 key（含同 batch）的 deletion 列 → 累加數量、不新增列
    UPDATE public.product_inventory
    SET quantity = quantity + p_quantity, updated_at = NOW()
    WHERE product_id = p_product_id
      AND variant_id IS NOT DISTINCT FROM p_variant_id
      AND warehouse_id = p_warehouse_id
    RETURNING quantity INTO v_new_balance;

    IF NOT FOUND THEN
      INSERT INTO public.product_inventory (product_id, variant_id, warehouse_id, quantity, updated_at)
      VALUES (p_product_id, p_variant_id, p_warehouse_id, p_quantity, NOW())
      RETURNING quantity INTO v_new_balance;
    END IF;

    -- UPDATE 不觸發 BEFORE INSERT trigger → 批次餘額需手動同步
    IF p_batch_id IS NOT NULL THEN
      INSERT INTO public.product_batch_inventory (batch_id, warehouse_id, quantity, updated_at)
      VALUES (p_batch_id, p_warehouse_id, p_quantity, NOW())
      ON CONFLICT (batch_id, warehouse_id)
      DO UPDATE SET quantity = product_batch_inventory.quantity + EXCLUDED.quantity, updated_at = NOW();
    END IF;

    UPDATE public.inventory_movements
    SET quantity_change = quantity_change + p_quantity,
        balance_after = COALESCE(v_new_balance, quantity_change),
        reference_code = COALESCE(p_reference_code, reference_code),
        created_by = COALESCE(p_created_by, created_by)
    WHERE sales_note_id = p_sales_note_id
      AND order_item_id = p_order_item_id
      AND source_type = 'sales_note_deletion'
      AND batch_id IS NOT DISTINCT FROM p_batch_id;
  ELSE
    INSERT INTO public.inventory_movements (
      product_id, variant_id, warehouse_id, quantity_change, source_type,
      sales_note_id, order_item_id, reference_code, created_by, batch_id
    )
    VALUES (
      p_product_id, p_variant_id, p_warehouse_id, p_quantity, 'sales_note_deletion',
      p_sales_note_id, p_order_item_id, p_reference_code, p_created_by, p_batch_id
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_sales_note_deletion_movement(uuid, uuid, uuid, uuid, uuid, integer, text, uuid, uuid) FROM public, anon, authenticated;
-- 此 helper 僅供 delete_sales_note / correct_sales_note（SECURITY DEFINER）內部呼叫，
-- 不開放給一般 authenticated 直接執行（避免任意加庫存）。

NOTIFY pgrst, 'reload schema';

COMMIT;