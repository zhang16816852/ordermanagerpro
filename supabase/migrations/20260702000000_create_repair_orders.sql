-- ==============================================================
-- 手機維修開單收據系統 (Repair Order System)
-- 擴展 device_models + 建立維修訂單/收據相關資料表
-- ==============================================================

-- 0. 擴展 device_models：加入規格 JSONB，存放顏色、RAM、ROM 等
ALTER TABLE device_models
  ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN device_models.specifications IS '設備規格 (顏色、RAM、ROM、儲存空間等)，例如 {"colors":["太空黑","銀色"],"storage_options":["128GB","256GB"],"ram":"8GB"}';

-- 1. 建立列舉型別

DO $$ BEGIN
  CREATE TYPE repair_order_status AS ENUM (
    'pending',           -- 待處理
    'diagnosing',        -- 檢測中
    'quoting',           -- 報價中
    'awaiting_approval', -- 待客戶確認
    'awaiting_parts',    -- 待料中
    'repairing',         -- 維修中
    'ready',             -- 已修復 / 待取件
    'delivered',         -- 已取件
    'cancelled'          -- 已取消
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE repair_item_type AS ENUM (
    'service',  -- 維修服務 (工資)
    'part'      -- 零件材料
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. 維修訂單主表
CREATE TABLE IF NOT EXISTS repair_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,  -- RO-YYYYMMDD-XXXXX
  store_id        UUID REFERENCES stores(id) ON DELETE SET NULL,
  status          repair_order_status NOT NULL DEFAULT 'pending',

  -- 客戶資訊
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT,
  customer_email  TEXT,
  customer_notes  TEXT,                  -- 客戶備註/特殊需求

  -- 裝置資訊 (透過 device_models 型號 + 額外規格)
  device_model_id UUID REFERENCES device_models(id) ON DELETE SET NULL,
  device_color    TEXT,                  -- 顏色 (例: 太空黑)
  device_storage  TEXT,                  -- 儲存空間 (例: 256GB)
  device_ram      TEXT,                  -- 記憶體 (例: 8GB)
  device_specs    JSONB DEFAULT '{}'::jsonb,  -- 其他擴充規格
  device_imei     TEXT,                  -- IMEI 碼
  device_sn       TEXT,                  -- 序號
  device_passcode TEXT,                  -- 螢幕鎖密碼
  device_condition TEXT,                -- 外觀狀況備註

  -- 問題與診斷
  reported_issue   TEXT,                -- 客戶描述問題
  diagnostic_result TEXT,               -- 工程師檢測結果
  internal_notes   TEXT,                -- 內部備註 (不顯示在收據)

  -- 帳務
  parts_cost       DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 零件成本
  labor_fee        DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 工資
  total_cost       DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 總成本 (零件成本)
  total_price      DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 總售價 (向客戶收費)
  discount         DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 折扣
  deposit          DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 已收定金
  payment_method   TEXT,                              -- 付款方式

  -- 人員指派
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to      UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- 負責技師

  -- 時間
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  diagnosed_at     TIMESTAMPTZ,          -- 檢測完成時間
  started_at       TIMESTAMPTZ,          -- 開始維修時間
  completed_at     TIMESTAMPTZ,          -- 維修完成時間
  delivered_at     TIMESTAMPTZ           -- 客戶取件時間
);

-- 3. 維修單品項 (維修服務 + 用料)
CREATE TABLE IF NOT EXISTS repair_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id   UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  item_type         repair_item_type NOT NULL DEFAULT 'service',

  -- 服務名稱 (如 "螢幕更換"、"電池更換"、"檢測費")
  service_name      TEXT,
  service_category  TEXT,                -- 分類 (如 "螢幕維修"、"電池維修"、"軟體")

  -- 庫存連結 (若使用庫存中的零件)
  product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id        UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  part_name         TEXT,                -- 零件名稱 (如不連結庫存時使用)

  -- 通用
  description       TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_cost         DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 單價成本
  unit_price        DECIMAL(12,2) NOT NULL DEFAULT 0,  -- 單價售價
  sort_order        INTEGER NOT NULL DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. 狀態變更紀錄
CREATE TABLE IF NOT EXISTS repair_order_status_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_order_id   UUID NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  changed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. 索引
CREATE INDEX IF NOT EXISTS idx_repair_orders_store_id ON repair_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_status ON repair_orders(status);
CREATE INDEX IF NOT EXISTS idx_repair_orders_code ON repair_orders(code);
CREATE INDEX IF NOT EXISTS idx_repair_orders_customer_phone ON repair_orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_repair_orders_device_model_id ON repair_orders(device_model_id);
CREATE INDEX IF NOT EXISTS idx_repair_orders_created_at ON repair_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repair_orders_assigned_to ON repair_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_repair_order_items_order_id ON repair_order_items(repair_order_id);
CREATE INDEX IF NOT EXISTS idx_repair_order_status_history_order_id ON repair_order_status_history(repair_order_id);

-- 6. 自動更新 updated_at
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

-- 7. 自動產生維修單編號 RO-YYYYMMDD-XXXXX
CREATE OR REPLACE FUNCTION generate_repair_order_code()
RETURNS TRIGGER AS $$
DECLARE
  date_part TEXT;
  seq_num INTEGER;
BEGIN
  date_part := to_char(now(), 'YYYYMMDD');
  
  -- 取得當日最大序號
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

-- 8. 狀態變更自動寫入歷史
CREATE OR REPLACE FUNCTION log_repair_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO repair_order_status_history (repair_order_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status::TEXT, NEW.status::TEXT, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 注意：需要先在 repair_orders 加上 updated_by 欄位，或者我們用另一種方式
-- 因目前修訂不打算修改 migration 太多，此 trigger 可稍後再補

-- 9. 利潤自動計算（可用 View 或 Client 端計算）
-- 這裡建立 View 方便查詢
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

COMMENT ON VIEW repair_order_summary IS '維修單彙總檢視，含利潤、毛利率、裝置品牌型號、人員';

-- 10. 啟用 RLS
ALTER TABLE repair_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_order_status_history ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies

-- repair_orders
CREATE POLICY "Users can view repair orders in their stores"
  ON repair_orders FOR SELECT
  USING (
    store_id IS NULL
    OR is_store_member(store_id)
    OR has_role('admin')
  );

CREATE POLICY "Users can insert repair orders"
  ON repair_orders FOR INSERT
  WITH CHECK (
    store_id IS NULL
    OR is_store_member(store_id)
    OR has_role('admin')
  );

CREATE POLICY "Users can update repair orders in their stores"
  ON repair_orders FOR UPDATE
  USING (
    store_id IS NULL
    OR is_store_member(store_id)
    OR has_role('admin')
  );

-- repair_order_items
CREATE POLICY "Users can view items of accessible orders"
  ON repair_order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM repair_orders ro
      WHERE ro.id = repair_order_items.repair_order_id
      AND (ro.store_id IS NULL OR is_store_member(ro.store_id) OR has_role('admin'))
    )
  );

CREATE POLICY "Users can insert items to accessible orders"
  ON repair_order_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM repair_orders ro
      WHERE ro.id = repair_order_items.repair_order_id
      AND (ro.store_id IS NULL OR is_store_member(ro.store_id) OR has_role('admin'))
    )
  );

CREATE POLICY "Users can update items of accessible orders"
  ON repair_order_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM repair_orders ro
      WHERE ro.id = repair_order_items.repair_order_id
      AND (ro.store_id IS NULL OR is_store_member(ro.store_id) OR has_role('admin'))
    )
  );

CREATE POLICY "Users can delete items of accessible orders"
  ON repair_order_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM repair_orders ro
      WHERE ro.id = repair_order_items.repair_order_id
      AND (ro.store_id IS NULL OR is_store_member(ro.store_id) OR has_role('admin'))
    )
  );

-- repair_order_status_history
CREATE POLICY "Users can view status history of accessible orders"
  ON repair_order_status_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM repair_orders ro
      WHERE ro.id = repair_order_status_history.repair_order_id
      AND (ro.store_id IS NULL OR is_store_member(ro.store_id) OR has_role('admin'))
    )
  );

-- 12. 資料版本控制（觸發快取更新）
INSERT INTO data_versions (table_name, version)
VALUES ('repair_orders', to_char(now(), 'YYMMDD') || '-0000')
ON CONFLICT (table_name) DO NOTHING;

-- repair_orders 版本更新 trigger
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
