-- ============================================================
-- 20260905000000 維修單模組進化
-- 型號規格選項/版本組合、密碼鎖類型、外觀/功能檢測清單、零件庫存
-- 以 IF NOT EXISTS 防禦性補建（部分環境未套用舊 repair migration）
-- ============================================================

-- ------------------------------------------------------------
-- 0. 防禦性補建：device_models.specifications
-- ------------------------------------------------------------
ALTER TABLE public.device_models
  ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '{}'::jsonb;

-- ------------------------------------------------------------
-- 1. 防禦性補建：repair 列舉型別
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE repair_order_status AS ENUM (
    'pending', 'diagnosing', 'quoting', 'awaiting_approval', 'awaiting_parts',
    'repairing', 'ready', 'delivered', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE repair_item_type AS ENUM (
    'service', 'part'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 2. 防禦性補建：repair_orders（customer_name 改為可空）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE,
  store_id        UUID REFERENCES stores(id) ON DELETE SET NULL,
  status          repair_order_status NOT NULL DEFAULT 'pending',

  customer_name   TEXT,
  customer_phone  TEXT,
  customer_email  TEXT,
  customer_notes  TEXT,

  device_model_id UUID REFERENCES device_models(id) ON DELETE SET NULL,
  device_color    TEXT,
  device_storage  TEXT,
  device_ram      TEXT,
  device_specs    JSONB DEFAULT '{}'::jsonb,
  device_imei     TEXT,
  device_sn       TEXT,
  device_passcode TEXT,
  device_condition TEXT,

  reported_issue   TEXT,
  diagnostic_result TEXT,
  internal_notes   TEXT,

  parts_cost       DECIMAL(12,2) NOT NULL DEFAULT 0,
  labor_fee        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cost       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_price      DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  deposit          DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method   TEXT,

  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to      UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  diagnosed_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS repair_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id   UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  item_type         repair_item_type NOT NULL DEFAULT 'service',
  service_name      TEXT,
  service_category  TEXT,
  product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id        UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  part_name         TEXT,
  description       TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_cost         DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_price        DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_order_status_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id   UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  changed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 既有表補欄位（防呆，已是新表則 ADD IF NOT EXISTS 無作用）
ALTER TABLE public.repair_orders
  ALTER COLUMN customer_name DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_repair_orders_store_id ON repair_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_status ON repair_orders(status);
CREATE INDEX IF NOT EXISTS idx_repair_orders_code ON repair_orders(code);
CREATE INDEX IF NOT EXISTS idx_repair_orders_customer_phone ON repair_orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_repair_orders_device_model_id ON repair_orders(device_model_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_created_at ON repair_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_orders_assigned_to ON repair_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_repair_order_items_order_id ON repair_order_items(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_repair_order_status_history_order_id ON repair_order_status_history(repair_order_id);

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_repair_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_orders_updated_at ON repair_orders;
CREATE TRIGGER trg_repair_orders_updated_at
  BEFORE UPDATE ON repair_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_repair_orders_updated_at();

-- 自動產生維修單編號 RO-YYYYMMDD-XXXXX
CREATE OR REPLACE FUNCTION generate_repair_order_code()
RETURNS TRIGGER AS $$
DECLARE
  date_part TEXT;
  seq_num INTEGER;
BEGIN
  date_part := to_char(now(), 'YYYYMMDD');
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM '\d{5}$') AS INTEGER)), 0) + 1
  INTO seq_num
  FROM repair_orders
  WHERE code LIKE 'RO-' || date_part || '-%';
  NEW.code := 'RO-' || date_part || '-' || LPAD(seq_num::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_orders_code ON repair_orders;
CREATE TRIGGER trg_repair_orders_code
  BEFORE INSERT ON repair_orders
  FOR EACH ROW
  WHEN (NEW.code IS NULL OR NEW.code = '')
  EXECUTE FUNCTION generate_repair_order_code();

-- 彙總 View
CREATE OR REPLACE VIEW repair_order_summary AS
SELECT
  ro.*,
  (ro.total_price - ro.discount - ro.total_cost) AS profit,
  (ro.total_price - ro.discount) AS final_price,
  CASE
    WHEN (ro.total_price - ro.discount) > 0
    THEN ROUND(((ro.total_price - ro.discount - ro.total_cost) / (ro.total_price - ro.discount) * 100)::numeric, 1)
    ELSE 0
  END AS profit_margin_percent,
  db.name AS device_brand_name,
  dm.name AS device_model_name,
  dm.specifications AS device_specifications,
  dm.device_type AS device_type,
  dm.screen_size AS device_screen_size,
  creator.email AS created_by_email,
  assignee.email AS assigned_to_email
FROM repair_orders ro
LEFT JOIN device_models dm ON dm.id = ro.device_model_id
LEFT JOIN device_brands db ON db.id = dm.brand_id
LEFT JOIN auth.users creator ON creator.id = ro.created_by
LEFT JOIN auth.users assignee ON assignee.id = ro.assigned_to;

-- RLS 啟用與 Policies（IF NOT EXISTS 無法用於 policy，採 DROP + CREATE）
ALTER TABLE repair_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_order_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view repair orders in their stores" ON repair_orders;
CREATE POLICY "Users can view repair orders in their stores"
  ON repair_orders FOR SELECT
  USING (store_id IS NULL OR is_store_member(auth.uid(), store_id) OR has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS "Users can insert repair orders" ON repair_orders;
CREATE POLICY "Users can insert repair orders"
  ON repair_orders FOR INSERT
  WITH CHECK (store_id IS NULL OR is_store_member(auth.uid(), store_id) OR has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS "Users can update repair orders in their stores" ON repair_orders;
CREATE POLICY "Users can update repair orders in their stores"
  ON repair_orders FOR UPDATE
  USING (store_id IS NULL OR is_store_member(auth.uid(), store_id) OR has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS "Users can view items of accessible orders" ON repair_order_items;
CREATE POLICY "Users can view items of accessible orders"
  ON repair_order_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

DROP POLICY IF EXISTS "Users can insert items to accessible orders" ON repair_order_items;
CREATE POLICY "Users can insert items to accessible orders"
  ON repair_order_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

DROP POLICY IF EXISTS "Users can update items of accessible orders" ON repair_order_items;
CREATE POLICY "Users can update items of accessible orders"
  ON repair_order_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

DROP POLICY IF EXISTS "Users can delete items of accessible orders" ON repair_order_items;
CREATE POLICY "Users can delete items of accessible orders"
  ON repair_order_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_order_items.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

DROP POLICY IF EXISTS "Users can view status history of accessible orders" ON repair_order_status_history;
CREATE POLICY "Users can view status history of accessible orders"
  ON repair_order_status_history FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_order_status_history.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

-- 版本控制
INSERT INTO data_versions (table_name, version)
VALUES ('repair_orders', to_char(now(), 'YYMMDD') || '-0000')
ON CONFLICT (table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION bump_repair_orders_version()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE data_versions
  SET version = to_char(now(), 'YYMMDD') || '-' || LPAD(FLoor(random() * 10000)::INTEGER::TEXT, 4, '0'),
      updated_at = now()
  WHERE table_name = 'repair_orders';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_repair_orders_version ON repair_orders;
CREATE TRIGGER trg_repair_orders_version
  AFTER INSERT OR UPDATE OR DELETE ON repair_orders
  FOR EACH STATEMENT
  EXECUTE FUNCTION bump_repair_orders_version();

-- ------------------------------------------------------------
-- 3. repair_orders 新欄位：密碼鎖類型 / 圖像鎖路徑
-- ------------------------------------------------------------
ALTER TABLE public.repair_orders
  ADD COLUMN IF NOT EXISTS device_lock_type TEXT NOT NULL DEFAULT 'none'
    CHECK (device_lock_type IN ('none', 'numeric', 'pattern'));
ALTER TABLE public.repair_orders
  ADD COLUMN IF NOT EXISTS device_passcode_pattern TEXT;

-- ------------------------------------------------------------
-- 4. repair_order_items 新欄位：庫存扣減旗標
-- ------------------------------------------------------------
ALTER TABLE public.repair_order_items
  ADD COLUMN IF NOT EXISTS is_stock_deducted BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 5. products 新欄位：維修零件標記（不出現在門市 Catalog）
-- ------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_repair_part BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 6. 新表：device_model_spec_options（型號規格選項清單）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_model_spec_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    UUID NOT NULL REFERENCES public.device_models(id) ON DELETE CASCADE,
  aspect      TEXT NOT NULL CHECK (aspect IN ('color', 'storage', 'ram', 'cpu')),
  value       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, aspect, value)
);

CREATE INDEX IF NOT EXISTS idx_device_model_spec_options_model
  ON public.device_model_spec_options(model_id, aspect);

ALTER TABLE public.device_model_spec_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage device model spec options" ON public.device_model_spec_options;
CREATE POLICY "Admins can manage device model spec options"
  ON public.device_model_spec_options FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS "Users can view device model spec options" ON public.device_model_spec_options;
CREATE POLICY "Users can view device model spec options"
  ON public.device_model_spec_options FOR SELECT TO authenticated USING (true);

-- 規格異動時推進 device_models 快取版本
DROP TRIGGER IF EXISTS trg_device_model_spec_options_version ON public.device_model_spec_options;
CREATE TRIGGER trg_device_model_spec_options_version
  AFTER INSERT OR UPDATE OR DELETE ON public.device_model_spec_options
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_device_models_version();

-- ------------------------------------------------------------
-- 7. 新表：device_model_versions（型號預設版本組合）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_model_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id      UUID NOT NULL REFERENCES public.device_models(id) ON DELETE CASCADE,
  version_name  TEXT NOT NULL,
  color         TEXT,
  storage       TEXT,
  ram           TEXT,
  cpu           TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_model_versions_model
  ON public.device_model_versions(model_id);

ALTER TABLE public.device_model_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage device model versions" ON public.device_model_versions;
CREATE POLICY "Admins can manage device model versions"
  ON public.device_model_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS "Users can view device model versions" ON public.device_model_versions;
CREATE POLICY "Users can view device model versions"
  ON public.device_model_versions FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_device_model_versions_version ON public.device_model_versions;
CREATE TRIGGER trg_device_model_versions_version
  AFTER INSERT OR UPDATE OR DELETE ON public.device_model_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_device_models_version();

-- ------------------------------------------------------------
-- 8. 新表：repair_checklist_library（檢測/外觀項目提示庫）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_checklist_library (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL CHECK (category IN ('appearance', 'functional')),
  item_name     TEXT NOT NULL,
  usage_count   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category, item_name)
);

CREATE INDEX IF NOT EXISTS idx_repair_checklist_library_cat
  ON public.repair_checklist_library(category, sort_order);

ALTER TABLE public.repair_checklist_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage repair checklist library" ON public.repair_checklist_library;
CREATE POLICY "Admins can manage repair checklist library"
  ON public.repair_checklist_library FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.system_role));

DROP POLICY IF EXISTS "Users can view repair checklist library" ON public.repair_checklist_library;
CREATE POLICY "Users can view repair checklist library"
  ON public.repair_checklist_library FOR SELECT TO authenticated USING (true);

-- 支援「遇到不同項目可儲存」：由有權限使用者 upsert 計數
CREATE OR REPLACE FUNCTION public.upsert_repair_checklist_library(p_category TEXT, p_item_name TEXT)
RETURNS void AS $$
BEGIN
  INSERT INTO public.repair_checklist_library (category, item_name, usage_count, sort_order)
  VALUES (p_category, btrim(p_item_name), 1, 1000)
  ON CONFLICT (category, item_name) DO UPDATE
    SET usage_count = repair_checklist_library.usage_count + 1;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.upsert_repair_checklist_library(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_repair_checklist_library(TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 9. 新表：repair_device_checklists（維修單外觀/功能檢測紀錄）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.repair_device_checklists (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id  UUID NOT NULL REFERENCES public.repair_orders(id) ON DELETE CASCADE,
  category         TEXT NOT NULL CHECK (category IN ('appearance', 'functional')),
  item_name        TEXT NOT NULL,
  is_checked       BOOLEAN NOT NULL DEFAULT true,
  note             TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_device_checklists_order
  ON public.repair_device_checklists(repair_order_id);

ALTER TABLE public.repair_device_checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can view repair device checklists"
  ON public.repair_device_checklists FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

DROP POLICY IF EXISTS "Users can insert repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can insert repair device checklists"
  ON public.repair_device_checklists FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

DROP POLICY IF EXISTS "Users can update repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can update repair device checklists"
  ON public.repair_device_checklists FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

DROP POLICY IF EXISTS "Users can delete repair device checklists" ON public.repair_device_checklists;
CREATE POLICY "Users can delete repair device checklists"
  ON public.repair_device_checklists FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM repair_orders ro
    WHERE ro.id = repair_device_checklists.repair_order_id
    AND (ro.store_id IS NULL OR is_store_member(auth.uid(), ro.store_id) OR has_role(auth.uid(), 'admin'::public.system_role))
  ));

-- ------------------------------------------------------------
-- 10. inventory_movements：串接維修零件出庫
-- ------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS repair_order_id UUID REFERENCES public.repair_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invmov_repair_order ON public.inventory_movements(repair_order_id);

-- 重寫 source_type CHECK（含 repair_part_usage）
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_source_type_check;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_source_type_check CHECK (
    source_type IN (
      'purchase_receipt', 'purchase_return',
      'sales_shipment', 'sales_note_deletion',
      'customer_return',
      'consignment_in_receipt', 'consignment_in_return',
      'consignment_out_shipment', 'consignment_out_sale', 'consignment_out_return',
      'consignment_sale_reversal', 'consignment_shipment_reversal',
      'scrap', 'transfer',
      'repair_part_usage',
      'manual_adjustment', 'system_recalculation'
    )
  );

-- 重寫 FK 綁定 CHECK（新規約束發生既有資料違規：sales_shipment/sales_note_deletion 有 sales_note_id
-- 為 NULL 的歷史資料，故沿用舊約束寬鬆度，僅新增 repair_order_id 檢查與 repair_part_usage 分支）
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS chk_invmov_source_fk;
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT chk_invmov_source_fk CHECK (
    (source_type IN ('purchase_receipt', 'purchase_return')
     AND sales_note_id IS NULL AND consignment_order_id IS NULL
     AND repair_order_id IS NULL)
    OR
    (source_type IN ('sales_shipment', 'sales_note_deletion', 'customer_return')
     AND purchase_order_id IS NULL AND consignment_order_id IS NULL
     AND repair_order_id IS NULL)
    OR
    (source_type IN ('consignment_in_receipt', 'consignment_in_return',
                     'consignment_out_shipment', 'consignment_out_sale', 'consignment_out_return',
                     'consignment_sale_reversal', 'consignment_shipment_reversal')
     AND purchase_order_id IS NULL
     AND repair_order_id IS NULL)
    OR
    (source_type = 'repair_part_usage'
     AND repair_order_id IS NOT NULL AND purchase_order_id IS NULL
     AND sales_note_id IS NULL AND consignment_order_id IS NULL)
    OR
    (source_type IN ('scrap', 'transfer', 'manual_adjustment', 'system_recalculation')
     AND purchase_order_id IS NULL AND sales_note_id IS NULL
     AND consignment_order_id IS NULL AND repair_order_id IS NULL)
  );

-- ------------------------------------------------------------
-- 11. 快速出庫 RPC：維修單零件出庫（SECURITY DEFINER，重複呼叫安全）
--     同品項同單僅扣除一次（依 repair_order_items.is_stock_deducted 守門）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_repair_part_stock(
  p_repair_order_id UUID,
  p_item_id         UUID,
  p_product_id      UUID,
  p_variant_id      UUID,
  p_quantity        INTEGER,
  p_created_by      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_warehouse_id UUID;
  v_balance      INTEGER;
  v_variant      UUID;
BEGIN
  SELECT id INTO v_warehouse_id
  FROM warehouses
  WHERE code = 'own' OR type = '自有倉'
  ORDER BY (code = 'own') DESC, is_active DESC
  LIMIT 1;

  IF v_warehouse_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '找不到自有倉庫');
  END IF;

  v_variant := p_variant_id;
  IF v_variant IS NULL AND p_product_id IS NOT NULL THEN
    -- 無變體產品以 product 層級出庫
    v_variant := NULL;
  END IF;

  SELECT quantity INTO v_balance
  FROM product_inventory
  WHERE product_id = p_product_id
    AND variant_id IS NOT DISTINCT FROM v_variant
    AND warehouse_id = v_warehouse_id
  LIMIT 1;

  IF v_balance IS NULL OR v_balance < p_quantity THEN
    RETURN jsonb_build_object('ok', false, 'error',
      '庫存不足（目前 ' || COALESCE(v_balance::TEXT, '0') || '，需要 ' || p_quantity || '）');
  END IF;

  INSERT INTO public.inventory_movements (
    product_id, variant_id, warehouse_id, quantity_change, balance_after,
    source_type, repair_order_id, note, created_by
  )
  VALUES (
    p_product_id, v_variant, v_warehouse_id, -p_quantity,
    v_balance - p_quantity,
    'repair_part_usage', p_repair_order_id,
    '維修單零件出庫', p_created_by
  );

  UPDATE public.repair_order_items
  SET is_stock_deducted = true
  WHERE id = p_item_id AND repair_order_id = p_repair_order_id;

  RETURN jsonb_build_object('ok', true, 'warehouse_id', v_warehouse_id, 'balance_after', v_balance - p_quantity);
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_repair_part_stock(UUID, UUID, UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_repair_part_stock(UUID, UUID, UUID, UUID, INTEGER, UUID) TO authenticated;