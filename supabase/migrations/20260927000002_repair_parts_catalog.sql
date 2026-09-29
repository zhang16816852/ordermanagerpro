-- 維修零件目錄（repair parts catalog）
--
-- 目的：把「零件型錄」從「商品」抽離出來。
--   上層 repair_parts  = 型號 / 名稱 / 標籤 的型錄（31 列，由舊商品合併而來）
--   下層 products(item_type='repair_part') = 真正有庫存、能進貨/扣料/算 FIFO 成本的實體
--   兩層以 repair_part_variants(product_id, variant_id) 連結。
--
-- 因此採 additive 設計：repair_order_items 既有 product_id / variant_id / part_name
-- 全部保留不動，庫存、進貨、批次、扣料、採購成本四條既有路徑零改動。
-- 只需在選定零件時把解析出的 product_id / variant_id 一併寫入即可。

-- ============================================================================
-- 1. repair_parts（型錄主檔）
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.repair_parts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = 通用零件（不綁單一型號）。承接舊資料中無變體、型號不明的零件。
  device_model_id     uuid REFERENCES public.device_models(id) ON DELETE SET NULL,
  name                text NOT NULL,
  tags                text[] NOT NULL DEFAULT '{}',
  description         text,
  -- 預設供應商：純型錄中繼資料，供日後擴充叫料流程帶入（本次不接進 RepairPurchaseDialog）
  supplier_id         uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  default_unit_cost   numeric(12,2) NOT NULL DEFAULT 0,
  default_unit_price  numeric(12,2) NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_repair_parts_name_not_blank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE public.repair_parts IS '維修零件型錄（與 products 庫存實體分離）';
COMMENT ON COLUMN public.repair_parts.device_model_id IS 'NULL = 通用零件';
COMMENT ON COLUMN public.repair_parts.tags IS '零件標籤，例如 原廠 / 副廠 / OLED / BSMI認證';

-- 同一型號下零件名稱不可重複。NULL 型號以零值 UUID 佔位，避免 NULL 破壞唯一性。
CREATE UNIQUE INDEX IF NOT EXISTS uq_repair_parts_model_name
  ON public.repair_parts (COALESCE(device_model_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

CREATE INDEX IF NOT EXISTS idx_repair_parts_device_model
  ON public.repair_parts (device_model_id);

CREATE INDEX IF NOT EXISTS idx_repair_parts_name
  ON public.repair_parts (name);

-- 標籤檢索
CREATE INDEX IF NOT EXISTS idx_repair_parts_tags
  ON public.repair_parts USING GIN (tags);

-- Picker 常用「某型號下的啟用零件，依 sort_order」查詢
CREATE INDEX IF NOT EXISTS idx_repair_parts_active_picker
  ON public.repair_parts (device_model_id, sort_order)
  WHERE is_active;

DROP TRIGGER IF EXISTS trg_repair_parts_updated_at ON public.repair_parts;
CREATE TRIGGER trg_repair_parts_updated_at
  BEFORE UPDATE ON public.repair_parts
  FOR EACH ROW EXECUTE FUNCTION trgfn_set_updated_at();

-- ============================================================================
-- 2. repair_part_variants（零件 ↔ 庫存商品連結）
--    一個零件可對多個商品變體（如「IP12 手機背蓋」有 6 個顏色）。
--    零件被選用時由此表解析出下游庫存所需的 product_id / variant_id。
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.repair_part_variants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_part_id      uuid NOT NULL REFERENCES public.repair_parts(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- NULL = 綁到「產品層級」（舊資料中無變體的商品）
  variant_id          uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  -- 區分用規格／顏色，僅在該零件有多個連結時有意義
  spec_label          text,
  is_default          boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_repair_part_variant UNIQUE (repair_part_id, product_id, variant_id)
);

COMMENT ON TABLE public.repair_part_variants IS '維修零件與庫存商品（產品/變體）的連結表';
COMMENT ON COLUMN public.repair_part_variants.spec_label IS '規格／顏色標籤，供多變體時選擇';

CREATE INDEX IF NOT EXISTS idx_repair_part_variants_part
  ON public.repair_part_variants (repair_part_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_repair_part_variants_variant
  ON public.repair_part_variants (variant_id);

-- UNIQUE 對 NULL 不視為相等，故「無變體」連結另以部分唯一索引防重
CREATE UNIQUE INDEX IF NOT EXISTS uq_repair_part_variant_product_only
  ON public.repair_part_variants (repair_part_id, product_id)
  WHERE variant_id IS NULL;

-- ============================================================================
-- 3. repair_part_tags（常用標籤字典）
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.repair_part_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_repair_part_tags_name UNIQUE (name),
  CONSTRAINT chk_repair_part_tags_name_not_blank CHECK (btrim(name) <> '')
);

COMMENT ON TABLE public.repair_part_tags IS '維修零件常用標籤字典（供零件表單一鍵挑選）';

-- ============================================================================
-- 4. repair_order_items 關聯欄位
--    ON DELETE SET NULL：刪掉型錄不應影響既有維修單的歷史明細。
--    part_name / product_id / variant_id 皆保留，歷史資料與舊流程完全不受影響。
-- ============================================================================
ALTER TABLE public.repair_order_items
  ADD COLUMN IF NOT EXISTS repair_part_id uuid
  REFERENCES public.repair_parts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_order_items_repair_part
  ON public.repair_order_items (repair_part_id);

COMMENT ON COLUMN public.repair_order_items.repair_part_id IS '所選維修零件型錄（NULL = 未綁型錄，舊資料或自訂材料）';

-- ============================================================================
-- 5. RLS —— 完全比照 repair_checklist_library 既有慣例
--    管理權限僅 admin（門市「建立零件」鈕同樣只在 admin 顯示，見 ItemsFieldsSection 的 mode 守門），
--    所有登入者可讀取（供維修表單零件選擇器使用）。
-- ============================================================================
ALTER TABLE public.repair_parts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_part_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_part_tags    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage repair parts" ON public.repair_parts;
CREATE POLICY "Admins can manage repair parts"
  ON public.repair_parts FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role));

DROP POLICY IF EXISTS "Users can view repair parts" ON public.repair_parts;
CREATE POLICY "Users can view repair parts"
  ON public.repair_parts FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage repair part variants" ON public.repair_part_variants;
CREATE POLICY "Admins can manage repair part variants"
  ON public.repair_part_variants FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role));

DROP POLICY IF EXISTS "Users can view repair part variants" ON public.repair_part_variants;
CREATE POLICY "Users can view repair part variants"
  ON public.repair_part_variants FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage repair part tags" ON public.repair_part_tags;
CREATE POLICY "Admins can manage repair part tags"
  ON public.repair_part_tags FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role));

DROP POLICY IF EXISTS "Users can view repair part tags" ON public.repair_part_tags;
CREATE POLICY "Users can view repair part tags"
  ON public.repair_part_tags FOR SELECT TO authenticated
  USING (true);
