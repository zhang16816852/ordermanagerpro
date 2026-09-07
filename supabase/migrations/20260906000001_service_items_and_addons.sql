-- ============================================================
-- 20260906000001_service_items_and_addons.sql
-- 服務型商品（運費/包裝）+ A+B 加購 + 前端顯示開關 + 運費月結帳本
-- 統一設計：products.item_type 取代 is_repair_part
--   product     = 一般商品（進訂單目錄）
--   shipping    = 運費（不進訂單目錄、不扣庫存、可月結）
--   packaging   = 包裝（一般庫存商品，並可作為 A+B 加購品）
--   repair_part = 維修零件（不進訂單目錄，原 is_repair_part 遷移）
-- ============================================================

-- ------------------------------------------------------------
-- 1. products.item_type + is_hidden
-- ------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'product';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.item_type IS 'product=一般商品, shipping=運費(不進目錄/不扣庫存/月結), packaging=包裝(庫存商品+可加購), repair_part=維修零件(不進訂單目錄)';
COMMENT ON COLUMN public.products.is_hidden IS '前端(門市目錄/大眾前台)顯示開關：true 時隱藏，後台仍可管理';

-- ------------------------------------------------------------
-- 2. 統一：is_repair_part → item_type='repair_part'，再移除舊欄位
-- ------------------------------------------------------------
UPDATE public.products SET item_type = 'repair_part' WHERE is_repair_part = true;
ALTER TABLE public.products DROP COLUMN IF EXISTS is_repair_part;

-- ------------------------------------------------------------
-- 3. categories.is_hidden（前端顯示開關，兩層控制）
-- ------------------------------------------------------------
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- 4. A+B 加購綁定表
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_addon_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  addon_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  parent_variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  addon_variant_id uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  trigger_condition jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_addon_bindings_not_self CHECK (parent_product_id <> addon_product_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_addon_bindings
  ON public.product_addon_bindings (parent_product_id, parent_variant_id, addon_product_id, addon_variant_id);
CREATE INDEX IF NOT EXISTS idx_product_addon_bindings_parent
  ON public.product_addon_bindings (parent_product_id, parent_variant_id);

ALTER TABLE public.product_addon_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_product_addon_bindings" ON public.product_addon_bindings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins_manage_product_addon_bindings" ON public.product_addon_bindings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- 綁定變動時 bump products 版本（商品 UI 依賴）
CREATE OR REPLACE FUNCTION public.trgfn_bump_products_version_on_addon()
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.bump_data_version('products'::text, 'product_addon_bindings'::text);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_bump_products_version_on_addon ON public.product_addon_bindings;
CREATE TRIGGER trg_bump_products_version_on_addon
  AFTER INSERT OR UPDATE OR DELETE ON public.product_addon_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION public.trgfn_bump_products_version_on_addon();

-- ------------------------------------------------------------
-- 5. order_items：A+B 父行 + 成本快照 + 運費付款方式
--    unit_cost 為佣金成本優先來源（其次 rep_product_costs）
-- ------------------------------------------------------------
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS parent_order_item_id uuid
  REFERENCES public.order_items(id) ON DELETE CASCADE;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS shipping_payment text;

CREATE INDEX IF NOT EXISTS idx_order_items_parent_order_item
  ON public.order_items (order_id, parent_order_item_id);

COMMENT ON COLUMN public.order_items.unit_cost IS '成本快照（佣金計算優先取此值，其次 rep_product_costs）';
COMMENT ON COLUMN public.order_items.shipping_payment IS '運費付款方式：monthly=月結（可走運費結帳），NULL/其他=隨單收費';

-- ------------------------------------------------------------
-- 6. 運費月結帳本
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipping_settlement_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_product_id uuid NOT NULL REFERENCES public.products(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  is_settled boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  entry_id uuid REFERENCES public.accounting_entries(id) ON DELETE SET NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_settlement_periods_range CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_settlement_period
  ON public.shipping_settlement_periods (carrier_product_id, period_start, period_end);

ALTER TABLE public.shipping_settlement_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_shipping_settlements" ON public.shipping_settlement_periods
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins_manage_shipping_settlements" ON public.shipping_settlement_periods
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::system_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::system_role));

-- ------------------------------------------------------------
-- 7. 運費型商品一律不寫 inventory_movements（統一：不進庫存，出貨 RPC 無需改）
--    BEFORE ROW trigger 依字母序先於 trg_sync_inventory_on_movement 觸發，
--    RETURN NULL 使整列跳過（含 product_inventory 同步）。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trgfn_skip_shipping_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = NEW.product_id AND item_type = 'shipping') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_a_skip_shipping_inventory ON public.inventory_movements;
CREATE TRIGGER trg_a_skip_shipping_inventory
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.trgfn_skip_shipping_inventory();

-- ------------------------------------------------------------
-- 8. storefront 同步：隱藏商品與非一般(運費/維修零件)商品不進大眾前台
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_storefront_items(p_product_id UUID)
RETURNS void AS $$
DECLARE
    v_variant RECORD;
    v_model RECORD;
    v_display_name TEXT;
    v_slug TEXT;
    v_active_models UUID[];
BEGIN
    -- 隱藏或非一般商品的產品：清除前台項目並結束
    IF EXISTS (
      SELECT 1 FROM public.products
      WHERE id = p_product_id
        AND (is_hidden = true OR item_type NOT IN ('product', 'packaging'))
    ) THEN
      DELETE FROM public.storefront_items WHERE product_id = p_product_id;
      RETURN;
    END IF;

    FOR v_variant IN 
        SELECT id, name FROM public.product_variants WHERE product_id = p_product_id
    LOOP
        v_active_models := ARRAY[]::UUID[];
        
        FOR v_model IN
            WITH variant_models AS (
                SELECT model_id FROM public.device_model_links 
                WHERE entity_id = v_variant.id AND entity_type = 'variant'
                UNION
                SELECT model_id FROM public.device_model_links 
                WHERE entity_id = p_product_id AND entity_type = 'product'
                UNION
                SELECT i.model_id FROM public.device_model_group_links gl
                JOIN public.device_model_group_items i ON gl.group_id = i.group_id
                WHERE gl.entity_id = v_variant.id AND gl.entity_type = 'variant'
                UNION
                SELECT i.model_id FROM public.device_model_group_links gl
                JOIN public.device_model_group_items i ON gl.group_id = i.group_id
                WHERE gl.entity_id = p_product_id AND gl.entity_type = 'product'
            ),
            exclusions AS (
                SELECT model_id FROM public.device_model_exclusions
                WHERE entity_id = v_variant.id AND entity_type = 'variant'
                UNION
                SELECT model_id FROM public.device_model_exclusions
                WHERE entity_id = p_product_id AND entity_type = 'product'
            )
            SELECT m.id, m.name 
            FROM variant_models vm
            JOIN public.device_models m ON vm.model_id = m.id
            WHERE vm.model_id NOT IN (SELECT model_id FROM exclusions)
        LOOP
            IF v_variant.name LIKE '%{model}%' THEN
                v_display_name := REPLACE(v_variant.name, '{model}', v_model.name);
            ELSE
                v_display_name := '(' || v_model.name || ') ' || v_variant.name;
            END IF;

            v_slug := 'item-' || encode(digest(v_variant.id::text || v_model.id::text, 'sha1'), 'hex');

            INSERT INTO public.storefront_items (product_id, variant_id, model_id, display_name, slug, updated_at)
            VALUES (p_product_id, v_variant.id, v_model.id, v_display_name, v_slug, now())
            ON CONFLICT (variant_id, model_id) DO UPDATE 
            SET display_name = EXCLUDED.display_name,
                updated_at = now();

            v_active_models := array_append(v_active_models, v_model.id);
        END LOOP;

        DELETE FROM public.storefront_items 
        WHERE variant_id = v_variant.id 
        AND model_id != ALL(v_active_models);
    END LOOP;

    DELETE FROM public.storefront_items
    WHERE product_id = p_product_id 
    AND variant_id NOT IN (SELECT id FROM public.product_variants WHERE product_id = p_product_id);

    PERFORM public.bump_data_version('storefront_items'::text, NULL::text);
END;
$$ LANGUAGE plpgsql;